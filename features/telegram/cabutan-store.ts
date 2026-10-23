// Menyimpan CSV Data Cabutan terakhir yang diupload lewat bot, supaya tombol "Unduh Data Cabutan" di menu
// bisa membuat ulang DO_<Bulan>.xlsx kapan saja. Memakai tabel dashboard_state yang sudah ada (tanpa skema baru).
// CSV dikompres gzip lalu disimpan sebagai base64 agar ukurannya kecil.
import { gunzipSync, gzipSync } from "node:zlib";
import { readDashboardStateByKey, writeDashboardStateByKey } from "@/features/shared/backend/database/dashboard-state";

const STATE_KEY = "telegram:cabutan:last";

export type CabutanMeta = {
  fileName: string;
  periods: number[];
  rowCount: number;
  uploadedAt: string;
  uploadedBy: string | null;
};

type StoredCabutan = CabutanMeta & { csvGzipBase64: string };

function isStored(value: unknown): value is StoredCabutan {
  const v = value as Partial<StoredCabutan> | null;
  return Boolean(v && typeof v === "object" && typeof v.csvGzipBase64 === "string" && typeof v.fileName === "string");
}

export async function saveLastCabutan(csv: Buffer, meta: Omit<CabutanMeta, "uploadedAt">): Promise<boolean> {
  const payload: StoredCabutan = {
    ...meta,
    csvGzipBase64: gzipSync(csv, { level: 9 }).toString("base64"),
    uploadedAt: new Date().toISOString(),
  };
  const result = await writeDashboardStateByKey(STATE_KEY, payload);
  return !("error" in result.body);
}

async function readStored(): Promise<StoredCabutan | null> {
  const result = await readDashboardStateByKey(STATE_KEY);
  const state = "state" in result.body ? result.body.state : null;
  return isStored(state) ? state : null;
}

/** Info upload terakhir (tanpa isi file), atau null bila belum pernah ada upload. */
export async function lastCabutanMeta(): Promise<CabutanMeta | null> {
  const s = await readStored();
  if (!s) return null;
  const { csvGzipBase64: _omit, ...meta } = s;
  void _omit;
  return meta;
}

/** CSV asli dari upload terakhir, atau null bila belum ada. */
export async function loadLastCabutanCsv(): Promise<{ csv: Buffer; meta: CabutanMeta } | null> {
  const s = await readStored();
  if (!s) return null;
  const { csvGzipBase64, ...meta } = s;
  return { csv: gunzipSync(Buffer.from(csvGzipBase64, "base64")), meta };
}

// ---------- Mode "siap menerima CSV cabutan" ----------
// CSV T_NAL untuk Data Cabutan dan file CAPS (NAL) milik LTS berasal dari ekspor Tableau yang sama (kolom identik),
// jadi isinya tidak bisa dibedakan. Karena itu CSV baru dianggap Data Cabutan setelah pengguna membuka menu
// Data Cabutan (atau menulis "cabutan" di caption); tanpa itu file diproses sebagai upload LTS seperti biasa.
export const CABUTAN_PENDING_MINUTES = 15;
const pendingKey = (chatId: number) => `telegram:cabutan:pending:${chatId}`;

/** Aktifkan mode cabutan untuk chat ini selama CABUTAN_PENDING_MINUTES menit. */
export async function armCabutan(chatId: number): Promise<boolean> {
  const result = await writeDashboardStateByKey(pendingKey(chatId), { until: Date.now() + CABUTAN_PENDING_MINUTES * 60_000 });
  return !("error" in result.body);
}

/** Apakah mode cabutan masih aktif untuk chat ini? (tidak mengubah apa pun) */
export async function isCabutanArmed(chatId: number): Promise<boolean> {
  const result = await readDashboardStateByKey(pendingKey(chatId));
  const state = "state" in result.body ? (result.body.state as { until?: unknown } | null) : null;
  return typeof state?.until === "number" && state.until > Date.now();
}

/** Matikan mode cabutan (dipanggil setelah satu CSV berhasil dikonversi). */
export async function disarmCabutan(chatId: number): Promise<void> {
  await writeDashboardStateByKey(pendingKey(chatId), { until: 0 });
}
