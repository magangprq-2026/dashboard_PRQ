// Pembuat file report untuk bot Telegram: Excel dan gambar PNG untuk HSI, WMS, LTS, dan MetaBright.
import * as XLSX from "xlsx";
import { computeLtsReport, ltsReportTabs, type LtsComputedReport, type LtsReportRow, type LtsReportSourceDatasets } from "@/features/lts/domain/reporting/reporting";
import { computeWmsReport, type MasterRow as WmsMasterRow } from "@/features/wms/domain/reporting/reporting";
import type { ComputedReport as HsiComputedReport } from "@/features/hsi/domain/reporting/reporting";
import defaultMetabright from "@/features/metabright/data/default.json";
import { toAoa } from "@/features/metabright/domain/export";
import { periodLabel as metabrightPeriodLabel } from "@/features/metabright/domain/utils";
import type { Dataset } from "@/features/metabright/domain/types";
import { buildReportFile, loadLatestEntry } from "./master-upload";
import { buildHsiImages, type ReportHistory } from "./report-images/hsi-image";
import { buildLtsImage } from "./report-images/lts-image";
import { buildMetabrightImage } from "./report-images/metabright-image";
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
    const report = computeWmsReport(entry.rows as WmsMasterRow[], entry.periodKey);
    return [buildWmsImage(report, new Date())];
  }

  if (product === "LTS") {
    const reports = await ltsReports(deps);
    const timestamp = new Date();
    return reports.map((report) => buildLtsImage(report, timestamp));
  }

  return [buildMetabrightImage(METABRIGHT_DATA, METABRIGHT_PERIOD)];
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
  const aoa = toAoa(METABRIGHT_DATA.rows, METABRIGHT_DATA);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = aoa[0].map((_, i) => ({ wch: i < 2 ? 7 : i === 2 ? 22 : i === 3 ? 18 : i === aoa[0].length - 1 ? 12 : 17 }));
  XLSX.utils.book_append_sheet(wb, ws, "Semua witel");
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return {
    bytes: new Uint8Array(bytes),
    caption: `Report MetaBright (Impactful Award Telda)\nPeriode: ${METABRIGHT_PERIOD}`,
    filename: `Impactful_Award_Telda_${METABRIGHT_PERIOD.replace(/\s+/g, "_")}.xlsx`,
  };
}
