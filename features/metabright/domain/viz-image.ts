// Gambar "Visualisasi" MetaBright untuk bot Telegram: KPI, podium, sorotan, grafik peringkat, rata-rata per witel,
// capaian per indikator, distribusi, dan peta capaian witel. Isinya mengikuti tab Visualisasi di dashboard.
// File ini tidak boleh mengimpor modul Node.
import type { Dataset, Row } from "./types";
import { COL, avg, fmt, isRatio, nf, pillStyle } from "./utils";
import { fit, formatJakartaDateTime, pill, rr, wrap, type Ctx } from "./report-image";

const M = 32;
const GAP = 16;
const W = 1440;
const CW = W - M * 2;
const HEADER = 112;
const BLUE = "#1a44fc";
const BORDER = "#94a3b8";
const NAVY = "#071426";
const MUTED = "#64748b";

type Kpi = { label: string; value: string; sub: string; color: string; bar?: number };
type Sor = { color: string; title: string; text: string };

function indicatorAvg(rows: Row[], d: Dataset) {
  return d.indicators.map((x, k) => (x.weight ? avg(rows.map((r) => (r.v[k][3] / x.weight) * 100)) : 0));
}

function summarize(d: Dataset, rows: Row[], i: number) {
  const ind = d.indicators[i] ?? d.indicators[0];
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const hi = sorted[0];
  const lo = sorted[sorted.length - 1];
  const agg = (a: number[]) => (isRatio(ind.name) ? avg(a) : a.reduce((x, y) => x + y, 0));
  const T = agg(rows.map((r) => r.v[i][0]));
  const R = agg(rows.map((r) => r.v[i][1]));
  const ach = T ? (R / T) * 100 : 0;
  const kpis: Kpi[] = [
    { label: "Telda dianalisis", value: String(rows.length), sub: `dari ${d.rows.length} telda`, color: "#2563eb" },
    { label: "Rata-rata total score", value: nf(avg(rows.map((r) => r.total))), sub: `Rentang ${nf(lo.total)} – ${nf(hi.total)}`, color: "#0ea5e9" },
    { label: "Skor tertinggi", value: nf(hi.total), sub: hi.telda, color: "#059669" },
    { label: "Skor terendah", value: nf(lo.total), sub: lo.telda, color: "#e11d48" },
    { label: `Achievement ${ind.name}`, value: nf(ach) + "%", sub: `Target ${fmt(T)} · Realisasi ${fmt(R)}`, color: "#7c3aed", bar: Math.min(ach, 100) },
  ];
  const iv = indicatorAvg(rows, d).map((p, k) => ({ n: d.indicators[k].name, p }));
  const by = [...iv].sort((a, b) => b.p - a.p);
  const ok = rows.filter((r) => r.v[i][2] >= 100).length;
  const sor: Sor[] = [
    { color: "#059669", title: "Indikator terkuat", text: `${by[0].n}, rata-rata ${nf(by[0].p, 0)}% dari bobot.` },
    { color: "#e11d48", title: "Paling perlu dikejar", text: `${by[by.length - 1].n}, rata-rata baru ${nf(by[by.length - 1].p, 0)}% dari bobot.` },
    { color: "#2563eb", title: ind.name, text: `${ok} dari ${rows.length} telda sudah mencapai ACH 100% atau lebih.` },
    { color: "#f59e0b", title: "Selisih skor", text: `${nf(hi.total - lo.total)} poin antara ${hi.telda} (tertinggi) dan ${lo.telda} (terendah).` },
  ];
  return { ind, sorted, kpis, sor, iv };
}

const DIST_BUCKETS: [string, number, number, string][] = [
  ["< 50%", 0, 50, "#e11d48"],
  ["50–79%", 50, 80, "#f59e0b"],
  ["80–99%", 80, 100, "#0095fd"],
  ["≥ 100%", 100, 1e9, "#059669"],
];

function plan(d: Dataset, rows: Row[]) {
  const ws = [...new Set(rows.map((r) => r.witel))].sort();
  const topN = Math.min(10, rows.length);
  const kpiY = HEADER + 20;
  const kpiH = 112;
  const podY = kpiY + kpiH + GAP;
  const podH = 330;
  const r3Y = podY + podH + GAP;
  const wsCardH = Math.max(ws.length * 34 + 78, 130);
  const rankH = Math.max(topN * 32 + 84, wsCardH + GAP + 230);
  const distH = rankH - wsCardH - GAP;
  const indY = r3Y + rankH + GAP;
  const indH = d.indicators.length * 30 + 84;
  const hmY = indY + indH + GAP;
  const hmRowH = 34;
  const hmH = 84 + (ws.length > 1 ? ws.length + 1 : ws.length) * hmRowH + 60;
  const H = hmY + hmH + 64;
  return { ws, topN, kpiY, kpiH, podY, podH, r3Y, wsCardH, rankH, distH, indY, indH, hmY, hmRowH, hmH, H };
}

export function metabrightVizSize(d: Dataset, rows: Row[]) {
  return { W, H: plan(d, rows).H };
}

function card(ctx: Ctx, x: number, y: number, w: number, h: number, title: string, sub?: string) {
  ctx.fillStyle = "#ffffff";
  rr(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.save();
  rr(ctx, x, y, w, h, 14);
  ctx.clip();
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, "#510dfc");
  g.addColorStop(0.5, BLUE);
  g.addColorStop(1, "#0095fd");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, 5);
  ctx.restore();
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 14);
  ctx.stroke();
  ctx.fillStyle = BLUE;
  rr(ctx, x + 20, y + 24, 5, 18, 3);
  ctx.fill();
  ctx.fillStyle = NAVY;
  ctx.font = "800 15px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(fit(ctx, title.toUpperCase(), w - 56), x + 34, y + 33);
  if (sub) {
    ctx.fillStyle = MUTED;
    ctx.font = "12px Arial";
    ctx.fillText(fit(ctx, sub, w - 40), x + 34, y + 54);
  }
}

type Bar = { label: string; value: number; color: string; text: string };

function hBars(ctx: Ctx, x: number, y: number, w: number, bars: Bar[], max: number, rowH: number, labelW: number, ref?: { v: number; label?: string }) {
  const barX = x + labelW;
  const barMaxW = w - labelW - 64;
  if (ref) {
    const rx = barX + (Math.min(ref.v, max) / max) * barMaxW;
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(rx, y - 4);
    ctx.lineTo(rx, y + bars.length * rowH);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  bars.forEach((b, k) => {
    const cy = y + k * rowH + rowH / 2;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#334155";
    ctx.font = "600 12px Arial";
    ctx.fillText(fit(ctx, b.label, labelW - 12), x + labelW - 10, cy);
    ctx.fillStyle = "#eef2f7";
    rr(ctx, barX, cy - 8, barMaxW, 16, 8);
    ctx.fill();
    const bw = Math.max(6, (Math.min(b.value, max) / max) * barMaxW);
    ctx.fillStyle = b.color;
    rr(ctx, barX, cy - 8, bw, 16, 8);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = "#1e293b";
    ctx.font = "700 12px Arial";
    ctx.fillText(b.text, barX + bw + 8, cy);
  });
}

export function drawMetabrightViz(ctx: Ctx, d: Dataset, rows: Row[], period: string, timestamp: Date, scopeLabel: string) {
  const P = plan(d, rows);
  const { H } = P;
  const S = summarize(d, rows, 0);
  const wsColor = (w: string) => COL[P.ws.indexOf(w) % COL.length];

  // latar putih + bingkai
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  // header
  ctx.fillStyle = "#ffffff";
  rr(ctx, M, 24, 64, 64, 16);
  ctx.fill();
  ctx.strokeStyle = "#cbd5e1";
  rr(ctx, M + 0.5, 24.5, 63, 63, 16);
  ctx.stroke();
  const lg = ctx.createLinearGradient(M, 0, M + 64, 0);
  lg.addColorStop(0, "#510dfc");
  lg.addColorStop(1, "#0095fd");
  ctx.fillStyle = lg;
  ctx.font = "800 26px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("MB", M + 32, 57);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = BLUE;
  ctx.font = "700 12px Arial";
  ctx.fillText("PRIME • METABRIGHT  |  VISUALISASI", M + 82, 40);
  ctx.fillStyle = NAVY;
  ctx.font = "700 30px Arial";
  ctx.fillText("Impactful Award Telda", M + 82, 74);
  ctx.fillStyle = "#475569";
  ctx.font = "600 14px Arial";
  ctx.fillText(`${period}  |  ${scopeLabel}  |  ${rows.length} telda  |  Indikator: ${S.ind.name}`, M + 82, 98);
  ctx.textAlign = "right";
  ctx.fillStyle = MUTED;
  ctx.font = "600 13px Arial";
  ctx.fillText(`Rendered ${formatJakartaDateTime(timestamp, true)}`, W - M, 98);
  ctx.textAlign = "left";
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, HEADER - 4);
  ctx.lineTo(W - M, HEADER - 4);
  ctx.stroke();
  ctx.lineWidth = 1;

  // KPI
  const kw = (CW - GAP * 4) / 5;
  S.kpis.forEach((k, n) => {
    const x = M + n * (kw + GAP);
    const y = P.kpiY;
    ctx.fillStyle = "#ffffff";
    rr(ctx, x, y, kw, P.kpiH, 14);
    ctx.fill();
    ctx.save();
    rr(ctx, x, y, kw, P.kpiH, 14);
    ctx.clip();
    ctx.fillStyle = k.color;
    ctx.fillRect(x, y, kw, 5);
    ctx.restore();
    ctx.strokeStyle = BORDER;
    rr(ctx, x + 0.5, y + 0.5, kw - 1, P.kpiH - 1, 14);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = k.color;
    ctx.font = "800 11px Arial";
    ctx.fillText(fit(ctx, k.label.toUpperCase(), kw - 28), x + 16, y + 24);
    ctx.fillStyle = NAVY;
    ctx.font = "800 32px Arial";
    ctx.fillText(k.value, x + 16, y + 56);
    ctx.fillStyle = MUTED;
    ctx.font = "700 11px Arial";
    ctx.fillText(fit(ctx, k.sub, kw - 28), x + 16, y + (k.bar != null ? 82 : 86));
    if (k.bar != null) {
      ctx.fillStyle = "#e2e8f0";
      rr(ctx, x + 16, y + 98, kw - 32, 6, 3);
      ctx.fill();
      const bg = ctx.createLinearGradient(x + 16, 0, x + kw - 16, 0);
      bg.addColorStop(0, "#f43f5e");
      bg.addColorStop(0.5, "#fbbf24");
      bg.addColorStop(1, "#10b981");
      ctx.fillStyle = bg;
      rr(ctx, x + 16, y + 98, Math.max(6, ((kw - 32) * k.bar) / 100), 6, 3);
      ctx.fill();
    }
  });

  // podium + sorotan
  const podW = Math.round(CW * 0.56);
  card(ctx, M, P.podY, podW, P.podH, "Tiga telda teratas", "Berdasarkan total score, skor maksimum 110");
  const top3 = S.sorted.slice(0, 3);
  const order = [1, 0, 2].filter((k) => top3[k]);
  const pcw = (podW - 64) / 3;
  const baseY = P.podY + P.podH - 22;
  const heights = [130, 100, 78];
  const medal = [["#fbbf24", "#d97706"], ["#cbd5e1", "#64748b"], ["#a78bfa", "#6d28d9"]];
  order.forEach((k, n) => {
    const r = top3[k];
    const cx = M + 32 + n * pcw + pcw / 2;
    const bh = heights[k];
    const bw = pcw - 36;
    const g = ctx.createLinearGradient(0, baseY - bh, 0, baseY);
    g.addColorStop(0, medal[k][0]);
    g.addColorStop(1, medal[k][1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(cx - bw / 2, baseY - bh, bw, bh, [12, 12, 0, 0]);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 38px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(k + 1), cx, baseY - bh / 2);
    ctx.fillStyle = BLUE;
    ctx.font = "800 28px Arial";
    ctx.fillText(nf(r.total), cx, baseY - bh - 20);
    ctx.fillStyle = NAVY;
    ctx.font = "800 13px Arial";
    ctx.fillText(fit(ctx, r.telda.toUpperCase(), pcw - 12), cx, baseY - bh - 48);
    ctx.fillStyle = MUTED;
    ctx.font = "11px Arial";
    ctx.fillText(fit(ctx, r.witel.toUpperCase(), pcw - 12), cx, baseY - bh - 65);
  });
  ctx.strokeStyle = "#dbeafe";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(M + 20, baseY + 1.5);
  ctx.lineTo(M + podW - 20, baseY + 1.5);
  ctx.stroke();
  ctx.lineWidth = 1;

  const sorX = M + podW + GAP;
  const sorW = CW - podW - GAP;
  card(ctx, sorX, P.podY, sorW, P.podH, "Sorotan", "Dihitung dari hasil filter saat ini");
  const sw = (sorW - 40 - GAP) / 2;
  const sh = (P.podH - 76 - 24 - GAP) / 2;
  S.sor.forEach((s, n) => {
    const x = sorX + 20 + (n % 2) * (sw + GAP);
    const y = P.podY + 76 + Math.floor(n / 2) * (sh + GAP);
    ctx.fillStyle = "#fbfcff";
    rr(ctx, x, y, sw, sh, 10);
    ctx.fill();
    ctx.strokeStyle = "#d9e2f1";
    rr(ctx, x + 0.5, y + 0.5, sw - 1, sh - 1, 10);
    ctx.stroke();
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.roundRect(x, y, 5, sh, [10, 0, 0, 10]);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = s.color;
    ctx.font = "800 11.5px Arial";
    ctx.fillText(fit(ctx, s.title.toUpperCase(), sw - 32), x + 18, y + 26);
    ctx.fillStyle = "#475569";
    ctx.font = "13px Arial";
    wrap(ctx, s.text, sw - 36, 4).forEach((line, li) => ctx.fillText(line, x + 18, y + 48 + li * 18));
  });

  // peringkat total score
  const rankW = Math.round(CW * 0.5);
  card(ctx, M, P.r3Y, rankW, P.rankH, `Peringkat total score (${P.topN} teratas)`, "Warna menunjukkan witel · garis putus-putus = rata-rata");
  const meanAll = avg(rows.map((r) => r.total));
  const rankRowH = Math.min(46, Math.floor((P.rankH - 76 - 44) / P.topN));
  hBars(
    ctx,
    M + 14,
    P.r3Y + 76,
    rankW - 28,
    S.sorted.slice(0, P.topN).map((r, k) => ({ label: `${k + 1}. ${r.telda}`, value: r.total, color: wsColor(r.witel), text: nf(r.total) })),
    110,
    rankRowH,
    150,
    { v: meanAll },
  );
  // legenda witel
  let lx = M + 24;
  const ly = P.r3Y + P.rankH - 20;
  ctx.textBaseline = "middle";
  ctx.font = "700 11px Arial";
  for (const w of P.ws) {
    const tw = ctx.measureText(w.toUpperCase()).width;
    if (lx + tw + 28 > M + rankW - 16) break;
    ctx.fillStyle = wsColor(w);
    rr(ctx, lx, ly - 5, 10, 10, 3);
    ctx.fill();
    ctx.fillStyle = MUTED;
    ctx.textAlign = "left";
    ctx.fillText(w.toUpperCase(), lx + 16, ly);
    lx += tw + 36;
  }

  // rata-rata per witel + distribusi
  const rx = M + rankW + GAP;
  const rw = CW - rankW - GAP;
  card(ctx, rx, P.r3Y, rw, P.wsCardH, "Rata-rata total score per witel", "Skor maksimum 110 · jumlah telda di dalam kurung");
  const wsBars = P.ws
    .map((w) => {
      const rs = rows.filter((r) => r.witel === w);
      return { label: `${w} (${rs.length})`, value: avg(rs.map((r) => r.total)), color: wsColor(w), text: "" };
    })
    .sort((a, b) => b.value - a.value)
    .map((b) => ({ ...b, text: nf(b.value) }));
  hBars(ctx, rx + 14, P.r3Y + 76, rw - 28, wsBars, 110, 34, 215);

  const dy = P.r3Y + P.wsCardH + GAP;
  card(ctx, rx, dy, rw, P.distH, "Distribusi pencapaian indikator", `Jumlah telda per rentang ACH — ${S.ind.name}`);
  const counts = DIST_BUCKETS.map(([label, lo, hi, color]) => ({ label, color, n: rows.filter((r) => r.v[0][2] >= lo && r.v[0][2] < hi).length }));
  const maxN = Math.max(1, ...counts.map((c) => c.n));
  const chartTop = dy + 84;
  const chartBottom = dy + P.distH - 34;
  const cwid = (rw - 60) / counts.length;
  counts.forEach((c, n) => {
    const bx = rx + 30 + n * cwid + 14;
    const bw = cwid - 28;
    const bh = Math.max(4, ((chartBottom - chartTop - 22) * c.n) / maxN);
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.roundRect(bx, chartBottom - bh, bw, bh, [10, 10, 3, 3]);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#1e293b";
    ctx.font = "800 13px Arial";
    ctx.fillText(String(c.n), bx + bw / 2, chartBottom - bh - 12);
    ctx.fillStyle = "#475569";
    ctx.font = "700 11.5px Arial";
    ctx.fillText(c.label, bx + bw / 2, chartBottom + 16);
  });
  ctx.strokeStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(rx + 24, chartBottom + 0.5);
  ctx.lineTo(rx + rw - 24, chartBottom + 0.5);
  ctx.stroke();

  // capaian rata-rata per indikator
  card(ctx, M, P.indY, CW, P.indH, "Capaian rata-rata per indikator", "Skor diperoleh terhadap bobot indikator (%) · ≥ 80% hijau, 50–79% kuning, < 50% merah");
  hBars(
    ctx,
    M + 14,
    P.indY + 76,
    CW - 28,
    S.iv.map((x) => ({ label: x.n, value: x.p, color: x.p >= 80 ? "#059669" : x.p >= 50 ? "#f59e0b" : "#e11d48", text: nf(x.p, 1) + "%" })),
    110,
    30,
    300,
    { v: 100 },
  );

  // peta capaian witel per indikator
  card(ctx, M, P.hmY, CW, P.hmH, "Peta capaian witel per indikator", "Rata-rata skor diperoleh terhadap bobot indikator. Sel merah menunjukkan area yang perlu dikejar.");
  const nI = d.indicators.length;
  const firstW = 180;
  const lastW = 100;
  const cellW = (CW - 40 - firstW - lastW) / nI;
  const hx = M + 20;
  const hy = P.hmY + 72;
  const headH = 52;
  ctx.fillStyle = "#1d4ed8";
  rr(ctx, hx, hy, CW - 40, headH, 8);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "700 12px Arial";
  ctx.fillText("Witel", hx + 14, hy + headH / 2);
  d.indicators.forEach((x, k) => {
    ctx.textAlign = "center";
    ctx.font = "700 10px Arial";
    const lines = [...wrap(ctx, x.name, cellW - 6, 2), `(${x.weight})`];
    const top = hy + headH / 2 - ((lines.length - 1) * 12) / 2;
    lines.forEach((ln, li) => {
      ctx.fillStyle = li === lines.length - 1 ? "#bfdbfe" : "#ffffff";
      ctx.fillText(ln, hx + firstW + k * cellW + cellW / 2, top + li * 12);
    });
  });
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "700 11px Arial";
  ctx.fillText("Rata-rata", hx + CW - 40 - lastW / 2, hy + headH / 2 - 7);
  ctx.fillText("total score", hx + CW - 40 - lastW / 2, hy + headH / 2 + 7);
  const lines: { name: string; rs: Row[]; all?: boolean }[] = P.ws.map((w) => ({ name: w, rs: rows.filter((r) => r.witel === w) }));
  if (P.ws.length > 1) lines.push({ name: "Semua witel", rs: rows, all: true });
  lines.forEach((ln, li) => {
    const y = hy + headH + li * P.hmRowH;
    if (ln.all) {
      ctx.fillStyle = "#eef2f7";
      ctx.fillRect(hx, y, CW - 40, P.hmRowH);
    }
    ctx.strokeStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(hx, y + P.hmRowH - 0.5);
    ctx.lineTo(hx + CW - 40, y + P.hmRowH - 0.5);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = NAVY;
    ctx.font = "800 12px Arial";
    ctx.fillText(fit(ctx, ln.name.toUpperCase(), firstW - 20), hx + 14, y + P.hmRowH / 2 - 5);
    ctx.fillStyle = MUTED;
    ctx.font = "10px Arial";
    ctx.fillText(`${ln.rs.length} telda`, hx + 14, y + P.hmRowH / 2 + 8);
    d.indicators.forEach((x, k) => {
      if (!x.weight || !ln.rs.length) return;
      const v = avg(ln.rs.map((r) => (r.v[k][3] / x.weight) * 100));
      pill(ctx, hx + firstW + k * cellW + cellW / 2, y + P.hmRowH / 2, nf(v, 0) + "%", pillStyle(v), Math.min(52, cellW - 8));
    });
    ctx.textAlign = "center";
    ctx.fillStyle = NAVY;
    ctx.font = "800 13px Arial";
    ctx.fillText(nf(avg(ln.rs.map((r) => r.total))), hx + CW - 40 - lastW / 2, y + P.hmRowH / 2);
  });

  // footer
  ctx.strokeStyle = "#cbd5e1";
  ctx.beginPath();
  ctx.moveTo(M, H - 44.5);
  ctx.lineTo(W - M, H - 44.5);
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = BLUE;
  ctx.font = "700 12px Arial";
  ctx.fillText(`Dibuat ${formatJakartaDateTime(timestamp, false)} · Dashboard Impactful Award Telda`, M, H - 24);
}
