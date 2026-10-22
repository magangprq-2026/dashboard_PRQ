// Pembuat PNG tabel MetaBright di browser (tombol Unduh). Memakai kode gambar yang sama dengan bot Telegram
// (report-image.ts), sehingga hasilnya identik.
import type { Dataset, Row } from "./types";
import { drawMetabrightImage, metabrightImageSize } from "./report-image";
import { drawMetabrightViz, metabrightVizSize } from "./viz-image";

export async function renderMetabrightTablePng(d: Dataset, rows: Row[], period: string, scopeLabel?: string): Promise<Blob> {
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
