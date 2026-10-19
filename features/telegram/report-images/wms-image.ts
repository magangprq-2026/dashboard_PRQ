// Gambar report WMS (PNG) untuk bot Telegram. Isi fungsi diambil dari createWmsReportPng di
// features/wms/frontend/dashboard/wms-dashboard.tsx agar tampilannya sama dengan tombol "Download PNG" di web.
import type { WmsComputedReport, WmsReportRow } from "@/features/wms/domain/reporting/reporting";
import { achievementTone, formatJakartaDateTime, formatNumber, formatPercent, jakartaStamp, newCanvas, toPngBytes, type ReportImage } from "./canvas";

export function buildWmsImage(report: WmsComputedReport, timestamp: Date): ReportImage {
  const witelRows = [...report.witel.rows, report.witel.total];
  const teldaRows = [...report.telda.rows, report.telda.total];
  const latestDay = report.cutoffDay;
  const weekStartDay = Math.max(1, latestDay - 6);
  const weekDays = Array.from({ length: latestDay - weekStartDay + 1 }, (_, index) => weekStartDay + index);
  const columns = [
    { key: "label", label: "WILAYAH", width: 190 },
    { key: "targetFm", label: "TARGET FM", width: 82 },
    { key: "targetYtd", label: "TARGET YTD", width: 82 },
    ...weekDays.map((day) => ({ key: `d${day - 1}`, label: String(day), width: 42 })),
    { key: "mtd", label: "MTD", width: 72 },
    { key: "ach", label: "ACH", width: 72 },
    { key: "rank", label: "RANK", width: 62 },
    { key: "shortageFm", label: "SHORTAGE FM", width: 92 },
    { key: "realYtd", label: "REAL YTD", width: 82 },
    { key: "achYtd", label: "ACH YTD", width: 82 },
    { key: "rankYtd", label: "RANK YTD", width: 74 },
    { key: "shortageYtd", label: "SHORTAGE YTD", width: 96 },
  ];
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const width = Math.max(1180, tableWidth + 80);
  const rowHeight = 28;
  const headerHeight = 104;
  const tableTitleHeight = 94;
  const height = headerHeight + (witelRows.length + teldaRows.length + 4) * rowHeight + tableTitleHeight * 2 + 60;
  const scale = 2;
  const { canvas, ctx } = newCanvas(width, height, scale);
  ctx.fillStyle = "#f8f3ec";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#160d08";
  ctx.fillRect(0, 0, width, headerHeight);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 26px Arial";
  ctx.fillText("REPORT WMS TARGET RKAP", 40, 43);
  ctx.font = "600 13px Arial";
  ctx.fillStyle = "#fed7aa";
  ctx.fillText(`Tanggal ${weekStartDay}-${latestDay} | ${report.periodLabel} | Data ${report.cutoffLabel}`, 40, 72);
  ctx.fillStyle = "#b9a38e";
  ctx.fillText(`Rendered ${formatJakartaDateTime(timestamp, true)}`, 40, 91);

  function headerFill(columnKey: string) {
    if (columnKey === "label") return "#140b06";
    if (columnKey === "targetFm" || columnKey === "targetYtd") return "#7c3f16";
    if (columnKey.startsWith("d")) return "#8a5a16";
    return "#21140c";
  }

  function achievementFill(value: number | null | undefined) {
    const tone = achievementTone(value);
    if (tone === "good") return "#ecfdf3";
    if (tone === "near") return "#fff7ed";
    if (tone === "low") return "#fff1f2";
    return "#f8f3ec";
  }

  function achievementText(value: number | null | undefined) {
    const tone = achievementTone(value);
    if (tone === "good") return "#047857";
    if (tone === "near") return "#92400e";
    if (tone === "low") return "#be123c";
    return "#334155";
  }

  function bodyFill(columnKey: string, rowIndex: number, isTotal: boolean, row: WmsReportRow) {
    if (isTotal) return columnKey === "targetFm" || columnKey === "targetYtd" ? "#2a1a10" : "#140b06";
    if (columnKey === "label") return rowIndex % 2 === 0 ? "#ffffff" : "#faf7f2";
    if (columnKey === "targetFm" || columnKey === "targetYtd") return "#f7eadf";
    if (columnKey.startsWith("d")) return "#ffffff";
    if (columnKey === "mtd" || columnKey === "realYtd") return "#f5eadf";
    if (columnKey === "ach") return achievementFill(row.ach);
    if (columnKey === "achYtd") return achievementFill(row.achYtd);
    if (columnKey === "shortageFm") return row.shortageFm < 0 ? "#fff1f2" : "#ecfdf3";
    if (columnKey === "shortageYtd") return row.shortageYtd < 0 ? "#fff1f2" : "#ecfdf3";
    if (columnKey === "rank" || columnKey === "rankYtd") return "#faf7f2";
    return rowIndex % 2 === 0 ? "#ffffff" : "#faf7f2";
  }

  function bodyTextFill(columnKey: string, isTotal: boolean, row: WmsReportRow) {
    if (isTotal) return "#ffffff";
    if (columnKey === "targetFm" || columnKey === "targetYtd") return "#6b3a13";
    if (columnKey === "mtd" || columnKey === "realYtd") return "#5b3418";
    if (columnKey === "ach") return achievementText(row.ach);
    if (columnKey === "achYtd") return achievementText(row.achYtd);
    if (columnKey === "shortageFm") return row.shortageFm < 0 ? "#be123c" : "#047857";
    if (columnKey === "shortageYtd") return row.shortageYtd < 0 ? "#be123c" : "#047857";
    if (columnKey === "rank" || columnKey === "rankYtd") return "#0f172a";
    return "#0f172a";
  }

  function drawTable(scope: string, tableRows: WmsReportRow[], startY: number) {
    let y = startY;
    const gradient = ctx.createLinearGradient(40, y, 40 + tableWidth, y);
    gradient.addColorStop(0, "#070302");
    gradient.addColorStop(0.58, "#1f130c");
    gradient.addColorStop(1, "#7c3f16");
    ctx.fillStyle = gradient;
    ctx.fillRect(40, y, tableWidth, tableTitleHeight);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "700 10px Arial";
    ctx.fillStyle = "#fed7aa";
    ctx.fillText("MAIN TABLE", 40 + tableWidth / 2, y + 23);
    ctx.font = "700 18px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("PS HARIAN WMS", 40 + tableWidth / 2, y + 48);
    ctx.font = "600 12px Arial";
    ctx.fillStyle = "#e7d4c2";
    ctx.fillText(scope, 40 + tableWidth / 2, y + 68);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(40 + tableWidth / 2 - 130, y + 75, 260, 18);
    ctx.font = "700 10px Arial";
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(`${report.periodLabel} | Data s.d. Tgl ${latestDay}`, 40 + tableWidth / 2, y + 88);
    ctx.textAlign = "left";
    y += tableTitleHeight;

    let x = 40;
    ctx.font = "700 10px Arial";
    for (const column of columns) {
      ctx.fillStyle = headerFill(column.key);
      ctx.fillRect(x, y, column.width, rowHeight);
      ctx.strokeStyle = "#ffffff";
      ctx.strokeRect(x, y, column.width, rowHeight);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(column.label, x + 6, y + 18);
      x += column.width;
    }
    y += rowHeight;

    tableRows.forEach((row, rowIndex) => {
      const isTotal = row.label === "Total" || row.label === "YK JATENG SELATAN";
      x = 40;
      ctx.font = isTotal ? "700 11px Arial" : "600 11px Arial";
      for (const column of columns) {
        ctx.fillStyle = bodyFill(column.key, rowIndex, isTotal, row);
        ctx.fillRect(x, y, column.width, rowHeight);
        ctx.strokeStyle = "#e7e5e4";
        ctx.strokeRect(x, y, column.width, rowHeight);
        let value = "";
        if (column.key === "label") value = row.label;
        else if (column.key === "targetFm") value = formatNumber(row.targetFm);
        else if (column.key === "targetYtd") value = formatNumber(row.targetYtd);
        else if (column.key === "mtd") value = formatNumber(row.mtd);
        else if (column.key === "ach") value = formatPercent(row.ach);
        else if (column.key === "rank") value = formatNumber(row.rank);
        else if (column.key === "shortageFm") value = formatNumber(row.shortageFm);
        else if (column.key === "realYtd") value = formatNumber(row.realYtd);
        else if (column.key === "achYtd") value = formatPercent(row.achYtd);
        else if (column.key === "rankYtd") value = formatNumber(row.rankYtd);
        else if (column.key === "shortageYtd") value = formatNumber(row.shortageYtd);
        else if (column.key.startsWith("d")) value = formatNumber(row.days[Number(column.key.slice(1))]);
        ctx.fillStyle = bodyTextFill(column.key, isTotal, row);
        ctx.textAlign = column.key === "label" ? "left" : "right";
        ctx.fillText(value, column.key === "label" ? x + 6 : x + column.width - 6, y + 18);
        x += column.width;
      }
      y += rowHeight;
    });
    ctx.textAlign = "left";
    return y + 18;
  }

  const afterWitel = drawTable("WITEL", witelRows, headerHeight + 26);
  drawTable("TELDA / BRANCH", teldaRows, afterWitel);
  return {
    bytes: toPngBytes(canvas),
    caption: `Report WMS Target RKAP\n${report.periodLabel} | Data ${report.cutoffLabel}`,
    filename: `WMS-Report-${report.periodLabel.replace(/\s+/g, "-")}-${jakartaStamp(timestamp)}.png`,
  };
}
