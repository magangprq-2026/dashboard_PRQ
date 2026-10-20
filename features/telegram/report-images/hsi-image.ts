// Gambar report HSI (PNG) untuk bot Telegram. Fungsi gambar & perhitungan riwayat diambil dari
// features/hsi/frontend/dashboard/hsi-dashboard.tsx agar tampilannya sama dengan tombol "Download PNG" di web.
import { computeReport, type ComputedReport, type ReportRow, type ReportTable } from "@/features/hsi/domain/reporting/reporting";
import {
  achievementTone, formatJakartaDateTime, formatNumber, formatPercent, newCanvas, toPngBytes,
  type Ctx, type ReportImage,
} from "./canvas";

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

function summaryHeadersFor(previousMonthLabel: string) {
  return [
    "Total",
    "TARGET ACH",
    "RANK ACH",
    "SHORTAGE TO TARGET FM",
    `REAL MTD ${previousMonthLabel}`,
    "GR MTD",
    `REAL FM ${previousMonthLabel}`,
    "GR FM",
    "REAL YTD 2026",
    "ACH YTD",
    "GR YTD",
    "RANK YTD",
    "SHORTAGE TO TARGET YTD",
  ];
}

function wrapCanvasText(context: Ctx, text: string, maxWidth: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (context.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawCell(
  context: Ctx,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    align?: CanvasTextAlign;
    border?: string;
    fill?: string;
    font?: string;
    padding?: number;
    textColor?: string;
    wrap?: boolean;
  } = {},
) {
  context.fillStyle = options.fill ?? "#ffffff";
  context.fillRect(x, y, width, height);
  context.strokeStyle = options.border ?? "#e2e8f0";
  context.lineWidth = 1;
  context.strokeRect(x, y, width, height);
  context.fillStyle = options.textColor ?? "#0f172a";
  context.font = options.font ?? "12px Arial";
  context.textAlign = options.align ?? "right";
  context.textBaseline = "middle";
  const padding = options.padding ?? 8;
  const textX = options.align === "left" ? x + padding : options.align === "center" ? x + width / 2 : x + width - padding;
  if (options.wrap) {
    const lines = wrapCanvasText(context, text, width - padding * 2).slice(0, 3);
    const lineHeight = 11;
    const startY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => context.fillText(line, textX, startY + index * lineHeight));
  } else {
    context.fillText(text, textX, y + height / 2);
  }
}

function drawReportTableCanvas(
  context: Ctx,
  table: ReportTable,
  exportStartDay: number,
  latestDay: number,
  periodLabel: string,
  previousMonthLabel: string,
  x: number,
  y: number,
  totalWidth: number,
) {
  const summaryHeaders = summaryHeadersFor(previousMonthLabel);
  const labelWidth = reportCanvasColumns.label;
  const targetWidth = reportCanvasColumns.target;
  const dayWidth = reportCanvasColumns.day;
  const summaryWidth = reportCanvasColumns.summary;
  const exportDayCount = latestDay - exportStartDay + 1;
  const titleHeight = 58;
  const groupHeaderHeight = 36;
  const dayHeaderHeight = 26;
  const rowHeight = 28;
  const rows = [...table.rows, table.total];
  const tableHeight = titleHeight + groupHeaderHeight + dayHeaderHeight + rows.length * rowHeight;

  context.fillStyle = "#ffffff";
  context.fillRect(x, y, totalWidth, tableHeight);
  context.strokeStyle = "#cbd5e1";
  context.strokeRect(x, y, totalWidth, tableHeight);

  context.fillStyle = "#020617";
  context.fillRect(x, y, totalWidth, titleHeight);
  const accent = context.createLinearGradient(x, y, x + totalWidth, y);
  accent.addColorStop(0, "#22d3ee");
  accent.addColorStop(0.45, "#e11d48");
  accent.addColorStop(1, "#f59e0b");
  context.fillStyle = accent;
  context.fillRect(x, y, totalWidth, 4);
  context.fillStyle = "#ffffff";
  context.font = "700 18px Arial";
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillText(table.title, x + totalWidth / 2, y + 12);
  context.fillStyle = "#cbd5e1";
  context.font = "600 12px Arial";
  context.fillText(table.subtitle, x + totalWidth / 2, y + 34);
  context.font = "700 11px Arial";
  context.fillText(`${periodLabel} | Data s.d. Tgl ${latestDay}`, x + totalWidth / 2, y + 48);
  context.textAlign = "left";

  let cursorX = x;
  const headerY = y + titleHeight;
  const labelHeader = table.total.label === "Total" ? "WITEL" : "BRANCH";
  drawCell(context, labelHeader, cursorX, headerY, labelWidth, groupHeaderHeight + dayHeaderHeight, {
    align: "center",
    border: "#334155",
    fill: "#020617",
    font: "700 11px Arial",
    textColor: "#ffffff",
  });
  cursorX += labelWidth;
  drawCell(context, "TARGET FM", cursorX, headerY, targetWidth, groupHeaderHeight + dayHeaderHeight, {
    align: "center",
    border: "#4338ca",
    fill: "#3730a3",
    font: "700 10px Arial",
    textColor: "#ffffff",
    wrap: true,
  });
  cursorX += targetWidth;
  drawCell(context, "TARGET YTD", cursorX, headerY, targetWidth, groupHeaderHeight + dayHeaderHeight, {
    align: "center",
    border: "#4338ca",
    fill: "#3730a3",
    font: "700 10px Arial",
    textColor: "#ffffff",
    wrap: true,
  });
  cursorX += targetWidth;
  drawCell(context, "TANGGAL", cursorX, headerY, exportDayCount * dayWidth, groupHeaderHeight, {
    align: "center",
    border: "#0f766e",
    fill: "#0f766e",
    font: "700 11px Arial",
    textColor: "#ffffff",
  });
  for (let day = exportStartDay; day <= latestDay; day += 1) {
    drawCell(context, String(day), cursorX + (day - exportStartDay) * dayWidth, headerY + groupHeaderHeight, dayWidth, dayHeaderHeight, {
      align: "center",
      border: "#99f6e4",
      fill: "#ccfbf1",
      font: "700 10px Arial",
      textColor: "#134e4a",
    });
  }
  cursorX += exportDayCount * dayWidth;
  for (const header of summaryHeaders) {
    drawCell(context, header, cursorX, headerY, summaryWidth, groupHeaderHeight + dayHeaderHeight, {
      align: "center",
      border: "#334155",
      fill: "#1e293b",
      font: "700 8px Arial",
      padding: 4,
      textColor: "#ffffff",
      wrap: true,
    });
    cursorX += summaryWidth;
  }

  rows.forEach((row, rowIndex) => {
    const total = rowIndex === rows.length - 1;
    const rowY = headerY + groupHeaderHeight + dayHeaderHeight + rowIndex * rowHeight;
    const baseFill = total ? "#e2e8f0" : rowIndex % 2 === 0 ? "#ffffff" : "#f8fafc";
    let cellX = x;
    const bodyFont = total ? "700 11px Arial" : "11px Arial";
    drawCell(context, row.label, cellX, rowY, labelWidth, rowHeight, {
      align: "left",
      fill: baseFill,
      font: bodyFont,
    });
    cellX += labelWidth;
    drawCell(context, formatNumber(row.targetFm), cellX, rowY, targetWidth, rowHeight, {
      fill: "#eef2ff",
      font: "700 11px Arial",
      textColor: "#312e81",
    });
    cellX += targetWidth;
    drawCell(context, formatNumber(row.targetYtd), cellX, rowY, targetWidth, rowHeight, {
      fill: "#eef2ff",
      font: "700 11px Arial",
      textColor: "#312e81",
    });
    cellX += targetWidth;
    row.days.slice(exportStartDay - 1, latestDay).forEach((value) => {
      drawCell(context, formatNumber(value), cellX, rowY, dayWidth, rowHeight, {
        fill: baseFill,
        font: bodyFont,
      });
      cellX += dayWidth;
    });

    const summaryValues = [
      { value: formatNumber(row.mtd), fill: "#ccfbf1", color: "#134e4a", bold: true },
      { value: formatPercent(row.targetAch), tone: achievementTone(row.targetAch) },
      { value: formatNumber(row.rankAch), fill: "#f1f5f9", color: "#0f172a", bold: true },
      { value: formatNumber(row.shortageFm), fill: row.shortageFm < 0 ? "#ffe4e6" : "#dcfce7", color: row.shortageFm < 0 ? "#9f1239" : "#166534", bold: true },
      { value: formatNumber(row.realMtdPrev), fill: "#f8fafc", color: "#334155" },
      { value: formatPercent(row.growthMtd), fill: baseFill, color: "#0f172a" },
      { value: formatNumber(row.realFmPrev), fill: "#f8fafc", color: "#334155" },
      { value: formatPercent(row.growthFm), fill: baseFill, color: "#0f172a" },
      { value: formatNumber(row.realYtd), fill: "#ccfbf1", color: "#134e4a", bold: true },
      { value: formatPercent(row.achYtd), tone: achievementTone(row.achYtd) },
      { value: formatPercent(row.growthYtd), fill: baseFill, color: "#0f172a" },
      { value: formatNumber(row.rankYtd), fill: "#f1f5f9", color: "#0f172a", bold: true },
      { value: formatNumber(row.shortageYtd), fill: row.shortageYtd < 0 ? "#ffe4e6" : "#dcfce7", color: row.shortageYtd < 0 ? "#9f1239" : "#166534", bold: true },
    ];
    for (const item of summaryValues) {
      let fill = item.fill ?? baseFill;
      let color = item.color ?? "#0f172a";
      if (item.tone === "good") {
        fill = "#dcfce7";
        color = "#166534";
      } else if (item.tone === "near") {
        fill = "#fef3c7";
        color = "#92400e";
      } else if (item.tone === "low") {
        fill = "#ffe4e6";
        color = "#9f1239";
      }
      drawCell(context, item.value, cellX, rowY, summaryWidth, rowHeight, {
        fill,
        font: item.bold || item.tone ? "700 11px Arial" : bodyFont,
        textColor: color,
      });
      cellX += summaryWidth;
    }
  });

  return tableHeight;
}

function drawConfidentialWatermark(context: Ctx, width: number, height: number) {
  context.save();
  context.globalAlpha = 0.055;
  context.fillStyle = "#0f172a";
  context.font = "700 58px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.translate(width / 2, height / 2);
  context.rotate((-22 * Math.PI) / 180);
  context.fillText("CONFIDENTIAL", 0, 0);
  context.restore();
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
  const scale = 2;
  const padding = 28;
  const labelWidth = reportCanvasColumns.label;
  const targetWidth = reportCanvasColumns.target;
  const dayWidth = reportCanvasColumns.day;
  const summaryWidth = reportCanvasColumns.summary;
  const summaryHeaders = summaryHeadersFor(previousMonthLabel);
  const exportStartDay = Math.max(1, latestDay - 6);
  const exportDayCount = latestDay - exportStartDay + 1;
  const tableWidth = labelWidth + targetWidth * 2 + exportDayCount * dayWidth + summaryHeaders.length * summaryWidth;
  const witelHeight = 58 + 36 + 26 + (witelTable.rows.length + 1) * 28;
  const branchHeight = 58 + 36 + 26 + (branchTable.rows.length + 1) * 28;
  const logicalWidth = tableWidth + padding * 2;
  const logicalHeight = padding + 68 + witelHeight + 22 + branchHeight + padding;
  const { canvas, ctx: context } = newCanvas(logicalWidth, logicalHeight, scale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, logicalWidth, logicalHeight);
  context.fillStyle = "#0f172a";
  context.font = "700 28px Arial";
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText(variant === "stf" ? "Report HSI Target STF" : "Report HSI Target RKAP", padding, padding);
  context.fillStyle = "#475569";
  context.font = "15px Arial";
  context.fillText(`Downloaded: ${formatJakartaDateTime(timestamp, false)}`, padding, padding + 36);
  context.fillText(`Periode: ${periodLabel} | Tanggal ${exportStartDay}-${latestDay}`, padding + 360, padding + 36);
  context.fillStyle = "#881337";
  context.font = "700 12px Arial";
  context.textAlign = "right";
  context.fillText("CONFIDENTIAL - INTERNAL USE ONLY", logicalWidth - padding, padding + 8);
  context.textAlign = "left";
  const firstTableHeight = drawReportTableCanvas(context, witelTable, exportStartDay, latestDay, periodLabel, previousMonthLabel, padding, padding + 68, tableWidth);
  drawReportTableCanvas(context, branchTable, exportStartDay, latestDay, periodLabel, previousMonthLabel, padding, padding + 68 + firstTableHeight + 22, tableWidth);
  drawConfidentialWatermark(context, logicalWidth, logicalHeight);
  return toPngBytes(canvas);
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
