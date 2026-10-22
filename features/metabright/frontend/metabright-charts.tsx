"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import type { Dataset, Row } from "@/features/metabright/domain/types";
import { COL, avg, fmt, nf } from "@/features/metabright/domain/utils";

const GRID = "#e6ecf7";
const AXIS = { fontSize: 11, fill: "#475569" };
const LBL = { fontSize: 11, fontWeight: 700, fill: "#1e293b" };
const tipStyle = { background: "rgba(26,20,87,.96)", border: 0, borderRadius: 12, color: "#fff", fontSize: 12, padding: "8px 12px", boxShadow: "0 12px 30px rgba(15,23,42,.25)" };
const tipItem = { color: "#fff" };
const tv = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0));


/* trek abu-abu di belakang bar: menunjukkan "ruang" sampai skor maksimum */
const TRACK = { fill: "#f1f5f9", radius: 10 } as never;

/* label pill kecil di atas garis referensi (garis putus-putus) */
function RefTag({ viewBox, text, color }: { viewBox?: { x?: number; y?: number }; text: string; color: string }) {
  const x = viewBox?.x ?? 0;
  const y = (viewBox?.y ?? 0) - 8;
  const w = text.length * 6.4 + 18;
  return (
    <g>
      <rect x={x - w / 2} y={y - 20} width={w} height={20} rx={10} fill={color} />
      <text x={x} y={y - 10} textAnchor="middle" dominantBaseline="central" fontSize={10.5} fontWeight={800} fill="#fff">{text}</text>
    </g>
  );
}

type LblProps = { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown };
const pos = (p: LblProps) => ({ x: Number(p.x ?? 0), y: Number(p.y ?? 0), w: Number(p.width ?? 0), h: Number(p.height ?? 0), v: Number(p.value ?? 0) });

/* angka di ujung bar + selisih terhadap rata-rata (▲ di atas / ▼ di bawah garis putus-putus) */
const deltaLabel = (mean: number) => function DeltaLabel(p: LblProps) {
  const { x, y, w, h, v } = pos(p);
  const d = v - mean;
  const up = d >= 0;
  return (
    <text x={x + w + 8} y={y + h / 2} dominantBaseline="central" fontSize={11.5} fontWeight={800} fill="#0f172a">
      {nf(v)}
      <tspan dx={6} fontSize={10} fontWeight={700} fill={up ? "#059669" : "#e11d48"}>{up ? "▲" : "▼"} {nf(Math.abs(d))}</tspan>
    </text>
  );
};

/* batas sumbu dinamis supaya bar > 100% tidak terpotong */
const niceMax = (vals: number[], floor: number) => Math.max(floor, Math.ceil((Math.max(0, ...vals) + 8) / 10) * 10);

export const witelColor = (ws: string[], w: string) => COL[ws.indexOf(w) % COL.length];

/* 1. Peringkat total score */
export function RankChart({ rows, ws, topN }: { rows: Row[]; ws: string[]; topN: number }) {
  const top = [...rows].sort((a, b) => b.total - a.total).slice(0, topN || rows.length);
  const data = top.map((r, k) => ({ label: `${k + 1}. ${r.telda}`, telda: r.telda, witel: r.witel, total: r.total }));
  const h = top.length * (top.length <= 12 ? 46 : 30) + 64;
  /* garis putus-putus = rata-rata total score SEMUA telda hasil filter (bukan hanya yang tampil di grafik) */
  const mean = avg(rows.map((r) => r.total));
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 34, right: 40, bottom: 4, left: 4 }} barCategoryGap="22%">
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" domain={[0, 110]} ticks={[0, 25, 50, 75, 100]} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={150} interval={0} tick={{ ...AXIS, fontWeight: 600, fill: "#334155" }} axisLine={false} tickLine={false} />
        <ReferenceLine x={mean} stroke="#334155" strokeWidth={1.5} strokeDasharray="6 4" ifOverflow="extendDomain" label={<RefTag text={"Rata-rata " + nf(mean)} color="#334155" />} />
        <Tooltip
          cursor={{ fill: "rgba(148,163,184,.12)" }}
          contentStyle={tipStyle}
          itemStyle={tipItem}
          labelStyle={{ color: "#fff", fontWeight: 700 }}
          formatter={(v: unknown, _n: unknown, p: unknown) => {
            const d = tv(v) - mean;
            return [
              `${nf(tv(v))}  (${d >= 0 ? "+" : "−"}${nf(Math.abs(d))} dari rata-rata)`,
              (p as { payload?: { witel?: string } }).payload?.witel ?? "Total score",
            ];
          }}
        />
        <Bar dataKey="total" radius={[0, 10, 10, 0]} maxBarSize={top.length <= 12 ? 26 : 16} background={TRACK} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={witelColor(ws, d.witel)} />)}
          <LabelList dataKey="total" position="right" content={deltaLabel(mean) as never} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* 2. Rata-rata total score per witel */
export function WitelChart({ rows, ws }: { rows: Row[]; ws: string[] }) {
  const data = ws
    .map((w) => {
      const rs = rows.filter((r) => r.witel === w);
      return { witel: w, label: `${w} (${rs.length})`, v: +avg(rs.map((r) => r.total)).toFixed(2), n: rs.length };
    })
    .filter((x) => x.n)
    .sort((a, b) => b.v - a.v);
  return (
    <ResponsiveContainer width="100%" height={data.length * 38 + 30}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" domain={[0, 110]} ticks={[0, 25, 50, 75, 100]} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={150} interval={0} tick={{ ...AXIS, fontWeight: 600, fill: "#334155" }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "rgba(148,163,184,.12)" }} contentStyle={tipStyle} itemStyle={tipItem} formatter={(v: unknown) => [nf(tv(v)), "Rata-rata"]} />
        <Bar dataKey="v" radius={[0, 10, 10, 0]} maxBarSize={22} background={TRACK} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={witelColor(ws, d.witel)} />)}
          <LabelList dataKey="v" position="right" formatter={(v: unknown) => nf(Number(v))} style={LBL} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* helper: capaian rata-rata per indikator (% dari bobot) */
export const indicatorAvg = (rows: Row[], d: Dataset) =>
  d.indicators.map((x, k) => (x.weight ? avg(rows.map((r) => (r.v[k][3] / x.weight) * 100)) : 0));

/* label sumbu Y yang dipotong rapi (maks. 2 baris) */
function WrapTick(props: { x?: number; y?: number; payload?: { value: string } }) {
  const { x = 0, y = 0, payload } = props;
  const t = payload?.value ?? "";
  const max = 26;
  let a = t, b = "";
  if (t.length > max) {
    const cut = t.lastIndexOf(" ", max);
    a = t.slice(0, cut > 0 ? cut : max);
    b = t.slice(a.length).trim();
    if (b.length > max) b = b.slice(0, max - 1) + "…";
  }
  return (
    <text x={x - 6} y={y} textAnchor="end" fill="#334155" fontSize={11} fontWeight={600}>
      <title>{t}</title>
      <tspan x={x - 6} dy={b ? "-0.3em" : "0.35em"}>{a}</tspan>
      {b && <tspan x={x - 6} dy="1.15em">{b}</tspan>}
    </text>
  );
}

/* 3. Capaian rata-rata per indikator */
export function IndicatorChart({ rows, d }: { rows: Row[]; d: Dataset }) {
  const iv = indicatorAvg(rows, d);
  const data = d.indicators.map((x, k) => ({ name: x.name, v: +iv[k].toFixed(1) }));
  /* sumbu mengikuti nilai tertinggi (mis. OCA bisa > 100%) agar bar & angkanya tidak terpotong */
  const max = niceMax(data.map((x) => x.v), 110);
  const ticks = [0, 25, 50, 75, 100, ...(max > 110 ? [Math.floor(max / 10) * 10] : [])];
  return (
    <ResponsiveContainer width="100%" height={data.length * 36 + 48}>
      <BarChart data={data} layout="vertical" margin={{ top: 34, right: 24, bottom: 4, left: 4 }} barCategoryGap="22%">
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" domain={[0, max]} ticks={ticks} tickFormatter={(v) => v + "%"} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={170} interval={0} tick={<WrapTick />} axisLine={false} tickLine={false} />
        <ReferenceLine x={100} stroke="#334155" strokeWidth={1.5} strokeDasharray="6 4" label={<RefTag text="Target 100%" color="#334155" />} />
        <Tooltip cursor={{ fill: "rgba(148,163,184,.12)" }} contentStyle={tipStyle} itemStyle={tipItem} formatter={(v: unknown) => [nf(tv(v)) + "% dari bobot", "Capaian"]} />
        <Bar dataKey="v" radius={[0, 10, 10, 0]} maxBarSize={20} background={TRACK} isAnimationActive={false}>
          {data.map((d2, i) => <Cell key={i} fill={d2.v >= 80 ? "#059669" : d2.v >= 50 ? "#f59e0b" : "#e11d48"} />)}
          <LabelList dataKey="v" position="right" formatter={(v: unknown) => nf(Number(v), 1) + "%"} style={LBL} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* 4. Profil capaian telda (radar) */
export function RadarProfile({ t, rows, d }: { t?: Row; rows: Row[]; d: Dataset }) {
  const iv = indicatorAvg(rows, d);
  const short = (s: string) => (s.length > 18 ? s.slice(0, 17) + "…" : s);
  const data = d.indicators.map((x, k) => ({
    name: short(x.name),
    full: x.name,
    telda: t ? +((t.v[k][3] / (x.weight || 1)) * 100).toFixed(1) : 0,
    rata: +iv[k].toFixed(1),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} outerRadius="58%" margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
        <PolarGrid stroke="#e2e8f0" />
        <PolarAngleAxis dataKey="name" tick={{ fontSize: 10.5, fill: "#334155", fontWeight: 600 }} />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={5} tickFormatter={(v) => v + "%"} tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} />
        <Radar name={t?.telda ?? "-"} dataKey="telda" stroke="#1a44fc" fill="#1a44fc" fillOpacity={0.28} strokeWidth={2.5} isAnimationActive={false} />
        <Radar name="Rata-rata filter" dataKey="rata" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.08} strokeWidth={2} strokeDasharray="5 4" isAnimationActive={false} />
        <Legend verticalAlign="bottom" iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
        <Tooltip contentStyle={tipStyle} itemStyle={tipItem} labelStyle={{ color: "#fff", fontWeight: 700 }} formatter={(v: unknown) => nf(tv(v), 1) + "%"} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

/* 5. Distribusi pencapaian */
const BUCKETS: [string, number, number, string][] = [
  ["< 50%", 0, 50, "#e11d48"],
  ["50–79%", 50, 80, "#f59e0b"],
  ["80–99%", 80, 100, "#0095fd"],
  ["≥ 100%", 100, 1e9, "#059669"],
];

export function DistChart({ rows, i }: { rows: Row[]; i: number }) {
  const data = BUCKETS.map(([label, lo, hi, color]) => ({
    label, color, n: rows.filter((r) => r.v[i][2] >= lo && r.v[i][2] < hi).length,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 26, right: 8, bottom: 4, left: -8 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "rgba(148,163,184,.12)" }} contentStyle={tipStyle} itemStyle={tipItem} formatter={(v: unknown) => [tv(v), "Telda"]} />
        <Bar dataKey="n" radius={[10, 10, 4, 4]} maxBarSize={72} minPointSize={3} isAnimationActive={false}>
          {data.map((d, k) => <Cell key={k} fill={d.color} />)}
          <LabelList dataKey="n" position="top" style={LBL} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* 6. Target, realisasi, achievement */
export function TargetChart({ rows, i }: { rows: Row[]; i: number }) {
  const data = rows.map((r) => {
    const [tg, re] = r.v[i];
    return { telda: r.telda, Target: tg, Realisasi: re, Shortage: Math.max(tg - re, 0), ach: tg ? +((re / tg) * 100).toFixed(1) : 0 };
  });
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="telda" interval={0} angle={-55} textAnchor="end" height={90} tick={AXIS} />
        <YAxis tickFormatter={(v) => fmt(v)} tick={AXIS} width={90} />
        <YAxis yAxisId="r" orientation="right" domain={[0, "auto"]} axisLine={false} tickFormatter={(v) => v + "%"} tick={AXIS} />
        <Tooltip
          contentStyle={tipStyle}
          itemStyle={tipItem}
          labelStyle={{ color: "#fff", fontWeight: 700 }}
          formatter={(v: unknown, name: unknown) => (name === "Achievement (%)" ? nf(tv(v)) + "%" : fmt(tv(v)))}
        />
        <Legend verticalAlign="top" align="right" iconType="circle" iconSize={9} wrapperStyle={{ paddingBottom: 8, fontSize: 12, fontWeight: 700 }} />
        <Bar dataKey="Target" fill="#cbd5e1" radius={[6, 6, 0, 0]} maxBarSize={14} isAnimationActive={false} />
        <Bar dataKey="Realisasi" fill="#1a44fc" radius={[6, 6, 0, 0]} maxBarSize={14} isAnimationActive={false} />
        <Bar dataKey="Shortage" fill="#fb7185" radius={[6, 6, 0, 0]} maxBarSize={14} isAnimationActive={false} />
        <Line yAxisId="r" type="monotone" dataKey="ach" name="Achievement (%)" stroke="#059669" strokeWidth={2.5} dot={{ r: 3, fill: "#fff", stroke: "#059669" }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
