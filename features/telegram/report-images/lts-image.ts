// Gambar report LTS (PNG) untuk bot Telegram. Isi fungsi diambil dari createLtsReportPng di
// features/lts/frontend/dashboard/lts-dashboard.tsx agar tampilannya sama dengan tombol "Download PNG" di web.
import type { LtsComputedReport, LtsReportRow, LtsReportTable } from "@/features/lts/domain/reporting/reporting";
import { formatNumber, newCanvas, toPngBytes, type ReportImage } from "./canvas";

type LtsColumnOptions = { churnGap: boolean; rankCaps: boolean };
const hiddenLtsColumns: LtsColumnOptions = { churnGap: false, rankCaps: false };

// Persen LTS ditampilkan seperti Excel: 190,32% (nilai rasio dikali 100).
function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value * 100)}%`;
}

function formatSavedAt(value: string | null | undefined) {
  if (!value) return "Belum pernah diupload";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })
    .format(new Date(value))
    .replace(/\./g, ":");
}

export function buildLtsImage(report: LtsComputedReport, timestamp: Date, columnOptions: LtsColumnOptions = hiddenLtsColumns): ReportImage {
  const exportTableWidth = 1320;
  const columns = [
    { key: "label", label: "WILAYAH", width: 178 },
    { key: "coordinator", label: "KOORDINATOR", width: 190 },
    { key: "sales", label: "SALES", width: 76 },
    { key: "ct0", label: "CT0", width: 76 },
    { key: "ct0Ratio", label: "CT0/SALES", width: 88 },
    { key: "ct0Rank", label: "RANK", width: 62 },
    { key: "caps", label: "CAPS", width: 76 },
    { key: "capsRatio", label: "CAPS/SALES", width: 92 },
    { key: "capsRank", label: "RANK", width: 62 },
    { key: "score", label: "SCORE", width: 76 },
    { key: "scoreRank", label: "RANK", width: 62 },
    { key: "capsRankOnly", label: "RANK LTS CAPS", width: 94 },
    { key: "churn", label: "CHURN", width: 86 },
    { key: "gap", label: "GAP", width: 76 },
  ];
  const width = Math.max(1400, exportTableWidth + 80);
  const rowHeight = 30;
  const groupHeaderHeight = 38;
  const subHeaderHeight = 36;
  const tableTitleHeight = 92;
  const headerHeight = 112;
  const tableHeaderHeight = groupHeaderHeight + subHeaderHeight;
  const height = headerHeight + tableTitleHeight * 2 + tableHeaderHeight * 2 + ([...report.witel.rows, report.witel.total, ...report.hotda.rows, report.hotda.total].length) * rowHeight + 92;
  const scale = 2;
  const { canvas, ctx } = newCanvas(width, height, scale);
  ctx.fillStyle = "#f8f5fb";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#090612";
  ctx.fillRect(0, 0, width, headerHeight);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 28px Arial";
  ctx.fillText(report.label, 40, 46);
  ctx.font = "600 13px Arial";
  ctx.fillStyle = "#d8d3e3";
  ctx.fillText(`${report.periodLabel} | Source: ${report.sourceLabel} | ${report.cutoffLabel}`, 40, 75);
  ctx.fillStyle = "#a89ec0";
  ctx.fillText(`Rendered ${formatSavedAt(timestamp.toISOString())} WIB`, 40, 94);

  function drawCell(x: number, y: number, w: number, h: number, fill: string, stroke = "#e7e2ed") {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = stroke;
    ctx.strokeRect(x, y, w, h);
  }

  function drawText(text: string, x: number, y: number, w: number, align: CanvasTextAlign, fill: string, baseline: CanvasTextBaseline = "middle") {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y - 18, w, 36);
    ctx.clip();
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillStyle = fill;
    ctx.fillText(text, align === "left" ? x + 7 : align === "right" ? x + w - 7 : x + w / 2, y);
    ctx.restore();
  }

  function drawPill(text: string, x: number, y: number, color: string) {
    if (!text) return;
    const pillWidth = Math.max(34, ctx.measureText(text).width + 18);
    const pillHeight = 22;
    const left = x - pillWidth / 2;
    const top = y - pillHeight / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(left, top, pillWidth, pillHeight, 11);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  }

  function textValue(row: LtsReportRow, key: string) {
    if (key === "label") return row.label;
    if (key === "coordinator") return row.coordinator ?? "";
    if (key === "ct0Ratio" || key === "capsRatio" || key === "score") return formatPercent(Number(row[key as keyof LtsReportRow]));
    if (key === "ct0Rank" || key === "capsRank" || key === "scoreRank" || key === "capsRankOnly") return formatNumber(row[key as keyof LtsReportRow] as number | null);
    return formatNumber(row[key as keyof LtsReportRow] as number);
  }

  function exportColumnsForTable(table: LtsReportTable) {
    const visibleColumns = columns.filter((column) => !(table.scope === "witel" && column.key === "coordinator") && !(table.scope === "hotda" && column.key === "capsRankOnly") && !(column.key === "capsRankOnly" && !columnOptions.rankCaps) && !((column.key === "churn" || column.key === "gap") && !columnOptions.churnGap));
    const baseWidth = visibleColumns.reduce((sum, column) => sum + column.width, 0);
    const scaleFactor = exportTableWidth / Math.max(baseWidth, 1);
    return visibleColumns.map((column) => ({
      ...column,
      label: column.key === "label" ? (table.scope === "witel" ? "WITEL" : "BRANCH") : column.label,
      width: column.width * scaleFactor,
    }));
  }

  function drawTable(table: LtsReportTable, y: number) {
    const exportColumns = exportColumnsForTable(table);
    const columnPositions = new Map<string, { width: number; x: number }>();
    let currentX = 40;
    for (const column of exportColumns) {
      columnPositions.set(column.key, { width: column.width, x: currentX });
      currentX += column.width;
    }
    const groupWidth = (keys: string[]) => keys.reduce((sum, key) => sum + (columnPositions.get(key)?.width ?? 0), 0);
    const groupX = (key: string) => columnPositions.get(key)?.x ?? 40;
    const gradient = ctx.createLinearGradient(40, y, 40 + exportTableWidth, y);
    gradient.addColorStop(0, "#07040f");
    gradient.addColorStop(0.62, "#24103f");
    gradient.addColorStop(1, "#43206a");
    ctx.fillStyle = gradient;
    ctx.fillRect(40, y, exportTableWidth, tableTitleHeight);
    ctx.textAlign = "center";
    ctx.font = "700 10px Arial";
    ctx.fillStyle = "#c9b8ee";
    ctx.fillText("MAIN TABLE", 40 + exportTableWidth / 2, y + 23);
    ctx.font = "700 19px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(table.title, 40 + exportTableWidth / 2, y + 50);
    ctx.font = "600 12px Arial";
    ctx.fillStyle = "#d8d3e3";
    ctx.fillText(table.subtitle, 40 + exportTableWidth / 2, y + 70);
    y += tableTitleHeight;

    const drawHeader = (key: string, label: string, fill: string, height: number, yOffset = 0, textColor = "#ffffff") => {
      const position = columnPositions.get(key);
      if (!position) return;
      drawCell(position.x, y + yOffset, position.width, height, fill, "#4b356d");
      ctx.font = "700 11px Arial";
      drawText(label, position.x, y + yOffset + height / 2, position.width, "center", textColor);
    };
    const drawHeaderGroup = (keys: string[], label: string, fill: string) => {
      if (!columnPositions.has(keys[0])) return;
      const x = groupX(keys[0]);
      const w = groupWidth(keys);
      drawCell(x, y, w, groupHeaderHeight, fill, "#4b356d");
      ctx.font = "700 12px Arial";
      drawText(label, x, y + groupHeaderHeight / 2, w, "center", "#ffffff");
    };
    drawHeader("label", table.scope === "witel" ? "WITEL" : "BRANCH", "#120824", tableHeaderHeight);
    drawHeader("coordinator", "KOORDINATOR", "#1a0d2f", tableHeaderHeight);
    drawHeader("sales", "Sales", "#43206a", tableHeaderHeight);
    drawHeaderGroup(["ct0", "ct0Ratio", "ct0Rank"], "Bobot 50% CT0", "#3730a3");
    drawHeaderGroup(["caps", "capsRatio", "capsRank"], "Bobot 50% CAPS", "#0e7490");
    drawHeaderGroup(["score", "scoreRank"], "Score", "#5b21b6");
    drawHeader("capsRankOnly", "Rank LTS CAPS", "#92400e", tableHeaderHeight);
    drawHeaderGroup(["churn", "gap"], "CAPS 27/8", "#047857");

    const subHeaderStyles: Record<string, { fill: string; text: string }> = {
      caps: { fill: "#ecfeff", text: "#0e7490" },
      capsRatio: { fill: "#ecfeff", text: "#0e7490" },
      capsRank: { fill: "#ecfeff", text: "#0e7490" },
      churn: { fill: "#fff7ed", text: "#92400e" },
      ct0: { fill: "#eef2ff", text: "#3730a3" },
      ct0Rank: { fill: "#eef2ff", text: "#3730a3" },
      ct0Ratio: { fill: "#eef2ff", text: "#3730a3" },
      gap: { fill: "#ecfdf5", text: "#047857" },
      score: { fill: "#f5f1ff", text: "#5b21b6" },
      scoreRank: { fill: "#f5f1ff", text: "#5b21b6" },
    };
    for (const column of exportColumns) {
      if (["label", "coordinator", "sales", "capsRankOnly"].includes(column.key)) continue;
      const style = subHeaderStyles[column.key] ?? { fill: "#ffffff", text: "#111827" };
      drawCell(columnPositions.get(column.key)?.x ?? 40, y + groupHeaderHeight, column.width, subHeaderHeight, style.fill, "#dbe4f0");
      ctx.font = "700 11px Arial";
      drawText(column.label, columnPositions.get(column.key)?.x ?? 40, y + groupHeaderHeight + subHeaderHeight / 2, column.width, "center", style.text);
    }
    y += tableHeaderHeight;

    [...table.rows, table.total].forEach((row, index, list) => {
      const total = index === list.length - 1;
      ctx.font = total ? "700 11px Arial" : "600 11px Arial";
      for (const column of exportColumns) {
        const position = columnPositions.get(column.key);
        if (!position) continue;
        const isNegative = column.key === "gap" && row.gap < 0;
        const rowBackground = index % 2 === 0 ? "#ffffff" : "#f7f4ff";
        const fill =
          column.key === "label"
            ? total ? "#0b0614" : rowBackground
            : column.key === "coordinator"
              ? total ? "#160d24" : rowBackground
              : column.key === "sales"
                ? total ? "#160d24" : "#f3edff"
                : column.key === "ct0" || column.key === "ct0Rank"
                  ? "#eef2ff"
                  : column.key === "ct0Ratio"
                    ? "#e0e7ff"
                    : column.key === "caps" || column.key === "capsRank"
                      ? "#ecfeff"
                      : column.key === "capsRatio"
                        ? "#cffafe"
                        : column.key === "score"
                          ? "#f5f1ff"
                          : column.key === "scoreRank"
                            ? "#ede9fe"
                            : column.key === "capsRankOnly"
                              ? "#fffbeb"
                              : column.key === "churn"
                                ? "#fff7ed"
                                : isNegative
                                  ? "#fff1f2"
                                  : "#ecfdf5";
        drawCell(position.x, y, column.width, rowHeight, fill);
        const value = textValue(row, column.key);
        if (["ct0Rank", "capsRank", "scoreRank", "capsRankOnly"].includes(column.key) && value && !total) {
          const pillColor = column.key === "ct0Rank" ? "#312e81" : column.key === "capsRank" ? "#164e63" : column.key === "capsRankOnly" ? "#92400e" : "#2e1065";
          drawPill(value, position.x + column.width / 2, y + rowHeight / 2, pillColor);
          continue;
        }
        const textColor =
          total && (column.key === "label" || column.key === "coordinator" || column.key === "sales")
            ? "#ffffff"
            : isNegative
              ? "#be123c"
              : column.key === "sales"
                ? "#321653"
                : column.key === "ct0Ratio"
                  ? "#3730a3"
                  : column.key === "capsRatio"
                    ? "#0e7490"
                    : column.key === "score"
                      ? "#5b21b6"
                      : column.key === "churn"
                        ? "#92400e"
                        : column.key === "gap"
                          ? "#047857"
                          : "#111827";
        const align = column.key === "label" || column.key === "coordinator" ? "left" : "right";
        drawText(value, position.x, y + rowHeight / 2, column.width, align, textColor);
      }
      y += rowHeight;
    });
    ctx.textAlign = "left";
    return y + 22;
  }

  const afterWitel = drawTable(report.witel, headerHeight + 26);
  drawTable(report.hotda, afterWitel);
  return {
    bytes: toPngBytes(canvas),
    caption: `${report.label}\n${report.periodLabel} | ${report.cutoffLabel}`,
    filename: `${report.label.replace(/\s+/g, " ")}.png`,
  };
}
