"use client";

import { safeStorageRemove, safeStorageSet, MAX_SNAPSHOTS_PER_PERIOD } from "@/features/shared/storage/safe-storage";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Database,
  Download,
  FileSpreadsheet,
  Home,
  LockKeyhole,
  Save,
  ShieldCheck,
  Trash2,
  Undo2,
  TrendingUp,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { DashboardPermissions } from "@/features/hsi/backend/auth/session";
import { CompactRankingInsight } from "@/features/shared/dashboard/compact-ranking-insight";
import { renderReportPngBlob } from "@/features/shared/dashboard/report-png";
import { ReportCard, achTone as reportAchTone, dayKind as reportDayKind, parsePeriodLabel as parseReportPeriodLabel, rankTone as reportRankTone, signTone as reportSignTone, type CellStyle as ReportCellStyle, type ReportTheme, type TableCol as ReportCol } from "@/features/shared/dashboard/report-table";
import { rankTotal } from "@/features/shared/dashboard/rank-color";
import {
  cutoffDateFromPeriodPart,
  dateRangeLabel,
  dateRangeToMonthParts,
  formatDataCutoff,
  formatDataCutoffDate,
  formatYtdLabel,
  getPeriodSemanticLabel,
  monthRangeKeys,
  periodRangeLabel,
  type DashboardPeriodPart,
} from "@/features/shared/dashboard/date-label";
import { DashboardMetricCard, type DashboardMetricTone } from "@/features/shared/dashboard/metric-card";
import { ACCEPT_BODY_ENCODING_HEADER, BODY_ENCODING_HEADER, GZIP_THRESHOLD_BYTES, canGzip, gunzipToText, gzipText } from "@/features/shared/http/gzip-json";
import { MasterUnlockModal } from "@/features/shared/dashboard/master-unlock-modal";
import { DashboardPeriodFilter, defaultPeriodFilter, type DashboardPeriodFilterState } from "@/features/shared/dashboard/period-filter";
import {
  computeWmsReport,
  defaultWmsPeriodKey,
  initialMasterRows,
  masterHeaders,
  periodKeyFromMasterRow,
  periodLabelFromKey,
  periodOptionsFromRows,
  wmsDataVersion,
  type MasterRow,
  type WmsComputedReport,
  type WmsReportRow,
} from "@/features/wms/domain/reporting/reporting";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type View = "home" | "master" | "report";
type WilayahFilter = "all-witel" | "all-telda" | `witel:${string}` | `telda:${string}`;
type DashboardPeriodMode = "mtd" | "ytd";

type SheetJsWorkbook = {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
};
type SheetJsApi = {
  read: (data: ArrayBuffer, options?: { cellDates?: boolean; type?: "array" }) => SheetJsWorkbook;
  utils: {
    sheet_to_json: (sheet: unknown, options?: { blankrows?: boolean; defval?: null; header?: 1; raw?: boolean }) => unknown[][];
  };
};

declare global {
  interface Window {
    XLSX?: SheetJsApi;
  }
}

const STORAGE_KEY = "wms-master-rows-v1";
const SAVED_AT_KEY = "wms-master-saved-at-v1";
const PERIOD_ARCHIVE_KEY = "wms-period-archive-v1";
const SAVE_SNAPSHOTS_KEY = "wms-save-snapshots-v1";
const SELECTED_PERIOD_KEY = "wms-selected-period-v1";
const DATA_VERSION_KEY = "wms-seed-data-version-v1";
const AUTO_SAVE_DELAY_MS = 3 * 60 * 1000;

type PeriodArchiveEntry = {
  label: string;
  periodKey: string;
  rows: MasterRow[];
  savedAt: string | null;
  updatedAt: string | null;
};
type PeriodArchive = Record<string, PeriodArchiveEntry>;
type SavedVersion = {
  periodKey: string;
  rows: MasterRow[];
  savedAt: string | null;
};
type SaveSnapshots = Record<string, SavedVersion[]>;
type DashboardPersistedState = {
  periodArchive: PeriodArchive;
  saveSnapshots: SaveSnapshots;
  selectedPeriodKey: string;
  updatedAt: string | null;
};

const navItems: { id: View; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "master", label: "MASTER", icon: Database },
  { id: "report", label: "Report WMS Target RKAP", icon: FileSpreadsheet },
];

const panelClass =
  "rounded-xl border border-white/15 bg-white shadow-[0_18px_44px_-30px_rgba(0,0,0,0.58)] ring-1 ring-amber-950/[0.04]";
const primaryButtonClass =
  "inline-flex h-10 items-center gap-2 rounded-md bg-[#3b2414] px-4 text-sm font-semibold text-white shadow-[0_14px_28px_-18px_rgba(59,36,20,0.9)] transition hover:bg-[#4b2d18] disabled:cursor-not-allowed disabled:bg-stone-300";
const secondaryButtonClass =
  "inline-flex h-10 items-center gap-2 rounded-md border border-stone-200/90 bg-white/90 px-3 text-sm font-medium text-stone-700 shadow-sm transition hover:border-amber-300 hover:bg-white disabled:cursor-not-allowed disabled:border-stone-100 disabled:bg-stone-100 disabled:text-stone-400 disabled:shadow-none";
const dangerButtonClass =
  "inline-flex h-10 items-center gap-2 rounded-md border border-rose-200 bg-white/90 px-3 text-sm font-medium text-rose-700 shadow-sm transition hover:bg-rose-50";

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return new Intl.NumberFormat("id-ID", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value);
}

function parseClipboard(text: string) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line, index, lines) => !(index === lines.length - 1 && line === ""))
    .map((line) => line.split("\t"));
}

function cleanWorkbookCell(value: unknown): MasterRow[number] {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const pad = (input: number) => String(input).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function ensureRowWidth(row: unknown[]): MasterRow {
  return Array.from({ length: masterHeaders.length }, (_, index) => {
    const value = row[index];
    return value === undefined || value === "" ? null : (value as MasterRow[number]);
  });
}

function normalizedHeader(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function rowsIncludeMasterHeader(rows: unknown[][]) {
  const first = rows[0];
  if (!first) return false;
  const normalizedFirst = first.slice(0, masterHeaders.length).map(normalizedHeader);
  const normalizedHeaders = masterHeaders.map(normalizedHeader);
  return normalizedHeaders.every((header, index) => normalizedFirst[index] === header);
}

function rowsHaveMappableHeader(rows: unknown[][]) {
  const first = rows[0];
  if (!first) return false;
  const headerSet = new Set(first.map(normalizedHeader));
  return ["TANGGAL", "WITEL", "TELKOM_DAERAH", "JML_SALES", "DAY OF LAST_UPDATED_DATE"].every((header) => headerSet.has(header));
}

function normalizeImportedMasterRows(sheetRows: unknown[][], sourceLabel: string) {
  if (rowsIncludeMasterHeader(sheetRows)) {
    return sheetRows.slice(1)
      .map((row) => ensureRowWidth(row.map(cleanWorkbookCell)))
      .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""));
  }

  if (rowsHaveMappableHeader(sheetRows)) {
    const sourceHeaders = sheetRows[0];
    const indexByImportedHeader = new Map(sourceHeaders.map((header, index) => [normalizedHeader(header), index]));
    const missingHeaders = masterHeaders.filter((header) => !indexByImportedHeader.has(normalizedHeader(header)));
    if (missingHeaders.length > 0) {
      throw new Error(`${sourceLabel} kurang kolom wajib: ${missingHeaders.slice(0, 5).join(", ")}${missingHeaders.length > 5 ? "..." : ""}`);
    }
    return sheetRows.slice(1)
      .map((row) => masterHeaders.map((header) => cleanWorkbookCell(row[indexByImportedHeader.get(normalizedHeader(header)) ?? -1])))
      .map(ensureRowWidth)
      .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""));
  }

  return sheetRows
    .map((row) => ensureRowWidth(row.map(cleanWorkbookCell)))
    .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""));
}

function isCsvFile(file: File) {
  return file.name.trim().toLowerCase().endsWith(".csv") || file.type === "text/csv";
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((items) => items.some((item) => item.trim() !== ""));
}

async function loadSheetJs() {
  if (window.XLSX) return window.XLSX;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-sheetjs="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Gagal memuat parser Excel.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "/vendor/xlsx.full.min.js";
    script.async = true;
    script.dataset.sheetjs = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Gagal memuat parser Excel."));
    document.head.appendChild(script);
  });
  if (!window.XLSX) throw new Error("Parser Excel belum siap.");
  return window.XLSX;
}

async function readMasterRowsFromWorkbook(file: File) {
  const buffer = await file.arrayBuffer();
  const XLSX = await loadSheetJs();
  const workbook = XLSX.read(buffer, { cellDates: true, type: "array" });
  const sheetName = workbook.SheetNames.find((name) => name.trim().toUpperCase() === "MASTER") ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook tidak memiliki sheet yang bisa dibaca.");
  const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    blankrows: false,
    defval: null,
    header: 1,
    raw: true,
  });
  const rows = normalizeImportedMasterRows(sheetRows, `Sheet ${sheetName}`);
  if (rows.length === 0) throw new Error(`Sheet ${sheetName} tidak berisi data MASTER.`);
  return rows;
}

async function readMasterRowsFromCsv(file: File) {
  const rows = normalizeImportedMasterRows(parseCsvRows(await file.text()), file.name);
  if (rows.length === 0) throw new Error(`${file.name} tidak berisi data MASTER.`);
  return rows;
}

async function readMasterRowsFromUpload(file: File) {
  if (isCsvFile(file)) return readMasterRowsFromCsv(file);
  return readMasterRowsFromWorkbook(file);
}

function blankMasterRows() {
  return Array.from({ length: 25 }, () => Array(masterHeaders.length).fill(null) as MasterRow);
}

function formatJakartaDateTime(date: Date, seconds = true) {
  const dateText = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Jakarta",
    year: "numeric",
  }).format(date);
  const timeText = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    timeZone: "Asia/Jakarta",
  })
    .format(date)
    .replace(/\./g, ":");
  return `${dateText}${seconds ? "," : " •"} ${timeText} WIB`;
}

function formatSavedAt(value: string | null) {
  return value ? formatJakartaDateTime(new Date(value), true) : "Belum pernah disimpan";
}

function reportFileName(date: Date, periodLabel: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
    year: "numeric",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  const period = periodLabel.replace(/\s+/g, "-");
  return `WMS-Report-${period}-${parts.day}-${parts.month}-${parts.year}-${parts.hour}${parts.minute}-WIB.png`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Unduhan PNG memakai kolom, warna, dan penggambar yang sama dengan gambar report di bot Telegram.
async function createWmsReportPng(report: WmsComputedReport, timestamp: Date) {
  const latestDay = report.cutoffDay;
  const startDay = Math.max(1, latestDay - 6);
  const table = (labelHeader: string, source: { rows: WmsReportRow[]; total: WmsReportRow }) => ({
    cols: wmsReportColumns({
      dayCount: latestDay,
      endDay: latestDay,
      labelHeader,
      latestDay,
      periodLabel: report.periodLabel,
      previousMonthLabel: report.previousMonthLabel,
      rankCount: source.rows.length,
      startDay,
    }),
    rows: source.rows,
    total: source.total,
  });
  const blob = await renderReportPngBlob({
    banner: {
      note: `TARGET RKAP  •  TANGGAL ${startDay}-${latestDay}  •  ${report.cutoffLabel.toUpperCase()}`,
      periodLabel: report.periodLabel,
      scope: "WITEL YOGYA JATENG SELATAN",
      title: "PS HARIAN WMS",
    },
    footer: `Data s.d. Tgl ${latestDay}`,
    tables: [table("WITEL", report.witel), table("TELDA", report.telda)],
    theme: WMS_REPORT_THEME,
    timestamp,
  });
  downloadBlob(blob, reportFileName(timestamp, report.periodLabel));
}

function detectPeriodKey(rows: MasterRow[], fallback = defaultWmsPeriodKey) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const periodKey = periodKeyFromMasterRow(row);
    if (periodKey) counts.set(periodKey, (counts.get(periodKey) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

function currentJakartaPeriodKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    timeZone: "Asia/Jakarta",
    year: "numeric",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((accumulator, part) => {
      if (part.type === "year" || part.type === "month") accumulator[part.type] = part.value;
      return accumulator;
    }, {});
  return `${parts.year ?? "2026"}${parts.month ?? "01"}`;
}

function latestArchivePeriodKey(periodArchive: PeriodArchive) {
  return Object.keys(periodArchive)
    .filter((periodKey) => /^\d{6}$/.test(periodKey))
    .sort()
    .at(-1);
}

function ensureCurrentPeriodArchive(periodArchive: PeriodArchive) {
  const currentPeriodKey = currentJakartaPeriodKey();
  if (periodArchive[currentPeriodKey]) return periodArchive;
  const latestPeriodKey = latestArchivePeriodKey(periodArchive);
  if (!latestPeriodKey || currentPeriodKey <= latestPeriodKey) return periodArchive;
  return {
    ...periodArchive,
    [currentPeriodKey]: createPeriodEntry(currentPeriodKey, blankMasterRows(), null),
  };
}

function preferredActivePeriodKey(periodArchive: PeriodArchive, requestedPeriodKey?: string | null) {
  const currentPeriodKey = currentJakartaPeriodKey();
  const hasData = (key: string) =>
    periodArchive[key]?.rows.some((row) => row.some((cell) => cell !== null && String(cell).trim() !== "")) ?? false;
  // Bulan berjalan yang masih kosong (placeholder) tidak boleh menutupi periode yang baru diupload.
  if (periodArchive[currentPeriodKey] && (hasData(currentPeriodKey) || !requestedPeriodKey || !hasData(requestedPeriodKey))) return currentPeriodKey;
  if (requestedPeriodKey && periodArchive[requestedPeriodKey]) return requestedPeriodKey;
  return latestArchivePeriodKey(periodArchive) ?? defaultWmsPeriodKey;
}

function createPeriodEntry(periodKey: string, rows: MasterRow[], savedAt: string | null): PeriodArchiveEntry {
  return {
    label: periodLabelFromKey(periodKey),
    periodKey,
    rows: rows.map((row) => ensureRowWidth(row)),
    savedAt,
    updatedAt: savedAt,
  };
}

function splitRowsByPeriod(rows: MasterRow[]) {
  const grouped: Record<string, MasterRow[]> = {};
  for (const row of rows) {
    const periodKey = periodKeyFromMasterRow(row);
    if (!periodKey) continue;
    grouped[periodKey] = [...(grouped[periodKey] ?? []), ensureRowWidth(row)];
  }
  return grouped;
}

function initialSeedPeriodArchive(): PeriodArchive {
  const grouped = splitRowsByPeriod(initialMasterRows);
  return Object.fromEntries(
    Object.entries(grouped).map(([periodKey, periodRows]) => [periodKey, createPeriodEntry(periodKey, periodRows, null)]),
  );
}

function allRowsFromArchive(periodArchive: PeriodArchive, activePeriodKey: string, activeRows: MasterRow[]) {
  const byPeriod = {
    ...periodArchive,
    [activePeriodKey]: createPeriodEntry(activePeriodKey, activeRows, periodArchive[activePeriodKey]?.savedAt ?? null),
  };
  return Object.values(byPeriod)
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    .flatMap((entry) => entry.rows);
}

function parsePeriodArchive(value: string | null): PeriodArchive {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, Partial<PeriodArchiveEntry>>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, entry]) => {
        const periodKey = typeof entry.periodKey === "string" ? entry.periodKey : key;
        if (!/^\d{6}$/.test(periodKey) || !Array.isArray(entry.rows)) return [];
        return [
          [
            periodKey,
            {
              label: typeof entry.label === "string" ? entry.label : periodLabelFromKey(periodKey),
              periodKey,
              rows: entry.rows.map((row) => ensureRowWidth(Array.isArray(row) ? row : [])),
              savedAt: typeof entry.savedAt === "string" ? entry.savedAt : null,
              updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null,
            },
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

function parseSaveSnapshots(value: string | null): SaveSnapshots {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, Partial<SavedVersion>[]>;
    return Object.fromEntries(
      Object.entries(parsed).map(([periodKey, versions]) => [
        periodKey,
        Array.isArray(versions)
          ? versions
              .filter((version) => Array.isArray(version.rows))
              .slice(-MAX_SNAPSHOTS_PER_PERIOD)
              .map((version) => ({
                periodKey: typeof version.periodKey === "string" ? version.periodKey : periodKey,
                rows: (version.rows ?? []).map((row) => ensureRowWidth(Array.isArray(row) ? row : [])),
                savedAt: typeof version.savedAt === "string" ? version.savedAt : null,
              }))
          : [],
      ]),
    );
  } catch {
    return {};
  }
}

function parsePersistedDashboardState(value: unknown): DashboardPersistedState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DashboardPersistedState> & {
    rows?: MasterRow[];
    savedAt?: string;
  };
  const periodArchive = parsePeriodArchive(JSON.stringify(candidate.periodArchive ?? {}));
  if (Object.keys(periodArchive).length > 0 && typeof candidate.selectedPeriodKey === "string") {
    return {
      periodArchive,
      saveSnapshots: parseSaveSnapshots(JSON.stringify(candidate.saveSnapshots ?? {})),
      selectedPeriodKey: candidate.selectedPeriodKey,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
    };
  }
  if (Array.isArray(candidate.rows)) {
    const rows = candidate.rows.map((row) => ensureRowWidth(Array.isArray(row) ? row : []));
    const periodKey = detectPeriodKey(rows);
    return {
      periodArchive: { [periodKey]: createPeriodEntry(periodKey, rows, typeof candidate.savedAt === "string" ? candidate.savedAt : null) },
      saveSnapshots: {},
      selectedPeriodKey: periodKey,
      updatedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : null,
    };
  }
  return null;
}

function persistDashboardStateLocally(state: DashboardPersistedState) {
  // Hapus salinan lama dulu agar kuota browser lega, lalu tulis ulang di akhir (best effort).
  safeStorageRemove(SAVE_SNAPSHOTS_KEY);
  const activePeriod = state.periodArchive[state.selectedPeriodKey];
  safeStorageSet(PERIOD_ARCHIVE_KEY, JSON.stringify(state.periodArchive));
  safeStorageSet(SELECTED_PERIOD_KEY, state.selectedPeriodKey);
  safeStorageSet(STORAGE_KEY, JSON.stringify(activePeriod?.rows ?? []));
  if (activePeriod?.savedAt) {
    safeStorageSet(SAVED_AT_KEY, activePeriod.savedAt);
  } else {
    window.localStorage.removeItem(SAVED_AT_KEY);
  }
  safeStorageSet(SAVE_SNAPSHOTS_KEY, JSON.stringify(state.saveSnapshots));
}

async function loadDashboardStateFromServer(): Promise<{ configured: boolean; state: DashboardPersistedState | null }> {
  const response = await fetch("/api/wms/dashboard-state", {
    cache: "no-store",
    headers: canGzip() ? { [ACCEPT_BODY_ENCODING_HEADER]: "gzip" } : undefined,
  });
  if (!response.ok) throw new Error("Gagal memuat data WMS dari server.");
  const payload = (
    response.headers.get(BODY_ENCODING_HEADER) === "gzip"
      ? JSON.parse(await gunzipToText(await response.arrayBuffer()))
      : await response.json()
  ) as { configured?: boolean; state?: unknown };
  return {
    configured: Boolean(payload.configured),
    state: parsePersistedDashboardState(payload.state),
  };
}

async function saveDashboardStateToServer(state: DashboardPersistedState, masterUnlockToken: string | null): Promise<{ configured: boolean }> {
  // Data besar dikompres agar muat di batas body request Vercel (±4,5 MB).
  const json = JSON.stringify(state);
  const compress = json.length > GZIP_THRESHOLD_BYTES && canGzip();
  const response = await fetch("/api/wms/dashboard-state", {
    body: compress ? await gzipText(json) : json,
    headers: {
      "Content-Type": compress ? "application/octet-stream" : "application/json",
      ...(compress ? { [BODY_ENCODING_HEADER]: "gzip" } : {}),
      ...(masterUnlockToken ? { "x-master-unlock-token": masterUnlockToken } : {}),
    },
    method: "PUT",
  });
  if (response.status === 503) return { configured: false };
  if (!response.ok) throw new Error("Gagal menyimpan data WMS ke server.");
  const payload = (await response.json()) as { configured?: boolean };
  return { configured: Boolean(payload.configured) };
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" }) {
  const toneClass =
    tone === "good"
      ? "border-emerald-200/80 bg-emerald-50/90 text-emerald-700"
      : tone === "warn"
        ? "border-amber-200/80 bg-amber-50/90 text-amber-800"
        : "border-stone-200/80 bg-white/80 text-stone-600";
  return (
    <span className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold uppercase shadow-sm ${toneClass}`}>
      {children}
    </span>
  );
}

function MetricCard({
  detail,
  icon,
  label,
  tone = "neutral",
  value,
}: {
  detail: string;
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: DashboardMetricTone;
  value: string;
}) {
  return (
    <DashboardMetricCard
      detail={detail}
      icon={icon}
      label={label}
      theme={{
        accentLineClass: "bg-gradient-to-r from-[#3b2414] via-amber-500 to-orange-300 opacity-80",
        detailToneClass: {
          good: "text-emerald-700",
          neutral: "text-stone-500",
          warn: "text-amber-700",
        },
        hoverClass: "hover:-translate-y-0.5 hover:border-white/30 hover:shadow-[0_24px_46px_-28px_rgba(41,24,12,0.55)]",
        iconToneClass: {
          good: "border-emerald-200 bg-emerald-50 text-emerald-700",
          neutral: "border-stone-200 bg-white text-stone-600",
          warn: "border-amber-200 bg-amber-50 text-amber-700",
        },
        labelClass: "text-stone-500",
        panelClass,
        toneClass: {
          good: "from-emerald-50/90 to-white text-emerald-700",
          neutral: "from-stone-50/90 to-white text-stone-600",
          warn: "from-amber-50/90 to-white text-amber-700",
        },
        valueClass: "text-stone-950",
      }}
      tone={tone}
      value={value}
    />
  );
}

function activeRow(report: WmsComputedReport, filter: WilayahFilter) {
  if (filter === "all-telda") return { label: "ALL TELDA", rows: report.telda.rows, row: report.telda.total, type: "TELDA" };
  if (filter === "all-witel") return { label: "ALL WITEL", rows: report.witel.rows, row: report.witel.total, type: "WITEL" };
  const [kind, label] = filter.split(":");
  const source = kind === "telda" ? report.telda : report.witel;
  return {
    label,
    rows: source.rows,
    row: source.rows.find((item) => item.label === label) ?? source.total,
    type: kind === "telda" ? "TELDA" : "WITEL",
  };
}

type WmsReportPart = DashboardPeriodPart & { report: WmsComputedReport };

function latestActualDateFromWmsParts(parts: WmsReportPart[]) {
  for (const part of [...parts].reverse()) {
    const days = part.report.witel.total.days;
    for (let day = part.endDay; day >= part.startDay; day -= 1) {
      if ((days[day - 1] ?? 0) > 0) {
        return cutoffDateFromPeriodPart({ endDay: day, periodKey: part.periodKey });
      }
    }
  }
  const fallback = parts.at(-1);
  return fallback ? cutoffDateFromPeriodPart(fallback) : new Date();
}

function normalizeWmsPeriodFilter(value: DashboardPeriodFilterState) {
  if (value.mode === "current-month") return { ...value, endMonth: value.startMonth };
  if (value.mode === "ytd") return { ...value, startMonth: `${value.endMonth.slice(0, 4)}01` };
  if (value.mode === "date-range") {
    return {
      ...value,
      endMonth: value.endDate ? value.endDate.slice(0, 7).replace("-", "") : value.endMonth,
      startMonth: value.startDate ? value.startDate.slice(0, 7).replace("-", "") : value.startMonth,
    };
  }
  return value;
}

function validateWmsPeriodFilter(value: DashboardPeriodFilterState) {
  const normalized = normalizeWmsPeriodFilter(value);
  if (normalized.mode === "date-range") {
    if (!normalized.startDate || !normalized.endDate) return "Start date dan end date harus diisi.";
    if (new Date(`${normalized.startDate}T00:00:00`) > new Date(`${normalized.endDate}T00:00:00`)) {
      return "Start date must be before or equal to end date.";
    }
  } else if (normalized.startMonth > normalized.endMonth) {
    return "Start period must be before or equal to end period.";
  }
  return null;
}

function wmsRowSegment(row: WmsReportRow, startDay: number, endDay: number) {
  const days = row.days.slice(startDay - 1, endDay);
  const mtd = days.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return { days, mtd };
}

function aggregateWmsRows(
  label: string,
  rows: { row: WmsReportRow; startDay: number; endDay: number; weight: number }[],
  ytdRows = rows,
): WmsReportRow {
  const base = rows[0]?.row;
  const days = rows.flatMap((part) => wmsRowSegment(part.row, part.startDay, part.endDay).days);
  const mtd = rows.reduce((sum, part) => sum + wmsRowSegment(part.row, part.startDay, part.endDay).mtd, 0);
  const targetFm = rows.reduce((sum, part) => sum + part.row.targetFm * part.weight, 0);
  const realYtd = ytdRows.reduce((sum, part) => sum + wmsRowSegment(part.row, part.startDay, part.endDay).mtd, 0);
  const targetYtd = ytdRows.reduce((sum, part) => sum + part.row.targetFm * part.weight, 0);
  const realMtdPrev = rows.reduce((sum, part) => sum + part.row.realMtdPrev * part.weight, 0);
  const realFmPrev = rows.reduce((sum, part) => sum + part.row.realFmPrev * part.weight, 0);
  // realYtdPrev tiap bulan sudah kumulatif (Jan..bulan tsb, REAL!BN), jadi tidak boleh dijumlah antar bulan.
  // Sama seperti workbook: pembanding GR YTD = YTD tahun lalu sampai bulan terakhir pada rentang.
  const realYtdPrev = ytdRows.at(-1)?.row.realYtdPrev ?? 0;
  return {
    ...(base ?? {
      ach: null,
      achYtd: null,
      days: [],
      growthFm: null,
      growthMtd: null,
      growthYtd: null,
      label,
      mtd: 0,
      rank: null,
      rankYtd: null,
      realFmPrev: 0,
      realMtdPrev: 0,
      realYtd: 0,
      realYtdPrev: 0,
      shortageFm: 0,
      shortageYtd: 0,
      targetFm: 0,
      targetYtd: 0,
    }),
    ach: targetFm ? mtd / targetFm : 0,
    achYtd: targetYtd ? realYtd / targetYtd : 0,
    days,
    growthFm: realFmPrev ? mtd / realFmPrev - 1 : null,
    growthMtd: realMtdPrev ? mtd / realMtdPrev - 1 : null,
    growthYtd: realYtdPrev ? realYtd / realYtdPrev - 1 : null,
    label,
    mtd,
    rank: null,
    rankYtd: null,
    realFmPrev,
    realMtdPrev,
    realYtd,
    realYtdPrev,
    shortageFm: mtd - targetFm,
    shortageYtd: realYtd - targetYtd,
    targetFm,
    targetYtd,
  };
}

// Sama dengan Excel RANK() dan assignRanks di reporting.ts: nilai sama -> peringkat sama (1 + jumlah nilai lebih besar).
function rankWmsRows(rows: WmsReportRow[], source: "ach" | "achYtd", target: "rank" | "rankYtd") {
  return rows.map((row) => {
    const current = row[source];
    const rank = current === null || current === undefined ? null : 1 + rows.filter((other) => (other[source] ?? -Infinity) > current).length;
    return { ...row, [target]: rank };
  });
}

function aggregateWmsTable(
  parts: WmsReportPart[],
  selectRows: (report: WmsComputedReport) => WmsReportRow[],
  selectTotal: (report: WmsComputedReport) => WmsReportRow,
  totalLabel: string,
  ytdParts = parts,
) {
  const firstRows = selectRows(parts[0].report);
  const rows = firstRows.map((row) =>
    aggregateWmsRows(
      row.label,
      parts.map((part) => ({
        endDay: part.endDay,
        row: selectRows(part.report).find((candidate) => candidate.label === row.label) ?? row,
        startDay: part.startDay,
        weight: part.weight,
      })),
      ytdParts.map((part) => ({
        endDay: part.endDay,
        row: selectRows(part.report).find((candidate) => candidate.label === row.label) ?? row,
        startDay: part.startDay,
        weight: part.weight,
      })),
    ),
  );
  const rankedRows = rankWmsRows(rankWmsRows(rows, "ach", "rank"), "achYtd", "rankYtd");
  const total = aggregateWmsRows(
    totalLabel,
    parts.map((part) => ({ endDay: part.endDay, row: selectTotal(part.report), startDay: part.startDay, weight: part.weight })),
    ytdParts.map((part) => ({ endDay: part.endDay, row: selectTotal(part.report), startDay: part.startDay, weight: part.weight })),
  );
  return { rows: rankedRows, total };
}

function reportForWmsPeriodFilter(
  baseReport: WmsComputedReport,
  periodArchive: PeriodArchive,
  selectedPeriodKey: string,
  filter: DashboardPeriodFilterState,
) {
  const normalized = normalizeWmsPeriodFilter(filter);
  const validationMessage = validateWmsPeriodFilter(normalized);
  if (validationMessage) return { report: baseReport, validationMessage };
  const parts =
    normalized.mode === "date-range"
      ? dateRangeToMonthParts(normalized.startDate, normalized.endDate)
      : monthRangeKeys(normalized.startMonth, normalized.endMonth).map((periodKey) => ({
          endDay: new Date(Number(periodKey.slice(0, 4)), Number(periodKey.slice(4, 6)), 0).getDate(),
          periodKey,
          startDay: 1,
          weight: 1,
        }));
  if (parts.length <= 1 && parts[0]?.periodKey === selectedPeriodKey && parts[0]?.startDay === 1 && parts[0]?.weight === 1) {
    return { report: baseReport, validationMessage: null };
  }
  const reportParts = parts
    .map((part) => {
      const entry = periodArchive[part.periodKey];
      if (!entry) return null;
      return { ...part, report: computeWmsReport(entry.rows, part.periodKey) };
    })
    .filter(Boolean) as WmsReportPart[];
  if (reportParts.length === 0) return { report: baseReport, validationMessage: "Data periode yang dipilih belum tersedia." };
  const lastPart = reportParts[reportParts.length - 1];
  const ytdEndDate = `${lastPart.periodKey.slice(0, 4)}-${lastPart.periodKey.slice(4, 6)}-${String(lastPart.endDay).padStart(2, "0")}`;
  const ytdParts = dateRangeToMonthParts(`${lastPart.periodKey.slice(0, 4)}-01-01`, ytdEndDate)
    .map((part) => {
      const entry = periodArchive[part.periodKey];
      if (!entry) return null;
      return { ...part, report: computeWmsReport(entry.rows, part.periodKey) };
    })
    .filter(Boolean) as WmsReportPart[];
  const effectiveYtdParts = ytdParts.length > 0 ? ytdParts : reportParts;
  const witel = aggregateWmsTable(reportParts, (report) => report.witel.rows, (report) => report.witel.total, "Total", effectiveYtdParts);
  const telda = aggregateWmsTable(reportParts, (report) => report.telda.rows, (report) => report.telda.total, "YK JATENG SELATAN", effectiveYtdParts);
  const periodLabel =
    normalized.mode === "date-range"
      ? dateRangeLabel(normalized.startDate, normalized.endDate)
      : periodRangeLabel(reportParts[0].periodKey, reportParts[reportParts.length - 1].periodKey);
  return {
    report: {
      ...baseReport,
      cutoffDay: lastPart.endDay,
      cutoffLabel: formatDataCutoffDate(latestActualDateFromWmsParts(reportParts)),
      periodKey: lastPart.periodKey,
      periodLabel,
      telda,
      validation: { ...baseReport.validation, witelMtd: witel.rows.reduce((sum, row) => sum + row.mtd, 0) },
      witel,
    },
    validationMessage: reportParts.length < parts.length ? "Sebagian data periode belum tersedia, hanya periode yang tersedia yang dihitung." : null,
  };
}

function chartLabelNumber(value: unknown) {
  return typeof value === "number" && value > 0 ? formatNumber(value) : "";
}

function chartLabelPercent(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "";
}

function tooltipNumber(value: unknown) {
  return typeof value === "number" ? formatNumber(value) : formatNumber(Number(value ?? 0));
}

function tooltipPercent(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return `${numeric.toFixed(2)}%`;
}

function displayLabelForRow(row: WmsReportRow) {
  return row.label
    .replace("YOGYA JATENG SELATAN", "YJS")
    .replace("SEMARANG JATENG UTARA", "SCU")
    .replace("SOLO JATENG TIMUR", "SJT")
    .replace("NUSA TENGGARA", "NUSRA");
}


const fullAccessPermissions: DashboardPermissions = {
  canAccessMaster: true,
  canEditMaster: true,
  canViewDashboard: true,
};

export function WmsDashboard({ permissions = fullAccessPermissions }: { permissions?: DashboardPermissions }) {
  const router = useRouter();
  const [view, setView] = useState<View>("home");
  const [rows, setRows] = useState<MasterRow[]>(() => initialSeedPeriodArchive()[defaultWmsPeriodKey]?.rows ?? initialMasterRows.map((row) => [...row]));
  const [periodArchive, setPeriodArchive] = useState<PeriodArchive>(() => initialSeedPeriodArchive());
  const [saveSnapshots, setSaveSnapshots] = useState<SaveSnapshots>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string>(defaultWmsPeriodKey);
  const [periodFilter, setPeriodFilter] = useState<DashboardPeriodFilterState>(() => defaultPeriodFilter(defaultWmsPeriodKey));
  const [wilayahFilter, setWilayahFilter] = useState<WilayahFilter>("all-witel");
  const [hydrated, setHydrated] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState("Auto-save standby");
  const [masterUnlockToken, setMasterUnlockToken] = useState<string | null>(null);
  const [masterUnlockOpen, setMasterUnlockOpen] = useState(false);
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => item.id !== "master" || permissions.canAccessMaster),
    [permissions.canAccessMaster],
  );
  const renderView: View = view === "master" && (!permissions.canAccessMaster || !masterUnlockToken) ? "home" : view;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const reportRows = useMemo(() => allRowsFromArchive(periodArchive, selectedPeriodKey, rows), [periodArchive, rows, selectedPeriodKey]);
  const report = useMemo(() => computeWmsReport(reportRows, selectedPeriodKey), [reportRows, selectedPeriodKey]);
  const filteredReportState = useMemo(
    () => reportForWmsPeriodFilter(report, periodArchive, selectedPeriodKey, periodFilter),
    [periodArchive, periodFilter, report, selectedPeriodKey],
  );
  const displayReport = filteredReportState.report;
  const periodOptions = useMemo(() => {
    const archiveOptions = Object.values(periodArchive)
      .map((entry) => ({ label: entry.label, periodKey: entry.periodKey, savedAt: entry.savedAt }))
      .sort((a, b) => b.periodKey.localeCompare(a.periodKey));
    if (archiveOptions.length > 0) return archiveOptions;
    return periodOptionsFromRows(reportRows).sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  }, [periodArchive, reportRows]);
  const active = activeRow(displayReport, wilayahFilter);

  const applyPersistedState = useCallback((state: DashboardPersistedState, status: string) => {
    const nextArchive = ensureCurrentPeriodArchive(state.periodArchive);
    const activePeriodKey = preferredActivePeriodKey(nextArchive, state.selectedPeriodKey);
    if (!activePeriodKey) return;
    const activePeriod = nextArchive[activePeriodKey] ?? createPeriodEntry(activePeriodKey, blankMasterRows(), null);
    const periodArchiveWithActive = { ...nextArchive, [activePeriodKey]: activePeriod };
    setPeriodArchive(periodArchiveWithActive);
    setSaveSnapshots(state.saveSnapshots);
    setSelectedPeriodKey(activePeriodKey);
    setRows(activePeriod.rows);
    setSavedAt(activePeriod.savedAt);
    setDirty(false);
    setAutoSaveStatus(status);
    persistDashboardStateLocally({ ...state, periodArchive: periodArchiveWithActive, selectedPeriodKey: activePeriodKey });
  }, []);

  const syncDashboardState = useCallback((state: DashboardPersistedState, successStatus: string) => {
    void saveDashboardStateToServer(state, masterUnlockToken)
      .then((result) => {
        setAutoSaveStatus(result.configured ? successStatus : "Data tersimpan di browser; database server belum dikonfigurasi");
      })
      .catch(() => {
        setAutoSaveStatus("Data tersimpan di browser; sync server gagal");
      });
  }, [masterUnlockToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const seedArchive = initialSeedPeriodArchive();
      const storedArchive = parsePeriodArchive(window.localStorage.getItem(PERIOD_ARCHIVE_KEY));
      const storedSnapshots = parseSaveSnapshots(window.localStorage.getItem(SAVE_SNAPSHOTS_KEY));
      const storedSelectedPeriod = window.localStorage.getItem(SELECTED_PERIOD_KEY);
      const storedRows = window.localStorage.getItem(STORAGE_KEY);
      const storedSavedAt = window.localStorage.getItem(SAVED_AT_KEY);
      const shouldRefreshSeed = window.localStorage.getItem(DATA_VERSION_KEY) !== wmsDataVersion;
      let nextArchive: PeriodArchive = shouldRefreshSeed ? { ...storedArchive, ...seedArchive } : { ...seedArchive, ...storedArchive };

      if (Object.keys(storedArchive).length === 0 && storedRows) {
        try {
          const legacyRows = (JSON.parse(storedRows) as unknown[]).map((row) => ensureRowWidth(Array.isArray(row) ? row : []));
          const legacyPeriod = detectPeriodKey(legacyRows, defaultWmsPeriodKey);
          nextArchive = {
            ...nextArchive,
            [legacyPeriod]: createPeriodEntry(legacyPeriod, legacyRows, storedSavedAt),
          };
        } catch {
          // legacy local cache is optional
        }
      }

      nextArchive = ensureCurrentPeriodArchive(nextArchive);
      const activePeriodKey = preferredActivePeriodKey(nextArchive, storedSelectedPeriod);
      const activePeriod = nextArchive[activePeriodKey] ?? createPeriodEntry(activePeriodKey, blankMasterRows(), null);
      nextArchive = { ...nextArchive, [activePeriodKey]: activePeriod };

      const localState: DashboardPersistedState = {
        periodArchive: nextArchive,
        saveSnapshots: storedSnapshots,
        selectedPeriodKey: activePeriodKey,
        updatedAt: activePeriod.updatedAt,
      };
      applyPersistedState(localState, "Data lokal dimuat");

      void loadDashboardStateFromServer()
        .then(({ configured, state }) => {
          if (state) {
            const mergedArchive = { ...nextArchive, ...state.periodArchive }; // Server-saved uploads always override bundled seed and browser cache.
            applyPersistedState({ ...state, periodArchive: mergedArchive }, "Data server dimuat");
          } else if (!configured) {
            setAutoSaveStatus("Database server belum dikonfigurasi; data tersimpan di browser ini");
          }
        })
        .catch(() => {
          setAutoSaveStatus("Data lokal dimuat; server belum bisa diakses");
        })
        .finally(() => {
          safeStorageSet(DATA_VERSION_KEY, wmsDataVersion);
          setHydrated(true);
        });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [applyPersistedState]);

  const saveData = useCallback((nextRows = rows, options: { automated?: boolean; pushSnapshot?: boolean } = {}) => {
    const timestamp = new Date().toISOString();
    const periodKey = detectPeriodKey(nextRows, selectedPeriodKey);
    const previousEntry = periodArchive[periodKey];
    const shouldPushSnapshot = options.pushSnapshot !== false && Boolean(previousEntry?.savedAt);
    const nextSnapshots = shouldPushSnapshot
      ? {
          ...saveSnapshots,
          [periodKey]: [
            ...(saveSnapshots[periodKey] ?? []),
            {
              periodKey,
              rows: previousEntry?.rows ?? [],
              savedAt: previousEntry?.savedAt ?? null,
            },
          ].slice(-MAX_SNAPSHOTS_PER_PERIOD),
        }
      : saveSnapshots;
    const nextArchive = {
      ...periodArchive,
      [periodKey]: createPeriodEntry(periodKey, nextRows, timestamp),
    };
    const persistedState: DashboardPersistedState = {
      periodArchive: nextArchive,
      saveSnapshots: nextSnapshots,
      selectedPeriodKey: periodKey,
      updatedAt: timestamp,
    };
    persistDashboardStateLocally(persistedState);
    setPeriodArchive(nextArchive);
    setSaveSnapshots(nextSnapshots);
    setSelectedPeriodKey(periodKey);
    setRows(nextRows);
    setSavedAt(timestamp);
    setDirty(false);
    const status = options.automated ? `Auto-save tersimpan: ${formatJakartaDateTime(new Date(timestamp), true)}` : "Data tersimpan manual";
    setAutoSaveStatus(status);
    syncDashboardState(persistedState, `${status} dan tersinkron ke server`);
  }, [periodArchive, rows, saveSnapshots, selectedPeriodKey, syncDashboardState]);

  useEffect(() => {
    if (!hydrated || !dirty) return undefined;
    const timeout = window.setTimeout(() => {
      saveData(rows, { automated: true });
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [dirty, hydrated, rows, saveData]);

  function clearData() {
    setRows(blankMasterRows());
    setDirty(true);
    setAutoSaveStatus("Auto-save dalam 3 menit jika tidak ada perubahan");
  }

  async function importExcel(file: File | undefined) {
    if (!file) return;
    try {
      const importedRows = await readMasterRowsFromUpload(file);
      const grouped = splitRowsByPeriod(importedRows);
      const timestamp = new Date().toISOString();
      const importedArchive = Object.fromEntries(
        Object.entries(grouped).map(([periodKey, periodRows]) => [periodKey, createPeriodEntry(periodKey, periodRows, timestamp)]),
      );
      const activePeriodKey = Object.keys(importedArchive).sort().at(-1) ?? selectedPeriodKey;
      const nextArchive = { ...periodArchive, ...importedArchive };
      const nextSnapshots: SaveSnapshots = { ...saveSnapshots };
      for (const periodKey of Object.keys(importedArchive)) {
        const previousEntry = periodArchive[periodKey];
        if (!previousEntry?.savedAt) continue;
        nextSnapshots[periodKey] = [
          ...(nextSnapshots[periodKey] ?? []),
          { periodKey, rows: previousEntry.rows, savedAt: previousEntry.savedAt },
        ].slice(-MAX_SNAPSHOTS_PER_PERIOD);
      }
      const persistedState: DashboardPersistedState = {
        periodArchive: nextArchive,
        saveSnapshots: nextSnapshots,
        selectedPeriodKey: activePeriodKey,
        updatedAt: timestamp,
      };
      persistDashboardStateLocally(persistedState);
      setPeriodArchive(nextArchive);
      setSaveSnapshots(nextSnapshots);
      setSelectedPeriodKey(activePeriodKey);
      setRows(nextArchive[activePeriodKey]?.rows ?? importedRows);
      setSavedAt(nextArchive[activePeriodKey]?.savedAt ?? timestamp);
      setDirty(false);
      setAutoSaveStatus("Import file tersimpan");
      setImportError(null);
      syncDashboardState(persistedState, "Import file tersinkron ke server");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "File Excel/CSV tidak bisa dibaca.");
    }
  }

  function restorePreviousSave() {
    const versions = saveSnapshots[selectedPeriodKey] ?? [];
    const previous = versions[versions.length - 1];
    if (!previous) return;
    const nextSnapshots = {
      ...saveSnapshots,
      [selectedPeriodKey]: versions.slice(0, -1),
    };
    const nextArchive = {
      ...periodArchive,
      [selectedPeriodKey]: createPeriodEntry(selectedPeriodKey, previous.rows, previous.savedAt),
    };
    const persistedState: DashboardPersistedState = {
      periodArchive: nextArchive,
      saveSnapshots: nextSnapshots,
      selectedPeriodKey,
      updatedAt: previous.savedAt,
    };
    persistDashboardStateLocally(persistedState);
    setRows(previous.rows);
    setSavedAt(previous.savedAt);
    setPeriodArchive(nextArchive);
    setSaveSnapshots(nextSnapshots);
    setDirty(false);
    setAutoSaveStatus("Kembali ke save sebelumnya");
    syncDashboardState(persistedState, "Save sebelumnya tersinkron ke server");
  }

  function selectPeriod(periodKey: string) {
    const entry = periodArchive[periodKey];
    if (!entry) return;
    setSelectedPeriodKey(periodKey);
    setRows(entry.rows);
    setSavedAt(entry.savedAt);
    setDirty(false);
    setAutoSaveStatus("Auto-save standby");
    safeStorageSet(SELECTED_PERIOD_KEY, periodKey);
    safeStorageSet(STORAGE_KEY, JSON.stringify(entry.rows));
    if (entry.savedAt) {
      safeStorageSet(SAVED_AT_KEY, entry.savedAt);
    } else {
      window.localStorage.removeItem(SAVED_AT_KEY);
    }
  }

  function openMasterView() {
    if (!permissions.canAccessMaster) return;
    if (!masterUnlockToken) {
      setMasterUnlockOpen(true);
      return;
    }
    setView("master");
  }

  return (
    <main className="min-h-screen bg-[#2a1a10] bg-[radial-gradient(circle_at_90%_8%,rgba(245,158,11,0.16),transparent_32%),radial-gradient(circle_at_8%_24%,rgba(120,53,15,0.18),transparent_28%),linear-gradient(135deg,#21130b_0%,#3b2414_50%,#27170d_100%)] text-stone-950">
      <header className="sticky top-0 z-40 border-b border-amber-300/20 bg-[#2a1a10]/95 bg-[radial-gradient(circle_at_12%_0%,rgba(245,158,11,0.22),transparent_28%),linear-gradient(135deg,#21130b_0%,#3b2414_54%,#27170d_100%)] shadow-[0_22px_48px_-34px_rgba(0,0,0,0.92)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1920px] flex-col gap-3 px-4 py-3 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.07] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg bg-white/[0.08] shadow-[0_14px_30px_-16px_rgba(245,158,11,0.9)] ring-1 ring-amber-300/25">
              <Image alt="WMS" className="h-full w-full object-cover" height={80} priority src="/module-covers/wms-design-card.png" width={80} />
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-normal text-white">Reporting WMS 2026</p>
              <p className="text-xs font-semibold uppercase text-amber-100/75">{hydrated ? `${formatNumber(rows.length)} BARIS MASTER` : "MEMUAT DATA"}</p>
            </div>
          </div>
          <nav className="scrollbar-thin flex min-w-0 gap-1.5 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.08] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur">
            <button onClick={() => router.push("/portal")} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold text-stone-100/85 transition hover:bg-white/12 hover:text-white">
              <ArrowLeft className="h-4 w-4" />
              Portal
            </button>
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const activeItem = renderView === item.id;
              const masterLocked = item.id === "master" && !masterUnlockToken;
              return (
                <button
                  className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold transition ${
                    activeItem ? "bg-white text-[#2a1a10] shadow-[0_16px_30px_-20px_rgba(245,158,11,0.85)]" : "text-stone-100/85 hover:bg-white/12 hover:text-white"
                  }`}
                  key={item.id}
                  onClick={() => {
                    if (item.id === "master") {
                      openMasterView();
                    } else {
                      setMasterUnlockToken(null);
                      setView(item.id);
                    }
                  }}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  {masterLocked && <LockKeyhole aria-label="Master terkunci" className="h-3.5 w-3.5 opacity-70" />}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1920px] px-3 py-5 sm:px-5 lg:px-6">
        {renderView === "home" && (
          <DashboardHome
            active={active}
            onPeriodFilterChange={setPeriodFilter}
            periodOptions={periodOptions}
            periodFilter={periodFilter}
            periodValidationMessage={filteredReportState.validationMessage}
            report={displayReport}
            selectedPeriodKey={selectedPeriodKey}
            setSelectedPeriodKey={selectPeriod}
            setWilayahFilter={setWilayahFilter}
            wilayahFilter={wilayahFilter}
          />
        )}
        {renderView === "master" && permissions.canAccessMaster && (
          <MasterPage
            importError={importError}
            rows={rows}
            savedAt={savedAt}
            autoSaveStatus={autoSaveStatus}
            canGoBack={(saveSnapshots[selectedPeriodKey] ?? []).length > 0}
            setRows={(updater) => {
              setRows(updater);
              setDirty(true);
              setAutoSaveStatus("Auto-save dalam 3 menit jika tidak ada perubahan");
            }}
            onClear={clearData}
            onImport={importExcel}
            onBack={restorePreviousSave}
            onSave={() => saveData()}
            fileInputRef={fileInputRef}
          />
        )}
        {renderView === "report" && <ReportPage report={report} />}
      </div>
      <MasterUnlockModal
        open={masterUnlockOpen}
        theme="wms"
        onClose={() => setMasterUnlockOpen(false)}
        onUnlocked={(token) => {
          setMasterUnlockToken(token);
          setMasterUnlockOpen(false);
          setView("master");
        }}
      />
    </main>
  );
}

function DashboardHome({
  active,
  onPeriodFilterChange,
  periodOptions,
  periodFilter,
  periodValidationMessage,
  report,
  selectedPeriodKey,
  setSelectedPeriodKey,
  setWilayahFilter,
  wilayahFilter,
}: {
  active: { label: string; row: WmsReportRow; rows: WmsReportRow[]; type: string };
  onPeriodFilterChange: (value: DashboardPeriodFilterState) => void;
  periodOptions: { label: string; periodKey: string }[];
  periodFilter: DashboardPeriodFilterState;
  periodValidationMessage: string | null;
  report: WmsComputedReport;
  selectedPeriodKey: string;
  setSelectedPeriodKey: (value: string) => void;
  setWilayahFilter: (value: WilayahFilter) => void;
  wilayahFilter: WilayahFilter;
}) {
  const [analyticsFilter, setAnalyticsFilter] = useState<{ period: DashboardPeriodMode }>({ period: "mtd" });
  const normalizedPeriodFilter = normalizeWmsPeriodFilter(periodFilter);
  const periodMetricLabel = getPeriodSemanticLabel(normalizedPeriodFilter.mode);
  const isAllWilayah = wilayahFilter === "all-witel" || wilayahFilter === "all-telda";
  const chartSourceRows = isAllWilayah ? active.rows : [active.row];
  const chartPeriodLabel = analyticsFilter.period === "mtd" ? periodMetricLabel : "YTD";
  const targetChart = chartSourceRows.map((row) => {
    const target = analyticsFilter.period === "mtd" ? row.targetFm : row.targetYtd;
    const realisasi = analyticsFilter.period === "mtd" ? row.mtd : row.realYtd;
    const achievement = target > 0 ? realisasi / target : 0;
    return {
      achievement: Number((achievement * 100).toFixed(2)),
      name: displayLabelForRow(row),
      realisasi,
      shortage: Math.max(target - realisasi, 0),
      target,
    };
  });
  const ranking = [...active.rows].sort((a, b) => {
    const first = analyticsFilter.period === "mtd" ? b.ach : b.achYtd;
    const second = analyticsFilter.period === "mtd" ? a.ach : a.achYtd;
    return (first ?? -1) - (second ?? -1);
  });
  const analyticsAchievement = (row: WmsReportRow) => (analyticsFilter.period === "mtd" ? row.ach : row.achYtd) ?? 0;
  const topWilayah = ranking[0];
  const latestDay = report.cutoffDay;
  const dataCutoffLabel = report.cutoffLabel.startsWith("DATA S.D.") ? report.cutoffLabel : formatDataCutoff({ day: latestDay, periodKey: selectedPeriodKey });
  const ytdPeriodLabel = formatYtdLabel(normalizedPeriodFilter.endDate);
  const summaryMtdRankingRows = active.rows.map((row) => ({
    achievement: row.ach,
    id: row.label,
    label: displayLabelForRow(row),
  }));
  const summaryYtdRankingRows = active.rows.map((row) => ({
    achievement: row.achYtd,
    id: row.label,
    label: displayLabelForRow(row),
  }));
  const targetPerDay = active.row.targetFm / Math.max(active.row.days.length, 1);
  const trendData = active.row.days.slice(0, latestDay).map((_value, index) => {
    const day = index + 1;
    const realisasiKumulatif = active.row.days.slice(0, day).reduce<number>((sum, item) => sum + (typeof item === "number" ? item : 0), 0);
    return {
      day,
      realisasiKumulatif,
      targetKumulatif: Number((targetPerDay * day).toFixed(2)),
    };
  });
  const heroTitle = isAllWilayah ? `WMS PERFORMA ${active.label}` : `WMS PERFORMA ${active.type} ${active.label}`;

  return (
    <div className="space-y-5">
      <section className={`${panelClass} relative overflow-hidden`}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_88%_10%,rgba(245,158,11,0.16),transparent_28%),linear-gradient(135deg,#ffffff_0%,#fffaf2_54%,#fff7ed_100%)]" />
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#3b2414] via-amber-500 to-orange-300" />
        <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-[280px] flex-1">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase text-amber-700">
              <BarChart3 className="h-4 w-4" />
              DASHBOARD REPORTING WMS 2026
            </p>
            <h1 className="mt-1 text-xl font-semibold uppercase tracking-normal text-[#2a1a10] sm:text-2xl">WMS PERFORMANCE</h1>
            <p className="mt-1 max-w-2xl text-xs font-medium uppercase leading-5 text-stone-500">
              {report.periodLabel} | {active.label} | {dataCutoffLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <DashboardPeriodFilter
              onChange={(value) => {
                onPeriodFilterChange(value);
                const anchorPeriod = value.mode === "date-range" ? value.endDate.slice(0, 7).replace("-", "") : value.endMonth;
                if (anchorPeriod && anchorPeriod !== selectedPeriodKey && periodOptions.some((option) => option.periodKey === anchorPeriod)) {
                  setSelectedPeriodKey(anchorPeriod);
                }
              }}
              options={periodOptions}
              theme="wms"
              validationMessage={periodValidationMessage}
              value={periodFilter}
            />
            <label className="grid gap-1 text-[11px] font-semibold uppercase text-stone-500">
              WILAYAH
              <select className="h-9 w-[210px] rounded-md border border-stone-200 bg-white px-3 text-xs font-semibold text-[#2a1a10] shadow-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100" value={wilayahFilter} onChange={(event) => setWilayahFilter(event.target.value as WilayahFilter)}>
                <option value="all-witel">ALL WITEL</option>
                <option value="all-telda">ALL TELDA</option>
                <optgroup label="WITEL">
                  {report.witel.rows.map((row) => <option key={row.label} value={`witel:${row.label}`}>{row.label}</option>)}
                </optgroup>
                <optgroup label="TELDA">
                  {report.telda.rows.map((row) => <option key={row.label} value={`telda:${row.label}`}>{row.label}</option>)}
                </optgroup>
              </select>
            </label>
            <StatusPill tone="good">VALIDASI MATCH</StatusPill>
          </div>
        </div>
      </section>

      <section className={`${panelClass} overflow-hidden`}>
        <div className="relative grid items-start gap-4 bg-[linear-gradient(135deg,#ffffff_0%,#fffaf2_48%,#fff7ed_100%)] p-4 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(245,158,11,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(120,53,15,0.035)_1px,transparent_1px)] bg-[size:44px_44px] opacity-60" />
          <div className="relative overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-[0_16px_36px_-28px_rgba(41,24,12,0.7)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-[#2a1a10] px-3 py-2.5 text-white">
              <div>
                <p className="text-[11px] font-semibold uppercase text-amber-200">WMS PERFORMANCE SUMMARY</p>
                <h2 className="mt-0.5 text-sm font-semibold tracking-normal">PERIODE {report.periodLabel} | {active.label}</h2>
              </div>
              <StatusPill>{dataCutoffLabel}</StatusPill>
            </div>
            <div className="grid gap-2.5 p-2.5 xl:grid-cols-2">
              <div className="overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-2.5 py-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-amber-700">WMS PERFORMA {periodMetricLabel} ({report.periodLabel})</p>
                    <p className="mt-0.5 text-xs font-semibold uppercase text-stone-950">{report.periodLabel} | {active.label}</p>
                  </div>
                  <span className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold uppercase text-stone-600">
                    FM
                  </span>
                </div>
                <div className="grid gap-2 p-2.5">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-md border border-stone-200 bg-white p-2 shadow-sm">
                      <p className="text-[10px] font-semibold uppercase text-stone-500">TARGET FM {periodMetricLabel}</p>
                      <p className="mt-0.5 text-base font-semibold text-stone-950">{formatNumber(active.row.targetFm)}</p>
                    </div>
                    <div className="rounded-md border border-emerald-100 bg-emerald-50/70 p-2 shadow-sm">
                      <p className="text-[10px] font-semibold uppercase text-emerald-700">REALISASI {periodMetricLabel}</p>
                      <p className="mt-0.5 text-base font-semibold text-emerald-950">{formatNumber(active.row.mtd)}</p>
                    </div>
                    <div className="rounded-md border border-amber-100 bg-amber-50/70 p-2 shadow-sm">
                      <p className="text-[10px] font-semibold uppercase text-amber-700">ACH FM {periodMetricLabel}</p>
                      <p className="mt-0.5 text-base font-semibold text-amber-950">{formatPercent(active.row.ach)}</p>
                    </div>
                    <div className="rounded-md border border-rose-100 bg-rose-50/70 p-2 shadow-sm">
                      <p className="text-[10px] font-semibold uppercase text-rose-700">SHORTAGE FM {periodMetricLabel}</p>
                      <p className="mt-0.5 text-base font-semibold text-rose-950">{formatNumber(active.row.shortageFm)}</p>
                    </div>
                  </div>
                  <div className="rounded-md border border-stone-200 bg-stone-50/80 p-2">
                    <div className="flex items-center justify-between text-[11px] font-semibold uppercase">
                      <span className="text-stone-500">ACHIEVEMENT {periodMetricLabel}</span>
                      <span className="text-emerald-700">{formatPercent(active.row.ach)}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200">
                      <div className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500" style={{ width: `${Math.min((active.row.ach ?? 0) * 100, 100)}%` }} />
                    </div>
                    <CompactRankingInsight
                      formatPercent={formatPercent}
                      isAllScope={isAllWilayah}
                      periodLabel={periodMetricLabel}
                      rows={summaryMtdRankingRows}
                      scopeLabel={active.type}
                      selectedId={active.row.label}
                      valueClassName="text-amber-700"
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-2.5 py-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-amber-700">WMS PERFORMA YTD (TAHUN BERJALAN)</p>
                    <p className="mt-0.5 text-xs font-semibold uppercase text-stone-950">{ytdPeriodLabel} | {active.label}</p>
                  </div>
                  <span className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold uppercase text-stone-600">
                    YTD
                  </span>
                </div>
                <div className="grid gap-2 p-2.5">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-md border border-stone-200 bg-white p-2 shadow-sm">
                      <p className="text-[10px] font-semibold uppercase text-stone-500">TARGET YTD</p>
                      <p className="mt-0.5 text-base font-semibold text-stone-950">{formatNumber(active.row.targetYtd)}</p>
                    </div>
                    <div className="rounded-md border border-emerald-100 bg-emerald-50/70 p-2 shadow-sm">
                      <p className="text-[10px] font-semibold uppercase text-emerald-700">REALISASI YTD</p>
                      <p className="mt-0.5 text-base font-semibold text-emerald-950">{formatNumber(active.row.realYtd)}</p>
                    </div>
                    <div className="rounded-md border border-amber-100 bg-amber-50/70 p-2 shadow-sm">
                      <p className="text-[10px] font-semibold uppercase text-amber-700">ACH YTD</p>
                      <p className="mt-0.5 text-base font-semibold text-amber-950">{formatPercent(active.row.achYtd)}</p>
                    </div>
                    <div className="rounded-md border border-rose-100 bg-rose-50/70 p-2 shadow-sm">
                      <p className="text-[10px] font-semibold uppercase text-rose-700">SHORTAGE YTD</p>
                      <p className="mt-0.5 text-base font-semibold text-rose-950">{formatNumber(active.row.shortageYtd)}</p>
                    </div>
                  </div>
                  <div className="rounded-md border border-stone-200 bg-stone-50/80 p-2">
                    <div className="flex items-center justify-between text-[11px] font-semibold uppercase">
                      <span className="text-stone-500">ACHIEVEMENT YTD</span>
                      <span className="text-emerald-700">{formatPercent(active.row.achYtd)}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200">
                      <div className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500" style={{ width: `${Math.min((active.row.achYtd ?? 0) * 100, 100)}%` }} />
                    </div>
                    <CompactRankingInsight
                      formatPercent={formatPercent}
                      isAllScope={isAllWilayah}
                      periodLabel="YTD"
                      rows={summaryYtdRankingRows}
                      scopeLabel={active.type}
                      selectedId={active.row.label}
                      valueClassName="text-amber-700"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <section className="relative overflow-hidden rounded-xl border border-amber-300/20 bg-[linear-gradient(145deg,#1c1008_0%,#2a1a10_48%,#4b2d18_100%)] p-5 text-white shadow-[0_30px_78px_-42px_rgba(245,158,11,0.55)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_86%_4%,rgba(245,158,11,0.22),transparent_30%)]" />
            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold uppercase leading-5 text-amber-100">{heroTitle}</p>
                <span className="shrink-0 rounded-md border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[11px] font-semibold uppercase text-amber-100">
                  SOURCE: BRIGHT
                </span>
              </div>
              <p className="mt-3 text-xs font-semibold uppercase text-stone-400">CAKUPAN: {active.label}</p>
              <p className="mt-4 text-xs font-semibold uppercase text-stone-400">TOTAL REALISASI {periodMetricLabel}</p>
              <p className="mt-1.5 text-4xl font-semibold tracking-normal text-white">{formatNumber(active.row.mtd)}</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400" style={{ width: `${Math.min((active.row.ach ?? 0) * 100, 100)}%` }} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2.5 text-sm">
                <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-xs font-semibold uppercase text-stone-400">ACH FM</p>
                  <p className="mt-1 text-base font-semibold text-white">{formatPercent(active.row.ach)}</p>
                </div>
                <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-xs font-semibold uppercase text-stone-400">ACH YTD</p>
                  <p className="mt-1 text-base font-semibold text-white">{formatPercent(active.row.achYtd)}</p>
                </div>
                <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-xs font-semibold uppercase text-stone-400">SHORTAGE FM</p>
                  <p className="mt-1 text-base font-semibold text-amber-200">{formatNumber(active.row.shortageFm)}</p>
                </div>
                <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-xs font-semibold uppercase text-stone-400">SHORTAGE YTD</p>
                  <p className="mt-1 text-base font-semibold text-amber-200">{formatNumber(active.row.shortageYtd)}</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="TARGET YTD" value={formatNumber(active.row.targetYtd)} detail="TARGET YTD 2026" icon={FileSpreadsheet} />
        <MetricCard label={`REALISASI ${periodMetricLabel}`} value={formatNumber(active.row.mtd)} detail={report.latestUpdatedAt ? `UPDATE ${formatSavedAt(report.latestUpdatedAt)}` : report.cutoffLabel} tone="good" icon={TrendingUp} />
        <MetricCard label="ACH FM" value={formatPercent(active.row.ach)} detail="REALISASI / TARGET FM" icon={ArrowUpRight} />
        <MetricCard label={periodMetricLabel === "MTD" ? "SHORTAGE CURRENT MONTH" : `SHORTAGE ${periodMetricLabel}`} value={formatNumber(active.row.shortageFm)} detail={`REALISASI ${periodMetricLabel} - TARGET FM ${periodMetricLabel}`} tone="warn" icon={FileSpreadsheet} />
        <MetricCard label={periodMetricLabel === "MTD" ? "GROWTH VS LAST MONTH" : "GROWTH VS COMPARABLE PERIOD"} value={formatPercent(active.row.growthMtd)} detail={periodMetricLabel === "MTD" ? "DIBANDINGKAN MTD BULAN SEBELUMNYA" : "DIBANDINGKAN PERIODE PEMBANDING"} icon={BarChart3} />
        <MetricCard label="RANKING WILAYAH" value={topWilayah?.label ?? "N/A"} detail={topWilayah ? `TOP ${active.type} ${formatPercent(topWilayah.ach)}` : `RANK ${active.type}`} icon={ShieldCheck} />
      </div>

      <section className={`${panelClass} overflow-hidden bg-white`}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#eaeff5] px-6 py-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-600">Performance Analytics</p>
            <h2 className="mt-1 text-[28px] font-bold uppercase leading-tight tracking-[-0.02em] text-stone-950">Regional Performance</h2>
            <p className="mt-1 text-sm font-medium text-stone-500">Ringkasan performa dan ranking achievement per TELDA</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="h-11 rounded-xl border border-stone-200 bg-white px-3 text-xs font-semibold uppercase text-stone-700 shadow-sm outline-none focus:border-amber-400" value={analyticsFilter.period} onChange={(event) => setAnalyticsFilter({ period: event.target.value as DashboardPeriodMode })}>
              <option value="mtd">{periodMetricLabel}</option>
              <option value="ytd">YTD</option>
            </select>
            <StatusPill>{report.periodLabel}</StatusPill>
          </div>
        </div>
        <div className="grid xl:grid-cols-[1.45fr_0.95fr]">
        <div className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold uppercase text-stone-950">TARGET VS REALISASI PER WILAYAH</h2>
              <p className="mt-1 text-[13px] font-medium uppercase text-stone-500">INDIKATOR {chartPeriodLabel}: TARGET, REALISASI, SHORTAGE, DAN ACHIEVEMENT PER {active.type}</p>
            </div>
          </div>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={targetChart} margin={{ left: 0, right: 22, top: 24, bottom: isAllWilayah ? 84 : 42 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                <XAxis
                  dataKey="name"
                  interval={0}
                  tick={{ angle: isAllWilayah ? -42 : 0, dx: isAllWilayah ? -10 : 0, dy: isAllWilayah ? 20 : 0, fontSize: isAllWilayah ? 8 : 12, fontWeight: 700, textAnchor: isAllWilayah ? "end" : "middle" }}
                  tickMargin={isAllWilayah ? 18 : 6}
                />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} unit="%" />
                <Tooltip formatter={(value, name) => (name === "ACHIEVEMENT" ? tooltipPercent(value) : tooltipNumber(value))} />                <Bar yAxisId="left" dataKey="target" name="TARGET" fill="#78716c" radius={[4, 4, 0, 0]}><LabelList dataKey="target" position="top" formatter={chartLabelNumber} fontSize={10} /></Bar>
                <Bar yAxisId="left" dataKey="realisasi" name="REALISASI" fill="#f97316" radius={[4, 4, 0, 0]}><LabelList dataKey="realisasi" position="top" formatter={chartLabelNumber} fontSize={10} /></Bar>
                <Bar yAxisId="left" dataKey="shortage" name="SHORTAGE" fill="#e11d48" radius={[4, 4, 0, 0]}><LabelList dataKey="shortage" position="top" formatter={chartLabelNumber} fontSize={10} /></Bar>
                <Line yAxisId="right" type="monotone" dataKey="achievement" name="ACHIEVEMENT" stroke="#059669" strokeWidth={3} dot={{ r: 3 }}><LabelList dataKey="achievement" position="top" formatter={chartLabelPercent} fontSize={10} fill="#047857" /></Line>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-bold uppercase">
            <span className="inline-flex items-center gap-1.5 text-emerald-600">
              <span className="h-0.5 w-5 rounded-full bg-emerald-600" />
              Achievement
            </span>
            <span className="inline-flex items-center gap-1.5 text-orange-600">
              <span className="h-3 w-3 rounded-sm bg-orange-500" />
              Realisasi
            </span>
            <span className="inline-flex items-center gap-1.5 text-rose-600">
              <span className="h-3 w-3 rounded-sm bg-rose-600" />
              Shortage
            </span>
            <span className="inline-flex items-center gap-1.5 text-stone-600">
              <span className="h-3 w-3 rounded-sm bg-stone-500" />
              Target
            </span>
          </div>
        </div>
        <div className="border-t border-stone-100 p-4 xl:border-l xl:border-t-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold uppercase text-stone-950">RANKING ACHIEVEMENT</h2>
              <p className="mt-1 text-[13px] font-medium uppercase text-stone-500">RANKING BERDASARKAN ACH {chartPeriodLabel}</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="mt-3 divide-y divide-stone-100">
            {ranking.map((row, index) => (
              <div className={`grid grid-cols-[34px_1fr_auto] items-center gap-3 py-2.5 text-sm ${row.label === active.row.label ? "rounded-md bg-amber-50/70 px-2" : ""}`} key={row.label}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2a1a10] text-xs font-semibold text-white shadow-sm">{index + 1}</span>
                <div className="min-w-0">
                  <span className="font-medium uppercase text-stone-800">{displayLabelForRow(row)}</span>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500" style={{ width: `${Math.min(analyticsAchievement(row) * 100, 100)}%` }} />
                  </div>
                </div>
                <span className="font-semibold text-amber-700">{formatPercent(analyticsAchievement(row))}</span>
              </div>
            ))}
          </div>
        </div>
        </div>
      </section>

      <section className={`${panelClass} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold uppercase text-stone-950">TREN TARGET HARIAN VS REALISASI HARIAN</h2>
            <p className="mt-1 text-xs font-medium uppercase text-stone-500">TARGET KUMULATIF HARIAN VS REALISASI KUMULATIF HARIAN</p>
          </div>
          <StatusPill>FM</StatusPill>
        </div>
        <div className="mt-3 h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ left: 0, right: 24, top: 16, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => tooltipNumber(value)} labelFormatter={(day) => `TANGGAL ${day}`} />
              <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
              <Line type="monotone" dataKey="targetKumulatif" name="TARGET KUMULATIF HARIAN" stroke="#78716c" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="realisasiKumulatif" name="REALISASI KUMULATIF HARIAN" stroke="#0f766e" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

function MasterPage({
  autoSaveStatus,
  canGoBack,
  fileInputRef,
  importError,
  rows,
  savedAt,
  setRows,
  onBack,
  onClear,
  onImport,
  onSave,
}: {
  autoSaveStatus: string;
  canGoBack: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  importError: string | null;
  rows: MasterRow[];
  savedAt: string | null;
  setRows: React.Dispatch<React.SetStateAction<MasterRow[]>>;
  onBack: () => void;
  onClear: () => void;
  onImport: (file: File | undefined) => void;
  onSave: () => void;
}) {
  function updateCell(rowIndex: number, colIndex: number, value: string) {
    setRows((current) => {
      const next = current.map((row) => [...row]);
      next[rowIndex][colIndex] = value === "" ? null : value;
      return next;
    });
  }

  function pasteAt(event: React.ClipboardEvent<HTMLTableSectionElement>) {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLTableCellElement>("[data-row][data-col]");
    if (!cell) return;
    const pasted = parseClipboard(event.clipboardData.getData("text/plain"));
    if (pasted.length <= 1 && pasted[0]?.length <= 1) return;
    event.preventDefault();
    const startRow = Number(cell.dataset.row);
    const startCol = Number(cell.dataset.col);
    const pastedRows = startRow === 0 && startCol === 0 && rowsIncludeMasterHeader(pasted) ? pasted.slice(1) : pasted;
    setRows((current) => {
      const next = startRow === 0 && startCol === 0 ? pastedRows.map((row) => ensureRowWidth(row)) : current.map((row) => [...row]);
      while (next.length < startRow + pastedRows.length) next.push(Array(masterHeaders.length).fill(null));
      pastedRows.forEach((pastedRow, rowOffset) => {
        pastedRow.forEach((value, colOffset) => {
          const col = startCol + colOffset;
          if (col < masterHeaders.length) next[startRow + rowOffset][col] = value === "" ? null : value;
        });
      });
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <div className={`${panelClass} flex flex-col gap-4 bg-[linear-gradient(135deg,#ffffff_0%,#fffaf2_55%,#f0f9ff_100%)] p-6 shadow-[0_16px_40px_-28px_rgba(68,42,12,0.3)] lg:flex-row lg:items-end lg:justify-between`}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold uppercase text-amber-700">MASTER</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-950">Input Data Utama WMS</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill>{formatNumber(rows.length)} baris MASTER</StatusPill>
            <StatusPill>Last saved: {formatSavedAt(savedAt)}</StatusPill>
            <StatusPill tone={autoSaveStatus.includes("tersimpan") ? "good" : "neutral"}>{autoSaveStatus}</StatusPill>
          </div>
          {importError && <p className="mt-3 text-sm font-medium text-rose-700">{importError}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button className={secondaryButtonClass} onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4" /> Upload Excel/CSV</button>
          <button className={secondaryButtonClass} disabled={!canGoBack} onClick={onBack}><Undo2 className="h-4 w-4" /> Back</button>
          <button className={dangerButtonClass} onClick={onClear}><Trash2 className="h-4 w-4" /> Clear Data</button>
          <button className={primaryButtonClass} onClick={onSave}><Save className="h-4 w-4" /> Save Data</button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.xlsm,.csv,text/csv" className="hidden" onChange={(event) => onImport(event.target.files?.[0])} />
        </div>
      </div>
      <section className={`${panelClass} overflow-hidden`}>
        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-[7600px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 w-14 border-b border-r border-stone-700 bg-[#2a1a10] px-2 py-2 text-xs font-semibold text-white">#</th>
                {masterHeaders.map((header, index) => (
                  <th key={`${header}-${index}`} className="sticky top-0 z-20 min-w-36 border-b border-r border-stone-700 bg-[#3b2414] px-2 py-2 text-xs font-semibold text-stone-100">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody onPaste={pasteAt}>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-white even:bg-stone-50/60 hover:bg-amber-50/40">
                  <th className="sticky left-0 z-10 border-b border-r border-stone-200 bg-inherit px-2 py-1 text-xs font-semibold text-stone-500">{rowIndex + 1}</th>
                  {masterHeaders.map((header, colIndex) => (
                    <td key={`${rowIndex}-${header}`} data-row={rowIndex} data-col={colIndex} contentEditable suppressContentEditableWarning className="min-w-36 max-w-52 border-b border-r border-stone-100 px-2 py-1 align-top text-stone-800 outline-none transition focus:bg-amber-50 focus:ring-2 focus:ring-inset focus:ring-amber-300" onBlur={(event) => updateCell(rowIndex, colIndex, event.currentTarget.innerText)}>
                      {formatCell(row[colIndex])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReportPage({ report }: { report: WmsComputedReport }) {
  const [downloadState, setDownloadState] = useState<"idle" | "working" | "error">("idle");

  async function downloadReport() {
    setDownloadState("working");
    try {
      await createWmsReportPng(report, new Date());
      setDownloadState("idle");
    } catch {
      setDownloadState("error");
    }
  }

  return (
    <div className="space-y-5">
      <div className={`${panelClass} flex flex-wrap items-end justify-between gap-4 bg-[linear-gradient(135deg,#ffffff_0%,#fffaf2_55%,#f0f9ff_100%)] p-6 shadow-[0_16px_40px_-28px_rgba(68,42,12,0.3)]`}>
        <div>
          <p className="text-sm font-semibold uppercase text-amber-700">Report WMS Target RKAP</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-normal text-stone-950">Report WMS Target RKAP</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill>{report.periodLabel}</StatusPill>
            <StatusPill>{report.cutoffLabel}</StatusPill>
            <StatusPill>{report.latestUpdatedAt ? `Update ${formatSavedAt(report.latestUpdatedAt)}` : "Update -"}</StatusPill>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={primaryButtonClass} disabled={downloadState === "working"} onClick={downloadReport}>
            <Download className="h-4 w-4" />
            {downloadState === "working" ? "Preparing PNG..." : "Download Report"}
          </button>
        </div>
      </div>
      {downloadState === "error" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          PNG belum berhasil dibuat. Coba tekan Download Report sekali lagi.
        </div>
      )}
      <ReportTable showBanner scopeLabel="WITEL" rows={[...report.witel.rows, report.witel.total]} periodLabel={report.periodLabel} previousMonthLabel={report.previousMonthLabel} cutoffDay={report.cutoffDay} />
      <ReportTable scopeLabel="TELDA / BRANCH" rows={[...report.telda.rows, report.telda.total]} periodLabel={report.periodLabel} previousMonthLabel={report.previousMonthLabel} cutoffDay={report.cutoffDay} />
    </div>
  );
}

const WMS_REPORT_THEME: ReportTheme = {
  bannerStops: ["#160d08", "#3b2414", "#8a4b1a"],
  canvasBg: "#f8f3ec",
  highlight: "#fdba74",
  ink: "#2a1a10",
  line: "#e7dccd",
  muted: "#6b5645",
  text: "#1c1209",
  zebra: "#fbf7f1",
};

type WmsColumnInput = {
  dayCount: number;
  endDay: number;
  labelHeader: string;
  latestDay: number;
  periodLabel: string;
  previousMonthLabel: string;
  rankCount: number;
  startDay: number;
};

// Kolom report WMS (lengkap). Dipakai tabel di layar (semua tanggal) dan PNG (7 hari terakhir),
// dengan gaya sama dengan features/telegram/report-images/wms-image.ts.
function wmsReportColumns(input: WmsColumnInput): ReportCol<WmsReportRow>[] {
  const dash = "–";
  const { endDay, labelHeader, latestDay, periodLabel, previousMonthLabel, rankCount: count, startDay } = input;
  const period = parseReportPeriodLabel(periodLabel);
  const num = (value: number | null | undefined): ReportCellStyle => ({ text: value === null || value === undefined ? dash : formatNumber(value) });
  const pct = (value: number | null | undefined, tone: ReturnType<typeof reportSignTone> = reportSignTone(value)): ReportCellStyle => {
    if (value === null || value === undefined || Number.isNaN(value)) return { text: dash };
    return { bold: true, color: tone?.color, fill: tone?.fill, text: formatPercent(value) };
  };
  const rank = (value: number | null): ReportCellStyle => {
    const tone = reportRankTone(value, count);
    return { bold: true, color: tone?.color, fill: tone?.fill, text: value === null || value === undefined ? dash : formatNumber(value) };
  };
  const shortage = (value: number): ReportCellStyle => {
    const tone = reportSignTone(value);
    return { bold: true, color: tone?.color, fill: tone?.fill, text: formatNumber(value) };
  };
  const dayCols: ReportCol<WmsReportRow>[] = [];
  for (let day = startDay; day <= endDay; day += 1) {
    const weekend = reportDayKind(period, day) === "weekend";
    const future = day > latestDay;
    dayCols.push({
      cell: (row) => (future ? { color: "#d6d3d1", fill: "#faf7f2", text: num(row.days[day - 1]).text } : num(row.days[day - 1])),
      fill: weekend ? "#be123c" : "#8a5a16",
      group: `TANGGAL (${periodLabel})`,
      head: String(day),
      key: `day-${day}`,
      subFill: weekend ? "#ffe4e6" : "#f8ead2",
      subText: weekend ? "#9f1239" : "#5b3a0c",
      width: 46,
    });
  }
  const base = { fill: "#3b2414", subFill: "#f3e7d8", subText: "#5b3418" };
  const prev = (value: number): ReportCellStyle => ({ color: "#5b4636", fill: "#f5efe6", text: formatNumber(value) });
  const head: ReportCol<WmsReportRow>[] = [
    { align: "left", cell: (row) => ({ bold: true, text: row.label.toUpperCase() }), fill: WMS_REPORT_THEME.ink, head: labelHeader, width: 200 },
    { cell: (row) => ({ bold: true, color: "#6b3a13", fill: "#f7eadf", text: formatNumber(row.targetFm) }), fill: "#7c3f16", head: "TARGET FM", width: 88 },
    { cell: (row) => ({ bold: true, color: "#6b3a13", fill: "#f7eadf", text: formatNumber(row.targetYtd) }), fill: "#7c3f16", head: "TARGET YTD", width: 92 },
    ...dayCols,
    { cell: (row) => ({ bold: true, color: "#5b2d06", fill: "#fde9c8", text: formatNumber(row.mtd) }), fill: "#f59e0b", head: "MTD", sub: "TOTAL", subFill: "#fcd9a0", subText: "#5b2d06", text: "#3a1d04", width: 80 },
  ];
  const ytdReal: ReportCol<WmsReportRow> = { ...base, cell: (row) => ({ bold: true, color: "#5b3418", fill: "#f3e7d8", text: formatNumber(row.realYtd) }), head: `REAL YTD ${period?.year ?? ""}`.trim(), sub: "YTD", width: 92 };
  return [
    ...head,
    { ...base, cell: (row) => pct(row.ach, reportAchTone(row.ach)), head: "TARGET ACH", sub: "MTD", width: 92 },
    { ...base, cell: (row) => rank(row.rank), head: "RANK ACH", sub: "MTD", width: 78 },
    { ...base, cell: (row) => shortage(row.shortageFm), head: "SHORTAGE TO TARGET FM", sub: "MTD", width: 104 },
    { ...base, cell: (row) => prev(row.realMtdPrev), head: `REAL MTD ${previousMonthLabel}`, sub: "MTD", width: 96 },
    { ...base, cell: (row) => pct(row.growthMtd), head: "GR MTD", sub: "%", width: 82 },
    { ...base, cell: (row) => prev(row.realFmPrev), head: `REAL FM ${previousMonthLabel}`, sub: "FM", width: 96 },
    { ...base, cell: (row) => pct(row.growthFm), head: "GR FM", sub: "%", width: 82 },
    ytdReal,
    { ...base, cell: (row) => pct(row.achYtd, reportAchTone(row.achYtd)), head: "ACH YTD", sub: "%", width: 88 },
    { ...base, cell: (row) => pct(row.growthYtd), head: "GR YTD", sub: "%", width: 82 },
    { ...base, cell: (row) => rank(row.rankYtd), head: "RANK YTD", sub: "YTD", width: 78 },
    { ...base, cell: (row) => shortage(row.shortageYtd), head: "SHORTAGE TO TARGET YTD", sub: "YTD", width: 104 },
  ];
}

const isWmsTotalRow = (item: WmsReportRow) => item.label === "Total" || item.label === "YK JATENG SELATAN";
const wmsRankCount = (dataRows: WmsReportRow[]) => Math.max(rankTotal(dataRows.map((item) => item.rank)), rankTotal(dataRows.map((item) => item.rankYtd)), dataRows.length);

function ReportTable({
  cutoffDay,
  periodLabel,
  previousMonthLabel,
  rows,
  scopeLabel,
  showBanner = false,
}: {
  cutoffDay: number;
  periodLabel: string;
  previousMonthLabel: string;
  rows: WmsReportRow[];
  scopeLabel: string;
  showBanner?: boolean;
}) {
  const dayCount = rows[0]?.days.length ?? 31;
  const latestDay = Math.max(1, Math.min(dayCount, cutoffDay));
  const dataRows = rows.filter((item) => !isWmsTotalRow(item));
  const totalRow = rows.find(isWmsTotalRow) ?? rows[rows.length - 1];
  const cols = wmsReportColumns({
    dayCount,
    endDay: dayCount,
    labelHeader: scopeLabel.toUpperCase().startsWith("TELDA") ? "TELDA" : scopeLabel,
    latestDay,
    periodLabel,
    previousMonthLabel,
    rankCount: wmsRankCount(dataRows),
    startDay: 1,
  });
  return (
    <ReportCard
      banner={showBanner ? {
        note: `TARGET RKAP  •  DATA S.D. TANGGAL ${latestDay}`,
        periodLabel,
        scope: "WITEL YOGYA JATENG SELATAN",
        title: "PS HARIAN WMS",
      } : undefined}
      cols={cols}
      rows={dataRows}
      theme={WMS_REPORT_THEME}
      total={totalRow}
    />
  );
}










