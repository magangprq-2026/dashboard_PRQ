// Gambar report MetaBright (Impactful Award Telda) untuk bot Telegram.
// Warna & susunan mengikuti tab Visualisasi di halaman /metabright (KPI, peringkat, rata-rata witel, capaian indikator).
import type { Dataset, Row } from "@/features/metabright/domain/types";
import { COL, avg, nf } from "@/features/metabright/domain/utils";
import { formatJakartaDateTime, jakartaStamp, newCanvas, toPngBytes, type Ctx, type ReportImage } from "./canvas";

const W = 1600;
const PAD = 40;
const INNER = W - PAD * 2;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function card(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.shadowColor = "rgba(15,23,42,0.08)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#ffffff";
  rr(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "#e5edf7";
  ctx.lineWidth = 1;
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 18);
  ctx.stroke();
}

function sectionTitle(ctx: Ctx, title: string, sub: string, x: number, y: number) {
  const g = ctx.createLinearGradient(0, y, 0, y + 20);
  g.addColorStop(0, "#22d3ee");
  g.addColorStop(0.5, "#3b82f6");
  g.addColorStop(1, "#7c3aed");
  ctx.fillStyle = g;
  rr(ctx, x, y + 1, 5, 20, 3);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 18px Arial";
  ctx.fillText(title, x + 16, y);
  ctx.fillStyle = "#64748b";
  ctx.font = "13px Arial";
  ctx.fillText(sub, x + 16, y + 25);
}

function fit(ctx: Ctx, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

const pctColor = (p: number) => (p >= 80 ? "#059669" : p >= 50 ? "#f59e0b" : "#e11d48");

export function buildMetabrightImage(d: Dataset, period: string, timestamp = new Date()): ReportImage {
  const rows: Row[] = [...d.rows].sort((a, b) => b.total - a.total);
  const ws = [...new Set(d.rows.map((r) => r.witel))].sort();
  const wColor = (w: string) => COL[ws.indexOf(w) % COL.length];

  const half = Math.ceil(rows.length / 2);
  const ROW_H = 30;
  const rankH = 90 + half * ROW_H + 24 + 34;
  const witelData = ws
    .map((w) => {
      const rs = d.rows.filter((r) => r.witel === w);
      return { w, n: rs.length, v: avg(rs.map((r) => r.total)) };
    })
    .sort((a, b) => b.v - a.v);
  const indData = d.indicators.map((x) => ({
    name: x.name,
    v: x.weight ? avg(d.rows.map((r) => (r.v[d.indicators.indexOf(x)][3] / x.weight) * 100)) : 0,
  }));
  const BAR_H = 30;
  const lowerH = 96 + Math.max(witelData.length, indData.length) * BAR_H + 30;

  const HEADER = 128;
  const KPI_H = 112;
  const H = HEADER + 28 + KPI_H + 24 + 150 + 24 + rankH + 24 + lowerH + 40;
  const { canvas, ctx } = newCanvas(W, H, 2);

  // latar
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#ffffff");
  bg.addColorStop(0.45, "#f7faff");
  bg.addColorStop(1, "#edf5ff");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // header
  const hg = ctx.createLinearGradient(0, 0, W, 0);
  hg.addColorStop(0, "#0891b2");
  hg.addColorStop(0.5, "#2563eb");
  hg.addColorStop(1, "#6d28d9");
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, W, HEADER);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  rr(ctx, PAD, 30, 62, 62, 18);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 22px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("MB", PAD + 31, 61);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#bae6fd";
  ctx.font = "700 12px Arial";
  ctx.fillText("PRIME • METABRIGHT", PAD + 84, 44);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 32px Arial";
  ctx.fillText("Impactful Award Telda", PAD + 84, 80);
  ctx.fillStyle = "#e0f2fe";
  ctx.font = "600 14px Arial";
  ctx.fillText(`${period}  |  ${d.rows.length} telda  |  ${d.indicators.length} indikator`, PAD + 84, 106);
  ctx.textAlign = "right";
  ctx.fillStyle = "#bae6fd";
  ctx.font = "600 13px Arial";
  ctx.fillText(`Rendered ${formatJakartaDateTime(timestamp, true)}`, W - PAD, 106);
  ctx.textAlign = "left";

  // KPI
  let y = HEADER + 28;
  const hi = rows[0];
  const lo = rows[rows.length - 1];
  const kpis = [
    { label: "TELDA DIANALISIS", value: String(rows.length), sub: `${ws.length} witel`, color: "#3b82f6" },
    { label: "RATA-RATA TOTAL SCORE", value: nf(avg(rows.map((r) => r.total))), sub: `Rentang ${nf(lo.total)} – ${nf(hi.total)}`, color: "#22d3ee" },
    { label: "SKOR TERTINGGI", value: nf(hi.total), sub: hi.telda, color: "#059669" },
    { label: "SKOR TERENDAH", value: nf(lo.total), sub: lo.telda, color: "#e11d48" },
    { label: "SELISIH SKOR", value: nf(hi.total - lo.total), sub: "poin tertinggi vs terendah", color: "#7c3aed" },
  ];
  const gap = 16;
  const kw = (INNER - gap * 4) / 5;
  kpis.forEach((k, i) => {
    const x = PAD + i * (kw + gap);
    card(ctx, x, y, kw, KPI_H);
    ctx.fillStyle = k.color;
    ctx.save();
    rr(ctx, x, y, kw, KPI_H, 18);
    ctx.clip();
    ctx.fillRect(x, y, 6, KPI_H);
    ctx.restore();
    ctx.fillStyle = "#64748b";
    ctx.font = "700 11px Arial";
    ctx.fillText(k.label, x + 22, y + 28);
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 36px Arial";
    ctx.fillText(k.value, x + 22, y + 70);
    ctx.fillStyle = "#64748b";
    ctx.font = "12px Arial";
    ctx.fillText(fit(ctx, k.sub, kw - 40), x + 22, y + 96);
  });
  y += KPI_H + 24;

  // podium 3 teratas
  card(ctx, PAD, y, INNER, 150);
  sectionTitle(ctx, "Tiga telda teratas", "Berdasarkan total score, skor maksimum 110", PAD + 24, y + 20);
  const medals = [
    { fill: "#f59e0b", bg: "#fffbeb", label: "1" },
    { fill: "#64748b", bg: "#f1f5f9", label: "2" },
    { fill: "#7c3aed", bg: "#f5f3ff", label: "3" },
  ];
  const pw = (INNER - 48 - 32) / 3;
  rows.slice(0, 3).forEach((r, i) => {
    const x = PAD + 24 + i * (pw + 16);
    const py = y + 68;
    ctx.fillStyle = medals[i].bg;
    rr(ctx, x, py, pw, 66, 14);
    ctx.fill();
    ctx.fillStyle = medals[i].fill;
    ctx.beginPath();
    ctx.arc(x + 36, py + 33, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 20px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(medals[i].label, x + 36, py + 34);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 17px Arial";
    ctx.fillText(fit(ctx, r.telda, pw - 170), x + 70, py + 29);
    ctx.fillStyle = "#64748b";
    ctx.font = "12px Arial";
    ctx.fillText(fit(ctx, r.witel, pw - 170), x + 70, py + 50);
    ctx.textAlign = "right";
    ctx.fillStyle = "#020617";
    ctx.font = "700 28px Arial";
    ctx.fillText(nf(r.total), x + pw - 20, py + 42);
    ctx.textAlign = "left";
  });
  y += 150 + 24;

  // peringkat lengkap (2 kolom)
  card(ctx, PAD, y, INNER, rankH);
  sectionTitle(ctx, "Peringkat total score", "Semua telda · warna batang menunjukkan witel", PAD + 24, y + 20);
  const colW = (INNER - 48 - 40) / 2;
  const ry = y + 78;
  [rows.slice(0, half), rows.slice(half)].forEach((list, c) => {
    const cx = PAD + 24 + c * (colW + 40);
    list.forEach((r, i) => {
      const rowY = ry + i * ROW_H;
      const rank = c * half + i + 1;
      if (i % 2 === 0) {
        ctx.fillStyle = "#f8fbff";
        rr(ctx, cx - 6, rowY - 2, colW + 12, ROW_H - 2, 8);
        ctx.fill();
      }
      ctx.fillStyle = rank === 1 ? "#fde68a" : rank === 2 ? "#e2e8f0" : rank === 3 ? "#fed7aa" : "#eef2f7";
      ctx.beginPath();
      ctx.arc(cx + 13, rowY + 12, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#334155";
      ctx.font = "700 11px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(rank), cx + 13, rowY + 13);
      ctx.textAlign = "left";
      ctx.fillStyle = "#0f172a";
      ctx.font = "700 12.5px Arial";
      ctx.fillText(fit(ctx, r.telda, 150), cx + 34, rowY + 13);
      const bx = cx + 196;
      const bw = colW - 196 - 62;
      ctx.fillStyle = "#e8eef6";
      rr(ctx, bx, rowY + 6, bw, 12, 6);
      ctx.fill();
      ctx.fillStyle = wColor(r.witel);
      rr(ctx, bx, rowY + 6, Math.max(8, (Math.min(r.total, 110) / 110) * bw), 12, 6);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.font = "700 12.5px Arial";
      ctx.textAlign = "right";
      ctx.fillText(nf(r.total), cx + colW, rowY + 13);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    });
  });
  // legenda witel
  ctx.textBaseline = "middle";
  ctx.font = "700 12px Arial";
  let lx = PAD + 24;
  const ly = y + rankH - 28;
  ws.forEach((w) => {
    ctx.fillStyle = wColor(w);
    rr(ctx, lx, ly - 5, 10, 10, 3);
    ctx.fill();
    ctx.fillStyle = "#64748b";
    ctx.textAlign = "left";
    ctx.fillText(w, lx + 16, ly);
    lx += 16 + ctx.measureText(w).width + 22;
  });
  ctx.textBaseline = "alphabetic";
  y += rankH + 24;

  // rata-rata witel + capaian indikator
  const lw = (INNER - 24) / 2;
  card(ctx, PAD, y, lw, lowerH);
  card(ctx, PAD + lw + 24, y, lw, lowerH);
  sectionTitle(ctx, "Rata-rata total score per witel", "Skor maksimum 110 · jumlah telda di dalam kurung", PAD + 24, y + 20);
  sectionTitle(ctx, "Capaian rata-rata per indikator", "Skor diperoleh terhadap bobot indikator (%)", PAD + lw + 48, y + 20);
  const drawBars = (x0: number, items: { label: string; v: number; max: number; color: string; text: string }[]) => {
    const labelW = 190;
    const bw = lw - 48 - labelW - 70;
    items.forEach((it, i) => {
      const by = y + 84 + i * BAR_H;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillStyle = "#334155";
      ctx.font = "600 12px Arial";
      ctx.fillText(fit(ctx, it.label, labelW - 10), x0, by + 11);
      ctx.fillStyle = "#e8eef6";
      rr(ctx, x0 + labelW, by + 3, bw, 16, 8);
      ctx.fill();
      ctx.fillStyle = it.color;
      rr(ctx, x0 + labelW, by + 3, Math.max(8, (Math.min(it.v, it.max) / it.max) * bw), 16, 8);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.font = "700 12px Arial";
      ctx.fillText(it.text, x0 + labelW + bw + 10, by + 11);
    });
    ctx.textBaseline = "alphabetic";
  };
  drawBars(PAD + 24, witelData.map((x) => ({ label: `${x.w} (${x.n})`, v: x.v, max: 110, color: wColor(x.w), text: nf(x.v) })));
  drawBars(PAD + lw + 48, indData.map((x) => ({ label: x.name, v: x.v, max: 110, color: pctColor(x.v), text: nf(x.v, 1) + "%" })));

  ctx.fillStyle = "#2563eb";
  ctx.font = "700 12px Arial";
  ctx.textAlign = "left";
  ctx.fillText(`Dibuat ${formatJakartaDateTime(timestamp, false)} · Dashboard Impactful Award Telda`, PAD, H - 18);

  return {
    bytes: toPngBytes(canvas),
    caption: `Impactful Award Telda (MetaBright)\n${period} | ${rows.length} telda`,
    filename: `MetaBright-Impactful-Award-Telda-${jakartaStamp(timestamp)}.png`,
  };
}
