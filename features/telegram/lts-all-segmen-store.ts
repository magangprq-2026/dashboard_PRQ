// Penyimpanan sementara untuk LTS ALL SEGMEN.
//
// Webhook Telegram berjalan stateless dan tiga file datang sebagai tiga request terpisah (kadang bersamaan),
// jadi tiap file disimpan dulu (gzip + base64) di tabel dashboard_state yang sudah ada. Begitu T_REG, T_NAL, dan
// T_PS lengkap, SATU request memenangkan "klaim" lalu membuat dan mengirim workbook. Tanpa skema database baru.
import { gunzipSync, gzipSync } from "node:zlib";
import { neon } from "@neondatabase/serverless";
import { dbConfig } from "@/features/shared/backend/database/db";
import { readDashboardStateByKey, writeDashboardStateByKey } from "@/features/shared/backend/database/dashboard-state";
import { ALL_SEGMEN_KINDS, type AllSegmenKind } from "@/features/telegram/lts-all-segmen";

const PART_KEY = (kind: AllSegmenKind) => `telegram:lts-allsegmen:${kind}`;
const GROUP_KEY = (groupId: string) => `telegram:lts-allsegmen:group:${groupId}`;
const CLAIM_KEY = (signature: string) => `telegram:lts-allsegmen:claim:${signature}`;

/** Jeda maksimum antar file dalam satu rangkaian. Sama dengan LTS biasa (env LTS_BATCH_WINDOW_MINUTES, default 30). */
export const ALL_SEGMEN_WINDOW_MINUTES = Math.max(1, Number(process.env.LTS_BATCH_WINDOW_MINUTES) || 30);
const GROUP_TTL_MINUTES = 60;

type StoredPart = { fileName: string; uploadedAt: string; csvGzipBase64?: string; consumed?: boolean };
export type AllSegmenPart = { fileName: string; uploadedAt: string; buffer: Buffer };

function isStored(value: unknown): value is StoredPart {
  const v = value as Partial<StoredPart> | null;
  return Boolean(v && typeof v === "object" && typeof v.fileName === "string" && typeof v.uploadedAt === "string");
}

async function readState(key: string): Promise<unknown> {
  const result = await readDashboardStateByKey(key);
  return "state" in result.body ? result.body.state : null;
}

const minutesSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60000;

export async function saveAllSegmenPart(kind: AllSegmenKind, fileName: string, csv: Buffer): Promise<void> {
  const payload: StoredPart = { csvGzipBase64: gzipSync(csv, { level: 6 }).toString("base64"), fileName, uploadedAt: new Date().toISOString() };
  const result = await writeDashboardStateByKey(PART_KEY(kind), payload);
  if ("error" in result.body) throw new Error(String(result.body.error));
}

export type AllSegmenProgress = {
  /** file yang sudah masuk dan masih berlaku (belum dipakai, belum lewat jeda) */
  received: Partial<Record<AllSegmenKind, AllSegmenPart>>;
  missing: AllSegmenKind[];
  complete: boolean;
  /** pengenal unik rangkaian ini (dari waktu upload ketiga file), dipakai untuk klaim */
  signature: string;
};

export async function loadAllSegmenProgress(): Promise<AllSegmenProgress> {
  const received: AllSegmenProgress["received"] = {};
  const stamps: string[] = [];
  for (const kind of ALL_SEGMEN_KINDS) {
    const state = await readState(PART_KEY(kind));
    if (!isStored(state) || state.consumed || !state.csvGzipBase64) continue;
    if (minutesSince(state.uploadedAt) > ALL_SEGMEN_WINDOW_MINUTES) continue;
    received[kind] = { buffer: gunzipSync(Buffer.from(state.csvGzipBase64, "base64")), fileName: state.fileName, uploadedAt: state.uploadedAt };
    stamps.push(`${kind}${new Date(state.uploadedAt).getTime()}`);
  }
  const missing = ALL_SEGMEN_KINDS.filter((k) => !received[k]);
  return { complete: missing.length === 0, missing, received, signature: stamps.join("-") };
}

/** true bila request INI yang berhak membuat workbook (insert atomik; request lain yang bersamaan mendapat false). */
export async function claimAllSegmenBuild(signature: string): Promise<boolean> {
  const config = dbConfig();
  if (!config || !/^[a-z_][a-z0-9_]*$/.test(config.table)) return false;
  const sql = neon(config.url);
  try {
    const result = (await sql.query(`insert into public."${config.table}" (key, payload, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do nothing returning key`, [
      CLAIM_KEY(signature),
      JSON.stringify({ at: new Date().toISOString() }),
    ])) as unknown;
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Setelah workbook terkirim: isi file diganti penanda kecil supaya tidak terpakai dua kali dan DB tetap ringan. */
export async function consumeAllSegmenParts(parts: AllSegmenProgress["received"]): Promise<void> {
  for (const kind of ALL_SEGMEN_KINDS) {
    const p = parts[kind];
    if (p) await writeDashboardStateByKey(PART_KEY(kind), { consumed: true, fileName: p.fileName, uploadedAt: p.uploadedAt });
  }
}

// --- Album Telegram: caption hanya menempel di SATU file, file lain dalam album tanpa caption ---------------
export async function flagAllSegmenGroup(groupId: string): Promise<void> {
  await writeDashboardStateByKey(GROUP_KEY(groupId), { at: new Date().toISOString() });
}

export async function isAllSegmenGroup(groupId: string): Promise<boolean> {
  const state = (await readState(GROUP_KEY(groupId))) as { at?: string } | null;
  return Boolean(state?.at && minutesSince(state.at) <= GROUP_TTL_MINUTES);
}

/** File album tanpa caption bisa tiba lebih dulu daripada file bercaption: tunggu sebentar sebelum menyerah. */
export async function waitForAllSegmenGroup(groupId: string, attempts = 3, delayMs = 1200): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (await isAllSegmenGroup(groupId)) return true;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}
