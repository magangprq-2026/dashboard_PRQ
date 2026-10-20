// Gambar report MetaBright (Impactful Award Telda) untuk bot Telegram: tabel data skor per indikator.
// Susunan, urutan, dan warna sel mengikuti tab "Tabel Data" di halaman /metabright (DataTable).
import type { Dataset, Row } from "@/features/metabright/domain/types";
import { nf, pillStyle } from "@/features/metabright/domain/utils";
import { formatJakartaDateTime, newCanvas, toPngBytes, type Ctx, type ReportImage } from "./canvas";

// Warna logo MetaBright: ungu -> biru -> cyan (sama dengan background halaman /metabright).
const BRAND_VIOLET = "#510dfc";
const BRAND_BLUE = "#1a44fc";
const BRAND_CYAN = "#0095fd";

const PAD = 32;
const HEADER = 112;
const ROW_H = 32;
const HEAD_ROW_H = 78;
const COL_RANK = 64;
const COL_WITEL = 212;
const COL_TELDA = 160;
const COL_IND = 88;
const COL_TOTAL = 160;

// Warna rank 1-5 (hijau -> oranye), selebihnya abu-abu. Sama dengan tabel di web.
const TOP_RANK_STYLE: Record<number, { background: string; color: string }> = {
  1: { background: "#01ad23", color: "#ffffff" },
  2: { background: "#80c02b", color: "#ffffff" },
  3: { background: "#ffd334", color: "#422006" },
  4: { background: "#f79c31", color: "#ffffff" },
  5: { background: "#ec6430", color: "#ffffff" },
};
const DEFAULT_RANK_STYLE = { background: "#e2e8f0", color: "#475569" };

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fit(ctx: Ctx, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

// Bungkus teks menjadi beberapa baris (maksimum maxLines); baris terakhir dipotong dengan "…" bila masih kepanjangan.
function wrap(ctx: Ctx, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(ctx, lines.slice(maxLines - 1).join(" "), maxWidth);
    return kept;
  }
  return lines.map((line) => fit(ctx, line, maxWidth));
}

function pill(ctx: Ctx, cx: number, cy: number, text: string, style: { background: string; color: string }, width = 58) {
  ctx.fillStyle = style.background;
  rr(ctx, cx - width / 2, cy - 11, width, 22, 11);
  ctx.fill();
  ctx.fillStyle = style.color;
  ctx.font = "700 12px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + 0.5);
}

export function buildMetabrightImage(d: Dataset, period: string, timestamp = new Date()): ReportImage {
  const rows: Row[] = [...d.rows].sort((a, b) => a.rank - b.rank);
  const indicators = d.indicators;

  const tableW = COL_RANK + COL_WITEL + COL_TELDA + indicators.length * COL_IND + COL_TOTAL;
  const W = Math.max(tableW + PAD * 2, 1100);
  const tableX = Math.round((W - tableW) / 2);
  const INFO_H = 52;
  const H = HEADER + INFO_H + HEAD_ROW_H + rows.length * ROW_H + 64;
  const { canvas, ctx } = newCanvas(W, H, 2);

  // latar putih polos; pemisah antar bagian berupa garis
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  // header
  ctx.fillStyle = "#ffffff";
  rr(ctx, tableX, 24, 64, 64, 16);
  ctx.fill();
  ctx.strokeStyle = "#cbd5e1";
  rr(ctx, tableX + 0.5, 24.5, 63, 63, 16);
  ctx.stroke();
  const logoGrad = ctx.createLinearGradient(tableX, 0, tableX + 64, 0);
  logoGrad.addColorStop(0, BRAND_VIOLET);
  logoGrad.addColorStop(1, BRAND_CYAN);
  ctx.fillStyle = logoGrad;
  ctx.font = "800 26px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("MB", tableX + 32, 57);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = BRAND_BLUE;
  ctx.font = "700 12px Arial";
  ctx.fillText("PRIME • METABRIGHT", tableX + 82, 40);
  ctx.fillStyle = "#071426";
  ctx.font = "700 30px Arial";
  ctx.fillText("Impactful Award Telda", tableX + 82, 74);
  ctx.fillStyle = "#475569";
  ctx.font = "600 14px Arial";
  ctx.fillText(`${period}  |  ${rows.length} telda  |  ${indicators.length} indikator`, tableX + 82, 98);
  ctx.textAlign = "right";
  ctx.fillStyle = "#64748b";
  ctx.font = "600 13px Arial";
  ctx.fillText(`Rendered ${formatJakartaDateTime(timestamp, true)}`, tableX + tableW, 98);
  ctx.textAlign = "left";

  ctx.strokeStyle = BRAND_BLUE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tableX, HEADER - 4);
  ctx.lineTo(tableX + tableW, HEADER - 4);
  ctx.stroke();
  ctx.lineWidth = 1;

  // keterangan + legenda warna
  let y = HEADER + 20;
  ctx.fillStyle = "#475569";
  ctx.font = "13px Arial";
  ctx.textBaseline = "middle";
  const info = `${rows.length} telda. Warna sel menunjukkan skor terhadap maksimum indikator:`;
  ctx.fillText(info, tableX, y + 12);
  let lx = tableX + ctx.measureText(info).width + 14;
  for (const [label, p] of [["≥ 80%", 90], ["50–79%", 60], ["< 50%", 10]] as const) {
    pill(ctx, lx + 36, y + 12, label, pillStyle(p), 72);
    lx += 84;
  }
  ctx.textBaseline = "alphabetic";
  y = HEADER + INFO_H;

  // kartu tabel
  const tableH = HEAD_ROW_H + rows.length * ROW_H;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  rr(ctx, tableX, y, tableW, tableH, 14);
  ctx.fill();
  ctx.restore();
  ctx.save();
  rr(ctx, tableX, y, tableW, tableH, 14);
  ctx.clip();

  // kolom (posisi x tengah/awal)
  const xRank = tableX;
  const xWitel = xRank + COL_RANK;
  const xTelda = xWitel + COL_WITEL;
  const xInd = xTelda + COL_TELDA;
  const xTotal = xInd + indicators.length * COL_IND;

  // header tabel
  const headGrad = ctx.createLinearGradient(0, y, 0, y + HEAD_ROW_H);
  headGrad.addColorStop(0, "#2563eb");
  headGrad.addColorStop(1, "#1d4ed8");
  ctx.fillStyle = headGrad;
  ctx.fillRect(tableX, y, tableW, HEAD_ROW_H);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 12px Arial";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText("Rank", xRank + COL_RANK / 2, y + HEAD_ROW_H / 2);
  ctx.textAlign = "left";
  ctx.fillText("Witel", xWitel + 14, y + HEAD_ROW_H / 2);
  ctx.fillText("Telda", xTelda + 14, y + HEAD_ROW_H / 2);
  indicators.forEach((ind, k) => {
    const cx = xInd + k * COL_IND + COL_IND / 2;
    ctx.textAlign = "center";
    ctx.font = "700 11px Arial";
    const lines = [...wrap(ctx, ind.name, COL_IND - 10, 3), `(${ind.weight})`];
    const lineH = 14;
    const top = y + HEAD_ROW_H / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => {
      ctx.fillStyle = i === lines.length - 1 ? "#bfdbfe" : "#ffffff";
      ctx.fillText(line, cx, top + i * lineH);
    });
  });
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 12px Arial";
  ctx.textAlign = "left";
  ctx.fillText("Total score", xTotal + 16, y + HEAD_ROW_H / 2);
  ctx.strokeStyle = "#93c5fd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tableX, y + HEAD_ROW_H - 0.5);
  ctx.lineTo(tableX + tableW, y + HEAD_ROW_H - 0.5);
  ctx.stroke();

  // baris data
  rows.forEach((r, i) => {
    const ry = y + HEAD_ROW_H + i * ROW_H;
    const cy = ry + ROW_H / 2;
    if (i % 2 === 1) {
      ctx.fillStyle = "#f8fbff";
      ctx.fillRect(tableX, ry, tableW, ROW_H);
    }
    ctx.strokeStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.moveTo(tableX, ry + ROW_H - 0.5);
    ctx.lineTo(tableX + tableW, ry + ROW_H - 0.5);
    ctx.stroke();

    // rank
    const rs = TOP_RANK_STYLE[r.rank] ?? DEFAULT_RANK_STYLE;
    ctx.fillStyle = rs.background;
    ctx.beginPath();
    ctx.arc(xRank + COL_RANK / 2, cy, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rs.color;
    ctx.font = "700 12px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(r.rank), xRank + COL_RANK / 2, cy + 1);

    // witel & telda
    ctx.textAlign = "left";
    ctx.fillStyle = "#475569";
    ctx.font = "12.5px Arial";
    ctx.fillText(fit(ctx, r.witel.toUpperCase(), COL_WITEL - 28), xWitel + 14, cy + 0.5);
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 12.5px Arial";
    ctx.fillText(fit(ctx, r.telda.toUpperCase(), COL_TELDA - 28), xTelda + 14, cy + 0.5);

    // skor per indikator
    r.v.forEach((v, k) => {
      const wt = indicators[k]?.weight || 1;
      const p = Math.min(v[3] / (wt * 1.1), 1) * 100;
      pill(ctx, xInd + k * COL_IND + COL_IND / 2, cy, nf(v[3]), pillStyle(p));
    });

    // total score + bar
    const barX = xTotal + 16;
    const barW = COL_TOTAL - 16 - 58;
    ctx.fillStyle = "#e8eef6";
    rr(ctx, barX, cy - 4, barW, 8, 4);
    ctx.fill();
    const bg = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    bg.addColorStop(0, "#22d3ee");
    bg.addColorStop(1, "#3b82f6");
    ctx.fillStyle = bg;
    rr(ctx, barX, cy - 4, Math.max(6, (Math.min(r.total, 110) / 110) * barW), 8, 4);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 13px Arial";
    ctx.textAlign = "right";
    ctx.fillText(nf(r.total), xTotal + COL_TOTAL - 12, cy + 0.5);
  });
  ctx.restore();
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 1;
  rr(ctx, tableX + 0.5, y + 0.5, tableW - 1, tableH - 1, 14);
  ctx.stroke();

  // footer
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.strokeStyle = "#cbd5e1";
  ctx.beginPath();
  ctx.moveTo(tableX, H - 44.5);
  ctx.lineTo(tableX + tableW, H - 44.5);
  ctx.stroke();
  ctx.fillStyle = BRAND_BLUE;
  ctx.font = "700 12px Arial";
  ctx.fillText(`Dibuat ${formatJakartaDateTime(timestamp, false)} · Dashboard Impactful Award Telda`, tableX, H - 24);

  return {
    bytes: toPngBytes(canvas),
    caption: `Tabel Impactful Award Telda (MetaBright)\n${period} | ${rows.length} telda`,
    filename: `Impactful_Award_Telda_${period.replace(/\s+/g, "_")}.png`,
  };
}
