// Membaca data acuan WMS langsung dari workbook Excel (sheet HELPER, TARGET, dan REAL).
//
// Di workbook, angka "REAL MTD/FM bulan lalu", "REAL YTD", "GR YTD", dan target diambil dari sheet-sheet tsb.
// Sheet REAL berisi nilai yang di-paste manual tiap bulan, jadi kalau data acuan di aplikasi tidak ikut
// diperbarui, hasil dashboard akan menyimpang dari workbook. Dengan membaca sheet yang sama saat file xlsx
// diupload, dashboard memakai angka acuan yang persis sama dengan workbook.
import { wmsBranchMembers, wmsTeldaMasterNames, type WmsHistoryEntry } from "./history-data";
import type { WmsReference, WmsTargetEntry } from "./reporting";

type SheetRows = readonly (readonly unknown[])[];
export type WmsSheetReader = (sheetName: string) => SheetRows | null;

const WITEL_NAMES = [
  "BALI",
  "JATIM BARAT",
  "JATIM TIMUR",
  "NUSA TENGGARA",
  "SEMARANG JATENG UTARA",
  "SOLO JATENG TIMUR",
  "SURAMADU",
  "YOGYA JATENG SELATAN",
] as const;
// Urutan 14 telda pada REAL!A16:A29 sama dengan daftar di Report Sementara!C38:C51.
const TELDA_NAMES = Object.keys(wmsTeldaMasterNames);
const BRANCH_NAMES = Object.keys(wmsBranchMembers);

const text = (value: unknown) => String(value ?? "").trim().toUpperCase();

function num(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function numbers(row: readonly unknown[], from: number, length: number) {
  return Array.from({ length }, (_, index) => num(row[from + index]));
}

function historyFromRealRow(row: readonly unknown[]): WmsHistoryEntry {
  return {
    prevDays: numbers(row, 1, 31), //  REAL!B:AF  realisasi harian bulan lalu
    prevTotal: num(row[32]), //        REAL!AG    "Total" bulan lalu (dasar REAL FM)
    y2025: numbers(row, 52, 12), //    REAL!BA:BL total bulanan tahun lalu
    y2026: numbers(row, 37, 12), //    REAL!AL:AW total bulanan tahun ini
  };
}

function findSheet(read: WmsSheetReader, name: string) {
  return read(name) ?? read(name.toLowerCase()) ?? read(name.toUpperCase());
}

/**
 * Membaca HELPER, TARGET, dan REAL. Mengembalikan reference=null (tanpa masalah) bila file bukan workbook
 * lengkap (mis. CSV atau file MASTER saja), sehingga data acuan yang sudah tersimpan tetap dipakai.
 */
export function parseWmsReference(read: WmsSheetReader): { problems: string[]; reference: WmsReference | null } {
  const helper = findSheet(read, "HELPER");
  const target = findSheet(read, "TARGET");
  const real = findSheet(read, "REAL");
  if (!helper || !target || !real) return { problems: [], reference: null };

  const problems: string[] = [];

  // HELPER!B3 = nomor bulan laporan ("# of Month").
  const monthRow = helper.find((row) => text(row[0]) === "# OF MONTH");
  const month = Math.trunc(num(monthRow?.[1]));
  if (!(month >= 1 && month <= 12)) problems.push("HELPER: nomor bulan (# of Month) tidak terbaca");

  // Tahun dari header bulan TARGET (202601, 202602, ...).
  let year = 0;
  for (const row of target.slice(0, 5)) {
    for (const cell of row) {
      const value = typeof cell === "number" ? cell : Number(cell);
      if (Number.isInteger(value) && /^20\d{2}01$/.test(String(value))) {
        year = Math.floor(value / 100);
        break;
      }
    }
    if (year) break;
  }
  if (!year) problems.push("TARGET: tahun tidak terbaca dari header bulan");

  // ---- TARGET ----
  const targetWitel: Record<string, WmsTargetEntry> = {};
  const targetBranch: Record<string, WmsTargetEntry> = {};
  let section: "witel" | "branch" | null = null;
  for (const row of target) {
    const head = text(row[0]);
    if (head.startsWith("TARGET WITEL")) section = "witel";
    else if (head.startsWith("TARGET TELDA") || head.startsWith("NEW TARGET TELDA")) section = head.includes("DEMARKASI") ? "branch" : null;
    else if (section === "branch" && head === "YJS") section = null; // tabel kumulatif di bawahnya memakai nama yang sama
    else if (section === "witel" && (WITEL_NAMES as readonly string[]).includes(text(row[1]))) {
      targetWitel[text(row[1])] = { monthly: numbers(row, 2, 12) }; // TARGET!C:N
    } else if (section === "branch" && BRANCH_NAMES.includes(head)) {
      targetBranch[head] = { monthly: numbers(row, 1, 12) }; // TARGET!B:M (tabel demarkasi, dipakai Report Sementara!D22:E29)
    }
  }
  for (const name of WITEL_NAMES) if (!targetWitel[name]) problems.push(`TARGET: baris witel ${name} tidak ditemukan`);
  for (const name of BRANCH_NAMES) if (!targetBranch[name]) problems.push(`TARGET: baris telda demarkasi ${name} tidak ditemukan`);

  // ---- REAL ----
  const historyWitel: Record<string, WmsHistoryEntry> = {};
  const teldaRows: (readonly unknown[])[] = [];
  let realSection: "witel" | "telda" | "done" | null = null;
  for (const row of real) {
    const head = text(row[0]);
    if (head === "WITEL") realSection = "witel";
    else if (head === "BRANCH") realSection = "telda";
    else if (realSection === "witel" && (WITEL_NAMES as readonly string[]).includes(head)) historyWitel[head] = historyFromRealRow(row);
    else if (realSection === "telda" && head) {
      if (head === "YJS") realSection = "done";
      else teldaRows.push(row);
    }
  }
  for (const name of WITEL_NAMES) if (!historyWitel[name]) problems.push(`REAL: baris witel ${name} tidak ditemukan`);
  const historyTelda: Record<string, WmsHistoryEntry> = {};
  if (teldaRows.length === TELDA_NAMES.length) {
    // Dipetakan menurut urutan baris (label di REAL boleh typo, mis. "PURWOREJJO").
    TELDA_NAMES.forEach((name, index) => {
      historyTelda[name] = historyFromRealRow(teldaRows[index]);
    });
  } else {
    problems.push(`REAL: jumlah baris telda ${teldaRows.length}, seharusnya ${TELDA_NAMES.length}`);
  }

  if (problems.length > 0) return { problems, reference: null };

  return {
    problems,
    reference: {
      history: { telda: historyTelda, witel: historyWitel },
      importedAt: new Date().toISOString(),
      lastClosedMonth: month - 1,
      reportPeriodKey: `${year}${String(month).padStart(2, "0")}`,
      source: "workbook xlsx (sheet HELPER, TARGET, REAL)",
      targets: { telda: targetBranch, witel: targetWitel },
      year,
    },
  };
}

function cleanNumbers(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value)) return null;
  return Array.from({ length }, (_, index) => num(value[index]));
}

function cleanHistory(value: unknown, names: readonly string[]): Record<string, WmsHistoryEntry> | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, Partial<WmsHistoryEntry> | undefined>;
  const result: Record<string, WmsHistoryEntry> = {};
  for (const name of names) {
    const entry = source[name];
    const prevDays = cleanNumbers(entry?.prevDays, 31);
    const y2025 = cleanNumbers(entry?.y2025, 12);
    const y2026 = cleanNumbers(entry?.y2026, 12);
    if (!entry || !prevDays || !y2025 || !y2026) return null;
    result[name] = { prevDays, prevTotal: num(entry.prevTotal), y2025, y2026 };
  }
  return result;
}

function cleanTargets(value: unknown, names: readonly string[]): Record<string, WmsTargetEntry> | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, { monthly?: unknown } | undefined>;
  const result: Record<string, WmsTargetEntry> = {};
  for (const name of names) {
    const monthly = cleanNumbers(source[name]?.monthly, 12);
    if (!monthly) return null;
    result[name] = { monthly };
  }
  return result;
}

/** Validasi data acuan hasil simpanan (localStorage/database). null bila bentuknya tidak lengkap. */
export function normalizeWmsReference(value: unknown): WmsReference | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WmsReference>;
  const year = Number(candidate.year);
  const lastClosedMonth = Number(candidate.lastClosedMonth);
  if (!Number.isInteger(year) || year < 2000) return null;
  if (typeof candidate.reportPeriodKey !== "string" || !/^\d{6}$/.test(candidate.reportPeriodKey)) return null;
  if (!Number.isInteger(lastClosedMonth) || lastClosedMonth < 0 || lastClosedMonth > 12) return null;
  const witel = cleanHistory(candidate.history?.witel, WITEL_NAMES);
  const telda = cleanHistory(candidate.history?.telda, TELDA_NAMES);
  const targetWitel = cleanTargets(candidate.targets?.witel, WITEL_NAMES);
  const targetTelda = cleanTargets(candidate.targets?.telda, BRANCH_NAMES);
  if (!witel || !telda || !targetWitel || !targetTelda) return null;
  return {
    history: { telda, witel },
    importedAt: typeof candidate.importedAt === "string" ? candidate.importedAt : null,
    lastClosedMonth,
    reportPeriodKey: candidate.reportPeriodKey,
    source: typeof candidate.source === "string" ? candidate.source : null,
    targets: { telda: targetTelda, witel: targetWitel },
    year,
  };
}
