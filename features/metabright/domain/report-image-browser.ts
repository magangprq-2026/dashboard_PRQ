// Pembuat PNG tabel MetaBright di browser (tombol Unduh). Memakai kode gambar yang sama dengan bot Telegram
// (report-image.ts), sehingga hasilnya identik.
import type { Dataset, Row } from "./types";
import { drawMetabrightImage, metabrightImageSize } from "./report-image";

export async function renderMetabrightTablePng(d: Dataset, rows: Row[], period: string): Promise<Blob> {
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
  drawMetabrightImage(ctx, d, sorted, period, new Date());
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("gagal membuat gambar"))), "image/png"),
  );
}
