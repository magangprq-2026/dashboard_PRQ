// Upload data LTS (SALES = ps, CAPS = nal, CT0 = reg) lewat bot Telegram.
// Logika baca/validasi sama dengan upload MASTER LTS di website.
import { neon } from "@neondatabase/serverless";
import * as XLSX from "xlsx";
import { dbConfig } from "@/features/shared/backend/database/db";
import {
  ltsDatasetDefinitions,
  periodKeyFromLtsRows,
  periodLabelFromLtsPeriodKey,
  validateLtsDataset,
  type LtsCell,
  type LtsDatasetKey,
  type LtsMasterRow,
  type LtsUploadedDataset,
} from "@/features/lts/domain/reporting/reporting";
import { columnValues, delimitedRows, hasWmsMasterHeader } from "@/features/telegram/master-upload";

export const LTS_DATASET_KEYS: LtsDatasetKey[] = ["sales", "caps", "ct0"];

const COMPACT_COLUMNS: Record<LtsDatasetKey, string[]> = {
  sales: ["WITEL", "TELKOM_DAERAH", "Jml_Sales", "COUNT_SID", "PRODUK", "PRODUCT", "TYPE_LAYANAN", "NPER", "PERIOD", "LAST_UPDATED_DATE"],
  caps: ["L_WITEL", "WITEL (NEW_TERRITORY)", "TWITEL", "TELKOM_DAERAH", "L_PRODUK", "PRODUK", "PRODUCT", "COUNT_SID", "SSL_CT0", "SSL_DO", "PERIODE", "PERIODE_CT0_BAYAR"],
  ct0: ["Witel", "Witel Bill", "OLD_WITEL", "Datel", "Sto Desc", "Produk", "Bayar Desc", "STATUS_PAYMENT", "JML LYN", "Number of Records", "JML_BLN_NUNGGAK", "TUNGGAKAN", "Nper", "TAHUN", "LAST_PERIODE"],
};

const norm = (value: unknown) => String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");

export function ltsDatasetLabel(key: LtsDatasetKey) {
  return key === "sales" ? "Sales (PS)" : key === "caps" ? "CAPS (NAL)" : "CT0 (REG)";
}

function readRows(buffer: Buffer, datasetKey?: LtsDatasetKey): unknown[][] {
  const delimited = delimitedRows(buffer);
  if (delimited) return delimited;
  const workbook = XLSX.read(buffer, { cellDates: true, type: "buffer" });
  const preferred = datasetKey ? norm(ltsDatasetDefinitions[datasetKey].sheetName) : "";
  const name = workbook.SheetNames.find((n) => norm(n) === preferred) ?? workbook.SheetNames[0];
  if (!name) throw new Error("File tidak memiliki sheet yang bisa dibaca.");
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { blankrows: false, defval: null, header: 1, raw: true });
}

function headerHasAll(rows: unknown[][], required: string[]) {
  const first = (rows[0] ?? []).map(norm);
  return required.every((column) => first.includes(norm(column)));
}

function hintFromName(fileName: string, caption?: string): LtsDatasetKey | null {
  const hint = `${caption ?? ""} ${fileName}`.toLowerCase();
  if (/(^|[^a-z])(ps|sales)([^a-z]|$)|t_ps|sales_master/.test(hint)) return "sales";
  if (/(^|[^a-z])(nal|caps)([^a-z]|$)|caps_master/.test(hint)) return "caps";
  if (/(^|[^a-z])(reg|ct0)([^a-z]|$)|ct0_master/.test(hint)) return "ct0";
  return null;
}

// File MASTER WMS memakai kolom yang sama persis dengan file PS (Sales) LTS: keduanya ekspor Tableau dengan 117+ kolom
// yang sama, sehingga header saja tidak bisa membedakannya. Bedanya ada di isi: file WMS hanya berisi produk WMS,
// sedangkan PS LTS memuat HSI (BASIC/BISNIS) juga.
const EXPLICIT_PS_HINT = /(^|[^a-z])(ps|sales)([^a-z]|$)|t_ps|sales_master/;
const WMS_NAME_HINT = /wm+e?s+/; // wms, wmes, wmess, ...

/**
 * File yang header-nya cocok dengan Sales LTS, tetapi sebenarnya MASTER WMS. Urutan keputusan:
 *   1. Nama file/caption jelas menyebut ps/sales -> LTS (Sales).
 *   2. Nama file/caption menyebut wms -> WMS.
 *   3. Tanpa petunjuk nama: bila kolom PRODUK terisi dan tidak ada satu pun baris HSI -> WMS; selain itu LTS.
 */
function isWmsMasterFile(fileName: string, caption: string | undefined, buffer: Buffer): boolean {
  if (!hasWmsMasterHeader(buffer)) return false;
  const hint = `${caption ?? ""} ${fileName}`.toLowerCase();
  if (EXPLICIT_PS_HINT.test(hint)) return false;
  if (WMS_NAME_HINT.test(hint)) return true;
  const produk = columnValues(buffer, "PRODUK");
  if (!produk) return false;
  const filled = produk.filter((v) => v !== "");
  return filled.length > 0 && !filled.some((v) => /HSI/i.test(v));
}

/** Header kolom menang atas caption/nama file (mis. caption "WMS" pada file PS), kecuali file MASTER WMS yang berformat sama dengan PS. Null = bukan data LTS. */
export function detectLtsDataset(fileName: string, caption: string | undefined, buffer: Buffer): LtsDatasetKey | null {
  let matches: LtsDatasetKey[] = [];
  try {
    const rows = readRows(buffer);
    matches = LTS_DATASET_KEYS.filter((key) => headerHasAll(rows, ltsDatasetDefinitions[key].requiredColumns));
  } catch {
    return hintFromName(fileName, caption);
  }
  if (matches.includes("sales") && isWmsMasterFile(fileName, caption, buffer)) return null;
  if (matches.length === 1) return matches[0];
  const hint = hintFromName(fileName, caption);
  if (matches.length > 1) return hint && matches.includes(hint) ? hint : matches[0];
  return null;
}

function cleanCell(value: unknown): LtsCell {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export function parseLtsDataset(datasetKey: LtsDatasetKey, fileName: string, buffer: Buffer): LtsUploadedDataset {
  const definition = ltsDatasetDefinitions[datasetKey];
  const sheetRows = readRows(buffer, datasetKey);
  if (sheetRows.length === 0) throw new Error("File kosong.");
  const rawHeaders = (sheetRows[0] ?? []).map((v) => String(v ?? "").trim());
  const dataRows = headerHasAll(sheetRows, definition.requiredColumns) ? sheetRows.slice(1) : sheetRows;
  validateLtsDataset(datasetKey, rawHeaders, dataRows as LtsMasterRow[]);

  const compactHeaders = COMPACT_COLUMNS[datasetKey];
  const headerMap = new Map(rawHeaders.map((h, i) => [norm(h), i]));
  const indexes = compactHeaders.map((c) => headerMap.get(norm(c)) ?? -1);
  const rows = dataRows
    .map((row) => indexes.map((i) => (i >= 0 ? cleanCell(row[i]) : null)))
    .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""));
  if (rows.length === 0) throw new Error(`${definition.label} tidak memiliki baris data valid.`);
  validateLtsDataset(datasetKey, compactHeaders, rows);
  return {
    datasetKey,
    fileName,
    headers: compactHeaders,
    periodKey: periodKeyFromLtsRows(datasetKey, compactHeaders, rows),
    rows,
    rowCount: rows.length,
    uploadedAt: new Date().toISOString(),
  };
}

/**
 * Simpan satu dataset ke state "lts" dalam SATU statement SQL atomik, supaya 3 file yang dikirim
 * bersamaan (dan diproses paralel) tidak saling menimpa.
 */
export async function importLtsDataset(dataset: LtsUploadedDataset) {
  const config = dbConfig();
  if (!config) throw new Error("Database belum dikonfigurasi (DATABASE_URL).");
  const table = config.table;
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error("Nama tabel database tidak valid.");
  const sql = neon(config.url);
  const now = new Date().toISOString();
  const text =
    `insert into public."${table}" (key, payload, updated_at) values ('lts', ` +
    `jsonb_build_object('datasetArchive', jsonb_build_object($1::text, jsonb_build_object($2::text, $3::jsonb)), 'datasets', '{}'::jsonb, 'selectedPeriodKey', $2::text, 'updatedAt', $4::text), now()) ` +
    `on conflict (key) do update set updated_at = now(), payload = ` +
    `jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(` +
    `coalesce("${table}".payload, '{}'::jsonb), '{datasetArchive}', coalesce("${table}".payload->'datasetArchive', '{}'::jsonb)), ` +
    `array['datasetArchive', $1::text], coalesce("${table}".payload->'datasetArchive'->$1::text, '{}'::jsonb)), ` +
    `array['datasetArchive', $1::text, $2::text], $3::jsonb), ` +
    `'{selectedPeriodKey}', to_jsonb($2::text)), '{datasets}', '{}'::jsonb)`;
  try {
    await sql.query(text, [dataset.datasetKey, dataset.periodKey, JSON.stringify(dataset), now]);
  } catch {
    throw new Error("Gagal menyimpan data LTS ke database.");
  }
}

// Ketiga file LTS (ps, nal, reg) harus dikirim dalam satu rangkaian upload.
// Kelengkapan TIDAK dihitung dari data yang sudah ada di database (data lama dari upload web, kiriman kemarin, atau
// percobaan sebelumnya tidak boleh membuat satu file dianggap "lengkap"). Sebagai gantinya, setiap file yang masuk
// dicatat ke "rangkaian" (payload.ltsBatch) dan report hanya dikirim ketika ketiga file ada di rangkaian yang SAMA.
//
// Rangkaian baru dimulai (hanya berisi file yang baru masuk) bila salah satu terjadi:
//   - belum ada rangkaian, atau rangkaian sebelumnya sudah dikirim report-nya;
//   - jenis file yang sama dikirim lagi (mis. PS dikirim dua kali);
//   - periodenya berbeda;
//   - jeda sejak file terakhir lebih dari LTS_BATCH_WINDOW_MINUTES (default 30 menit).
export const LTS_BATCH_WINDOW_MINUTES = Math.max(1, Number(process.env.LTS_BATCH_WINDOW_MINUTES) || 30);

export type LtsProgress = {
  /** Kunci unik rangkaian yang lengkap (agar report hanya dikirim sekali). Null bila belum lengkap. */
  batchKey: string | null;
  complete: boolean;
  missing: LtsDatasetKey[];
  periodKey: string;
  periodLabel: string;
  present: Record<LtsDatasetKey, boolean>;
};

type LtsBatch = { periodKey?: unknown; received?: Record<string, unknown> | null; startedAt?: unknown };

/** Murni (tanpa database): ubah isi rangkaian menjadi status kelengkapan. */
export function progressFromLtsBatch(batch: LtsBatch | null | undefined, periodKey: string): LtsProgress {
  const received = batch?.received && typeof batch.received === "object" ? batch.received : {};
  const present = {} as Record<LtsDatasetKey, boolean>;
  for (const key of LTS_DATASET_KEYS) present[key] = typeof received[key] === "string";
  const missing = LTS_DATASET_KEYS.filter((key) => !present[key]);
  const complete = missing.length === 0;
  return {
    batchKey: complete ? `${periodKey}|${String(batch?.startedAt ?? "")}|${LTS_DATASET_KEYS.map((key) => String(received[key])).join("|")}` : null,
    complete,
    missing,
    periodKey,
    periodLabel: periodLabelFromLtsPeriodKey(periodKey),
    present,
  };
}

/**
 * Catat file yang baru disimpan ke rangkaian upload (SATU statement SQL atomik, row terkunci selama update, jadi 3 file
 * yang diproses paralel tidak saling menimpa dan hanya proses terakhir yang melihat rangkaian lengkap).
 * Harus dipanggil SETELAH importLtsDataset (baris "lts" sudah ada).
 */
export async function registerLtsUpload(dataset: LtsUploadedDataset): Promise<LtsProgress> {
  const config = dbConfig();
  if (!config) throw new Error("Database belum dikonfigurasi (DATABASE_URL).");
  const table = config.table;
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error("Nama tabel database tidak valid.");
  const sql = neon(config.url);
  const batch = `payload->'ltsBatch'`;
  const text =
    `update public."${table}" set updated_at = now(), payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{ltsBatch}', ` +
    `case when jsonb_typeof(${batch}) is distinct from 'object' ` +
    `or ${batch}->>'periodKey' is distinct from $1::text ` +
    `or coalesce(${batch}->>'reported', '') = 'true' ` +
    `or jsonb_exists(${batch}->'received', $2::text) ` +
    `or ($3::timestamptz - coalesce((${batch}->>'lastAt')::timestamptz, '-infinity'::timestamptz)) > make_interval(mins => $4::int) ` +
    `then jsonb_build_object('periodKey', $1::text, 'startedAt', $3::text, 'lastAt', $3::text, 'reported', false, 'received', jsonb_build_object($2::text, $3::text)) ` +
    `else jsonb_set(jsonb_set(${batch}, array['received', $2::text], to_jsonb($3::text)), '{lastAt}', to_jsonb($3::text)) end) ` +
    `where key = 'lts' returning ${batch} as batch`;
  let rows: unknown[];
  try {
    const result = (await sql.query(text, [dataset.periodKey, dataset.datasetKey, new Date().toISOString(), LTS_BATCH_WINDOW_MINUTES])) as unknown;
    rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  } catch {
    throw new Error("Gagal mencatat rangkaian upload LTS.");
  }
  const row = rows[0] as { batch?: LtsBatch | null } | undefined;
  if (!row) throw new Error("Gagal mencatat rangkaian upload LTS.");
  return progressFromLtsBatch(row.batch, dataset.periodKey);
}

/**
 * Klaim pengiriman report untuk rangkaian yang sudah lengkap. UPDATE bersyarat ini atomik: hanya satu proses yang
 * mendapat true (dan boleh mengirim report), dan rangkaian ditandai "reported" sehingga file berikutnya memulai
 * rangkaian baru.
 */
export async function claimLtsReport(): Promise<boolean> {
  const config = dbConfig();
  if (!config || !/^[a-z_][a-z0-9_]*$/.test(config.table)) return false;
  const sql = neon(config.url);
  const text =
    `update public."${config.table}" set payload = jsonb_set(payload, '{ltsBatch,reported}', 'true'::jsonb) ` +
    `where key = 'lts' and jsonb_typeof(payload->'ltsBatch') = 'object' ` +
    `and coalesce(payload->'ltsBatch'->>'reported', '') <> 'true' ` +
    `and jsonb_exists_all(payload->'ltsBatch'->'received', array['sales','caps','ct0']) returning key`;
  try {
    const result = (await sql.query(text)) as unknown;
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    return rows.length > 0;
  } catch {
    return false;
  }
}
