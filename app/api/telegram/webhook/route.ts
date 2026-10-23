import { NextRequest, NextResponse } from "next/server";
import { dbGet } from "@/features/shared/backend/database/db";
import { computeLtsReport, type LtsReportSourceDatasets } from "@/features/lts/domain/reporting/reporting";
import {
  computeWmsReport,
  type MasterRow as WmsMasterRow,
} from "@/features/wms/domain/reporting/reporting";

import {
  detectProduct,
  importMaster,
  isAllowedUploader,
  loadLatestRows,
  parseMasterRows,
} from "@/features/telegram/master-upload";
import {
  claimLtsReport,
  detectLtsDataset,
  importLtsDataset,
  ltsDatasetLabel,
  registerLtsUpload,
  LTS_BATCH_WINDOW_MINUTES,
  LTS_DATASET_KEYS,
  parseLtsDataset,
} from "@/features/telegram/lts-upload";
import {
  hasMetabrightHint,
  importMetabright,
  parseMetabrightFile,
  tryParseMetabrightFile,
} from "@/features/telegram/metabright-upload";
import { buildCabutanWorkbook, isCabutanCaption, isCabutanFile } from "@/features/telegram/cabutan";
import { lastCabutanMeta, loadLastCabutanCsv, saveLastCabutan, type CabutanMeta } from "@/features/telegram/cabutan-store";
import { downloadTelegramFile, sendTelegramDocument } from "@/features/telegram/telegram-api";
import {
  buildMetabrightFiles,
  buildReportExcel,
  buildReportImages,
  listMetabrightWitels,
  loadMetabrightReportData,
  type MetabrightContent,
  type MetabrightScope,
  REPORT_DOWNLOAD_PRODUCTS,
  type ReportProductKey,
} from "@/features/telegram/report-files";
import { computeReport as computeHsiReport } from "@/features/hsi/domain/reporting/reporting";

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
  reply_to_message?: TelegramMessage;
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
  /** Balas pesan ini, sehingga tombol yang ditekan nanti bisa mengambil kembali file aslinya lewat reply_to_message. */
  replyToMessageId?: number;
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

const DIVIDER = "━━━━━━━━━━━━━━━━━━";
// Garis pemisah dengan jarak di atas dan bawahnya.
const SECTION = `\n${DIVIDER}\n`;

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

// Perintah boleh diketik dengan atau tanpa "/" dan huruf besar/kecil, mis. "start", "/Start", "Menu", "last update".
const COMMAND_ALIASES: Record<string, string> = {
  bantuan: "/help",
  cabutan: "/cabutan",
  datacabutan: "/cabutan",
  download: "/download",
  halo: "/start",
  hai: "/start",
  hello: "/start",
  help: "/help",
  hi: "/start",
  id: "/myid",
  laporan: "/report",
  lastupdate: "/lastupdate",
  menu: "/start",
  mulai: "/start",
  myid: "/myid",
  portal: "/portal",
  report: "/report",
  start: "/start",
  status: "/status",
  unduh: "/download",
  update: "/lastupdate",
  upload: "/upload",
};

function normalizeTelegramCommand(text: string) {
  const whole = text.trim().toLowerCase().replace(/^\//, "").replace(/[\s_\-]+/g, "").replace(/[.!?,]+$/, "");
  if (COMMAND_ALIASES[whole]) return COMMAND_ALIASES[whole];
  const first = (text.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[.!?,]+$/, "");
  const name = (first.startsWith("/") ? first.slice(1) : first).split("@")[0] ?? "";
  return COMMAND_ALIASES[name] ?? (first.startsWith("/") ? `/${name}` : first);
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

function mainMenuText(name?: string | null) {
  const greeting = name ? `👋 <b>Halo, ${escapeHtml(name)}!</b>` : "👋 <b>Halo!</b>";
  return [
    greeting,
    "",
    "Selamat datang di <b>PRIME Bot</b>",
    "<i>PRQ Reporting, Integration, Monitoring &amp; Evaluation</i>",
    SECTION,
    "<b>Modul</b>",
    "",
    "🏠 HSI   •   📡 WMS   •   📶 LTS   •   ✨ MetaBright",
    "",
    "",
    "<b>Layanan</b>",
    "",
    "📊 Status dan waktu update data",
    "",
    "📈 Ringkasan performa tiap modul",
    "",
    "📥 Unduh report (Excel / PNG)",
    "",
    "📤 Upload data MASTER",
    "",
    "🗂️ Data Cabutan (CSV → DO_Bulan.xlsx)",
    SECTION,
    "Silakan pilih menu di bawah 👇",
  ].join("\n");
}

function mainMenuKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { callback_data: "menu:status", text: "📊 Status" },
        { callback_data: "menu:lastupdate", text: "🕒 Last Update" },
      ],
      [
        { callback_data: "menu:report", text: "📈 Lihat Report" },
        { callback_data: "menu:download", text: "📥 Unduh Report" },
      ],
      [
        { callback_data: "menu:upload", text: "📤 Upload Data" },
        { callback_data: "menu:cabutan", text: "🗂️ Data Cabutan" },
      ],
      [
        { callback_data: "menu:portal", text: "🌐 PRIME Portal" },
        { callback_data: "menu:myid", text: "🪪 My ID" },
      ],
      [{ callback_data: "menu:help", text: "ℹ️ Bantuan" }],
    ],
  };
}

function helpKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ callback_data: "menu:home", text: "🏠 Menu Utama" }]],
  };
}

function statusKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ callback_data: "status:refresh", text: "🔄 Refresh Status" }],
      [{ callback_data: "menu:report", text: "📈 Lihat Report" }],
      [{ callback_data: "menu:home", text: "🏠 Menu Utama" }],
    ],
  };
}

function lastUpdateKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ callback_data: "menu:lastupdate", text: "🔄 Refresh" }],
      [{ callback_data: "menu:status", text: "📊 Status Dashboard" }],
      [{ callback_data: "menu:home", text: "🏠 Menu Utama" }],
    ],
  };
}

function portalKeyboard(baseUrl: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🚀 Open PRIME Portal", url: `${baseUrl}/portal` }],
      [{ callback_data: "menu:home", text: "🏠 Menu Utama" }],
    ],
  };
}

function myIdKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ callback_data: "menu:home", text: "🏠 Menu Utama" }]],
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
      "📊 <b>Status Dashboard PRIME</b>",
      SECTION,
      ...statuses.flatMap(({ available, product }) => [
        `<b>${productLabel(product)}</b>`,
        available ? "✅ Data tersedia" : "⚠️ Belum ada data",
        "",
      ]),
      DIVIDER,
      "",
      "🗄 <b>Database</b>",
      "✅ Terhubung",
    ];

    if (lastUpdate) {
      lines.push("", "🕒 <b>Update terakhir</b>", escapeHtml(lastUpdate));
    }

    return lines.join("\n");
  } catch {
    return dataUnavailableText();
  }
}

function dataUnavailableText() {
  return [
    "⚠️ <b>Data belum dapat dimuat</b>",
    "",
    "PRIME sedang mengalami kendala saat membaca data.",
    "Silakan coba lagi beberapa saat lagi.",
  ].join("\n");
}

function reportMenuText() {
  return ["📈 <b>Report Performa PRIME</b>", SECTION, "Pilih modul yang ingin dilihat:"].join("\n");
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
      [{ callback_data: "menu:home", text: "🏠 Menu Utama" }],
    ],
  };
}

function reportActionKeyboard(product: ReportProduct, baseUrl: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { callback_data: `report_refresh:${product}`, text: "🔄 Refresh" },
        { callback_data: `dl:${product}`, text: "📥 Unduh Report" },
      ],
      [{ callback_data: "menu:report", text: "📊 Pilih Modul Lain" }],
      [{ callback_data: "menu:home", text: "🏠 Menu Utama" }],
      [{ text: "🌐 Buka PRIME", url: `${baseUrl}/portal` }],
    ],
  };
}

async function buildHsiReportFromState(): Promise<ProductReport | null> {
  const latest = await loadLatestRows("HSI");
  if (!latest) return null;
  const report = computeHsiReport(latest.rows, latest.savedAt, latest.periodKey);
  const rkap = report.witel.total;
  const stf = report.targetStf.witel.total;
  const metrics: ReportMetric[] = [];
  addMetric(metrics, "Achievement RKAP", formatPercent(rkap.targetAch));
  addMetric(metrics, "Achievement YTD", formatPercent(rkap.achYtd));
  addMetric(metrics, "Shortage RKAP", formatNumber(rkap.shortageFm));
  addMetric(metrics, "Achievement STF", formatPercent(stf.targetAch));
  addMetric(metrics, "Shortage STF", formatNumber(stf.shortageFm));
  const top = [...report.branch.rows].filter((r) => typeof r.targetAch === "number").sort((a, b) => Number(b.targetAch) - Number(a.targetAch))[0];
  if (top) addMetric(metrics, "Top TELDA", `${top.label} (${formatPercent(top.targetAch)})`);
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
  addMetric(metrics, "Achievement FM", formatPercent(total.ach));
  addMetric(metrics, "Shortage FM", formatNumber(total.shortageFm));
  addMetric(metrics, "Target YTD", formatNumber(total.targetYtd));
  addMetric(metrics, "Realisasi YTD", formatNumber(total.realYtd));
  addMetric(metrics, "Achievement YTD", formatPercent(total.achYtd));
  addMetric(metrics, "Shortage YTD", formatNumber(total.shortageYtd));
  if (top) addMetric(metrics, "Top TELDA", `${top.label} (${formatPercent(top.ach)})`);
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

// Dataset LTS aktif dari state dashboard (dipakai ringkasan report dan unduhan gambar/Excel).
function ltsDatasetsFromState(state: unknown): LtsReportSourceDatasets {
  const stateRecord = payloadRecord(state);
  // State di server hanya menyimpan datasetArchive; dataset aktif diambil dari periode yang dipilih.
  const storedDatasets = payloadRecord(stateRecord.datasets);
  const archive = payloadRecord(stateRecord.datasetArchive);
  const selectedPeriodKey = typeof stateRecord.selectedPeriodKey === "string" ? stateRecord.selectedPeriodKey : null;
  return (
    Object.keys(storedDatasets).length > 0
      ? storedDatasets
      : Object.fromEntries(
          (["sales", "caps", "ct0"] as const).flatMap((datasetKey) => {
            const entry = selectedPeriodKey ? payloadRecord(archive[datasetKey])[selectedPeriodKey] : null;
            return entry ? [[datasetKey, entry]] : [];
          }),
        )
  ) as LtsReportSourceDatasets;
}

async function loadLtsDatasetsForReport(): Promise<LtsReportSourceDatasets> {
  return ltsDatasetsFromState(await dashboardStatePayload("lts"));
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
  const datasets = ltsDatasetsFromState(state);
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
    addMetric(metrics, "CT0/Sales", formatNumber(total.ct0Ratio));
    addMetric(metrics, "CAPS/Sales", formatNumber(total.capsRatio));
    addMetric(metrics, "Score", formatNumber(report.summary.score));
    addMetric(metrics, "Churn", formatNumber(total.churn));
    addMetric(metrics, "Gap", formatNumber(total.gap));
    if (report.summary.bestWitel) {
      addMetric(metrics, "Best Witel", `${report.summary.bestWitel.label} (${formatNumber(report.summary.bestWitel.score)})`);
    }
    if (report.summary.bestHotda) {
      addMetric(metrics, "Best HOTDA", `${report.summary.bestHotda.label} (${formatNumber(report.summary.bestHotda.score)})`);
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

async function buildMetabrightReport(): Promise<ProductReport> {
  try {
    const mb = await loadMetabrightReportData();
    const rows = [...mb.data.rows].sort((a, b) => b.total - a.total);
    const metrics: ReportMetric[] = [];
    if (rows.length) {
      const average = rows.reduce((sum, r) => sum + r.total, 0) / rows.length;
      addMetric(metrics, "Telda dianalisis", String(rows.length));
      addMetric(metrics, "Rata-rata total score", formatNumber(Math.round(average * 100) / 100));
      addMetric(metrics, "Skor tertinggi", `${rows[0].telda} (${formatNumber(rows[0].total)})`);
      addMetric(metrics, "Skor terendah", `${rows[rows.length - 1].telda} (${formatNumber(rows[rows.length - 1].total)})`);
    }
    return {
      available: rows.length > 0,
      lastUpdate: (mb.updatedAt ? formatJakartaTimestamp(mb.updatedAt) : null) ?? undefined,
      metrics,
      note: mb.fromDatabase ? undefined : "Menampilkan data bawaan aplikasi (belum ada data MetaBright yang diupload di web).",
      periodLabel: mb.label,
      product: "METABRIGHT",
      title: "METABRIGHT Report",
    };
  } catch (error) {
    return {
      available: false,
      metrics: [],
      note: error instanceof Error ? error.message : "Data METABRIGHT belum tersedia.",
      product: "METABRIGHT",
      title: "METABRIGHT Report",
    };
  }
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
      `${productIcon(report.product)} <b>${escapeHtml(report.product)} PERFORMANCE</b>`,
      SECTION,
      "⚠️ <b>Data belum tersedia</b>",
      "",
      "Silakan cek kembali setelah data dashboard diperbarui.",
      report.lastUpdate ? `\n🕒 <b>Update terakhir</b>\n${escapeHtml(report.lastUpdate)}` : "",
    ]
      .filter((line, index, all) => line !== "" || all[index - 1] !== "")
      .join("\n")
      .trimEnd();
  }

  const lines = [`${productIcon(report.product)} <b>${escapeHtml(report.product)} PERFORMANCE</b>`];
  if (report.periodLabel) lines.push("", `📅 ${escapeHtml(report.periodLabel)}`);

  if (report.metrics.length) {
    lines.push(SECTION);
    report.metrics.forEach((metric, index) => {
      if (index > 0) lines.push("");
      lines.push(`${metricIcon(metric.label)} ${escapeHtml(metric.label)}:  <b>${escapeHtml(metric.value)}</b>`);
    });
  }

  lines.push(SECTION);
  if (report.lastUpdate) lines.push(`🕒 <b>Update terakhir</b>`, escapeHtml(report.lastUpdate));
  if (report.note) lines.push("", `ℹ️ <i>${escapeHtml(report.note)}</i>`);

  return lines.join("\n").trimEnd();
}

function metricIcon(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("achievement") || normalized.includes("score")) return "🎯";
  if (normalized.includes("shortage") || normalized.includes("gap")) return "⚠️";
  if (normalized.includes("top") || normalized.includes("best")) return "🏆";
  if (normalized.includes("target")) return "📌";
  if (normalized.includes("realisasi") || normalized.includes("sales") || normalized.includes("ct0") || normalized.includes("caps")) return "📈";
  return "🔹";
}

async function lastUpdateText() {
  try {
    const updates = await Promise.all(
      DASHBOARD_PRODUCTS.map(async (product) => ({
        product,
        updatedAt: await latestProductUpdate(product),
      })),
    );

    const lines = ["🕒 <b>Update Terakhir Data PRIME</b>", SECTION];
    for (const item of updates) {
      lines.push(`<b>${productLabel(item.product)}</b>`, item.updatedAt ? escapeHtml(item.updatedAt) : "⚠️ Belum ada data", "");
    }

    return lines.join("\n").trimEnd();
  } catch {
    return dataUnavailableText();
  }
}

function helpText() {
  return [
    "ℹ️ <b>Bantuan PRIME Bot</b>",
    SECTION,
    "Gunakan tombol menu untuk mengakses semua fitur. Perintah juga bisa diketik <b>dengan atau tanpa “/”</b>, misalnya <code>start</code> atau <code>/start</code>.",
    SECTION,
    "<b>Daftar perintah</b>",
    "",
    "▫️ <code>start</code> — buka menu utama",
    "",
    "▫️ <code>status</code> — status data tiap modul",
    "",
    "▫️ <code>report</code> — ringkasan performa",
    "",
    "▫️ <code>lastupdate</code> — waktu update terakhir",
    "",
    "▫️ <code>download</code> — unduh report (Excel / PNG)",
    "",
    "▫️ <code>upload</code> — panduan upload data MASTER",
    "",
    "▫️ <code>cabutan</code> — ubah CSV T_NAL menjadi DO_Bulan.xlsx",
    "",
    "▫️ <code>portal</code> — buka PRIME Portal",
    "",
    "▫️ <code>myid</code> — lihat Telegram User ID Anda",
  ].join("\n");
}

function portalText() {
  return ["🌐 <b>PRIME Portal</b>", SECTION, "Buka dashboard PRIME melalui tombol di bawah."].join("\n");
}

function myIdText(userId: string | null) {
  return [
    "🪪 <b>Telegram User ID</b>",
    SECTION,
    userId ? `<code>${escapeHtml(userId)}</code>` : "ID tidak tersedia pada pesan ini.",
    "",
    "<i>Berikan ID ini kepada admin bila Anda perlu didaftarkan sebagai pengunggah data.</i>",
  ].join("\n");
}

function unknownCommandText() {
  return [
    "🤔 <b>Perintah belum dikenali</b>",
    "",
    "Ketik <code>start</code> untuk membuka menu utama atau <code>help</code> untuk melihat daftar perintah.",
    "",
    "Atau pilih menu di bawah 👇",
  ].join("\n");
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string, options: TelegramMessageOptions = {}) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    body: JSON.stringify({
      chat_id: chatId,
      disable_web_page_preview: true,
      parse_mode: "HTML",
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      ...(options.replyToMessageId ? { reply_parameters: { allow_sending_without_reply: true, message_id: options.replyToMessageId } } : {}),
      text,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    return { error: await response.text(), ok: false as const };
  }

  const body = (await response.json().catch(() => null)) as { result?: { message_id?: number } } | null;
  return { messageId: body?.result?.message_id, ok: true as const };
}

// Hapus pesan status sementara ("Menyiapkan…") agar chat tetap rapi. Gagal menghapus tidak apa-apa.
async function deleteTelegramMessage(botToken: string, chatId: number, messageId: number | undefined) {
  if (!messageId) return;
  await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }).catch(() => undefined);
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

async function showMainMenu(botToken: string, chatId: number, messageId?: number, name?: string | null) {
  await sendOrEditTelegramMessage(botToken, chatId, messageId, mainMenuText(name), {
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


function uploadHelpText() {
  return [
    "📤 <b>Upload Data MASTER</b>",
    SECTION,
    "Kirim file <b>.xlsx / .xls / .csv</b> ke chat ini sebagai <i>dokumen</i> (ikon 📎 → File).",
    "",
    "Maksimal 20 MB, dengan format kolom sama seperti upload MASTER di web.",
    SECTION,
    "🏠 <b>HSI</b> dan 📡 <b>WMS</b>",
    "",
    "Modul dikenali otomatis dari isi file. Agar pasti, tulis <b>HSI</b> atau <b>WMS</b> di caption.",
    "",
    "",
    "📶 <b>LTS</b>  —  wajib 3 file",
    "",
    "▫️ <b>ps</b> → Sales",
    "▫️ <b>nal</b> → CAPS",
    "▫️ <b>reg</b> → CT0",
    "",
    `Kirim ketiganya dalam satu rangkaian (boleh sekaligus, jeda antar file maks. ${LTS_BATCH_WINDOW_MINUTES} menit). Selama belum lengkap, bot menunggu file yang tersisa. Report dikirim otomatis setelah ketiganya diterima.`,
    "",
    "",
    "✨ <b>MetaBright</b>",
    "",
    "Kirim file <b>Impactful Award Telda</b> (.xls / .xlsx), mis. <i>Impactful Award Telda - 202610.xls</i>. Periode diambil dari nama file; data periode yang sama akan diperbarui.",
    SECTION,
    "Setelah selesai, bot menyimpan data ke dashboard dan mengirim report (PNG) terbaru.",
  ].join("\n");
}

function cabutanMenuText(last: CabutanMeta | null) {
  const lines = [
    "🗂️ <b>Data Cabutan</b>",
    SECTION,
    "Ubah file CSV <b>T_NAL Full Data</b> menjadi <b>DO_&lt;Bulan&gt;.xlsx</b> (mis. <i>DO_Oktober.xlsx</i>).",
    "",
    "<b>Cara pakai</b>",
    "",
    `1️⃣ Kirim file <b>.csv</b> ke chat ini sebagai <i>dokumen</i> (ikon 📎 → File) dengan caption <b>cabutan</b>, <b>data cabutan</b>, atau <b>y</b>.`,
    "",
    "2️⃣ Bot membalas dengan file Excel berisi:",
    "▫️ <b>Sheet1</b> — pivot Sum of SSL_DO per Witel × Divisi",
    "▫️ <b>T_NAL_Full Data_data (2)</b> — seluruh data CSV",
    SECTION,
    "⚠️ <b>Beri caption</b> saat mengirim CSV: <code>cabutan</code>, <code>data cabutan</code>, atau <code>y</code>.",
    "<i>Tanpa caption, bot akan bertanya lewat tombol: Data Cabutan atau CAPS (NAL) LTS. Caption <b>lts</b> langsung diproses sebagai LTS.</i>",
    SECTION,
  ];
  if (last) {
    const when = formatJakartaTimestamp(last.uploadedAt);
    lines.push(
      "📌 <b>Upload terakhir</b>",
      "",
      `📄 ${escapeHtml(last.fileName)}`,
      "",
      `📅 Periode ${escapeHtml(last.periods.join(", "))}  •  ${last.rowCount.toLocaleString("id-ID")} baris`,
      ...(when ? ["", `🕒 ${escapeHtml(when)}${last.uploadedBy ? `  •  ${escapeHtml(last.uploadedBy)}` : ""}`] : []),
      "",
      "Tekan <b>Unduh Data Cabutan</b> untuk mengambil file Excel dari data ini.",
    );
  } else {
    lines.push("📌 Belum ada data cabutan yang diupload.", "", "Kirim file CSV untuk memulai.");
  }
  return lines.join("\n");
}

function cabutanMenuKeyboard(last: CabutanMeta | null): TelegramInlineKeyboardMarkup {
  const rows: TelegramInlineKeyboardButton[][] = [];
  if (last) rows.push([{ callback_data: "cabutan:dl", text: "📥 Unduh Data Cabutan" }]);
  rows.push(homeRow);
  return { inline_keyboard: rows };
}

async function lastCabutanSafe() {
  try {
    return await lastCabutanMeta();
  } catch {
    return null;
  }
}

function cabutanKeyboard(): TelegramInlineKeyboardMarkup {
  return { inline_keyboard: [[{ callback_data: "menu:cabutan", text: "🗂️ Menu Data Cabutan" }], homeRow] };
}

// Buat DO_<Bulan>.xlsx dari CSV dan kirim ke chat. `note` = baris tambahan di bawah caption.
async function sendCabutanFile(botToken: string, chatId: number, csv: Buffer, note?: string) {
  const result = await buildCabutanWorkbook(csv);
  const caption = [
    `🗂️ <b>${escapeHtml(result.filename)}</b>`,
    SECTION,
    `📅 <b>Periode</b>  •  ${escapeHtml(result.periods.join(", "))}`,
    "",
    `📄 <b>Jumlah baris</b>  •  ${result.rowCount.toLocaleString("id-ID")}`,
    "",
    `📉 <b>Total cabutan (SSL_DO)</b>  •  ${result.cabutan.toLocaleString("id-ID")}`,
    "",
    `📍 <b>Jumlah witel</b>  •  ${result.witelCount}`,
    SECTION,
    ...(note ? [note, ""] : []),
    "<i>Sheet1 = pivot Sum of SSL_DO per Witel × Divisi</i>",
  ].join("\n");
  const sent = await sendTelegramDocument(botToken, chatId, result.filename, result.bytes, caption, undefined, cabutanKeyboard());
  return { result, sent };
}

async function handleCabutanDownload(botToken: string, chatId: number) {
  const working = await sendTelegramMessage(botToken, chatId, "⏳ <b>Menyiapkan Data Cabutan…</b>");
  const workingId = working.ok ? working.messageId : undefined;
  try {
    const stored = await loadLastCabutanCsv();
    if (!stored) {
      await sendTelegramMessage(botToken, chatId, "⚠️ <b>Belum ada data cabutan</b>\n\nKirim file CSV T_NAL terlebih dahulu.", { replyMarkup: cabutanMenuKeyboard(null) });
      return;
    }
    const when = formatJakartaTimestamp(stored.meta.uploadedAt);
    const note = `🕒 <i>Dari upload terakhir${when ? `: ${escapeHtml(when)}` : ""}</i>`;
    const { sent } = await sendCabutanFile(botToken, chatId, stored.csv, note);
    if (!sent.ok) {
      await sendTelegramMessage(botToken, chatId, "❌ <b>File Data Cabutan gagal dikirim</b>\n\nSilakan coba lagi sebentar.", { replyMarkup: cabutanMenuKeyboard(stored.meta) });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Terjadi kesalahan.";
    await sendTelegramMessage(botToken, chatId, `❌ <b>Data Cabutan belum bisa dibuat</b>\n\n${escapeHtml(reason)}`, { replyMarkup: cabutanMenuKeyboard(await lastCabutanSafe()) });
  } finally {
    await deleteTelegramMessage(botToken, chatId, workingId);
  }
}

function downloadModuleName(product: ReportProductKey) {
  return product === "METABRIGHT" ? "MetaBright" : product;
}

function downloadMenuText() {
  return ["📥 <b>Unduh Report</b>", SECTION, "Pilih modul:"].join("\n");
}

function downloadMenuKeyboard(): TelegramInlineKeyboardMarkup {
  const button = (p: ReportProductKey) => ({ callback_data: `dl:${p}`, text: `${productIcon(p)} ${downloadModuleName(p)}` });
  return {
    inline_keyboard: [
      [button("HSI"), button("WMS")],
      [button("LTS"), button("METABRIGHT")],
      [{ callback_data: "menu:home", text: "🏠 Menu Utama" }],
    ],
  };
}

const homeRow = [{ callback_data: "menu:home", text: "🏠 Menu Utama" }];

// Tombol di bawah file terakhir yang dikirim, supaya tidak perlu scroll atau mengetik ulang.
function afterDownloadKeyboard(product: ReportProductKey): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { callback_data: `dl:${product}`, text: `🔁 Unduh ${downloadModuleName(product)} Lagi` },
        { callback_data: "menu:download", text: "📥 Modul Lain" },
      ],
      homeRow,
    ],
  };
}

function downloadRetryKeyboard(product: ReportProductKey, format: "excel" | "image"): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ callback_data: `${format === "image" ? "dli" : "dlx"}:${product}`, text: "🔄 Coba Lagi" }],
      [
        { callback_data: `dl:${product}`, text: "⬅️ Pilih Format" },
        { callback_data: "menu:download", text: "📥 Modul Lain" },
      ],
      homeRow,
    ],
  };
}

function afterUploadKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { callback_data: "menu:download", text: "📥 Unduh Report" },
        { callback_data: "menu:report", text: "📈 Lihat Report" },
      ],
      [{ callback_data: "menu:upload", text: "📤 Upload Lagi" }],
      homeRow,
    ],
  };
}

function uploadWaitingKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ callback_data: "menu:upload", text: "📤 Panduan Upload" }], homeRow],
  };
}

function uploadErrorKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ callback_data: "menu:upload", text: "📤 Panduan Upload" }], homeRow],
  };
}

function notAllowedKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ callback_data: "menu:myid", text: "🪪 Lihat My ID" }], homeRow],
  };
}

function downloadFormatText(product: ReportProductKey) {
  return [`📥 <b>Unduh Report ${downloadModuleName(product)}</b>`, SECTION, "Pilih format file:"].join("\n");
}

function downloadFormatKeyboard(product: ReportProductKey): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { callback_data: `dlx:${product}`, text: "📊 Excel" },
        { callback_data: `dli:${product}`, text: "🖼️ Gambar (PNG)" },
      ],
      [{ callback_data: "menu:download", text: "⬅️ Pilih Modul Lain" }],
      [{ callback_data: "menu:home", text: "🏠 Menu Utama" }],
    ],
  };
}

// ---------- Unduh MetaBright: pilih cakupan witel + isi unduhan (sama seperti dialog Unduh di dashboard) ----------
const MB_SCOPE_ALL = "all";
const MB_CONTENT_LABEL: Record<MetabrightContent | "semua", string> = {
  data: "Data (.xlsx)",
  semua: "Semua isi",
  tabel: "Tabel (.png)",
  viz: "Visualisasi (.png)",
};

function metabrightScopeText() {
  return ["📥 <b>Unduh Report MetaBright</b>", SECTION, "Pilih cakupan witel:"].join("\n");
}

function metabrightScopeKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { callback_data: `mbs:${MB_SCOPE_ALL}`, text: "🌐 Semua Witel" },
        { callback_data: "mbp", text: "📍 Pilih Witel" },
      ],
      [{ callback_data: "menu:download", text: "⬅️ Pilih Modul Lain" }],
      homeRow,
    ],
  };
}

function metabrightWitelText() {
  return ["📍 <b>Pilih Witel</b>", SECTION, "Unduhan hanya berisi data witel yang dipilih:"].join("\n");
}

function metabrightWitelKeyboard(witels: string[]): TelegramInlineKeyboardMarkup {
  const buttons = witels.map((w) => ({ callback_data: `mbs:${w}`, text: `📍 ${w}` }));
  const rows: { callback_data: string; text: string }[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([{ callback_data: "dl:METABRIGHT", text: "⬅️ Kembali" }]);
  rows.push(homeRow);
  return { inline_keyboard: rows };
}

function metabrightContentText(scope: string) {
  const label = scope === MB_SCOPE_ALL ? "Semua witel" : scope;
  return ["📥 <b>Unduh Report MetaBright</b>", SECTION, `📍 Cakupan: <b>${escapeHtml(label)}</b>`, "", "Pilih isi unduhan:"].join("\n");
}

function metabrightContentKeyboard(scope: string): TelegramInlineKeyboardMarkup {
  const b = (content: MetabrightContent | "semua", icon: string) => ({ callback_data: `mb:${content}:${scope}`, text: `${icon} ${MB_CONTENT_LABEL[content]}` });
  return {
    inline_keyboard: [
      [b("data", "📊"), b("tabel", "🖼️")],
      [b("viz", "📈"), b("semua", "📦")],
      [{ callback_data: "dl:METABRIGHT", text: "⬅️ Ganti Cakupan Witel" }],
      homeRow,
    ],
  };
}

function metabrightRetryKeyboard(content: string, scope: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ callback_data: `mb:${content}:${scope}`, text: "🔄 Coba Lagi" }],
      [
        { callback_data: `mbs:${scope}`, text: "⬅️ Pilih Isi" },
        { callback_data: "menu:download", text: "📥 Modul Lain" },
      ],
      homeRow,
    ],
  };
}

function metabrightAfterKeyboard(scope: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { callback_data: `mbs:${scope}`, text: "🔁 Isi Lain (witel sama)" },
        { callback_data: "dl:METABRIGHT", text: "📍 Ganti Witel" },
      ],
      [{ callback_data: "menu:download", text: "📥 Modul Lain" }],
      homeRow,
    ],
  };
}

function isDownloadProduct(value: string): value is ReportProductKey {
  return REPORT_DOWNLOAD_PRODUCTS.includes(value as ReportProductKey);
}

function notAllowedText() {
  return [
    "⛔ <b>Akses upload ditolak</b>",
    SECTION,
    "Akun Telegram Anda belum terdaftar sebagai pengunggah data.",
    "",
    "Kirim <b>User ID</b> Anda (lihat menu 🪪 My ID) kepada admin untuk didaftarkan.",
  ].join("\n");
}

const reportDeps = { loadLtsDatasets: loadLtsDatasetsForReport };

// Kirim report sebagai gambar PNG (sebagai dokumen agar resolusi penuh dan tabel tetap terbaca).
// Informasi pengantar (mis. hasil upload) dikirim sebagai PESAN TERPISAH sebelum gambar, supaya caption gambar tetap
// bersih. Tombol navigasi dipasang di gambar terakhir.
async function sendReportImages(
  botToken: string,
  chatId: number,
  product: ReportProductKey,
  intro = "",
  replyMarkup?: TelegramInlineKeyboardMarkup,
) {
  const images = await buildReportImages(product, reportDeps);
  if (intro.trim()) await sendTelegramMessage(botToken, chatId, intro.trim());
  let failed = 0;
  for (const [index, image] of images.entries()) {
    const [title, ...rest] = image.caption.split("\n");
    const caption = [`🖼️ <b>${escapeHtml(title)}</b>`, ...rest.map(escapeHtml)].join("\n");
    const isLast = index === images.length - 1;
    const sent = await sendTelegramDocument(botToken, chatId, image.filename, image.bytes, caption, "image/png", isLast ? replyMarkup : undefined);
    if (!sent.ok) failed += 1;
  }
  return { failed, total: images.length };
}

async function sendReportExcel(botToken: string, chatId: number, product: ReportProductKey, replyMarkup?: TelegramInlineKeyboardMarkup) {
  const file = await buildReportExcel(product, reportDeps);
  const [title, ...rest] = file.caption.split("\n");
  const caption = [`📊 <b>${escapeHtml(title)}</b>`, ...rest.map(escapeHtml)].join("\n");
  return sendTelegramDocument(botToken, chatId, file.filename, file.bytes, caption, undefined, replyMarkup);
}

// CSV T_NAL: UBIS selain Business -> pasti Data Cabutan. Hanya Business -> CAPS (NAL) LTS, kecuali menu Data Cabutan
// baru dibuka (mode aktif) atau caption memuat "cabutan".
// CSV T_NAL berformat sama untuk Data Cabutan dan CAPS (NAL) LTS. Tanpa caption bot tidak menebak: pengguna diminta memilih.
// Pertanyaan dikirim sebagai balasan ke file, sehingga saat tombol ditekan file aslinya bisa diambil lewat reply_to_message.
async function askNalKind(botToken: string, chatId: number, message: TelegramMessage) {
  return sendTelegramMessage(
    botToken,
    chatId,
    [
      "❓ <b>File CSV ini data apa?</b>",
      "",
      "Format file ini sama untuk <b>Data Cabutan</b> dan <b>CAPS (NAL)</b> LTS, dan tidak ada caption yang menjelaskannya.",
      "",
      "Pilih salah satu 👇",
      "",
      "<i>Tips: tulis <b>cabutan</b> (atau <b>y</b>) di caption agar tidak ditanya lagi, atau <b>lts</b> untuk data LTS.</i>",
    ].join("\n"),
    {
      replyMarkup: {
        inline_keyboard: [
          [{ callback_data: "nal:cabutan", text: "🗂️ Data Cabutan" }],
          [{ callback_data: "nal:lts", text: "📶 CAPS (NAL) LTS" }],
        ],
      },
      replyToMessageId: message.message_id,
    },
  );
}

// `forced` diisi saat pengguna sudah memilih lewat tombol; penentuan otomatis dilewati.
async function handleDocumentUpload(botToken: string, chatId: number, message: TelegramMessage, forced?: "cabutan" | "lts") {
  const document = message.document!;
  const userId = telegramUserId(message.from);
  if (!isAllowedUploader(userId)) {
    await sendTelegramMessage(botToken, chatId, notAllowedText(), { replyMarkup: notAllowedKeyboard() });
    return;
  }

  const fileName = document.file_name ?? "upload.xlsx";
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(fileName)) {
    await sendTelegramMessage(botToken, chatId, "⚠️ <b>Format file tidak didukung</b>\n\nGunakan file <b>.xlsx</b>, <b>.xls</b>, atau <b>.csv</b>.", { replyMarkup: uploadErrorKeyboard() });
    return;
  }

  const working = await sendTelegramMessage(botToken, chatId, `⏳ <b>Memproses file…</b>\n<i>${escapeHtml(fileName)}</i>`);
  const workingId = working.ok ? working.messageId : undefined;
  try {
    const buffer = await downloadTelegramFile(botToken, document.file_id);
    // Aturan: caption "cabutan" / "data cabutan" / "y" -> Data Cabutan. Caption lain (mis. "lts") -> diproses seperti biasa (LTS).
    // Tanpa caption sama sekali dan file berformat CSV T_NAL (ambigu dengan CAPS LTS) -> bot bertanya lewat tombol.
    const asCabutan = forced ? forced === "cabutan" : isCabutanCaption(message.caption);
    if (!forced && !asCabutan && !(message.caption ?? "").trim() && isCabutanFile(fileName, buffer)) {
      await deleteTelegramMessage(botToken, chatId, workingId);
      await askNalKind(botToken, chatId, message);
      return;
    }
    if (asCabutan && !isCabutanFile(fileName, buffer)) {
      await deleteTelegramMessage(botToken, chatId, workingId);
      await sendTelegramMessage(
        botToken,
        chatId,
        [
          "⚠️ <b>File ini tidak bisa diproses sebagai Data Cabutan</b>",
          "",
          "Caption <b>cabutan</b> / <b>data cabutan</b> / <b>y</b> hanya untuk file <b>.csv</b> T_NAL Full Data yang memuat kolom PERIODE, L_WITEL, DIVISI, SSL_DO, SSL_NAL, KATEGORI_DO, dan JENISPSB.",
          "",
          "Jika ini data LTS, kirim ulang dengan caption <b>lts</b>.",
        ].join("\n"),
        { replyMarkup: cabutanKeyboard() },
      );
      return;
    }
    if (asCabutan) {
      const { result, sent } = await sendCabutanFile(botToken, chatId, buffer);
      // Simpan CSV supaya bisa diunduh lagi lewat menu Data Cabutan. Kegagalan simpan tidak membatalkan file yang sudah dikirim.
      const saved = await saveLastCabutan(buffer, {
        fileName,
        periods: result.periods,
        rowCount: result.rowCount,
        uploadedBy: message.from?.first_name ?? null,
      }).catch(() => false);
      await deleteTelegramMessage(botToken, chatId, workingId);
      if (!sent.ok) {
        await sendTelegramMessage(botToken, chatId, "❌ <b>File Data Cabutan gagal dikirim</b>\n\nSilakan coba kirim ulang CSV-nya.", { replyMarkup: cabutanKeyboard() });
      }
      if (!saved) {
        await sendTelegramMessage(botToken, chatId, "⚠️ <i>Data belum tersimpan di server, jadi tombol Unduh Data Cabutan belum memuat file ini.</i>");
      }
      return;
    }
    const ltsKey = detectLtsDataset(fileName, message.caption, buffer);
    if (ltsKey) {
      const dataset = parseLtsDataset(ltsKey, fileName, buffer);
      await importLtsDataset(dataset);
      const progress = await registerLtsUpload(dataset);
      const received = LTS_DATASET_KEYS.filter((k) => progress.present[k]).length;
      const checklist = [
        `📶 <b>Kelengkapan data LTS</b>  (${received}/${LTS_DATASET_KEYS.length})`,
        "",
        ...LTS_DATASET_KEYS.flatMap((k) => [`${progress.present[k] ? "✅" : "⬜"} ${ltsDatasetLabel(k)}`, ""]),
      ]
        .join("\n")
        .trimEnd();
      const head = [
        `✅ <b>${ltsDatasetLabel(ltsKey)}</b> berhasil disimpan`,
        "",
        `📅 ${escapeHtml(progress.periodLabel)}  •  ${dataset.rowCount.toLocaleString("id-ID")} baris`,
      ].join("\n");
      if (!progress.complete) {
        // Belum lengkap: beri tahu file mana yang masih ditunggu. Report baru dikirim setelah ketiganya masuk.
        const waiting = progress.missing.map((k) => `<b>${ltsDatasetLabel(k)}</b>`).join(" dan ");
        await sendTelegramMessage(
          botToken,
          chatId,
          [
            head,
            SECTION,
            checklist,
            SECTION,
            `⏳ <b>Menunggu ${progress.missing.length} file lagi</b>`,
            "",
            waiting,
            "",
            `<i>Report LTS dikirim otomatis setelah ketiga file (ps, nal, reg) diterima. Jeda antar file maks. ${LTS_BATCH_WINDOW_MINUTES} menit.</i>`,
          ].join("\n"),
          { replyMarkup: uploadWaitingKeyboard() },
        );
      } else if (await claimLtsReport()) {
        const sent = await sendReportImages(botToken, chatId, "LTS", `${head}\n${SECTION}\n${checklist}\n${SECTION}\n🎉 <b>Data LTS lengkap</b>\n\n`, afterUploadKeyboard());
        if (sent.failed > 0) {
          await sendTelegramMessage(botToken, chatId, "⚠️ <b>Data LTS tersimpan, tetapi gambar report gagal dikirim.</b>\n\nSilakan unduh lewat menu Unduh Report.", { replyMarkup: afterUploadKeyboard() });
        }
      } else {
        // Ketiga file sudah lengkap, tetapi report dikirim oleh proses lain (file dikirim bersamaan).
        await sendTelegramMessage(botToken, chatId, `${head}\n${SECTION}\n${checklist}\n${SECTION}\n🎉 <b>Data LTS lengkap.</b> Report dikirim otomatis.`, { replyMarkup: afterUploadKeyboard() });
      }
      await deleteTelegramMessage(botToken, chatId, workingId);
      return;
    }
    // MetaBright (Impactful Award Telda): dikenali dari nama file/caption, atau dari struktur file bila bukan HSI/WMS.
    const metabrightHint = hasMetabrightHint(fileName, message.caption);
    const product = metabrightHint ? null : detectProduct(fileName, message.caption, buffer);
    const metabright = metabrightHint
      ? parseMetabrightFile(fileName, message.caption, buffer)
      : product
        ? null
        : tryParseMetabrightFile(fileName, message.caption, buffer);
    if (metabright) {
      await importMetabright(metabright);
      const { dataset, label } = metabright;
      const note = dataset.warn ? `\n⚠️ <i>Catatan: ${escapeHtml(dataset.warn)}</i>` : "";
      const sent = await sendReportImages(
        botToken,
        chatId,
        "METABRIGHT",
        `✅ <b>Upload MetaBright berhasil</b>\n\n📅 ${escapeHtml(label)}  •  ${dataset.rows.length.toLocaleString("id-ID")} telda, ${dataset.indicators.length} indikator${note}\n\n`,
        afterUploadKeyboard(),
      );
      await deleteTelegramMessage(botToken, chatId, workingId);
      if (sent.failed > 0) {
        await sendTelegramMessage(botToken, chatId, `⚠️ <b>Data MetaBright ${escapeHtml(label)} tersimpan, tetapi gambar report gagal dikirim.</b>\n\nSilakan unduh lewat menu Unduh Report.`, { replyMarkup: afterUploadKeyboard() });
      }
      return;
    }
    if (!product) {
      await deleteTelegramMessage(botToken, chatId, workingId);
      await sendTelegramMessage(
        botToken,
        chatId,
        ["⚠️ <b>Modul tidak dikenali</b>", "", "Kirim ulang file dengan caption <b>HSI</b>, <b>WMS</b>, atau <b>MetaBright</b>.", "Untuk LTS, kirim file <b>ps</b> / <b>nal</b> / <b>reg</b> dengan kolom sesuai MASTER LTS di web."].join("\n"),
        { replyMarkup: uploadErrorKeyboard() },
      );
      return;
    }
    const rows = parseMasterRows(product, buffer);
    const summary = await importMaster(product, rows);
    const periods = summary.periods.map((p) => `${escapeHtml(p.label)} (${p.rows.toLocaleString("id-ID")} baris)`).join(", ");
    const sent = await sendReportImages(botToken, chatId, product, `✅ <b>Upload ${product} berhasil</b>\n\n📅 ${periods}\n\n`, afterUploadKeyboard());
    await deleteTelegramMessage(botToken, chatId, workingId);
    if (sent.failed > 0) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ <b>Data ${product} tersimpan (${periods}), tetapi gambar report gagal dikirim.</b>\n\nSilakan unduh lewat menu Unduh Report.`,
        { replyMarkup: afterUploadKeyboard() },
      );
    }
  } catch (error) {
    await deleteTelegramMessage(botToken, chatId, workingId);
    const reason = error instanceof Error ? error.message : "Terjadi kesalahan.";
    await sendTelegramMessage(botToken, chatId, `❌ <b>Upload gagal</b>\n\n${escapeHtml(reason)}`, { replyMarkup: uploadErrorKeyboard() });
  }
}

async function handleDownload(botToken: string, chatId: number, product: ReportProductKey, format: "excel" | "image") {
  const working = await sendTelegramMessage(botToken, chatId, `⏳ <b>Menyiapkan report ${downloadModuleName(product)}…</b>`);
  const workingId = working.ok ? working.messageId : undefined;
  const retry = downloadRetryKeyboard(product, format);
  try {
    if (format === "image") {
      const sent = await sendReportImages(botToken, chatId, product, "", afterDownloadKeyboard(product));
      if (sent.failed > 0) await sendTelegramMessage(botToken, chatId, "❌ <b>Gambar report gagal dikirim</b>\n\nSilakan coba lagi sebentar.", { replyMarkup: retry });
    } else {
      const sent = await sendReportExcel(botToken, chatId, product, afterDownloadKeyboard(product));
      if (!sent.ok) await sendTelegramMessage(botToken, chatId, "❌ <b>File report gagal dikirim</b>\n\nSilakan coba lagi sebentar.", { replyMarkup: retry });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Terjadi kesalahan.";
    await sendTelegramMessage(botToken, chatId, `❌ <b>Report ${downloadModuleName(product)} belum bisa dibuat</b>\n\n${escapeHtml(reason)}`, { replyMarkup: retry });
  } finally {
    await deleteTelegramMessage(botToken, chatId, workingId);
  }
}

async function handleMetabrightDownload(botToken: string, chatId: number, scopeValue: string, contentValue: string) {
  const contents: MetabrightContent[] = contentValue === "semua" ? ["data", "tabel", "viz"] : contentValue === "data" || contentValue === "tabel" || contentValue === "viz" ? [contentValue] : [];
  if (contents.length === 0) return;
  const scope: MetabrightScope = scopeValue === MB_SCOPE_ALL ? "all" : { witel: scopeValue };
  const scopeLabel = scope === "all" ? "semua witel" : scopeValue;
  const working = await sendTelegramMessage(botToken, chatId, `⏳ <b>Menyiapkan report MetaBright (${escapeHtml(scopeLabel)})…</b>`);
  const workingId = working.ok ? working.messageId : undefined;
  const retry = metabrightRetryKeyboard(contentValue, scopeValue);
  try {
    const { images, excel } = await buildMetabrightFiles(scope, contents);
    const total = images.length + (excel ? 1 : 0);
    let sentCount = 0;
    let failed = 0;
    const withCaption = (icon: string, caption: string) => {
      const [title, ...rest] = caption.split("\n");
      return [`${icon} <b>${escapeHtml(title)}</b>`, ...rest.map(escapeHtml)].join("\n");
    };
    const next = () => {
      sentCount += 1;
      return sentCount === total ? metabrightAfterKeyboard(scopeValue) : undefined;
    };
    if (excel) {
      const sent = await sendTelegramDocument(botToken, chatId, excel.filename, excel.bytes, withCaption("📊", excel.caption), undefined, next());
      if (!sent.ok) failed += 1;
    }
    for (const image of images) {
      const sent = await sendTelegramDocument(botToken, chatId, image.filename, image.bytes, withCaption("🖼️", image.caption), "image/png", next());
      if (!sent.ok) failed += 1;
    }
    if (failed > 0) await sendTelegramMessage(botToken, chatId, "❌ <b>Sebagian file gagal dikirim</b>\n\nSilakan coba lagi sebentar.", { replyMarkup: retry });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Terjadi kesalahan.";
    await sendTelegramMessage(botToken, chatId, `❌ <b>Report MetaBright belum bisa dibuat</b>\n\n${escapeHtml(reason)}`, { replyMarkup: retry });
  } finally {
    await deleteTelegramMessage(botToken, chatId, workingId);
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
    await showMainMenu(botToken, chatId, messageId, callbackQuery.from?.first_name);
    return;
  }

  if (data === "menu:help") {
    await sendOrEditTelegramMessage(botToken, chatId, messageId, helpText(), { replyMarkup: helpKeyboard() });
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

  // Pengguna menjawab "CSV ini data apa?". File asli diambil dari pesan yang dibalas bot (reply_to_message).
  if (data === "nal:cabutan" || data === "nal:lts") {
    const original = callbackQuery.message?.reply_to_message;
    if (!original?.document) {
      await sendOrEditTelegramMessage(
        botToken,
        chatId,
        messageId,
        "⚠️ <b>File aslinya tidak ditemukan</b>\n\nKirim ulang CSV-nya dengan caption <b>cabutan</b> (Data Cabutan) atau <b>lts</b> (CAPS/NAL LTS).",
        { replyMarkup: cabutanKeyboard() },
      );
      return;
    }
    await deleteTelegramMessage(botToken, chatId, messageId);
    await handleDocumentUpload(botToken, chatId, { ...original, from: callbackQuery.from }, data === "nal:cabutan" ? "cabutan" : "lts");
    return;
  }

  if (data === "menu:cabutan") {
    const last = await lastCabutanSafe();
    await sendOrEditTelegramMessage(botToken, chatId, messageId, cabutanMenuText(last), { replyMarkup: cabutanMenuKeyboard(last) });
    return;
  }

  if (data === "cabutan:dl") {
    await handleCabutanDownload(botToken, chatId);
    return;
  }

  if (data === "menu:download") {
    await sendOrEditTelegramMessage(botToken, chatId, messageId, downloadMenuText(), {
      replyMarkup: downloadMenuKeyboard(),
    });
    return;
  }

  if (data === "dl:METABRIGHT") {
    await sendOrEditTelegramMessage(botToken, chatId, messageId, metabrightScopeText(), { replyMarkup: metabrightScopeKeyboard() });
    return;
  }

  if (data === "mbp") {
    try {
      const witels = await listMetabrightWitels();
      await sendOrEditTelegramMessage(botToken, chatId, messageId, metabrightWitelText(), { replyMarkup: metabrightWitelKeyboard(witels) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Terjadi kesalahan.";
      await sendOrEditTelegramMessage(botToken, chatId, messageId, `❌ <b>Daftar witel belum bisa dimuat</b>\n\n${escapeHtml(reason)}`, { replyMarkup: metabrightScopeKeyboard() });
    }
    return;
  }

  if (data.startsWith("mbs:")) {
    await sendOrEditTelegramMessage(botToken, chatId, messageId, metabrightContentText(data.slice(4)), { replyMarkup: metabrightContentKeyboard(data.slice(4)) });
    return;
  }

  if (data.startsWith("mb:")) {
    const rest = data.slice(3);
    const cut = rest.indexOf(":");
    if (cut > 0) await handleMetabrightDownload(botToken, chatId, rest.slice(cut + 1), rest.slice(0, cut));
    return;
  }

  if (data.startsWith("dl:")) {
    const product = data.slice(3);
    if (isDownloadProduct(product)) {
      await sendOrEditTelegramMessage(botToken, chatId, messageId, downloadFormatText(product), {
        replyMarkup: downloadFormatKeyboard(product),
      });
    }
    return;
  }

  if (data.startsWith("dlx:") || data.startsWith("dli:")) {
    const product = data.slice(4);
    if (product === "METABRIGHT") {
      await handleMetabrightDownload(botToken, chatId, MB_SCOPE_ALL, data.startsWith("dli:") ? "tabel" : "data");
      return;
    }
    if (isDownloadProduct(product)) await handleDownload(botToken, chatId, product, data.startsWith("dli:") ? "image" : "excel");
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
      `⚠️ <b>Report ${escapeHtml(productValue)} belum dapat dimuat</b>`,
      "",
      "PRIME sedang mengalami kendala saat membaca data.",
      "Silakan coba lagi beberapa saat lagi.",
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
    const result = await sendTelegramMessage(botToken, chatId, mainMenuText(message?.from?.first_name), { replyMarkup: mainMenuKeyboard() });
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

  if (command === "/cabutan") {
    const last = await lastCabutanSafe();
    await sendTelegramMessage(botToken, chatId, cabutanMenuText(last), { replyMarkup: cabutanMenuKeyboard(last) });
    return NextResponse.json({ ok: true });
  }

  if (command === "/download") {
    await sendTelegramMessage(botToken, chatId, downloadMenuText(), {
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
