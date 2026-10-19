// Pembuat gambar PNG di server (Vercel/Node) memakai @napi-rs/canvas, dengan API Canvas 2D yang sama
// seperti kode "Download PNG" di dashboard web, sehingga hasilnya identik.
import path from "node:path";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";

export type Ctx = SKRSContext2D;

let fontsReady = false;

// Server (Vercel) tidak punya font sistem. Font dibundel di ./fonts dan didaftarkan dengan nama "Arial"
// supaya semua string font bawaan kode web ("700 12px Arial") tetap berlaku.
export function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "features", "telegram", "report-images", "fonts");
  GlobalFonts.registerFromPath(path.join(dir, "LiberationSans-Regular.ttf"), "Arial");
  GlobalFonts.registerFromPath(path.join(dir, "LiberationSans-Bold.ttf"), "Arial");
  fontsReady = true;
}

export function newCanvas(width: number, height: number, scale = 2) {
  ensureFonts();
  const canvas = createCanvas(Math.ceil(width * scale), Math.ceil(height * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  return { canvas, ctx };
}

export function toPngBytes(canvas: { toBuffer(mime: "image/png"): Buffer }) {
  return new Uint8Array(canvas.toBuffer("image/png"));
}

export type ReportImage = { bytes: Uint8Array; filename: string; caption: string };

export function jakartaStamp(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
    year: "numeric",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.day}-${parts.month}-${parts.year}-${parts.hour}${parts.minute}-WIB`;
}

export function formatJakartaDateTime(date: Date, seconds = true) {
  const dateText = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", timeZone: "Asia/Jakarta", year: "numeric" }).format(date);
  const timeText = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    timeZone: "Asia/Jakarta",
  })
    .format(date)
    .replace(/\./g, ":");
  return `${dateText}${seconds ? "," : " •"} ${timeText} WIB`;
}

export const formatNumber = (value: number | null | undefined) =>
  value === null || value === undefined || Number.isNaN(value) ? "" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);

export const formatPercent = (value: number | null | undefined) =>
  value === null || value === undefined || Number.isNaN(value)
    ? ""
    : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2, minimumFractionDigits: 2, style: "percent" }).format(value);

export function achievementTone(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "neutral";
  if (value >= 1) return "good";
  if (value >= 0.8) return "near";
  return "low";
}
