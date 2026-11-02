// Akses upload lewat bot: user baru meminta akses, admin menyetujui/menolak langsung dari Telegram.
//  - Admin            : TELEGRAM_ADMIN_USER_IDS (pisahkan koma). Kosong = tidak ada admin (tidak ada yang bisa menyetujui).
//  - Pengunggah tetap : TELEGRAM_ALLOWED_USER_IDS (cara lama, tetap berlaku, tidak bisa dicabut dari bot).
//  - Pengunggah dari bot: disimpan di dashboard_state, key telegram:access:user:<id>; permintaan: telegram:access:req:<id>.
import { dbQuery } from "@/features/shared/backend/database/db";
import { writeDashboardStateByKey } from "@/features/shared/backend/database/dashboard-state";

export type AccessPerson = { id: string; name: string; username: string | null; at: number; by?: string | null };

const REQ = "telegram:access:req:";
const USER = "telegram:access:user:";

const stateTable = () => {
  const t = process.env.DASHBOARD_STATE_TABLE || "dashboard_state";
  if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw new Error("Nama tabel database tidak valid.");
  return t;
};

const envList = (name: string) => (process.env[name] ?? "").split(",").map((v) => v.trim()).filter(Boolean);

export function adminIds() {
  return envList("TELEGRAM_ADMIN_USER_IDS");
}

export function isAdmin(userId: string | null) {
  return Boolean(userId && adminIds().includes(userId));
}

export function isEnvUploader(userId: string | null) {
  return Boolean(userId && (envList("TELEGRAM_ALLOWED_USER_IDS").includes(userId) || isAdmin(userId)));
}

type Row = { key: string; payload: Partial<AccessPerson> | null };

function toPerson(prefix: string, row: Row): AccessPerson {
  const id = row.key.slice(prefix.length);
  return { id, name: row.payload?.name || id, username: row.payload?.username ?? null, at: Number(row.payload?.at ?? 0), by: row.payload?.by ?? null };
}

async function getRow(key: string): Promise<Row | null> {
  const result = await dbQuery<Row[]>(`select key, payload from public."${stateTable()}" where key = $1 limit 1`, [key]);
  return result.data?.[0] ?? null;
}

async function listRows(prefix: string): Promise<AccessPerson[]> {
  const result = await dbQuery<Row[]>(`select key, payload from public."${stateTable()}" where key like $1 order by updated_at desc limit 30`, [`${prefix}%`]);
  return (result.data ?? []).map((row) => toPerson(prefix, row));
}

async function deleteKey(key: string): Promise<boolean> {
  const result = await dbQuery<{ key: string }[]>(`delete from public."${stateTable()}" where key = $1 returning key`, [key]);
  return (result.data?.length ?? 0) > 0;
}

/** Uploader sah: daftar env/admin, atau disetujui lewat bot. */
export async function isUploaderAllowed(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  if (isEnvUploader(userId)) return true;
  try {
    return Boolean(await getRow(USER + userId));
  } catch {
    return false;
  }
}

/** Catat permintaan akses. `fresh` = true bila belum pernah diminta (admin baru perlu diberi tahu). */
export async function requestAccess(person: Omit<AccessPerson, "at">): Promise<{ fresh: boolean }> {
  const existing = await getRow(REQ + person.id);
  if (existing) return { fresh: false };
  await writeDashboardStateByKey(REQ + person.id, { name: person.name, username: person.username, at: Date.now() });
  return { fresh: true };
}

export async function pendingRequest(id: string): Promise<AccessPerson | null> {
  const row = await getRow(REQ + id);
  return row ? toPerson(REQ, row) : null;
}

/** Setujui: hanya berhasil bila permintaan masih ada (atomik lewat DELETE ... RETURNING). */
export async function approveAccess(id: string, adminName: string): Promise<AccessPerson | null> {
  const result = await dbQuery<Row[]>(`delete from public."${stateTable()}" where key = $1 returning key, payload`, [REQ + id]);
  const row = result.data?.[0];
  if (!row) return null;
  const person = toPerson(REQ, row);
  await writeDashboardStateByKey(USER + id, { name: person.name, username: person.username, at: Date.now(), by: adminName });
  return person;
}

export async function rejectAccess(id: string): Promise<AccessPerson | null> {
  const result = await dbQuery<Row[]>(`delete from public."${stateTable()}" where key = $1 returning key, payload`, [REQ + id]);
  const row = result.data?.[0];
  return row ? toPerson(REQ, row) : null;
}

export async function revokeAccess(id: string): Promise<boolean> {
  return deleteKey(USER + id);
}

export const listPending = () => listRows(REQ);
export const listApproved = () => listRows(USER);
