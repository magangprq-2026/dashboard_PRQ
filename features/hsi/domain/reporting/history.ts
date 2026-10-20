// Perhitungan riwayat harian report HSI. Dipakai bersama oleh dashboard web dan bot Telegram
// supaya angka keduanya selalu sama (modul ini tidak bergantung pada React).
import type { ComputedReport, ReportRow, ReportTable } from "./reporting";

export type ReportHistoryTable = Record<string, (number | null)[]>;
export type ReportHistory = {
  branch: ReportHistoryTable;
  stfBranch: ReportHistoryTable;
  stfWitel: ReportHistoryTable;
  updatedAt: string | null;
  witel: ReportHistoryTable;
};

export function emptyReportHistory(): ReportHistory {
  return { branch: {}, stfBranch: {}, stfWitel: {}, updatedAt: null, witel: {} };
}

export function hasActualValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function normalizeHistoryDays(value: unknown, fallbackLength: number) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: fallbackLength }, (_, index) => {
    const numeric = Number(source[index]);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  });
}

export function safeRatioValue(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

export function safeGrowthValue(current: number, previous: number) {
  return previous === 0 ? null : current / previous - 1;
}

export function previousFromGrowth(current: number, growth: number | null) {
  if (growth === null || growth <= -1) return 0;
  return current / (growth + 1);
}

export function recalcRowFromDays(row: ReportRow, days: (number | null)[]): ReportRow {
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

export function rankReportRows(rows: ReportRow[], metric: "targetAch" | "achYtd"): ReportRow[] {
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

export function recalcTotalFromRows(label: string, rows: ReportRow[], originalTotal: ReportRow): ReportRow {
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

export function applyHistoryTable(table: ReportTable, _history: ReportHistoryTable, excludedDay: number | null = null): ReportTable {
  let rows = table.rows.map((row) => {
    // MASTER yang diunggah adalah sumber kebenaran untuk periode yang sedang dihitung.
    // Nilai kosong berarti tidak ada order pada tanggal tersebut (sama seperti formula COUNTIFS
    // di workbook yang menampilkan "" saat hasil hitung 0), bukan alasan untuk mengambil angka
    // lama dari riwayat upload. Menggunakan history sebagai fallback membuat angka lama tetap
    // muncul setelah data MASTER terbaru berubah sehingga dashboard berbeda dari file Excel.
    const days = row.days.map((value, index) =>
      index + 1 === excludedDay ? null : hasActualValue(value) ? value : null,
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

export function applyReportHistory(report: ComputedReport, history: ReportHistory | null): ComputedReport {
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
