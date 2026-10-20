// Upload data LTS (SALES = ps, CAPS = nal, CT0 = reg) lewat bot Telegram.
// Logika baca/validasi sama dengan upload MASTER LTS di website.
import { neon } from "@neondatabase/serverless";
import * as XLSX from "xlsx";
import { dbConfig, dbGet } from "@/features/shared/backend/database/db";
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
import { delimitedRows } from "@/features/telegram/master-upload";

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

/** Header kolom menang atas caption/nama file (mis. caption "WMS" pada file PS). Null = bukan data LTS. */
export function detectLtsDataset(fileName: string, caption: string | undefined, buffer: Buffer): LtsDatasetKey | null {
  let matches: LtsDatasetKey[] = [];
  try {
    const rows = readRows(buffer);
    matches = LTS_DATASET_KEYS.filter((key) => headerHasAll(rows, ltsDatasetDefinitions[key].requiredColumns));
  } catch {
    return hintFromName(fileName, caption);
  }
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

// Ketiga file LTS (ps, nal, reg) harus dikirim dalam satu rangkaian upload. Data lama di database (mis. dari upload
// web atau kiriman kemarin) TIDAK dihitung sebagai "sudah lengkap": file hanya dianggap bagian dari rangkaian ini bila
// waktu upload-nya berdekatan (default 30 menit, bisa diubah lewat env LTS_BATCH_WINDOW_MINUTES).
export const LTS_BATCH_WINDOW_MINUTES = Math.max(1, Number(process.env.LTS_BATCH_WINDOW_MINUTES) || 30);

export type LtsProgress = {
  /** Kunci unik rangkaian upload yang lengkap (dipakai agar report hanya dikirim sekali). Null bila belum lengkap. */
  batchKey: string | null;
  complete: boolean;
  missing: LtsDatasetKey[];
  periodKey: string;
  periodLabel: string;
  present: Record<LtsDatasetKey, boolean>;
};

type LtsArchive = Partial<Record<string, Record<string, { uploadedAt?: unknown } | undefined> | undefined>>;

/** Murni (tanpa database): hitung kelengkapan rangkaian upload relatif terhadap waktu upload file yang baru masuk. */
export function computeLtsProgress(
  archive: LtsArchive,
  periodKey: string,
  referenceIso: string,
  windowMs = LTS_BATCH_WINDOW_MINUTES * 60_000,
): LtsProgress {
  const parsedReference = Date.parse(referenceIso);
  const reference = Number.isNaN(parsedReference) ? Date.now() : parsedReference;
  const stamps = {} as Record<LtsDatasetKey, string | null>;
  const present = {} as Record<LtsDatasetKey, boolean>;
  for (const key of LTS_DATASET_KEYS) {
    const uploadedAt = archive[key]?.[periodKey]?.uploadedAt;
    const time = typeof uploadedAt === "string" ? Date.parse(uploadedAt) : Number.NaN;
    const inBatch = !Number.isNaN(time) && Math.abs(reference - time) <= windowMs;
    present[key] = inBatch;
    stamps[key] = inBatch ? (uploadedAt as string) : null;
  }
  const missing = LTS_DATASET_KEYS.filter((key) => !present[key]);
  const complete = missing.length === 0;
  return {
    batchKey: complete ? `${periodKey}|${LTS_DATASET_KEYS.map((key) => stamps[key]).join("|")}` : null,
    complete,
    missing,
    periodKey,
    periodLabel: periodLabelFromLtsPeriodKey(periodKey),
    present,
  };
}

/** Status rangkaian upload Sales/CAPS/CT0 untuk periode tertentu (dibaca dari database). */
export async function ltsProgress(periodKey: string, referenceIso: string): Promise<LtsProgress> {
  const result = await dbGet<{ payload?: { datasetArchive?: LtsArchive } }[]>(
    process.env.DASHBOARD_STATE_TABLE || "dashboard_state",
    "select=payload&key=eq.lts&limit=1",
  );
  const archive = result.data?.[0]?.payload?.datasetArchive ?? {};
  return computeLtsProgress(archive, periodKey, referenceIso);
}

/**
 * Klaim pengiriman report untuk satu rangkaian upload. Tiga file yang dikirim bersamaan diproses paralel, dan lebih
 * dari satu proses bisa melihat data "lengkap" pada saat yang sama. UPDATE bersyarat ini atomik: hanya satu proses
 * yang mendapat true (dan boleh mengirim report), sisanya false.
 */
export async function claimLtsReport(batchKey: string): Promise<boolean> {
  const config = dbConfig();
  if (!config || !/^[a-z_][a-z0-9_]*$/.test(config.table)) return true;
  const sql = neon(config.url);
  const text =
    `update public."${config.table}" set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{ltsReportClaim}', to_jsonb($1::text)) ` +
    `where key = 'lts' and coalesce(payload->>'ltsReportClaim', '') <> $1 returning key`;
  try {
    const result = (await sql.query(text, [batchKey])) as unknown;
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    return rows.length > 0;
  } catch {
    // Gagal mengklaim: lebih baik report terkirim (mungkin dobel) daripada tidak terkirim sama sekali.
    return true;
  }
}
