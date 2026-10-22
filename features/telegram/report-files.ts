// Pembuat file report untuk bot Telegram: Excel dan gambar PNG untuk HSI, WMS, LTS, dan MetaBright.
import * as XLSX from "xlsx";
import { computeLtsReport, ltsReportTabs, type LtsComputedReport, type LtsReportRow, type LtsReportSourceDatasets } from "@/features/lts/domain/reporting/reporting";
import { computeWmsReport, type MasterRow as WmsMasterRow } from "@/features/wms/domain/reporting/reporting";
import type { ComputedReport as HsiComputedReport } from "@/features/hsi/domain/reporting/reporting";
import defaultMetabright from "@/features/metabright/data/default.json";
import { toAoa } from "@/features/metabright/domain/export";
import { periodLabel as metabrightPeriodLabel } from "@/features/metabright/domain/utils";
import type { Dataset } from "@/features/metabright/domain/types";
import { slug as metabrightSlug } from "@/features/metabright/domain/utils";
import { readMetabrightDashboardState } from "@/features/metabright/backend/dashboard-state/db-state";
import { buildReportFile, loadLatestEntry } from "./master-upload";
import { buildHsiImages, type ReportHistory } from "./report-images/hsi-image";
import { buildLtsImage } from "./report-images/lts-image";
import { buildMetabrightImage, buildMetabrightVizImage } from "./report-images/metabright-image";
import { buildWmsImage } from "./report-images/wms-image";
import type { ReportImage } from "./report-images/canvas";

export type ReportProductKey = "HSI" | "WMS" | "LTS" | "METABRIGHT";
export const REPORT_DOWNLOAD_PRODUCTS: ReportProductKey[] = ["HSI", "WMS", "LTS", "METABRIGHT"];

export type ReportDeps = {
  /** Dataset LTS aktif (sales, caps, ct0) dari database. */
  loadLtsDatasets: () => Promise<LtsReportSourceDatasets>;
};

export type ExcelReport = { bytes: Uint8Array; filename: string; caption: string };

const METABRIGHT_DATA = defaultMetabright as unknown as Dataset;
const METABRIGHT_PERIOD = metabrightPeriodLabel("202610");

// ---------- Data MetaBright ----------
export type MetabrightReportData = { data: Dataset; label: string; updatedAt: string | null; fromDatabase: boolean };

/**
 * Data MetaBright yang sama dengan halaman web: periode terpilih dari database (key "metabright").
 * Jika database belum berisi data MetaBright (belum pernah diupload di web), dipakai data bawaan aplikasi.
 */
export async function loadMetabrightReportData(): Promise<MetabrightReportData> {
  const result = await readMetabrightDashboardState().catch(() => null);
  const state = (result?.body as { state?: { periods?: Record<string, Dataset>; selected?: string; updatedAt?: string } | null } | undefined)?.state;
  const periods = state && typeof state === "object" && state.periods && typeof state.periods === "object" ? state.periods : null;
  if (periods) {
    const labels = Object.keys(periods).filter((k) => Array.isArray(periods[k]?.rows) && Array.isArray(periods[k]?.indicators));
    if (labels.length === 0) throw new Error("Belum ada data MetaBright. Upload file Impactful Award Telda di halaman MetaBright dulu.");
    const label = state?.selected && labels.includes(state.selected) ? state.selected : labels[labels.length - 1];
    return { data: periods[label], fromDatabase: true, label, updatedAt: state?.updatedAt ?? null };
  }
  return { data: METABRIGHT_DATA, fromDatabase: false, label: METABRIGHT_PERIOD, updatedAt: null };
}

// ---------- Gambar (PNG) ----------
export async function buildReportImages(product: ReportProductKey, deps: ReportDeps): Promise<ReportImage[]> {
  if (product === "HSI") {
    const entry = await loadLatestEntry("HSI");
    if (!entry) throw new Error("Belum ada data HSI. Upload file MASTER HSI dulu.");
    return buildHsiImages(entry.rows, entry.savedAt, entry.periodKey, entry.reportHistory as ReportHistory | null, entry.reportSnapshot as HsiComputedReport | null);
  }

  if (product === "WMS") {
    const entry = await loadLatestEntry("WMS");
    if (!entry) throw new Error("Belum ada data WMS. Upload file MASTER WMS dulu.");
    const report = computeWmsReport(entry.allRows as WmsMasterRow[], entry.periodKey, { reference: entry.reference });
    return [buildWmsImage(report, new Date())];
  }

  if (product === "LTS") {
    const reports = await ltsReports(deps);
    const timestamp = new Date();
    return reports.map((report) => buildLtsImage(report, timestamp));
  }

  const mb = await loadMetabrightReportData();
  return [buildMetabrightImage(mb.data, mb.label)];
}

// ---------- MetaBright: cakupan witel (sama seperti dialog Unduh di dashboard) ----------
/** Daftar witel yang ada di data MetaBright aktif (urut abjad, sama dengan dashboard). */
export async function listMetabrightWitels(): Promise<string[]> {
  const mb = await loadMetabrightReportData();
  return [...new Set(mb.data.rows.map((r) => r.witel))].sort();
}

export type MetabrightScope = "all" | { witel: string };
export type MetabrightContent = "data" | "tabel" | "viz";

function scopeOf(mb: MetabrightReportData, scope: MetabrightScope) {
  if (scope === "all") return { data: mb.data, label: "Semua witel" };
  const rows = mb.data.rows.filter((r) => r.witel === scope.witel);
  if (rows.length === 0) throw new Error(`Data witel ${scope.witel} tidak ditemukan.`);
  return { data: { ...mb.data, rows }, label: scope.witel };
}

/** Satu file MetaBright (Excel, tabel PNG, atau visualisasi PNG) untuk cakupan witel tertentu. */
export async function buildMetabrightFiles(scope: MetabrightScope, contents: MetabrightContent[]): Promise<{ images: ReportImage[]; excel?: ExcelReport }> {
  const mb = await loadMetabrightReportData();
  const sc = scopeOf(mb, scope);
  const timestamp = new Date();
  const images: ReportImage[] = [];
  let excel: ExcelReport | undefined;
  if (contents.includes("data")) {
    const wb = XLSX.utils.book_new();
    const aoa = toAoa(sc.data.rows, sc.data);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = aoa[0].map((_, i) => ({ wch: i < 2 ? 7 : i === 2 ? 22 : i === 3 ? 18 : i === aoa[0].length - 1 ? 12 : 17 }));
    XLSX.utils.book_append_sheet(wb, ws, sc.label.replace(/[\\/?*[\]:]/g, " ").slice(0, 28));
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    excel = {
      bytes: new Uint8Array(bytes),
      caption: `Data Impactful Award Telda (MetaBright)\n${mb.label} | ${sc.label} | ${sc.data.rows.length} telda`,
      filename: `Data_${metabrightSlug(sc.label)}_${metabrightSlug(mb.label)}.xlsx`,
    };
  }
  if (contents.includes("tabel")) images.push(buildMetabrightImage(sc.data, mb.label, timestamp, scope === "all" ? undefined : sc.label));
  if (contents.includes("viz")) images.push(buildMetabrightVizImage(sc.data, mb.label, sc.label, timestamp));
  return { images, excel };
}

async function ltsReports(deps: ReportDeps): Promise<LtsComputedReport[]> {
  const datasets = await deps.loadLtsDatasets();
  if (!datasets.sales || !datasets.caps || !datasets.ct0) {
    throw new Error("Data LTS belum lengkap. Dashboard membutuhkan dataset Sales, CAPS, dan CT0.");
  }
  // Tiga tab sama seperti di web: LTS ALL, LTS WMS ONLY, LTS HSI ONLY.
  const reports: LtsComputedReport[] = [];
  for (const tab of ltsReportTabs) {
    try {
      reports.push(computeLtsReport(tab.key, datasets));
    } catch {
      /* tab dilewati bila dataset pendukungnya belum ada */
    }
  }
  if (reports.length === 0) throw new Error("Report LTS belum bisa dihitung dari data yang tersedia.");
  return reports;
}

// ---------- Excel ----------
const LTS_HEADERS = ["Wilayah", "Koordinator", "Sales", "CT0", "CT0/Sales", "Rank CT0", "CAPS", "CAPS/Sales", "Rank CAPS", "Score", "Rank Score", "Rank LTS CAPS", "Churn", "Gap"];
const LTS_PERCENT_COLUMNS = new Set([4, 7, 9]);

function ltsSheet(rows: LtsReportRow[]) {
  const body = rows.map((r) => [r.label, r.coordinator ?? "", r.sales, r.ct0, r.ct0Ratio, r.ct0Rank, r.caps, r.capsRatio, r.capsRank, r.score, r.scoreRank, r.capsRankOnly, r.churn, r.gap]);
  const ws = XLSX.utils.aoa_to_sheet([LTS_HEADERS, ...body]);
  ws["!cols"] = LTS_HEADERS.map((_, i) => ({ wch: i === 0 ? 26 : i === 1 ? 26 : 13 }));
  body.forEach((row, r) =>
    row.forEach((_, c) => {
      const cell = ws[XLSX.utils.encode_cell({ c, r: r + 1 })];
      if (cell && cell.t === "n" && LTS_PERCENT_COLUMNS.has(c)) cell.z = "0.00%";
    }),
  );
  return ws;
}

export async function buildReportExcel(product: ReportProductKey, deps: ReportDeps): Promise<ExcelReport> {
  if (product === "HSI" || product === "WMS") {
    const file = await buildReportFile(product);
    return { bytes: file.bytes, caption: `Report ${product}\nPeriode: ${file.periodLabel}`, filename: file.filename };
  }

  const wb = XLSX.utils.book_new();
  if (product === "LTS") {
    const reports = await ltsReports(deps);
    for (const report of reports) {
      const short = report.label.replace("LTS ", "").slice(0, 16);
      XLSX.utils.book_append_sheet(wb, ltsSheet([...report.witel.rows, report.witel.total]), `${short} Witel`);
      XLSX.utils.book_append_sheet(wb, ltsSheet([...report.hotda.rows, report.hotda.total]), `${short} Hotda`);
    }
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    return { bytes: new Uint8Array(bytes), caption: `Report LTS\nPeriode: ${reports[0].periodLabel}`, filename: `Report_LTS_${reports[0].periodLabel.replace(/\s+/g, "_")}.xlsx` };
  }

  // MetaBright: tabel data skor per indikator, format sama dengan unduhan Excel di halaman MetaBright.
  const mb = await loadMetabrightReportData();
  const aoa = toAoa(mb.data.rows, mb.data);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = aoa[0].map((_, i) => ({ wch: i < 2 ? 7 : i === 2 ? 22 : i === 3 ? 18 : i === aoa[0].length - 1 ? 12 : 17 }));
  XLSX.utils.book_append_sheet(wb, ws, "Semua witel");
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return {
    bytes: new Uint8Array(bytes),
    caption: `Report MetaBright (Impactful Award Telda)\nPeriode: ${mb.label}`,
    filename: `Impactful_Award_Telda_${mb.label.replace(/\s+/g, "_")}.xlsx`,
  };
}
