// Gambar report MetaBright (Impactful Award Telda) untuk bot Telegram: tabel data skor per indikator.
// Gambarnya dibuat oleh features/metabright/domain/report-image.ts, kode yang SAMA dipakai tombol Unduh di web.
import type { Dataset, Row } from "@/features/metabright/domain/types";
import { drawMetabrightImage, metabrightImageSize, type Ctx as DrawCtx } from "@/features/metabright/domain/report-image";
import { newCanvas, toPngBytes, type ReportImage } from "./canvas";

export function buildMetabrightImage(d: Dataset, period: string, timestamp = new Date()): ReportImage {
  const rows: Row[] = [...d.rows].sort((a, b) => a.rank - b.rank);
  const { W, H } = metabrightImageSize(rows.length, d.indicators.length);
  const { canvas, ctx } = newCanvas(W, H, 2);
  drawMetabrightImage(ctx as unknown as DrawCtx, d, rows, period, timestamp);
  return {
    bytes: toPngBytes(canvas),
    caption: `Tabel Impactful Award Telda (MetaBright)\n${period} | ${rows.length} telda`,
    filename: `Impactful_Award_Telda_${period.replace(/\s+/g, "_")}.png`,
  };
}
