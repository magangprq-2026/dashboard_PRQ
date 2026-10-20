// Gambar report HSI (PNG) untuk bot Telegram. Perhitungan riwayat harian memakai features/hsi/domain/reporting/history.ts
// (sama dengan dashboard web); tampilan memakai table-kit bersama dengan warna dashboard HSI.
import { computeReport, type ComputedReport, type ReportRow, type ReportTable } from "@/features/hsi/domain/reporting/reporting";
import { applyReportHistory, type ReportHistory } from "@/features/hsi/domain/reporting/history";
import { formatNumber, formatPercent, type ReportImage } from "./canvas";
import {
  achTone, dayKind, parsePeriodLabel, rankTone, renderReportPng, signTone,
  type CellStyle, type ReportTheme, type TableCol, type TableSpec,
} from "./table-kit";

// Perhitungan riwayat harian memakai modul yang sama dengan dashboard web (hsi/domain/reporting/history.ts),
// supaya angka di gambar Telegram selalu sama dengan dashboard.
export type { ReportHistory };

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
