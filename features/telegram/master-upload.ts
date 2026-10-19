// Import file MASTER (Excel/CSV) lewat Telegram dan pembuatan file report untuk diunduh.
// Mendukung HSI (state key "default") dan WMS (state key "wms"). Data ditulis ke tabel dashboard_state,
// sumber data yang sama dengan dashboard web, jadi hasilnya langsung terlihat di web.
import * as XLSX from "xlsx";
import { readDashboardStateByKey, writeDashboardStateByKey } from "@/features/shared/backend/database/dashboard-state";
import { MAX_SNAPSHOTS_PER_PERIOD } from "@/features/shared/storage/safe-storage";
import {
  computeReport as computeHsiReport,
  masterHeaders as hsiHeaders,
  type ComputedReport as HsiReport,
  type ReportTable as HsiTable,
} from "@/features/hsi/domain/reporting/reporting";
import { seedData as hsiSeed } from "@/features/hsi/domain/reporting/seed-data";
import {
  computeWmsReport,
  masterHeaders as wmsHeaders,
  periodKeyFromMasterRow as wmsPeriodKeyFromRow,
  periodLabelFromKey as wmsPeriodLabel,
  type WmsReportRow,
} from "@/features/wms/domain/reporting/reporting";

export type UploadProduct = "HSI" | "WMS";
type Cell = string | number | boolean | null;
type Row = Cell[];

const STATE_KEYS: Record<UploadProduct, string> = { HSI: "default", WMS: "wms" };
const MONTHS = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
const HEADERS: Record<UploadProduct, string[]> = { HSI: hsiHeaders, WMS: wmsHeaders };

// ---------- Otorisasi ----------
// Upload mengubah data produksi, jadi hanya Telegram user ID di TELEGRAM_ALLOWED_USER_IDS yang boleh.
// Kosong = tidak ada yang boleh (aman secara default).
export function isAllowedUploader(userId: string | null) {
  const allowed = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  return Boolean(userId && allowed.includes(userId));
}

// ---------- Parsing ----------
function pad(n: number) {
  return String(n).padStart(2, "0");
}

function cleanCell(value: unknown): Cell {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function normalizedHeader(row: unknown[] | undefined, headers: string[]) {
  return (row ?? []).slice(0, headers.length).map((c) => String(c ?? "").trim().toUpperCase());
}

function headerMatches(row: unknown[] | undefined, headers: string[]) {
  const first = normalizedHeader(row, headers);
  return headers.every((h, i) => h.toUpperCase() === first[i]);
}

// Banyak file "MASTER" HSI berekstensi .xls/.csv sebenarnya teks dengan pemisah "#" (sama seperti upload di web).
// SheetJS membacanya sebagai satu kolom, jadi dibaca manual di sini.
function parseDelimitedRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((item) => item.trim() !== "")) rows.push(row);
  return rows;
}

function isBinaryWorkbook(buffer: Buffer) {
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b; // .xlsx
  const ole = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0; // .xls
  return zip || ole;
}

function delimitedRows(buffer: Buffer): unknown[][] | null {
  if (isBinaryWorkbook(buffer)) return null;
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (!text.slice(0, 2000).includes("#")) return null;
  const parsed = parseDelimitedRows(text, "#");
  return parsed.length > 0 && parsed[0].length > 1 ? parsed : null;
}

function sheetRows(buffer: Buffer) {
  const delimited = delimitedRows(buffer);
  if (delimited) return { name: "MASTER", rows: delimited };
  const workbook = XLSX.read(buffer, { cellDates: true, type: "buffer" });
  const name = workbook.SheetNames.find((n) => n.trim().toUpperCase() === "MASTER") ?? workbook.SheetNames[0];
  if (!name) throw new Error("File tidak memiliki sheet yang bisa dibaca.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { blankrows: false, defval: null, header: 1, raw: true });
  return { name, rows };
}

/** Tebak modul dari caption/nama file, lalu dari header kolom. */
export function detectProduct(fileName: string, caption: string | undefined, buffer: Buffer): UploadProduct | null {
  const hint = `${caption ?? ""} ${fileName}`.toLowerCase();
  const hintsHsi = /\bhsi\b|hsi[_\-.]/.test(hint) || hint.includes("hsi");
  const hintsWms = /\bwms\b|wms[_\-.]/.test(hint) || hint.includes("wms");
  if (hintsHsi !== hintsWms) return hintsHsi ? "HSI" : "WMS";
  try {
    const { rows } = sheetRows(buffer);
    if (headerMatches(rows[0], hsiHeaders)) return "HSI";
    if (headerMatches(rows[0], wmsHeaders)) return "WMS";
  } catch {
    /* ditangani pemanggil */
  }
  return null;
}

export function parseMasterRows(product: UploadProduct, buffer: Buffer): Row[] {
  const headers = HEADERS[product];
  const { name, rows } = sheetRows(buffer);
  const dataRows = headerMatches(rows[0], headers) ? rows.slice(1) : rows;
  const result = dataRows
    .map((row) => Array.from({ length: headers.length }, (_, i) => cleanCell(row[i])))
    .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""));
  if (result.length === 0) throw new Error(`Sheet ${name} tidak berisi data MASTER.`);
  if (!headerMatches(rows[0], headers) && (rows[0]?.length ?? 0) < headers.length - 5) {
    throw new Error(`Kolom file tidak cocok dengan format MASTER ${product} (butuh ${headers.length} kolom).`);
  }
  return result;
}

// ---------- Periode ----------
function parsePeriodKey(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const month = Number(digits.slice(4, 6));
  return month >= 1 && month <= 12 ? digits : null;
}

function currentJakartaPeriodKey() {
  const parts = new Intl.DateTimeFormat("en-CA", { month: "2-digit", timeZone: "Asia/Jakarta", year: "numeric" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}${get("month")}`;
}

function hsiPeriodKey(rows: Row[]) {
  const col = hsiHeaders.indexOf("NPER");
  const counts = new Map<string, number>();
  if (col >= 0) {
    for (const row of rows) {
      const key = parsePeriodKey(row[col]);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? currentJakartaPeriodKey();
}

function hsiLabel(periodKey: string) {
  return `${MONTHS[Number(periodKey.slice(4, 6)) - 1] ?? periodKey} ${periodKey.slice(0, 4)}`;
}

// ---------- Penyimpanan state ----------
type Json = Record<string, unknown>;
const asRecord = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

async function loadState(product: UploadProduct): Promise<Json> {
  const result = await readDashboardStateByKey(STATE_KEYS[product]);
  if (result.body && "error" in result.body && result.body.error) throw new Error("Gagal membaca data dari database.");
  if ("configured" in result.body && result.body.configured === false) throw new Error("Database belum dikonfigurasi (DATABASE_URL).");
  return asRecord((result.body as { state?: unknown }).state);
}

async function saveState(product: UploadProduct, state: Json) {
  const result = await writeDashboardStateByKey(STATE_KEYS[product], state);
  if (result.status && result.status >= 400) throw new Error("Gagal menyimpan data ke database.");
}

// Gabungkan nilai harian baru ke riwayat lama (nilai baru menang, sel kosong memakai riwayat sebelumnya).
function mergeHistoryTable(previous: Record<string, (number | null)[]>, table: HsiTable, excludedDay: number | null) {
  const next = { ...previous };
  for (const row of [...table.rows, table.total]) {
    const stored = next[row.label] ?? [];
    next[row.label] = row.days.map((value, index) =>
      index + 1 === excludedDay ? null : typeof value === "number" && Number.isFinite(value) ? value : (stored[index] ?? null),
    );
  }
  return next;
}

export type ImportSummary = { periods: { key: string; label: string; rows: number }[]; savedAt: string };

export async function importMaster(product: UploadProduct, rows: Row[]): Promise<ImportSummary> {
  const state = await loadState(product);
  const archive = asRecord(state.periodArchive);
  const snapshots = asRecord(state.saveSnapshots);
  const savedAt = new Date().toISOString();

  const grouped: Record<string, Row[]> = {};
  if (product === "HSI") grouped[hsiPeriodKey(rows)] = rows;
  else {
    for (const row of rows) {
      const key = wmsPeriodKeyFromRow(row);
      if (key) (grouped[key] ??= []).push(row);
    }
    if (Object.keys(grouped).length === 0) throw new Error("Kolom periode (NPER/bulan) tidak terbaca dari file WMS.");
  }

  const nextArchive: Json = { ...archive };
  const nextSnapshots: Json = { ...snapshots };
  for (const [key, periodRows] of Object.entries(grouped)) {
    const previous = asRecord(archive[key]);
    if (previous.savedAt) {
      const list = Array.isArray(snapshots[key]) ? (snapshots[key] as unknown[]) : [];
      nextSnapshots[key] = [
        ...list,
        { periodKey: key, rows: previous.rows ?? [], savedAt: previous.savedAt, ...(product === "HSI" ? { reportHistory: previous.reportHistory ?? null } : {}) },
      ].slice(-MAX_SNAPSHOTS_PER_PERIOD);
    }
    if (product === "HSI") {
      const report = computeHsiReport(periodRows, savedAt, key);
      const old = asRecord(previous.reportHistory);
      const hist = (k: string) => asRecord(old[k]) as Record<string, (number | null)[]>;
      nextArchive[key] = {
        label: hsiLabel(key),
        periodKey: key,
        reportSnapshot: null,
        reportHistory: {
          branch: mergeHistoryTable(hist("branch"), report.branch, report.excludedDay ?? null),
          stfBranch: mergeHistoryTable(hist("stfBranch"), report.targetStf.branch, report.excludedDay ?? null),
          stfWitel: mergeHistoryTable(hist("stfWitel"), report.targetStf.witel, report.excludedDay ?? null),
          updatedAt: savedAt,
          witel: mergeHistoryTable(hist("witel"), report.witel, report.excludedDay ?? null),
        },
        rows: periodRows,
        savedAt,
        updatedAt: savedAt,
      };
    } else {
      nextArchive[key] = { label: wmsPeriodLabel(key), periodKey: key, rows: periodRows, savedAt, updatedAt: savedAt };
    }
  }

  const latestKey = Object.keys(grouped).sort().at(-1)!;
  const nextState: Json =
    product === "HSI"
      ? {
          dataVersion: typeof state.dataVersion === "string" ? state.dataVersion : hsiSeed.dataVersion,
          masterHeadersCleared: Boolean(state.masterHeadersCleared),
          periodArchive: nextArchive,
          saveSnapshots: nextSnapshots,
          selectedPeriodKey: latestKey,
          updatedAt: savedAt,
        }
      : { periodArchive: nextArchive, saveSnapshots: nextSnapshots, selectedPeriodKey: latestKey, updatedAt: savedAt };

  await saveState(product, nextState);
  return {
    periods: Object.entries(grouped).map(([key, r]) => ({ key, label: product === "HSI" ? hsiLabel(key) : wmsPeriodLabel(key), rows: r.length })),
    savedAt,
  };
}

// ---------- Report (Excel) ----------
const PCT_KEYS = new Set(["Ach", "Ach YTD", "Growth MTD", "Growth FM", "Growth YTD"]);

function sheetFrom(headers: string[], body: (string | number | null)[][]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
  ws["!cols"] = headers.map((_, i) => ({ wch: i === 0 ? 26 : 13 }));
  body.forEach((row, r) =>
    row.forEach((_, c) => {
      const cell = ws[XLSX.utils.encode_cell({ c, r: r + 1 })];
      if (cell && cell.t === "n" && PCT_KEYS.has(headers[c])) cell.z = "0.00%";
    }),
  );
  return ws;
}

function hsiSheet(table: HsiTable, dayCount: number) {
  const days = Array.from({ length: dayCount }, (_, i) => `Tgl ${i + 1}`);
  const headers = ["Wilayah", "Target FM", "Target YTD", ...days, "MTD", "Ach", "Rank", "Shortage FM", "Real MTD Prev", "Growth MTD", "Real FM Prev", "Growth FM", "Real YTD", "Ach YTD", "Growth YTD", "Rank YTD", "Shortage YTD"];
  const body = [...table.rows, table.total].map((r) => [
    r.label, r.targetFm, r.targetYtd, ...days.map((_, i) => r.days[i] ?? null),
    r.mtd, r.targetAch, r.rankAch, r.shortageFm, r.realMtdPrev, r.growthMtd, r.realFmPrev, r.growthFm, r.realYtd, r.achYtd, r.growthYtd, r.rankYtd, r.shortageYtd,
  ]);
  return sheetFrom(headers, body);
}

function wmsSheet(rows: WmsReportRow[], total: WmsReportRow, dayCount: number) {
  const days = Array.from({ length: dayCount }, (_, i) => `Tgl ${i + 1}`);
  const headers = ["Wilayah", "Target FM", "Target YTD", ...days, "MTD", "Ach", "Rank", "Shortage FM", "Real MTD Prev", "Growth MTD", "Real FM Prev", "Growth FM", "Real YTD", "Ach YTD", "Growth YTD", "Rank YTD", "Shortage YTD"];
  const body = [...rows, total].map((r) => [
    r.label, r.targetFm, r.targetYtd, ...days.map((_, i) => r.days[i] ?? null),
    r.mtd, r.ach, r.rank, r.shortageFm, r.realMtdPrev, r.growthMtd, r.realFmPrev, r.growthFm, r.realYtd, r.achYtd, r.growthYtd, r.rankYtd, r.shortageYtd,
  ]);
  return sheetFrom(headers, body);
}

export type ReportFile = { bytes: Uint8Array; filename: string; periodLabel: string; updatedAt: string | null };

export async function buildReportFile(product: UploadProduct): Promise<ReportFile> {
  const state = await loadState(product);
  const archive = asRecord(state.periodArchive);
  const selected = typeof state.selectedPeriodKey === "string" ? state.selectedPeriodKey : Object.keys(archive).sort().at(-1);
  const entry = asRecord(selected ? archive[selected] : null);
  const rows = Array.isArray(entry.rows) ? (entry.rows as Row[]) : [];
  if (!selected || rows.length === 0) throw new Error(`Belum ada data ${product}. Upload file MASTER ${product} dulu.`);
  const savedAt = typeof entry.savedAt === "string" ? entry.savedAt : null;

  const wb = XLSX.utils.book_new();
  let periodLabel: string;
  if (product === "HSI") {
    const report: HsiReport = computeHsiReport(rows, savedAt, selected);
    periodLabel = report.periodLabel;
    const dayCount = Math.max(...[report.witel, report.branch].flatMap((t) => [...t.rows, t.total].map((r) => r.days.length)), 0);
    XLSX.utils.book_append_sheet(wb, hsiSheet(report.witel, dayCount), "Report Witel");
    XLSX.utils.book_append_sheet(wb, hsiSheet(report.branch, dayCount), "Report Telda");
    XLSX.utils.book_append_sheet(wb, hsiSheet(report.targetStf.witel, dayCount), "STF Witel");
    XLSX.utils.book_append_sheet(wb, hsiSheet(report.targetStf.branch, dayCount), "STF Telda");
  } else {
    const report = computeWmsReport(rows, selected);
    periodLabel = report.periodLabel;
    const dayCount = Math.max(...[...report.witel.rows, report.witel.total, ...report.telda.rows, report.telda.total].map((r) => r.days.length), 0);
    XLSX.utils.book_append_sheet(wb, wmsSheet(report.witel.rows, report.witel.total, dayCount), "Report Witel");
    XLSX.utils.book_append_sheet(wb, wmsSheet(report.telda.rows, report.telda.total, dayCount), "Report Telda");
  }
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return {
    bytes: new Uint8Array(bytes),
    filename: `Report_${product}_${selected}.xlsx`,
    periodLabel,
    updatedAt: savedAt,
  };
}

/** Baris MASTER periode aktif dari dashboard_state (sumber yang sama dengan web). null bila belum ada data. */
export async function loadLatestRows(product: UploadProduct) {
  const state = await loadState(product);
  const archive = asRecord(state.periodArchive);
  const selected = typeof state.selectedPeriodKey === "string" ? state.selectedPeriodKey : Object.keys(archive).sort().at(-1);
  const entry = asRecord(selected ? archive[selected] : null);
  const rows = Array.isArray(entry.rows) ? (entry.rows as Row[]) : [];
  if (!selected || rows.length === 0) return null;
  return { periodKey: selected, rows, savedAt: typeof entry.savedAt === "string" ? entry.savedAt : null };
}
