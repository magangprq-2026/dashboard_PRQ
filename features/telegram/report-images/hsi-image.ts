// Gambar report HSI (PNG) untuk bot Telegram. Perhitungan riwayat harian diambil dari
// features/hsi/frontend/dashboard/hsi-dashboard.tsx; tampilan memakai table-kit bersama dengan warna dashboard HSI.
import { computeReport, type ComputedReport, type ReportRow, type ReportTable } from "@/features/hsi/domain/reporting/reporting";
import { formatNumber, formatPercent, type ReportImage } from "./canvas";
import {
  achTone, dayKind, parsePeriodLabel, rankTone, renderReportPng, signTone,
  type CellStyle, type ReportTheme, type TableCol, type TableSpec,
} from "./table-kit";

type ReportHistoryTable = Record<string, (number | null)[]>;
export type ReportHistory = {
  branch: ReportHistoryTable;
  stfBranch: ReportHistoryTable;
  stfWitel: ReportHistoryTable;
  updatedAt: string | null;
  witel: ReportHistoryTable;
};

const reportCanvasColumns = { day: 28, label: 168, summary: 78, target: 72 } as const;

function hasActualValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeHistoryDays(value: unknown, fallbackLength: number) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: fallbackLength }, (_, index) => {
    const numeric = Number(source[index]);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  });
}

function safeRatioValue(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

function safeGrowthValue(current: number, previous: number) {
  return previous === 0 ? null : current / previous - 1;
}

function previousFromGrowth(current: number, growth: number | null) {
  if (growth === null || growth <= -1) return 0;
  return current / (growth + 1);
}

function recalcRowFromDays(row: ReportRow, days: (number | null)[]): ReportRow {
  const mtd = days.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const currentMonthYtdBase = row.realYtd - row.mtd;
  const ytdPrevious = previousFromGrowth(row.realYtd, row.growthYtd);
  const realYtd = currentMonthYtdBase + mtd;

  return {
    ...row,
    achYtd: safeRatioValue(realYtd, row.targetYtd),
    days,
    growthFm: safeGrowthValue(mtd, row.realFmPrev),
    growthMtd: safeGrowthValue(mtd, row.realMtdPrev),
    growthYtd: safeGrowthValue(realYtd, ytdPrevious),
    mtd,
    realYtd,
    shortageFm: mtd - row.targetFm,
    shortageYtd: realYtd - row.targetYtd,
    targetAch: safeRatioValue(mtd, row.targetFm),
  };
}

function rankReportRows(rows: ReportRow[], metric: "targetAch" | "achYtd"): ReportRow[] {
  return rows.map((row) => {
    const value = row[metric];
    const next = { ...row };
    if (metric === "targetAch") {
      next.rankAch = value === null ? null : rows.filter((candidate) => (candidate.targetAch ?? -Infinity) > value).length + 1;
    } else {
      next.rankYtd = value === null ? null : rows.filter((candidate) => (candidate.achYtd ?? -Infinity) > value).length + 1;
    }
    return next;
  });
}

function recalcTotalFromRows(label: string, rows: ReportRow[], originalTotal: ReportRow): ReportRow {
  const days = Array.from({ length: originalTotal.days.length }, (_, day) =>
    rows.reduce<number>((sum, row) => sum + (row.days[day] ?? 0), 0),
  );
  const mtd = rows.reduce<number>((sum, row) => sum + row.mtd, 0);
  const realYtd = rows.reduce<number>((sum, row) => sum + row.realYtd, 0);
  const ytdPrevious = previousFromGrowth(originalTotal.realYtd, originalTotal.growthYtd);

  return {
    ...originalTotal,
    achYtd: safeRatioValue(realYtd, originalTotal.targetYtd),
    days,
    growthFm: safeGrowthValue(mtd, originalTotal.realFmPrev),
    growthMtd: safeGrowthValue(mtd, originalTotal.realMtdPrev),
    growthYtd: safeGrowthValue(realYtd, ytdPrevious),
    label,
    mtd,
    realYtd,
    shortageFm: mtd - originalTotal.targetFm,
    shortageYtd: realYtd - originalTotal.targetYtd,
    targetAch: safeRatioValue(mtd, originalTotal.targetFm),
  };
}

function applyHistoryTable(table: ReportTable, history: ReportHistoryTable, excludedDay: number | null = null): ReportTable {
  let rows = table.rows.map((row) => {
    const stored = normalizeHistoryDays(history[row.label], row.days.length);
    const days = row.days.map((value, index) =>
      index + 1 === excludedDay ? null : hasActualValue(value) ? value : stored[index],
    );
    return recalcRowFromDays(row, days);
  });
  rows = rankReportRows(rankReportRows(rows, "targetAch"), "achYtd");
  return {
    ...table,
    rows,
    total: recalcTotalFromRows(table.total.label, rows, table.total),
  };
}

function applyReportHistory(report: ComputedReport, history: ReportHistory | null): ComputedReport {
  if (!history) return report;
  const excludedDay = report.excludedDay ?? null;
  const witel = applyHistoryTable(report.witel, history.witel, excludedDay);
  const branch = applyHistoryTable(report.branch, history.branch, excludedDay);
  const stfWitel = applyHistoryTable(report.targetStf.witel, history.stfWitel, excludedDay);
  const stfBranch = applyHistoryTable(report.targetStf.branch, history.stfBranch, excludedDay);
  const dailyTrend = witel.total.days.map((value, index) => ({
    cumulative: witel.total.days.slice(0, index + 1).reduce<number>((sum, dayValue) => sum + (dayValue ?? 0), 0),
    day: index + 1,
    realisasi: value ?? 0,
  }));

  return {
    ...report,
    branch,
    dailyTrend,
    targetStf: {
      branch: stfBranch,
      witel: stfWitel,
    },
    witel,
  };
}

function latestPopulatedDay(tables: ReportTable[]) {
  let latest = 0;
  for (const table of tables) {
    for (const row of [...table.rows, table.total]) {
      row.days.forEach((value, index) => {
        if (typeof value === "number" && value > 0) latest = Math.max(latest, index + 1);
      });
    }
  }
  return Math.max(1, latest);
}

// Tema mengikuti dashboard HSI: navy gelap, biru, dan aksen langit.
const HSI_THEME: ReportTheme = {
  bannerStops: ["#071426", "#0b2a55", "#1d4ed8"],
  canvasBg: "#f3f7fd",
  highlight: "#7dd3fc",
  ink: "#071426",
  line: "#dbe4f0",
  muted: "#475569",
  text: "#0f172a",
  zebra: "#f7faff",
};

const dash = "–";
const num = (value: number | null | undefined): CellStyle => ({ text: value === null || value === undefined ? dash : formatNumber(value) });

function pct(value: number | null | undefined, tone = signTone(value)): CellStyle {
  if (value === null || value === undefined || Number.isNaN(value)) return { text: dash };
  return { bold: true, color: tone?.color, fill: tone?.fill, text: formatPercent(value) };
}

function hsiColumns(
  table: ReportTable,
  exportStartDay: number,
  latestDay: number,
  periodLabel: string,
  previousMonthLabel: string,
): TableCol<ReportRow>[] {
  const period = parsePeriodLabel(periodLabel);
  const count = table.rows.length;
  const labelHeader = table.total.label === "Total" ? "WITEL" : "TELDA";
  const dayCols: TableCol<ReportRow>[] = [];
  for (let day = exportStartDay; day <= latestDay; day += 1) {
    const weekend = dayKind(period, day) === "weekend";
    dayCols.push({
      cell: (row) => num(row.days[day - 1]),
      fill: weekend ? "#e11d48" : "#0f766e",
      group: `TANGGAL (${periodLabel})`,
      head: String(day),
      subFill: weekend ? "#ffe4e6" : "#ccfbf1",
      subText: weekend ? "#9f1239" : "#134e4a",
      width: 44,
    });
  }
  const unitFill = "#e3ecfa";
  const unitText = "#1e3a8a";
  const base = { fill: "#0f2a4d", subFill: unitFill, subText: unitText };
  return [
    {
      align: "left",
      cell: (row) => ({ bold: true, text: row.label.toUpperCase() }),
      fill: HSI_THEME.ink,
      head: labelHeader,
      width: 200,
    },
    { cell: (row) => ({ bold: true, color: "#1e3a8a", fill: "#eaf1ff", text: formatNumber(row.targetFm) }), fill: "#1d4ed8", head: "TARGET FM", width: 86 },
    { cell: (row) => ({ bold: true, color: "#1e3a8a", fill: "#eaf1ff", text: formatNumber(row.targetYtd) }), fill: "#1d4ed8", head: "TARGET YTD", width: 90 },
    ...dayCols,
    {
      cell: (row) => ({ bold: true, color: "#422006", fill: "#fef3c7", text: formatNumber(row.mtd) }),
      fill: "#fbbf24",
      head: "MTD",
      subFill: "#fde68a",
      subText: "#422006",
      text: "#422006",
      width: 80,
      sub: "TOTAL",
    },
    { ...base, cell: (row) => pct(row.targetAch, achTone(row.targetAch)), head: "TARGET ACH", sub: "MTD", width: 92 },
    { ...base, cell: (row) => { const tone = rankTone(row.rankAch, count); return { bold: true, color: tone?.color, fill: tone?.fill, text: row.rankAch === null ? dash : formatNumber(row.rankAch) }; }, head: "RANK ACH", sub: "MTD", width: 78 },
    { ...base, cell: (row) => { const tone = signTone(row.shortageFm); return { bold: true, color: tone?.color, fill: tone?.fill, text: formatNumber(row.shortageFm) }; }, head: "SHORTAGE TO TARGET FM", sub: "MTD", width: 104 },
    { ...base, cell: (row) => ({ color: "#334155", fill: "#f1f5f9", text: formatNumber(row.realMtdPrev) }), head: `REAL MTD ${previousMonthLabel}`, sub: "MTD", width: 96 },
    { ...base, cell: (row) => pct(row.growthMtd), head: "GR MTD", sub: "%", width: 82 },
    { ...base, cell: (row) => ({ color: "#334155", fill: "#f1f5f9", text: formatNumber(row.realFmPrev) }), head: `REAL FM ${previousMonthLabel}`, sub: "FM", width: 96 },
    { ...base, cell: (row) => pct(row.growthFm), head: "GR FM", sub: "%", width: 82 },
    { ...base, cell: (row) => ({ bold: true, color: "#0f2a4d", fill: "#e3ecfa", text: formatNumber(row.realYtd) }), head: `REAL YTD ${period?.year ?? ""}`.trim(), sub: "YTD", width: 92 },
    { ...base, cell: (row) => pct(row.achYtd, achTone(row.achYtd)), head: "ACH YTD", sub: "%", width: 86 },
    { ...base, cell: (row) => pct(row.growthYtd), head: "GR YTD", sub: "%", width: 82 },
    { ...base, cell: (row) => { const tone = rankTone(row.rankYtd, count); return { bold: true, color: tone?.color, fill: tone?.fill, text: row.rankYtd === null ? dash : formatNumber(row.rankYtd) }; }, head: "RANK YTD", sub: "YTD", width: 78 },
    { ...base, cell: (row) => { const tone = signTone(row.shortageYtd); return { bold: true, color: tone?.color, fill: tone?.fill, text: formatNumber(row.shortageYtd) }; }, head: "SHORTAGE TO TARGET YTD", sub: "YTD", width: 104 },
  ];
}

function createReportPng(
  witelTable: ReportTable,
  branchTable: ReportTable,
  latestDay: number,
  timestamp: Date,
  variant: "sementara" | "stf",
  periodLabel: string,
  previousMonthLabel: string,
) {
  const exportStartDay = Math.max(1, latestDay - 6);
  const spec = (table: ReportTable): TableSpec<ReportRow> => ({
    cols: hsiColumns(table, exportStartDay, latestDay, periodLabel, previousMonthLabel),
    rows: table.rows,
    total: table.total,
  });
  return renderReportPng({
    banner: {
      note: `${variant === "stf" ? "TARGET STF" : "TARGET RKAP"}  •  TANGGAL ${exportStartDay}-${latestDay}`,
      periodLabel,
      scope: "WITEL YOGYA JATENG SELATAN",
      title: "PS HARIAN HSI",
    },
    footer: `Data s.d. Tgl ${latestDay}`,
    tables: [spec(witelTable), spec(branchTable)],
    theme: HSI_THEME,
    timestamp,
  });
}

/** Dua gambar report HSI (Target RKAP & Target STF), sama seperti dua tombol PNG di web. */
export function buildHsiImages(
  rows: unknown[][],
  savedAt: string | null,
  periodKey: string,
  history: ReportHistory | null,
  snapshot: ComputedReport | null = null,
): ReportImage[] {
  // Sama seperti web: snapshot tersimpan bila ada, jika tidak hitung dari MASTER lalu terapkan riwayat harian.
  const report: ComputedReport = snapshot ?? applyReportHistory(computeReport(rows as never, savedAt, periodKey), history);
  const timestamp = new Date();
  const make = (variant: "sementara" | "stf"): ReportImage => {
    const stf = variant === "stf";
    const witel = stf ? report.targetStf.witel : report.witel;
    const branch = stf ? report.targetStf.branch : report.branch;
    const latestDay = latestPopulatedDay([witel, branch]);
    return {
      bytes: createReportPng(witel, branch, latestDay, timestamp, variant, report.periodLabel, report.previousMonthLabel),
      caption: `${stf ? "Report HSI Target STF" : "Report HSI Target RKAP"}\nPeriode: ${report.periodLabel} | Data s.d. Tgl ${latestDay}`,
      filename: `${stf ? "Report HSI Target STF" : "Report HSI Target RKAP"}.png`,
    };
  };
  return [make("sementara"), make("stf")];
}
