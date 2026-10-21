// Gambar report MetaBright (Impactful Award Telda) untuk bot Telegram: tabel data skor per indikator dan visualisasi.
// Gambarnya dibuat oleh features/metabright/domain/report-image.ts (tabel) dan viz-image.ts (visualisasi);
// kode yang sama dipakai tombol Unduh di web untuk tabel.
import type { Dataset, Row } from "@/features/metabright/domain/types";
import { drawMetabrightImage, metabrightImageSize, type Ctx as DrawCtx } from "@/features/metabright/domain/report-image";
import { drawMetabrightViz, metabrightVizSize } from "@/features/metabright/domain/viz-image";
import { newCanvas, toPngBytes, type ReportImage } from "./canvas";

const slugName = (text: string) => text.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "");

/** Tabel data. scopeLabel dikosongkan untuk semua witel; isi nama witel bila hanya satu witel (d sudah difilter). */
export function buildMetabrightImage(d: Dataset, period: string, timestamp = new Date(), scopeLabel?: string): ReportImage {
  const rows: Row[] = [...d.rows].sort((a, b) => a.rank - b.rank);
  const { W, H } = metabrightImageSize(rows.length, d.indicators.length);
  const { canvas, ctx } = newCanvas(W, H, 2);
  drawMetabrightImage(ctx as unknown as DrawCtx, d, rows, period, timestamp, scopeLabel);
  const scopeText = scopeLabel ?? "Semua witel";
  return {
    bytes: toPngBytes(canvas),
    caption: `Tabel Impactful Award Telda (MetaBright)\n${period} | ${scopeText} | ${rows.length} telda`,
    filename: `Tabel_${slugName(scopeText)}_${slugName(period)}.png`,
  };
}

/** Visualisasi (KPI, podium, sorotan, grafik, peta capaian). d sudah difilter sesuai cakupan witel. */
export function buildMetabrightVizImage(d: Dataset, period: string, scopeLabel: string, timestamp = new Date()): ReportImage {
  const rows: Row[] = [...d.rows].sort((a, b) => a.rank - b.rank);
  if (rows.length === 0) throw new Error("Tidak ada telda pada cakupan ini.");
  const { W, H } = metabrightVizSize(d, rows);
  const { canvas, ctx } = newCanvas(W, H, 1.5);
  drawMetabrightViz(ctx as unknown as DrawCtx, d, rows, period, timestamp, scopeLabel);
  return {
    bytes: toPngBytes(canvas),
    caption: `Visualisasi Impactful Award Telda (MetaBright)\n${period} | ${scopeLabel} | ${rows.length} telda`,
    filename: `Visualisasi_${slugName(scopeLabel)}_${slugName(period)}.png`,
  };
}
