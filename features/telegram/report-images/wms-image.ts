// Gambar report WMS (PNG) untuk bot Telegram. Memakai table-kit bersama dengan warna dashboard WMS
// (cokelat tua, amber, dan krem) dan kolom yang sama dengan tombol "Download PNG" di web.
import type { WmsComputedReport, WmsReportRow } from "@/features/wms/domain/reporting/reporting";
import { formatNumber, formatPercent, type ReportImage } from "./canvas";
import {
  achTone, dayKind, parsePeriodLabel, rankTone, renderReportPng, signTone,
  type CellStyle, type ReportTheme, type TableCol, type TableSpec,
} from "./table-kit";

const WMS_THEME: ReportTheme = {
  bannerStops: ["#160d08", "#3b2414", "#8a4b1a"],
  canvasBg: "#f8f3ec",
  highlight: "#fdba74",
  ink: "#2a1a10",
  line: "#e7dccd",
  muted: "#6b5645",
  text: "#1c1209",
  zebra: "#fbf7f1",
};

const dash = "–";
const num = (value: number | null | undefined): CellStyle => ({ text: value === null || value === undefined ? dash : formatNumber(value) });

function pct(value: number | null | undefined, tone = signTone(value)): CellStyle {
  if (value === null || value === undefined || Number.isNaN(value)) return { text: dash };
  return { bold: true, color: tone?.color, fill: tone?.fill, text: formatPercent(value) };
}

function wmsColumns(
  count: number,
  labelHeader: string,
  startDay: number,
  latestDay: number,
  periodLabel: string,
  previousMonthLabel: string,
): TableCol<WmsReportRow>[] {
  const period = parsePeriodLabel(periodLabel);
  const dayCols: TableCol<WmsReportRow>[] = [];
  for (let day = startDay; day <= latestDay; day += 1) {
    const weekend = dayKind(period, day) === "weekend";
    dayCols.push({
      cell: (row) => num(row.days[day - 1]),
      fill: weekend ? "#be123c" : "#8a5a16",
      group: `TANGGAL (${periodLabel})`,
      head: String(day),
      subFill: weekend ? "#ffe4e6" : "#f8ead2",
      subText: weekend ? "#9f1239" : "#5b3a0c",
      width: 46,
    });
  }
  const base = { fill: "#3b2414", subFill: "#f3e7d8", subText: "#5b3418" };
  const prev = (value: number): CellStyle => ({ color: "#5b4636", fill: "#f5efe6", text: formatNumber(value) });
  const rank = (value: number | null): CellStyle => {
    const tone = rankTone(value, count);
    return { bold: true, color: tone?.color, fill: tone?.fill, text: value === null ? dash : formatNumber(value) };
  };
  const shortage = (value: number): CellStyle => {
    const tone = signTone(value);
    return { bold: true, color: tone?.color, fill: tone?.fill, text: formatNumber(value) };
  };
  return [
    { align: "left", cell: (row) => ({ bold: true, text: row.label.toUpperCase() }), fill: WMS_THEME.ink, head: labelHeader, width: 200 },
    { cell: (row) => ({ bold: true, color: "#6b3a13", fill: "#f7eadf", text: formatNumber(row.targetFm) }), fill: "#7c3f16", head: "TARGET FM", width: 88 },
    { cell: (row) => ({ bold: true, color: "#6b3a13", fill: "#f7eadf", text: formatNumber(row.targetYtd) }), fill: "#7c3f16", head: "TARGET YTD", width: 92 },
    ...dayCols,
    {
      cell: (row) => ({ bold: true, color: "#5b2d06", fill: "#fde9c8", text: formatNumber(row.mtd) }),
      fill: "#f59e0b",
      head: "MTD",
      sub: "TOTAL",
      subFill: "#fcd9a0",
      subText: "#5b2d06",
      text: "#3a1d04",
      width: 80,
    },
    { ...base, cell: (row) => pct(row.ach, achTone(row.ach)), head: "TARGET ACH", sub: "MTD", width: 92 },
    { ...base, cell: (row) => rank(row.rank), head: "RANK ACH", sub: "MTD", width: 78 },
    { ...base, cell: (row) => shortage(row.shortageFm), head: "SHORTAGE TO TARGET FM", sub: "MTD", width: 104 },
    { ...base, cell: (row) => prev(row.realMtdPrev), head: `REAL MTD ${previousMonthLabel}`, sub: "MTD", width: 96 },
    { ...base, cell: (row) => pct(row.growthMtd), head: "GR MTD", sub: "%", width: 82 },
    { ...base, cell: (row) => prev(row.realFmPrev), head: `REAL FM ${previousMonthLabel}`, sub: "FM", width: 96 },
    { ...base, cell: (row) => pct(row.growthFm), head: "GR FM", sub: "%", width: 82 },
    { ...base, cell: (row) => ({ bold: true, color: "#5b3418", fill: "#f3e7d8", text: formatNumber(row.realYtd) }), head: `REAL YTD ${period?.year ?? ""}`.trim(), sub: "YTD", width: 92 },
    { ...base, cell: (row) => pct(row.achYtd, achTone(row.achYtd)), head: "ACH YTD", sub: "%", width: 88 },
    { ...base, cell: (row) => pct(row.growthYtd), head: "GR YTD", sub: "%", width: 82 },
    { ...base, cell: (row) => rank(row.rankYtd), head: "RANK YTD", sub: "YTD", width: 78 },
    { ...base, cell: (row) => shortage(row.shortageYtd), head: "SHORTAGE TO TARGET YTD", sub: "YTD", width: 104 },
  ];
}

export function buildWmsImage(report: WmsComputedReport, timestamp: Date): ReportImage {
  const latestDay = report.cutoffDay;
  const startDay = Math.max(1, latestDay - 6);
  const spec = (labelHeader: string, table: { rows: WmsReportRow[]; total: WmsReportRow }): TableSpec<WmsReportRow> => ({
    cols: wmsColumns(table.rows.length, labelHeader, startDay, latestDay, report.periodLabel, report.previousMonthLabel),
    rows: table.rows,
    total: table.total,
  });
  const bytes = renderReportPng({
    banner: {
      note: `TARGET RKAP  •  TANGGAL ${startDay}-${latestDay}  •  ${report.cutoffLabel.toUpperCase()}`,
      periodLabel: report.periodLabel,
      scope: "WITEL YOGYA JATENG SELATAN",
      title: "PS HARIAN WMS",
    },
    footer: `Data s.d. Tgl ${latestDay}`,
    tables: [spec("WITEL", report.witel), spec("TELDA", report.telda)],
    theme: WMS_THEME,
    timestamp,
  });
  return {
    bytes,
    caption: `Report WMS Target RKAP\n${report.periodLabel} | Data ${report.cutoffLabel}`,
    filename: "Report WMS Target RKAP.png",
  };
}
