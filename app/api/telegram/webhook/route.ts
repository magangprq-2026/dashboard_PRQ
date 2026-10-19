import { NextRequest, NextResponse } from "next/server";
import { dbGet } from "@/features/shared/backend/database/db";
import { computeLtsReport, type LtsReportSourceDatasets } from "@/features/lts/domain/reporting/reporting";
import {
  computeWmsReport,
  type MasterRow as WmsMasterRow,
} from "@/features/wms/domain/reporting/reporting";

import {
  buildReportFile,
  detectProduct,
  importLtsDataset,
  importMetabright,
  importMaster,
  isAllowedUploader,
  loadLatestRows,
  parseMasterRows,
  type ReportableProduct,
} from "@/features/telegram/master-upload";
import { downloadTelegramFile, sendTelegramDocument } from "@/features/telegram/telegram-api";
import { computeReport as computeHsiReport } from "@/features/hsi/domain/reporting/reporting";
import { applyReportHistory } from "@/features/hsi/domain/reporting/history";

export const dynamic = "force-dynamic";
// Parse Excel + tulis ke Neon bisa >10 dtk untuk file besar. Hobby Vercel mengizinkan sampai 60 dtk.
export const maxDuration = 60;

type TelegramChat = {
  id: number;
  type?: string;
};

type TelegramUser = {
  first_name?: string;
  id: number;
  username?: string;
};

type TelegramDocument = {
  file_id: string;
  file_name?: string;
  file_size?: number;
};

type TelegramMessage = {
  caption?: string;
  chat?: TelegramChat;
  document?: TelegramDocument;
  from?: TelegramUser;
  message_id?: number;
  text?: string;
};

type TelegramUpdate = {
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
  update_id?: number;
};

type DashboardProduct = "HSI" | "WMS" | "LTS" | "METABRIGHT";
type ReportProduct = DashboardProduct;

type TelegramCallbackQuery = {
  data?: string;
  from?: TelegramUser;
  id: string;
  message?: TelegramMessage;
};

type TelegramInlineKeyboardButton = {
  callback_data?: string;
  text: string;
  url?: string;
};

type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

type TelegramMessageOptions = {
  replyMarkup?: TelegramInlineKeyboardMarkup;
};

type DashboardPresenceRow = {
  product: string;
};

type ReportingImportRow = {
  imported_at: string | null;
  product?: string | null;
  row_count?: number | null;
  updated_at: string | null;
};

type DashboardRecordRow = {
  dataset_kind?: string | null;
  payload?: unknown;
  period_key?: string | null;
  product?: string | null;
  updated_at?: string | null;
};

type DashboardStateRow = {
  payload?: unknown;
  updated_at?: string | null;
};

type ReportMetric = {
  label: string;
  value: string;
};

type ProductReport = {
  available: boolean;
  lastUpdate?: string;
  metrics: ReportMetric[];
  note?: string;
  periodLabel?: string;
  product: ReportProduct;
  title: string;
};

const DASHBOARD_PRODUCTS: DashboardProduct[] = ["HSI", "WMS", "LTS", "METABRIGHT"];
const REPORT_PRODUCTS: ReportProduct[] = ["HSI", "WMS", "LTS", "METABRIGHT"];
const MONTH_NAMES_ID = [
  "JANUARI",
  "FEBRUARI",
  "MARET",
  "APRIL",
  "MEI",
  "JUNI",
  "JULI",
  "AGUSTUS",
  "SEPTEMBER",
  "OKTOBER",
  "NOVEMBER",
  "DESEMBER",
] as const;

function telegramConfig() {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Vercel mengisi VERCEL_PROJECT_PRODUCTION_URL tanpa "https://" (hanya host), sedangkan tombol link
// Telegram wajib memakai skema URL lengkap. Tambahkan https:// bila belum ada.
function configuredAppUrl() {
  const configuredUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  if (!configuredUrl) return null;
  const withScheme = /^https?:\/\//i.test(configuredUrl) ? configuredUrl : `https://${configuredUrl}`;
  return withScheme.replace(/\/$/, "");
}

function portalUrl(request: NextRequest) {
  return configuredAppUrl() ?? request.nextUrl.origin;
}

function portalUrlFromOrigin(origin: string) {
  return configuredAppUrl() ?? origin.replace(/\/$/, "");
}

function normalizeTelegramCommand(text: string) {
  const command = text.split(/\s+/)[0]?.toLowerCase() ?? "";
  return command.split("@")[0] ?? command;
}

function formatJakartaTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
    year: "numeric",
  }).format(date);

  return `${formatted.replace(",", "").replace(" at ", " • ")} WIB`;
}

function formatNumber(value: unknown) {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || Number.isNaN(numeric)) return null;
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 2,
  }).format(numeric);
}

// Rasio LTS selalu berupa pecahan (1,5801 = 158,01%), sama seperti tampilan di web.
function formatRatioPercent(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value * 100)}%`;
}

function formatPercent(value: unknown) {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || Number.isNaN(numeric)) return null;
  const percent = Math.abs(numeric) <= 2 ? numeric * 100 : numeric;
  return `${new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(percent)}%`;
}

function periodLabelFromPeriodKey(periodKey: string | null | undefined) {
  if (!periodKey) return null;
  const match = periodKey.match(/^(\d{4})-?(\d{2})/);
  if (!match) return periodKey.toUpperCase();

  const year = Number(match[1]);
  const month = Number(match[2]);
  const monthName = MONTH_NAMES_ID[month - 1];
  if (!monthName || !year) return periodKey.toUpperCase();
  return `${monthName} ${year}`;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function payloadArray(payload: unknown): unknown[] {
  return Array.isArray(payload) ? payload : [];
}

function nestedPayloadRow(payload: unknown): Record<string, unknown> {
  const record = payloadRecord(payload);
  return payloadRecord(record.row);
}

function pickFirst(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function addMetric(metrics: ReportMetric[], label: string, value: string | null) {
  if (value) metrics.push({ label, value });
}

function telegramUserId(user: TelegramUser | undefined) {
  return user?.id === undefined ? null : String(user.id);
}

function productIcon(product: DashboardProduct) {
  if (product === "HSI") return "🏠";
  if (product === "WMS") return "📡";
  if (product === "LTS") return "📶";
  return "✨";
}

function productLabel(product: DashboardProduct) {
  return `${productIcon(product)} ${product}`;
}

const MENU_DIVIDER = "▬▬▬▬▬▬▬▬▬▬▬▬▬▬";

function mainMenuText() {
  return [
    "✨ <b>PRIME Bot</b>",
    "<i>Performance Reporting &amp; Monitoring</i>",
    MENU_DIVIDER,
    "",
    "👋 Selamat datang! Pantau performa dan update dashboard langsung dari Telegram.",
    "",
    "🏠 <b>HSI</b>   📡 <b>WMS</b>   📶 <b>LTS</b>   ✨ <b>MetaBright</b>",
    "",
    MENU_DIVIDER,
    "👇 <b>Pilih menu di bawah ini</b>",
  ].join("\n");
}

function mainMenuKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      // Aksi utama dibuat lebar penuh supaya paling menonjol, sisanya berpasangan 2 kolom.
      [{ callback_data: "menu:report", text: "📈  LIHAT REPORT  📈" }],
      [
        { callback_data: "menu:status", text: "📊 Status" },
        { callback_data: "menu:lastupdate", text: "🕒 Last Update" },
      ],
      [
        { callback_data: "menu:upload", text: "📤 Upload Data" },
        { callback_data: "menu:download", text: "📥 Unduh Excel" },
      ],
      [
        { callback_data: "menu:portal", text: "🌐 PRIME Portal" },
        { callback_data: "menu:myid", text: "🪪 My ID" },
      ],
    ],
  };
}

function helpKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ callback_data: "menu:home", text: "◀️ Menu Utama" }]],
  };
}

function statusKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ callback_data: "status:refresh", text: "🔄 Refresh Status" }],
      [{ callback_data: "menu:report", text: "📈 Lihat Report" }],
      [{ callback_data: "menu:home", text: "◀️ Menu Utama" }],
    ],
  };
}

function lastUpdateKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ callback_data: "menu:lastupdate", text: "🔄 Refresh" }],
      [{ callback_data: "menu:status", text: "📊 Status Dashboard" }],
      [{ callback_data: "menu:home", text: "◀️ Menu Utama" }],
    ],
  };
}

function portalKeyboard(baseUrl: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🚀 Open PRIME Portal", url: `${baseUrl}/portal` }],
      [{ callback_data: "menu:home", text: "◀️ Menu Utama" }],
    ],
  };
}

function myIdKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ callback_data: "menu:home", text: "◀️ Menu Utama" }]],
  };
}

// Upload dari web/bot menulis ke dashboard_state, sedangkan dashboard_records hanya terisi lewat halaman /migration.
// Keduanya dicek supaya status & last update selalu mengikuti data terbaru.
const STATE_KEY_BY_PRODUCT: Partial<Record<DashboardProduct, string>> = { HSI: "default", LTS: "lts", METABRIGHT: "metabright", WMS: "wms" };

async function stateUpdatedAt(product: DashboardProduct) {
  const key = STATE_KEY_BY_PRODUCT[product];
  if (!key) return null;
  const result = await dbGet<{ updated_at?: string | null }[]>(
    process.env.DASHBOARD_STATE_TABLE || "dashboard_state",
    `select=updated_at&key=eq.${encodeURIComponent(key)}&limit=1`,
  );
  if (result.error) throw new Error("STATE_STATUS_QUERY_FAILED");
  return result.data?.[0]?.updated_at ?? null;
}

async function hasProductData(product: DashboardProduct) {
  if (await stateUpdatedAt(product)) return true;
  const result = await dbGet<DashboardPresenceRow[]>("dashboard_records", `select=product&product=eq.${product}&limit=1`);
  if (result.error) throw new Error("PRODUCT_STATUS_QUERY_FAILED");
  return Boolean(result.data?.length);
}

function latestIso(values: (string | null | undefined)[]) {
  const times = values.filter((v): v is string => Boolean(v)).map((v) => ({ t: new Date(v).getTime(), v })).filter((x) => !Number.isNaN(x.t));
  return times.sort((a, b) => b.t - a.t)[0]?.v ?? null;
}

async function latestProductUpdateIso(product: DashboardProduct) {
  const result = await dbGet<ReportingImportRow[]>(
    "reporting_imports",
    `select=imported_at,updated_at&product=eq.${product}&row_count=gt.0&order=imported_at.desc&limit=1`,
  );
  if (result.error) throw new Error("PRODUCT_LAST_UPDATE_QUERY_FAILED");
  const latest = result.data?.[0];
  return latestIso([latest?.imported_at ?? latest?.updated_at, await stateUpdatedAt(product)]);
}

async function latestDataUpdate() {
  const all = await Promise.all(DASHBOARD_PRODUCTS.map((product) => latestProductUpdateIso(product)));
  return formatJakartaTimestamp(latestIso(all));
}

async function latestProductUpdate(product: DashboardProduct) {
  return formatJakartaTimestamp(await latestProductUpdateIso(product));
}

async function latestPeriodFor(product: DashboardProduct, datasetKind?: string) {
  const datasetFilter = datasetKind ? `&dataset_kind=eq.${datasetKind}` : "";
  const result = await dbGet<DashboardRecordRow[]>(
    "dashboard_records",
    `select=period_key&product=eq.${product}${datasetFilter}&period_key=not.is.null&order=period_key.desc&limit=1`,
  );
  if (result.error) throw new Error("LATEST_PERIOD_QUERY_FAILED");
  return result.data?.[0]?.period_key ?? null;
}

async function recordsFor(product: DashboardProduct, datasetKind: string, periodKey?: string | null, limit = 32) {
  const periodFilter = periodKey ? `&period_key=eq.${periodKey}` : "";
  const result = await dbGet<DashboardRecordRow[]>(
    "dashboard_records",
    `select=dataset_kind,period_key,payload,updated_at&product=eq.${product}&dataset_kind=eq.${datasetKind}${periodFilter}&limit=${limit}`,
  );
  if (result.error) throw new Error("DASHBOARD_RECORDS_QUERY_FAILED");
  return result.data ?? [];
}

async function dashboardStatePayload(key: string) {
  const result = await dbGet<DashboardStateRow[]>(
    process.env.DASHBOARD_STATE_TABLE || "dashboard_state",
    `select=payload,updated_at&key=eq.${encodeURIComponent(key)}&limit=1`,
  );
  if (result.error) throw new Error("DASHBOARD_STATE_QUERY_FAILED");
  return result.data?.[0]?.payload ?? null;
}

async function primeStatusText() {
  try {
    const statuses = await Promise.all(
      DASHBOARD_PRODUCTS.map(async (product) => ({
        product,
        available: await hasProductData(product),
      })),
    );
    const lastUpdate = await latestDataUpdate();
    const lines = [
      "📊 <b>PRIME Dashboard Status</b>",
      MENU_DIVIDER,
      "",
      ...statuses.map(({ available, product }) => `${available ? "🟢" : "🟡"}  <b>${productLabel(product)}</b>  ·  ${available ? "Data tersedia" : "Belum ada data"}`),
      "",
      MENU_DIVIDER,
      "🗄 <b>Database</b>  ·  🟢 Connected",
    ];

    if (lastUpdate) {
      lines.push("", `🕒 <b>Update terakhir</b>`, `<code>${escapeHtml(lastUpdate)}</code>`);
    }

    return lines.join("\n");
  } catch {
    return [
      "⚠️ <b>Data belum dapat dimuat</b>",
      "",
      "PRIME sedang mengalami kendala membaca data.",
      "Silakan coba kembali beberapa saat lagi.",
    ].join("\n");
  }
}

function reportMenuText() {
  return ["📈 <b>PRIME Performance Report</b>", MENU_DIVIDER, "", "Pilih modul yang ingin Anda lihat:"].join("\n");
}

function reportMenuKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { callback_data: "report:HSI", text: "🏠 HSI" },
        { callback_data: "report:WMS", text: "📡 WMS" },
      ],
      [
        { callback_data: "report:LTS", text: "📶 LTS" },
        { callback_data: "report:METABRIGHT", text: "✨ MetaBright" },
      ],
      [{ callback_data: "menu:home", text: "◀️ Menu Utama" }],
    ],
  };
}

function reportActionKeyboard(product: ReportProduct, baseUrl: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ callback_data: `report_refresh:${product}`, text: "🔄 Refresh" }],
      [{ callback_data: "menu:report", text: "📊 Pilih Modul Lain" }],
      [{ callback_data: "menu:home", text: "◀️ Menu Utama" }],
      [{ text: "🌐 Buka PRIME", url: `${baseUrl}/portal` }],
    ],
  };
}

async function buildHsiReportFromState(): Promise<ProductReport | null> {
  const latest = await loadLatestRows("HSI");
  if (!latest) return null;
  // Sama persis dengan dashboard web (tampilan default "ALL TELDA"): hitung dari baris MASTER, lalu
  // terapkan riwayat harian periode itu, dan pakai total TELDA (bukan total WITEL).
  const report = applyReportHistory(computeHsiReport(latest.rows, latest.savedAt, latest.periodKey), latest.reportHistory);
  const rkap = report.branch.total;
  const stf = report.targetStf.branch.total;
  const metrics: ReportMetric[] = [];
  addMetric(metrics, "Achievement RKAP", formatRatioPercent(rkap.targetAch));
  addMetric(metrics, "Achievement YTD", formatRatioPercent(rkap.achYtd));
  addMetric(metrics, "Shortage RKAP", formatNumber(rkap.shortageFm));
  addMetric(metrics, "Achievement STF", formatRatioPercent(stf.targetAch));
  addMetric(metrics, "Shortage STF", formatNumber(stf.shortageFm));
  const top = [...report.branch.rows].filter((r) => typeof r.targetAch === "number").sort((a, b) => Number(b.targetAch) - Number(a.targetAch))[0];
  if (top) addMetric(metrics, "Top TELDA", `${top.label} (${formatRatioPercent(top.targetAch)})`);
  return {
    available: true,
    lastUpdate: formatJakartaTimestamp(latest.savedAt) ?? undefined,
    metrics,
    periodLabel: report.periodLabel,
    product: "HSI",
    title: "HSI Report",
  };
}

async function buildHsiReport(): Promise<ProductReport> {
  const fromState = await buildHsiReportFromState().catch(() => null);
  if (fromState) return fromState;
  const periodKey = await latestPeriodFor("HSI", "computed_witel_rows_total");
  const [rkapRows, stfRows, branchRows, lastUpdate] = await Promise.all([
    recordsFor("HSI", "computed_witel_rows_total", periodKey, 1),
    recordsFor("HSI", "computed_stf_witel_rows_total", periodKey, 1),
    recordsFor("HSI", "computed_branch_rows", periodKey, 64),
    latestProductUpdate("HSI"),
  ]);

  const rkap = nestedPayloadRow(rkapRows[0]?.payload);
  const stf = nestedPayloadRow(stfRows[0]?.payload);
  const metrics: ReportMetric[] = [];

  addMetric(metrics, "Achievement RKAP", formatPercent(pickFirst(rkap, ["targetAch", "ach", "achievement"])));
  addMetric(metrics, "Achievement YTD", formatPercent(pickFirst(rkap, ["achYtd", "targetAchYtd"])));
  addMetric(metrics, "Shortage RKAP", formatNumber(pickFirst(rkap, ["shortageFm", "shortage", "shortageMtd"])));
  addMetric(metrics, "Achievement STF", formatPercent(pickFirst(stf, ["targetAch", "ach", "achievement"])));
  addMetric(metrics, "Shortage STF", formatNumber(pickFirst(stf, ["shortageFm", "shortage", "shortageMtd"])));

  const topTelda = branchRows
    .map((row) => nestedPayloadRow(row.payload))
    .map((row) => ({
      ach: pickFirst(row, ["targetAch", "ach", "achievement"]),
      name: String(pickFirst(row, ["label", "branch", "telda", "wilayah"]) ?? ""),
    }))
    .filter((row) => row.name && typeof row.ach === "number")
    .sort((a, b) => Number(b.ach) - Number(a.ach))[0];

  if (topTelda) addMetric(metrics, "Top TELDA", `${topTelda.name} (${formatPercent(topTelda.ach)})`);

  return {
    available: Boolean(periodKey && (rkapRows.length || stfRows.length || branchRows.length)),
    lastUpdate: lastUpdate ?? undefined,
    metrics,
    periodLabel: periodLabelFromPeriodKey(periodKey) ?? undefined,
    product: "HSI",
    title: "HSI Report",
  };
}

async function buildWmsReportFromState(): Promise<ProductReport | null> {
  const latest = await loadLatestRows("WMS");
  if (!latest) return null;
  const report = computeWmsReport(latest.rows as WmsMasterRow[], latest.periodKey);
  const total = report.witel.total;
  const top = [...report.telda.rows].filter((r) => typeof r.ach === "number").sort((a, b) => Number(b.ach) - Number(a.ach))[0];
  const metrics: ReportMetric[] = [];
  addMetric(metrics, "Target FM", formatNumber(total.targetFm));
  addMetric(metrics, "Realisasi MTD", formatNumber(total.mtd));
  addMetric(metrics, "Achievement FM", formatRatioPercent(total.ach));
  addMetric(metrics, "Shortage FM", formatNumber(total.shortageFm));
  addMetric(metrics, "Target YTD", formatNumber(total.targetYtd));
  addMetric(metrics, "Realisasi YTD", formatNumber(total.realYtd));
  addMetric(metrics, "Achievement YTD", formatRatioPercent(total.achYtd));
  addMetric(metrics, "Shortage YTD", formatNumber(total.shortageYtd));
  if (top) addMetric(metrics, "Top TELDA", `${top.label} (${formatRatioPercent(top.ach)})`);
  return {
    available: true,
    lastUpdate: formatJakartaTimestamp(latest.savedAt ?? report.latestUpdatedAt) ?? undefined,
    metrics,
    periodLabel: report.periodLabel,
    product: "WMS",
    title: "WMS Report",
  };
}

async function buildWmsReport(): Promise<ProductReport> {
  const fromState = await buildWmsReportFromState().catch(() => null);
  if (fromState) return fromState;
  const periodKey = await latestPeriodFor("WMS", "master_rows");
  const [rows, lastUpdate] = await Promise.all([
    recordsFor("WMS", "master_rows", null, 2000),
    latestProductUpdate("WMS"),
  ]);
  const masterRows = rows
    .map((row) => payloadArray(payloadRecord(row.payload).rawRow))
    .filter((row): row is WmsMasterRow => row.length > 0);
  const metrics: ReportMetric[] = [];

  if (masterRows.length && periodKey) {
    const report = computeWmsReport(masterRows, periodKey);
    const total = report.witel.total;
    const topTelda = [...report.telda.rows]
      .filter((row) => typeof row.ach === "number")
      .sort((a, b) => Number(b.ach) - Number(a.ach))[0];

    addMetric(metrics, "Target FM", formatNumber(total.targetFm));
    addMetric(metrics, "Realisasi MTD", formatNumber(total.mtd));
    addMetric(metrics, "Achievement FM", formatPercent(total.ach));
    addMetric(metrics, "Shortage FM", formatNumber(total.shortageFm));
    addMetric(metrics, "Target YTD", formatNumber(total.targetYtd));
    addMetric(metrics, "Realisasi YTD", formatNumber(total.realYtd));
    addMetric(metrics, "Achievement YTD", formatPercent(total.achYtd));
    addMetric(metrics, "Shortage YTD", formatNumber(total.shortageYtd));
    if (topTelda) addMetric(metrics, "Top TELDA", `${topTelda.label} (${formatPercent(topTelda.ach)})`);

    return {
      available: true,
      lastUpdate: formatJakartaTimestamp(report.latestUpdatedAt) ?? lastUpdate ?? undefined,
      metrics,
      periodLabel: report.periodLabel,
      product: "WMS",
      title: "WMS Report",
    };
  }

  return {
    available: rows.length > 0,
    lastUpdate: lastUpdate ?? undefined,
    metrics,
    note: "Data WMS tersedia, tetapi row master belum bisa dibaca untuk ringkasan report.",
    periodLabel: periodLabelFromPeriodKey(periodKey) ?? undefined,
    product: "WMS",
    title: "WMS Report",
  };
}

async function buildLtsReport(): Promise<ProductReport> {
  const periodKey = await latestPeriodFor("LTS");
  const [state, salesRows, capsRows, ct0Rows, lastUpdate] = await Promise.all([
    dashboardStatePayload("lts"),
    recordsFor("LTS", "sales", periodKey, 1),
    recordsFor("LTS", "caps", null, 1),
    recordsFor("LTS", "ct0", null, 1),
    latestProductUpdate("LTS"),
  ]);
  const stateRecord = payloadRecord(state);
  // State di server hanya menyimpan datasetArchive; dataset aktif diambil dari periode yang dipilih.
  const storedDatasets = payloadRecord(stateRecord.datasets);
  const archive = payloadRecord(stateRecord.datasetArchive);
  const selectedPeriodKey = typeof stateRecord.selectedPeriodKey === "string" ? stateRecord.selectedPeriodKey : null;
  const datasets = (
    Object.keys(storedDatasets).length > 0
      ? storedDatasets
      : Object.fromEntries(
          (["sales", "caps", "ct0"] as const).flatMap((datasetKey) => {
            const entry = selectedPeriodKey ? payloadRecord(archive[datasetKey])[selectedPeriodKey] : null;
            return entry ? [[datasetKey, entry]] : [];
          }),
        )
  ) as LtsReportSourceDatasets;
  const datasetLabels = [
    datasets.sales || salesRows.length ? "Sales" : null,
    datasets.caps || capsRows.length ? "CAPS" : null,
    datasets.ct0 || ct0Rows.length ? "CT0" : null,
  ].filter(Boolean);
  const metrics: ReportMetric[] = [];

  if (datasets.sales && datasets.caps && datasets.ct0) {
    const report = computeLtsReport("all", datasets);
    const total = report.witel.total;

    addMetric(metrics, "Sales", formatNumber(report.summary.sales));
    addMetric(metrics, "CT0", formatNumber(report.summary.ct0));
    addMetric(metrics, "CAPS", formatNumber(report.summary.caps));
    addMetric(metrics, "CT0/Sales", formatRatioPercent(total.ct0Ratio));
    addMetric(metrics, "CAPS/Sales", formatRatioPercent(total.capsRatio));
    addMetric(metrics, "Score", formatRatioPercent(report.summary.score));
    addMetric(metrics, "Churn", formatNumber(total.churn));
    addMetric(metrics, "Gap", formatNumber(total.gap));
    if (report.summary.bestWitel) {
      addMetric(metrics, "Best Witel", `${report.summary.bestWitel.label} (${formatRatioPercent(report.summary.bestWitel.score)})`);
    }
    if (report.summary.bestHotda) {
      addMetric(metrics, "Best HOTDA", `${report.summary.bestHotda.label} (${formatRatioPercent(report.summary.bestHotda.score)})`);
    }

    return {
      available: true,
      lastUpdate: lastUpdate ?? undefined,
      metrics,
      periodLabel: report.periodLabel,
      product: "LTS",
      title: "LTS Report",
    };
  }

  if (datasetLabels.length) addMetric(metrics, "Dataset", datasetLabels.join(", "));

  return {
    available: Boolean(periodKey && datasetLabels.length),
    lastUpdate: lastUpdate ?? undefined,
    metrics,
    note: "Data LTS tersedia, tetapi master lengkap belum bisa dibaca untuk ringkasan report.",
    periodLabel: periodLabelFromPeriodKey(periodKey) ?? undefined,
    product: "LTS",
    title: "LTS Report",
  };
}

type MetabrightStatePeriod = { rows?: { rank?: number; telda?: string; total?: number; witel?: string }[] };

async function buildMetabrightReport(): Promise<ProductReport> {
  const [available, lastUpdate, statePayload] = await Promise.all([
    hasProductData("METABRIGHT"),
    latestProductUpdate("METABRIGHT"),
    dashboardStatePayload("metabright").catch(() => null),
  ]);

  const state = payloadRecord(statePayload);
  const periods = payloadRecord(state.periods) as Record<string, MetabrightStatePeriod>;
  const currentLabel =
    typeof state.cur === "string" && periods[state.cur] ? state.cur : Object.keys(periods)[0];
  const rows = (currentLabel ? periods[currentLabel]?.rows : null) ?? [];
  const metrics: ReportMetric[] = [];

  if (rows.length > 0) {
    const ranked = [...rows].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
    const scores = rows.map((row) => Number(row.total ?? 0));
    const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    addMetric(metrics, "Jumlah Telda", formatNumber(rows.length));
    addMetric(metrics, "Rata-rata Skor", formatNumber(average));
    ranked.slice(0, 3).forEach((row, index) => {
      addMetric(metrics, `Peringkat ${index + 1}`, `${row.telda ?? "-"} (${row.witel ?? "-"}) - ${formatNumber(row.total) ?? "-"}`);
    });
  }

  return {
    available,
    lastUpdate: lastUpdate ?? undefined,
    metrics,
    note: available ? undefined : "Data METABRIGHT belum diupload lewat menu Upload Data di dashboard MetaBright.",
    periodLabel: currentLabel,
    product: "METABRIGHT",
    title: "METABRIGHT Report",
  };
}

async function buildProductReport(product: ReportProduct) {
  if (product === "HSI") return buildHsiReport();
  if (product === "WMS") return buildWmsReport();
  if (product === "LTS") return buildLtsReport();
  return buildMetabrightReport();
}

function productReportText(report: ProductReport) {
  if (!report.available) {
    return [
      `<b>${productLabel(report.product)}</b>`,
      "",
      "⚠️ Data belum tersedia untuk saat ini.",
      "",
      "Silakan cek kembali setelah data dashboard diperbarui.",
      report.lastUpdate ? ["", "🕒 <b>Last update</b>", escapeHtml(report.lastUpdate)].join("\n") : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const lines = [`${productIcon(report.product)} <b>${escapeHtml(report.product)} PERFORMANCE</b>`];

  if (report.periodLabel) {
    lines.push(escapeHtml(report.periodLabel));
  }

  if (report.metrics.length) {
    lines.push("", "━━━━━━━━━━━━━━", "");
    for (const metric of report.metrics) {
      lines.push(`${metricIcon(metric.label)} <b>${escapeHtml(metric.label)}</b>`, escapeHtml(metric.value), "");
    }
  }

  if (report.lastUpdate) {
    lines.push("━━━━━━━━━━━━━━", "", "🕒 <b>Last update</b>", escapeHtml(report.lastUpdate));
  }

  if (report.note) {
    lines.push("", escapeHtml(report.note));
  }

  return lines.join("\n").trimEnd();
}

function metricIcon(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("achievement") || normalized.includes("score")) return "🎯";
  if (normalized.includes("shortage") || normalized.includes("gap")) return "⚠️";
  if (normalized.includes("top") || normalized.includes("best")) return "🏆";
  if (normalized.includes("target")) return "📌";
  if (normalized.includes("realisasi") || normalized.includes("sales") || normalized.includes("ct0") || normalized.includes("caps")) return "📈";
  return "•";
}

async function lastUpdateText() {
  try {
    const updates = await Promise.all(
      DASHBOARD_PRODUCTS.map(async (product) => ({
        product,
        updatedAt: await latestProductUpdate(product),
      })),
    );

    const lines = ["🕒 <b>PRIME Last Update</b>", MENU_DIVIDER, ""];
    for (const item of updates) {
      lines.push(`${item.updatedAt ? "🟢" : "🟡"}  <b>${productLabel(item.product)}</b>`, item.updatedAt ? `└ <code>${escapeHtml(item.updatedAt)}</code>` : "└ Belum ada data", "");
    }

    return lines.join("\n").trimEnd();
  } catch {
    return [
      "⚠️ <b>Data belum dapat dimuat</b>",
      "",
      "PRIME sedang mengalami kendala membaca data.",
      "Silakan coba kembali beberapa saat lagi.",
    ].join("\n");
  }
}

function helpText() {
  return [
    "ℹ️ <b>Bantuan PRIME Bot</b>",
    MENU_DIVIDER,
    "",
    "Anda dapat menggunakan tombol menu untuk mengakses seluruh fitur PRIME.",
    "",
    "Jika ingin menggunakan command:",
    "/status",
    "/report",
    "/lastupdate",
    "/upload — cara upload data MASTER",
    "/download — unduh report Excel",
    "/portal",
    "/myid",
    "Lihat Telegram User ID Anda",
  ].join("\n");
}

function portalText() {
  return ["🌐 <b>PRIME Portal</b>", MENU_DIVIDER, "", "Buka dashboard PRIME melalui tombol di bawah."].join("\n");
}

function myIdText(userId: string | null) {
  return ["🪪 <b>Telegram User ID</b>", MENU_DIVIDER, "", userId ? `<code>${escapeHtml(userId)}</code>` : "ID tidak tersedia pada pesan ini.", "", "<i>Ketuk ID untuk menyalin.</i>"].join("\n");
}

function unknownCommandText() {
  return [
    "Menu belum dikenali.",
    "",
    "Pilih menu yang ingin dibuka.",
  ].join("\n");
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string, options: TelegramMessageOptions = {}) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    body: JSON.stringify({
      chat_id: chatId,
      disable_web_page_preview: true,
      parse_mode: "HTML",
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      text,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    return { error: await response.text(), ok: false };
  }

  return { ok: true };
}

async function editTelegramMessage(
  botToken: string,
  chatId: number,
  messageId: number,
  text: string,
  options: TelegramMessageOptions = {},
) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
    body: JSON.stringify({
      chat_id: chatId,
      disable_web_page_preview: true,
      message_id: messageId,
      parse_mode: "HTML",
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      text,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return response.ok;
}

async function sendOrEditTelegramMessage(
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  text: string,
  options: TelegramMessageOptions = {},
) {
  if (messageId) {
    const edited = await editTelegramMessage(botToken, chatId, messageId, text, options);
    if (edited) return;
  }
  await sendTelegramMessage(botToken, chatId, text, options);
}

async function showMainMenu(botToken: string, chatId: number, messageId?: number) {
  await sendOrEditTelegramMessage(botToken, chatId, messageId, mainMenuText(), {
    replyMarkup: mainMenuKeyboard(),
  });
}

async function answerCallbackQuery(botToken: string, callbackQueryId: string) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return response.ok;
}

function isReportProduct(value: string): value is ReportProduct {
  return REPORT_PRODUCTS.includes(value as ReportProduct);
}

const UPLOAD_PRODUCTS: ReportableProduct[] = ["HSI", "WMS"];

function uploadHelpText() {
  return [
    "📤 <b>Upload Data MASTER</b>",
    MENU_DIVIDER,
    "",
    "Kirim file <b>.xlsx / .xls / .csv</b> langsung ke chat ini sebagai <i>dokumen</i> (pakai ikon 📎 → File).",
    "",
    "Modul dikenali otomatis dari header kolom. Agar pasti, tulis <b>HSI</b>, <b>WMS</b>, <b>LTS</b>, atau <b>MetaBright</b> di caption (atau di nama file).",
    "Untuk <b>LTS</b>, kirim 3 file (SALES, CAPS, CT0); masing-masing dikenali dari header kolomnya.",
    "",
    "Setelah selesai, bot menyimpan data ke dashboard dan mengirim report Excel yang sudah diperbarui.",
    "",
    "Format kolom harus sama dengan upload MASTER di web. Maks. 20 MB.",
  ].join("\n");
}

function downloadMenuKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      UPLOAD_PRODUCTS.map((p) => ({ callback_data: `dl:${p}`, text: `${productIcon(p)} ${p}` })),
      [{ callback_data: "menu:home", text: "◀️ Menu Utama" }],
    ],
  };
}

function notAllowedText() {
  return [
    "⛔ <b>Akses upload ditolak</b>",
    "",
    "Akun Telegram Anda belum terdaftar sebagai pengunggah data.",
    "Kirim User ID Anda (lihat /myid) ke admin untuk didaftarkan.",
  ].join("\n");
}

async function sendReportFile(botToken: string, chatId: number, product: ReportableProduct, prefix = "") {
  const file = await buildReportFile(product);
  const caption = [
    prefix,
    `📈 <b>Report ${product}</b>`,
    `Periode: ${escapeHtml(file.periodLabel)}`,
    file.updatedAt ? `Update: ${escapeHtml(formatJakartaTimestamp(file.updatedAt) ?? "-")}` : "",
  ].filter(Boolean).join("\n");
  return sendTelegramDocument(botToken, chatId, file.filename, file.bytes, caption);
}

async function handleDocumentUpload(botToken: string, chatId: number, message: TelegramMessage) {
  const document = message.document!;
  const userId = telegramUserId(message.from);
  if (!isAllowedUploader(userId)) {
    await sendTelegramMessage(botToken, chatId, notAllowedText());
    return;
  }

  const fileName = document.file_name ?? "upload.xlsx";
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(fileName)) {
    await sendTelegramMessage(botToken, chatId, "⚠️ Format file harus <b>.xlsx, .xls, atau .csv</b>.");
    return;
  }

  await sendTelegramMessage(botToken, chatId, `⏳ Memproses <b>${escapeHtml(fileName)}</b>…`);
  try {
    const buffer = await downloadTelegramFile(botToken, document.file_id);
    const product = detectProduct(fileName, message.caption, buffer);
    if (!product) {
      await sendTelegramMessage(
        botToken,
        chatId,
        "⚠️ Modul tidak dikenali. Kirim ulang file dengan caption <b>HSI</b>, <b>WMS</b>, <b>LTS</b>, atau <b>MetaBright</b>.",
      );
      return;
    }
    if (product === "METABRIGHT") {
      const mb = await importMetabright(buffer, fileName, message.caption);
      await sendTelegramMessage(
        botToken,
        chatId,
        `✅ <b>Upload MetaBright berhasil</b>: ${escapeHtml(mb.label)} (${mb.telda.toLocaleString("id-ID")} telda, ${mb.indicators} indikator).${mb.warn ? `\n⚠️ ${escapeHtml(mb.warn)}` : ""}`,
      );
      return;
    }
    if (product === "LTS") {
      const lts = await importLtsDataset(buffer, fileName);
      await sendTelegramMessage(
        botToken,
        chatId,
        `✅ <b>Upload LTS berhasil</b>: ${escapeHtml(lts.label)}, periode ${escapeHtml(lts.periodKey)} (${lts.rowCount.toLocaleString("id-ID")} baris).\nReport LTS di web tampil setelah ketiga master (SALES, CAPS, CT0) periode yang sama terupload.`,
      );
      return;
    }
    const rows = parseMasterRows(product, buffer);
    const summary = await importMaster(product, rows);
    const periods = summary.periods.map((p) => `${escapeHtml(p.label)} (${p.rows.toLocaleString("id-ID")} baris)`).join(", ");
    const sent = await sendReportFile(botToken, chatId, product, `✅ <b>Upload ${product} berhasil</b>: ${periods}\n`);
    if (!sent.ok) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `✅ Data ${product} tersimpan (${periods}), tetapi file report gagal dikirim. Coba /download.`,
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Terjadi kesalahan.";
    await sendTelegramMessage(botToken, chatId, `❌ <b>Upload gagal</b>\n${escapeHtml(reason)}`);
  }
}

async function handleDownload(botToken: string, chatId: number, product: ReportableProduct) {
  try {
    const sent = await sendReportFile(botToken, chatId, product);
    if (!sent.ok) await sendTelegramMessage(botToken, chatId, "❌ File report gagal dikirim. Coba lagi sebentar.");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Terjadi kesalahan.";
    await sendTelegramMessage(botToken, chatId, `❌ <b>Report ${product} belum bisa dibuat</b>\n${escapeHtml(reason)}`);
  }
}

async function handleCallbackQuery(botToken: string, callbackQuery: TelegramCallbackQuery, baseUrl: string) {
  await answerCallbackQuery(botToken, callbackQuery.id);

  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const data = callbackQuery.data ?? "";
  const userId = telegramUserId(callbackQuery.from);
  if (!chatId) return;

  if (data === "menu:home") {
    await showMainMenu(botToken, chatId, messageId);
    return;
  }

  if (data === "menu:myid") {
    await sendOrEditTelegramMessage(botToken, chatId, messageId, myIdText(userId), {
      replyMarkup: myIdKeyboard(),
    });
    return;
  }

  if (data === "menu:status" || data === "status:refresh") {
    await sendOrEditTelegramMessage(botToken, chatId, messageId, await primeStatusText(), {
      replyMarkup: statusKeyboard(),
    });
    return;
  }

  if (data === "menu:report" || data === "report_menu") {
    await sendOrEditTelegramMessage(botToken, chatId, messageId, reportMenuText(), {
      replyMarkup: reportMenuKeyboard(),
    });
    return;
  }

  if (data === "menu:lastupdate") {
    await sendOrEditTelegramMessage(botToken, chatId, messageId, await lastUpdateText(), {
      replyMarkup: lastUpdateKeyboard(),
    });
    return;
  }

  if (data === "menu:upload") {
    await sendOrEditTelegramMessage(botToken, chatId, messageId, uploadHelpText(), { replyMarkup: helpKeyboard() });
    return;
  }

  if (data === "menu:download") {
    await sendOrEditTelegramMessage(botToken, chatId, messageId, `📥 <b>Unduh Report Excel</b>\n${MENU_DIVIDER}\n\nPilih modul:`, {
      replyMarkup: downloadMenuKeyboard(),
    });
    return;
  }

  if (data.startsWith("dl:")) {
    const product = data.slice(3) as ReportableProduct;
    if (UPLOAD_PRODUCTS.includes(product)) await handleDownload(botToken, chatId, product);
    return;
  }

  if (data === "menu:portal") {
    await sendOrEditTelegramMessage(botToken, chatId, messageId, portalText(), {
      replyMarkup: portalKeyboard(baseUrl),
    });
    return;
  }

  const [action, productValue] = data.split(":");
  if ((action !== "report" && action !== "report_refresh") || !productValue || !isReportProduct(productValue)) return;

  try {
    const report = await buildProductReport(productValue);
    const text = productReportText(report);
    await sendOrEditTelegramMessage(botToken, chatId, messageId, text, {
      replyMarkup: reportActionKeyboard(productValue, baseUrl),
    });
  } catch {
    const text = [
      `⚠️ <b>${escapeHtml(productValue)} Report belum dapat dimuat</b>`,
      "",
      "PRIME sedang mengalami kendala membaca data.",
      "Silakan coba kembali beberapa saat lagi.",
    ].join("\n");
    await sendOrEditTelegramMessage(botToken, chatId, messageId, text, {
      replyMarkup: reportActionKeyboard(productValue, baseUrl),
    });
  }
}

function isTelegramUpdate(value: unknown): value is TelegramUpdate {
  return Boolean(value && typeof value === "object");
}

export async function GET() {
  const { botToken, webhookSecret } = telegramConfig();
  return NextResponse.json({
    configured: Boolean(botToken && webhookSecret),
    ok: true,
    service: "telegram-webhook",
  });
}

export async function POST(request: NextRequest) {
  const { botToken, webhookSecret } = telegramConfig();

  if (!botToken || !webhookSecret) {
    return NextResponse.json({ error: "Telegram env belum lengkap." }, { status: 500 });
  }

  const requestSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (requestSecret !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!isTelegramUpdate(payload)) {
    return NextResponse.json({ error: "Invalid Telegram update." }, { status: 400 });
  }

  if (payload.callback_query) {
    await handleCallbackQuery(botToken, payload.callback_query, portalUrlFromOrigin(request.nextUrl.origin));
    return NextResponse.json({ ok: true });
  }

  const message = payload.message;
  const chatId = message?.chat?.id;
  const text = message?.text?.trim();
  const userId = telegramUserId(message?.from);

  if (!chatId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (message?.document) {
    await handleDocumentUpload(botToken, chatId, message);
    return NextResponse.json({ ok: true });
  }

  if (!text) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const command = normalizeTelegramCommand(text);
  if (command === "/start") {
    const result = await sendTelegramMessage(botToken, chatId, mainMenuText(), { replyMarkup: mainMenuKeyboard() });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  if (command === "/help") {
    const result = await sendTelegramMessage(botToken, chatId, helpText(), { replyMarkup: helpKeyboard() });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  if (command === "/myid") {
    const result = await sendTelegramMessage(botToken, chatId, myIdText(userId), { replyMarkup: myIdKeyboard() });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  if (command === "/report") {
    const result = await sendTelegramMessage(botToken, chatId, reportMenuText(), { replyMarkup: reportMenuKeyboard() });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  if (command === "/status") {
    const result = await sendTelegramMessage(botToken, chatId, await primeStatusText(), { replyMarkup: statusKeyboard() });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  if (command === "/lastupdate") {
    const result = await sendTelegramMessage(botToken, chatId, await lastUpdateText(), { replyMarkup: lastUpdateKeyboard() });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  if (command === "/upload") {
    await sendTelegramMessage(botToken, chatId, uploadHelpText(), { replyMarkup: helpKeyboard() });
    return NextResponse.json({ ok: true });
  }

  if (command === "/download") {
    await sendTelegramMessage(botToken, chatId, "📥 <b>Unduh Report Excel</b>\n\nPilih modul:", {
      replyMarkup: downloadMenuKeyboard(),
    });
    return NextResponse.json({ ok: true });
  }

  if (command === "/portal") {
    const result = await sendTelegramMessage(botToken, chatId, portalText(), { replyMarkup: portalKeyboard(portalUrl(request)) });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  const result = await sendTelegramMessage(botToken, chatId, unknownCommandText(), { replyMarkup: mainMenuKeyboard() });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
