// Pembuat PNG tabel MetaBright di browser (tombol Unduh). Memakai kode gambar yang sama dengan bot Telegram
// (report-image.ts), sehingga hasilnya identik.
import type { Dataset, Row } from "./types";
import { drawMetabrightImage, metabrightImageSize } from "./report-image";
import { drawMetabrightViz, metabrightVizSize } from "./viz-image";

// Bot Telegram menggambar dengan font Liberation Sans yang didaftarkan sebagai "Arial" (server tidak punya font sistem).
// Di browser, "Arial" berarti font bawaan komputer pengguna (Arial asli / Helvetica / dll.), sehingga bentuk huruf sedikit
// berbeda. Agar hasil unduhan identik dengan bot, font yang sama dimuat dari /fonts dan didaftarkan sebagai "Arial".
// Jika gagal dimuat, gambar tetap dibuat memakai font bawaan browser.
let reportFonts: Promise<void> | null = null;

export function loadReportFonts(): Promise<void> {
  if (!reportFonts) {
    reportFonts = (async () => {
      if (typeof FontFace === "undefined" || !document.fonts) return;
      const faces = [
        new FontFace("Arial", "url(/fonts/LiberationSans-Regular.ttf)", { weight: "400" }),
        new FontFace("Arial", "url(/fonts/LiberationSans-Bold.ttf)", { weight: "700" }),
      ];
      const loaded = await Promise.all(faces.map((face) => face.load()));
      loaded.forEach((face) => document.fonts.add(face));
    })().catch(() => undefined);
  }
  return reportFonts;
}

export async function renderMetabrightTablePng(d: Dataset, rows: Row[], period: string, scopeLabel?: string): Promise<Blob> {
  await loadReportFonts();
  await document.fonts?.ready;
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  const { W, H } = metabrightImageSize(sorted.length, d.indicators.length);
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(W * scale);
  canvas.height = Math.ceil(H * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas browser tidak tersedia.");
  ctx.scale(scale, scale);
  drawMetabrightImage(ctx, d, sorted, period, new Date(), scopeLabel);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("gagal membuat gambar"))), "image/png"),
  );
}

/**
 * PNG visualisasi MetaBright di browser (tombol Unduh). Memakai kode gambar yang sama dengan bot Telegram
 * (viz-image.ts), sehingga hasilnya identik. `d` harus sudah difilter sesuai cakupan witel
 * (sama seperti bot: { ...data, rows: baris witel }), dan scopeLabel berisi "Semua witel" atau nama witel.
 */
export async function renderMetabrightVizPng(d: Dataset, period: string, scopeLabel: string): Promise<Blob> {
  await loadReportFonts();
  await document.fonts?.ready;
  const rows = [...d.rows].sort((a, b) => a.rank - b.rank);
  if (rows.length === 0) throw new Error("Tidak ada telda pada cakupan ini.");
  const { W, H } = metabrightVizSize(d, rows);
  const scale = 1.5;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(W * scale);
  canvas.height = Math.ceil(H * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas browser tidak tersedia.");
  ctx.scale(scale, scale);
  drawMetabrightViz(ctx, d, rows, period, new Date(), scopeLabel);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("gagal membuat gambar"))), "image/png"),
  );
}
