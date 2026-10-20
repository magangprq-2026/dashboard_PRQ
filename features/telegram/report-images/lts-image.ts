// Gambar report LTS (PNG) untuk bot Telegram. Memakai table-kit bersama dengan warna dashboard LTS (ungu tua)
// dan kolom yang sama dengan tombol "Download PNG" di web.
import type { LtsComputedReport, LtsReportRow, LtsReportTable } from "@/features/lts/domain/reporting/reporting";
import { formatNumber, type ReportImage } from "./canvas";
import {
  GOOD, LOW, rankTone, renderReportPng, tableWidth,
  type CellStyle, type ReportTheme, type TableCol, type TableSpec,
} from "./table-kit";

type LtsColumnOptions = { churnGap: boolean; rankCaps: boolean };
const hiddenLtsColumns: LtsColumnOptions = { churnGap: false, rankCaps: false };

const LTS_THEME: ReportTheme = {
  bannerStops: ["#07040f", "#24103f", "#5b2a9a"],
  canvasBg: "#f7f4fb",
  highlight: "#fcd34d",
  ink: "#24103f",
  line: "#e2d9f0",
  muted: "#5b4b78",
  text: "#1f1233",
  zebra: "#faf7ff",
};

// Persen LTS ditampilkan seperti Excel: 190,32% (nilai rasio dikali 100).
function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value * 100)}%`;
}

const dash = "–";

function ltsColumns(table: LtsReportTable, options: LtsColumnOptions): TableCol<LtsReportRow>[] {
  const count = table.rows.length;
  const rank = (key: "ct0Rank" | "capsRank" | "scoreRank" | "capsRankOnly") => (row: LtsReportRow): CellStyle => {
    const value = row[key];
    const tone = rankTone(value, count);
    return { bold: true, color: tone?.color, fill: tone?.fill, text: value === null ? dash : formatNumber(value) };
  };
  const tinted = (fill: string, color: string, text: string, bold = false): CellStyle => ({ bold, color, fill, text });

  const ct0 = { fill: "#3730a3", subFill: "#eef2ff", subText: "#3730a3", group: "Bobot 50% CT0" };
  const caps = { fill: "#0e7490", subFill: "#ecfeff", subText: "#0e7490", group: "Bobot 50% CAPS" };
  const score = { fill: "#5b21b6", subFill: "#f5f1ff", subText: "#5b21b6", group: "Score" };
  const churn = { fill: "#047857", subFill: "#ecfdf5", subText: "#047857", group: "CAPS 27/8" };

  const cols: TableCol<LtsReportRow>[] = [
    { align: "left", cell: (row) => ({ bold: true, text: row.label.toUpperCase() }), fill: LTS_THEME.ink, head: table.scope === "witel" ? "WITEL" : "BRANCH", width: 225 },
  ];
  if (table.scope !== "witel") {
    cols.push({ align: "left", cell: (row) => ({ text: row.coordinator ?? "" }), fill: "#1a0d2f", head: "KOORDINATOR", width: 250 });
  }
  cols.push(
    { cell: (row) => tinted("#f3edff", "#321653", formatNumber(row.sales), true), fill: "#43206a", head: "SALES", width: 84 },
    { ...ct0, cell: (row) => tinted("#eef2ff", "#312e81", formatNumber(row.ct0)), head: "CT0", width: 84 },
    { ...ct0, cell: (row) => tinted("#e0e7ff", "#3730a3", formatPercent(row.ct0Ratio), true), head: "CT0/SALES", width: 104 },
    { ...ct0, cell: rank("ct0Rank"), head: "RANK", width: 70 },
    { ...caps, cell: (row) => tinted("#ecfeff", "#164e63", formatNumber(row.caps)), head: "CAPS", width: 84 },
    { ...caps, cell: (row) => tinted("#cffafe", "#0e7490", formatPercent(row.capsRatio), true), head: "CAPS/SALES", width: 108 },
    { ...caps, cell: rank("capsRank"), head: "RANK", width: 70 },
    { ...score, cell: (row) => tinted("#f5f1ff", "#5b21b6", formatPercent(row.score), true), head: "SCORE", width: 100 },
    { ...score, cell: rank("scoreRank"), head: "RANK", width: 70 },
  );
  if (table.scope === "witel" && options.rankCaps) {
    cols.push({ cell: rank("capsRankOnly"), fill: "#92400e", head: "RANK LTS CAPS", width: 104 });
  }
  if (options.churnGap) {
    cols.push(
      { ...churn, cell: (row) => tinted("#fff7ed", "#92400e", formatNumber(row.churn)), head: "CHURN", width: 90 },
      {
        ...churn,
        cell: (row) => (row.gap < 0 ? { bold: true, color: LOW.color, fill: LOW.fill, text: formatNumber(row.gap) } : { bold: true, color: GOOD.color, fill: GOOD.fill, text: formatNumber(row.gap) }),
        head: "GAP",
        width: 84,
      },
    );
  }
  return cols;
}

/** Skalakan lebar kolom agar tabel WITEL dan BRANCH sama lebar (seperti di web). */
function scaleTo<R>(cols: TableCol<R>[], target: number) {
  const factor = target / tableWidth(cols);
  return cols.map((col) => ({ ...col, width: col.width * factor }));
}

export function buildLtsImage(report: LtsComputedReport, timestamp: Date, columnOptions: LtsColumnOptions = hiddenLtsColumns): ReportImage {
  const witelCols = ltsColumns(report.witel, columnOptions);
  const hotdaCols = ltsColumns(report.hotda, columnOptions);
  const target = Math.max(tableWidth(witelCols), tableWidth(hotdaCols));
  const tables: TableSpec<LtsReportRow>[] = [
    { cols: scaleTo(witelCols, target), rows: report.witel.rows, total: report.witel.total },
    { cols: scaleTo(hotdaCols, target), rows: report.hotda.rows, total: report.hotda.total },
  ];
  const cutoff = report.cutoffLabel.replace(/^cut\s*off\s*:?\s*/i, "").toUpperCase();
  const bytes = renderReportPng({
    banner: {
      note: `SOURCE: ${report.sourceLabel.toUpperCase()}${cutoff ? `  •  CUT OFF: ${cutoff}` : ""}`,
      periodLabel: report.periodLabel,
      scope: "WITEL YOGYA JATENG SELATAN",
      title: report.label.toUpperCase(),
    },
    footer: report.cutoffLabel,
    tables: tables,
    theme: LTS_THEME,
    timestamp,
  });
  return {
    bytes,
    caption: `${report.label}\n${report.periodLabel} | ${report.cutoffLabel}`,
    filename: `${report.label.replace(/\s+/g, " ")}.png`,
  };
}
