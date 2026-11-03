"use client";

/**
 * Komponen visual bersama untuk tab "Witel YJS" dan sorotan Home (HSI & WMS).
 *
 * ATURAN DATA: komponen ini TIDAK menghitung ulang realisasi/target. Semua angka utama dibaca langsung dari
 * hasil `computeReport` / `computeWmsReport` (lewat adapter `fromHsi` / `fromWms`). Satu-satunya angka turunan adalah
 * yang diberi label "estimasi" (proyeksi run-rate, kebutuhan harian) dan rasio kontribusi; rumusnya ditampilkan di UI.
 */

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Crown,
  Flag,
  Gauge,
  MapPinned,
  Medal,
  Rocket,
  ShieldAlert,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";

export const YJS_LABEL = "YOGYA JATENG SELATAN";

export type YjsTheme = "hsi" | "wms" | "lts";

export const themeStyle = {
  hsi: {
    primary: "#2563eb",
    secondary: "#38bdf8",
    soft: "#dbeafe",
    heroClass: "bg-[linear-gradient(135deg,#071426_0%,#0b2a5b_55%,#1d4ed8_100%)]",
    chipClass: "bg-blue-50 text-blue-700 ring-blue-100",
    buttonClass: "bg-[#071426] text-white hover:bg-[#0b2a5b]",
    activeTabClass: "bg-[#071426] text-white",
    label: "HSI",
  },
  wms: {
    primary: "#d97706",
    secondary: "#fbbf24",
    soft: "#fef3c7",
    heroClass: "bg-[linear-gradient(135deg,#2a1a10_0%,#5b330f_55%,#d97706_100%)]",
    chipClass: "bg-amber-50 text-amber-800 ring-amber-100",
    buttonClass: "bg-[#3b2414] text-white hover:bg-[#4b2d18]",
    activeTabClass: "bg-[#3b2414] text-white",
    label: "WMS",
  },
  lts: {
    primary: "#7c3aed",
    secondary: "#c084fc",
    soft: "#ede9fe",
    heroClass: "bg-[linear-gradient(135deg,#1e1040_0%,#4c1d95_55%,#7c3aed_100%)]",
    chipClass: "bg-violet-50 text-violet-800 ring-violet-100",
    buttonClass: "bg-[#24103f] text-white hover:bg-[#3b1c66]",
    activeTabClass: "bg-[#24103f] text-white",
    label: "LTS",
  },
} as const;

/** Gaya tab Witel YJS saja: diselaraskan dengan header Executive Overview pada Home.
 * HomeHighlights dan seluruh tab lain tetap memakai tema aslinya. */
export const yjsPanelTheme = {
  hsi: { ...themeStyle.hsi, primary: "#3b82f6", secondary: "#60a5fa", soft: "#eff6ff", heroClass: "bg-[#101f38]", accent: "#3b82f6" },
  wms: { ...themeStyle.wms, primary: "#0f766e", secondary: "#14b8a6", soft: "#f0fdfa", heroClass: "bg-[#101f38]", accent: "#14b8a6" },
  lts: { ...themeStyle.lts, primary: "#7c3aed", secondary: "#a78bfa", soft: "#f5f3ff", heroClass: "bg-[#101f38]", accent: "#8b5cf6" },
} as const;

const GOOD = "#059669";
const WARN = "#d97706";
const BAD = "#e11d48";
const MUTED = "#94a3b8";

/* ------------------------------------------------------------------ */
/* Tipe & adapter                                                      */
/* ------------------------------------------------------------------ */

export type MetricRow = {
  label: string;
  targetFm: number;
  mtd: number;
  ach: number | null;
  shortageFm: number;
  targetYtd: number;
  realYtd: number;
  achYtd: number | null;
  shortageYtd: number;
  realMtdPrev: number;
  realFmPrev: number;
  growthMtd: number | null;
  growthFm: number | null;
  growthYtd: number | null;
  rank: number | null;
  rankYtd: number | null;
  days: (number | null)[];
};
export type MetricTable = { rows: MetricRow[]; total: MetricRow };
export type MetricVariant = { key: string; label: string; targetName: string; witel: MetricTable; telda: MetricTable };

type HsiLike = {
  label: string; targetFm: number; mtd: number; targetAch: number | null; shortageFm: number; targetYtd: number;
  realYtd: number; achYtd: number | null; shortageYtd: number; realMtdPrev: number; realFmPrev: number;
  growthMtd: number | null; growthFm: number | null; growthYtd: number | null; rankAch: number | null;
  rankYtd: number | null; days: (number | null)[];
};
type WmsLike = {
  label: string; targetFm: number; mtd: number; ach: number | null; shortageFm: number; targetYtd: number;
  realYtd: number; achYtd: number | null; shortageYtd: number; realMtdPrev: number; realFmPrev: number;
  growthMtd: number | null; growthFm: number | null; growthYtd: number | null; rank: number | null;
  rankYtd: number | null; days: (number | null)[];
};

export function fromHsi(row: HsiLike): MetricRow {
  return {
    label: row.label, targetFm: row.targetFm, mtd: row.mtd, ach: row.targetAch, shortageFm: row.shortageFm,
    targetYtd: row.targetYtd, realYtd: row.realYtd, achYtd: row.achYtd, shortageYtd: row.shortageYtd,
    realMtdPrev: row.realMtdPrev, realFmPrev: row.realFmPrev, growthMtd: row.growthMtd, growthFm: row.growthFm,
    growthYtd: row.growthYtd, rank: row.rankAch, rankYtd: row.rankYtd, days: row.days,
  };
}
export function fromWms(row: WmsLike): MetricRow {
  return {
    label: row.label, targetFm: row.targetFm, mtd: row.mtd, ach: row.ach, shortageFm: row.shortageFm,
    targetYtd: row.targetYtd, realYtd: row.realYtd, achYtd: row.achYtd, shortageYtd: row.shortageYtd,
    realMtdPrev: row.realMtdPrev, realFmPrev: row.realFmPrev, growthMtd: row.growthMtd, growthFm: row.growthFm,
    growthYtd: row.growthYtd, rank: row.rank, rankYtd: row.rankYtd, days: row.days,
  };
}
export function tableOf<T>(rows: T[], total: T, map: (row: T) => MetricRow): MetricTable {
  return { rows: rows.map(map), total: map(total) };
}

/** True bila filter periode = tepat satu bulan penuh (maka tanggal 1..N bermakna sebagai kalender). */
export function isFullSingleMonth(filter: { endDate: string; endMonth: string; mode: string; startDate: string; startMonth: string }) {
  if (filter.mode === "ytd") return false;
  if (!filter.startMonth || filter.startMonth !== filter.endMonth) return false;
  const year = Number(filter.endMonth.slice(0, 4));
  const month = Number(filter.endMonth.slice(4, 6));
  if (!year || !month) return false;
  const last = new Date(year, month, 0).getDate();
  return filter.startDate.slice(8, 10) === "01" && Number(filter.endDate.slice(8, 10)) === last;
}

/* ------------------------------------------------------------------ */
/* Format                                                              */
/* ------------------------------------------------------------------ */

export const fmtNum = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? "–" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(v);
export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "–"
    : `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v * 100)}%`;
export const fmtSigned = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? "–" : `${v > 0 ? "+" : ""}${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(v)}`;
export const fmtGrowth = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? "–" : `${v > 0 ? "+" : ""}${fmtPct(v, 1)}`;

const achColor = (v: number | null | undefined) => (v === null || v === undefined ? MUTED : v >= 1 ? GOOD : v >= 0.8 ? WARN : BAD);
const norm = (v: string) => v.trim().toUpperCase();
function cumulativeSums(values: (number | null)[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (const value of values) {
    sum += value ?? 0;
    out.push(sum);
  }
  return out;
}
const lastPopulatedDay = (days: (number | null)[]) => {
  for (let i = days.length - 1; i >= 0; i -= 1) if ((days[i] ?? 0) > 0) return i + 1;
  return 0;
};

/* ------------------------------------------------------------------ */
/* Elemen kecil                                                        */
/* ------------------------------------------------------------------ */

export function Card({ title, subtitle, children, right, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.45)] ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-800">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs leading-5 text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Ring({ value, size = 132, color, label }: { value: number | null; size?: number; color: string; label?: string }) {
  const pct = value === null ? 0 : Math.max(0, value);
  const shown = Math.min(pct, 1);
  const r = size / 2 - 11;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ height: size, width: size }}>
      <svg height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
        <circle cx={size / 2} cy={size / 2} fill="none" r={r} stroke="rgba(255,255,255,0.16)" strokeWidth={11} />
        <circle
          cx={size / 2} cy={size / 2} fill="none" r={r} stroke={color} strokeDasharray={`${c * shown} ${c}`}
          strokeLinecap="round" strokeWidth={11} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center text-white">
        <div>
          <p className="text-2xl font-extrabold leading-none">{fmtPct(value, 1)}</p>
          {label && <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/70">{label}</p>}
        </div>
      </div>
    </div>
  );
}

export function Kpi({ label, value, detail, tone = "default", icon }: { label: string; value: string; detail?: string; tone?: "default" | "good" | "bad" | "warn"; icon?: React.ReactNode }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : tone === "warn" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="min-w-0 rounded-xl border border-slate-200/80 bg-[linear-gradient(145deg,#fff,#f8fafc)] px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <p className={`mt-1.5 truncate text-[clamp(1.2rem,1.8vw,1.65rem)] font-extrabold tracking-tight ${color}`} title={value}>{value}</p>
      {detail && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{detail}</p>}
    </div>
  );
}

export function GrowthBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">–</span>;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
      {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {fmtGrowth(value)}
    </span>
  );
}

const tooltipStyle = { borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 12px 30px -16px rgba(15,23,42,.35)" };

/* ------------------------------------------------------------------ */
/* TAB WITEL YJS (HSI & WMS)                                           */
/* ------------------------------------------------------------------ */

export function WitelYjsPanel({
  theme, moduleName, periodLabel, cutoffLabel, source, variants, dailyMode,
}: {
  theme: "hsi" | "wms";
  moduleName: string;
  periodLabel: string;
  cutoffLabel: string;
  source: string;
  variants: MetricVariant[];
  dailyMode: "calendar" | "series";
}) {
  const t = yjsPanelTheme[theme];
  const [variantKey, setVariantKey] = useState(variants[0]?.key ?? "");
  const variant = variants.find((v) => v.key === variantKey) ?? variants[0];
  const yjs = variant?.witel.rows.find((r) => norm(r.label) === YJS_LABEL);

  const calc = useMemo(() => {
    if (!variant || !yjs) return null;
    const dayCount = yjs.days.length;
    const latest = lastPopulatedDay(yjs.days);
    const calendar = dailyMode === "calendar";
    const perDayTarget = dayCount > 0 ? yjs.targetFm / dayCount : 0;
    const cumulativeDays = cumulativeSums(yjs.days);
    const daily = yjs.days.map((value, index) => {
      const day = index + 1;
      const v = value ?? 0;
      return {
        day,
        harian: day <= latest ? v : null,
        kumulatif: day <= latest ? cumulativeDays[index] : null,
        targetKumulatif: calendar ? Number((perDayTarget * day).toFixed(2)) : null,
      };
    });
    const remaining = dayCount - latest;
    const projected = calendar && latest > 0 ? (yjs.mtd / latest) * dayCount : null;
    const needPerDay = calendar && remaining > 0 && yjs.targetFm > yjs.mtd ? (yjs.targetFm - yjs.mtd) / remaining : null;
    const avgPerDay = latest > 0 ? yjs.mtd / latest : null;
    const bestDay = yjs.days.reduce<{ day: number; value: number } | null>((best, v, i) => ((v ?? 0) > (best?.value ?? 0) ? { day: i + 1, value: v ?? 0 } : best), null);
    const maxDay = Math.max(1, ...yjs.days.map((v) => v ?? 0));
    const teldaMtd = variant.telda.rows.reduce((s, r) => s + r.mtd, 0);
    const teldaTarget = variant.telda.rows.reduce((s, r) => s + r.targetFm, 0);
    const sortedWitel = [...variant.witel.rows].sort((a, b) => (b.ach ?? -1) - (a.ach ?? -1));
    return { dayCount, latest, remaining, projected, needPerDay, avgPerDay, bestDay, maxDay, daily, teldaMtd, teldaTarget, sortedWitel, calendar };
  }, [variant, yjs, dailyMode]);

  if (!variant || !yjs || !calc) {
    return (
      <Card title="Witel Yogya Jateng Selatan" subtitle="Data belum tersedia">
        <p className="text-sm text-slate-600">Baris Witel YOGYA JATENG SELATAN tidak ditemukan pada laporan aktif. Upload MASTER periode ini di menu MASTER terlebih dahulu.</p>
      </Card>
    );
  }

  const teldaRows = variant.telda.rows;
  const teldaChart = teldaRows.map((r) => ({ name: r.label, Target: r.targetFm, Realisasi: r.mtd, ach: r.ach }));
  const contribution = teldaRows.filter((r) => r.mtd > 0).map((r) => ({ name: r.label, value: r.mtd, share: calc.teldaMtd > 0 ? r.mtd / calc.teldaMtd : 0 }));
  const palette = [t.primary, t.secondary, "#0ea5e9", "#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#64748b"];
  const witelChart = calc.sortedWitel.map((r) => ({ name: r.label === YJS_LABEL ? "YJS" : r.label, ach: (r.ach ?? 0) * 100, isYjs: norm(r.label) === YJS_LABEL }));
  const syncMtd = Math.abs(calc.teldaMtd - yjs.mtd) < 0.5;
  const syncTarget = Math.abs(calc.teldaTarget - yjs.targetFm) < 0.5;

  return (
    <div className="space-y-5">
      {/* HERO */}
      <section className={`relative overflow-hidden rounded-2xl ${t.heroClass} p-6 text-white shadow-[0_24px_60px_-34px_rgba(0,0,0,0.7)]`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1" style={{ backgroundColor: t.accent }} />
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full opacity-20 blur-3xl" style={{ backgroundColor: t.accent }} />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-[260px] flex-1">
            <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/70"><MapPinned className="h-4 w-4" /> Witel profile · {moduleName}</p>
            <h2 className="mt-2 text-2xl font-extrabold uppercase tracking-tight sm:text-3xl">Witel Yogya Jateng Selatan</h2>
            <p className="mt-2 text-xs font-medium uppercase leading-5 text-white/70">{periodLabel} · {cutoffLabel} · Sumber: {source}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/20"><Trophy className="h-3.5 w-3.5" /> Peringkat Ach MTD: {yjs.rank ?? "–"} dari {variant.witel.rows.length} witel</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/20"><Flag className="h-3.5 w-3.5" /> Peringkat Ach YTD: {yjs.rankYtd ?? "–"}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/20"><Target className="h-3.5 w-3.5" /> {variant.targetName}</span>
            </div>
            {variants.length > 1 && (
              <div className="mt-4 inline-flex rounded-xl bg-black/20 p-1">
                {variants.map((v) => (
                  <button key={v.key} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${v.key === variant.key ? "bg-white text-slate-900" : "text-white/80 hover:bg-white/10"}`} onClick={() => setVariantKey(v.key)} type="button">{v.label}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-6">
            <Ring color={achColor(yjs.ach) === BAD ? "#fb7185" : achColor(yjs.ach) === WARN ? "#fbbf24" : "#34d399"} label="Ach MTD" value={yjs.ach} />
            <Ring color="#e2e8f0" label="Ach YTD" size={104} value={yjs.achYtd} />
          </div>
        </div>
      </section>

      {/* KPI */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi detail={`Target FM: ${fmtNum(yjs.targetFm)}`} icon={<Gauge className="h-4 w-4" />} label="Realisasi MTD" value={fmtNum(yjs.mtd)} />
        <Kpi detail={yjs.shortageFm >= 0 ? "Melampaui target bulan ini" : "Kekurangan terhadap target FM"} icon={<Target className="h-4 w-4" />} label={yjs.shortageFm >= 0 ? "Surplus MTD" : "Shortage MTD"} tone={yjs.shortageFm >= 0 ? "good" : "bad"} value={fmtSigned(yjs.shortageFm)} />
        <Kpi detail={`Target YTD: ${fmtNum(yjs.targetYtd)}`} icon={<TrendingUp className="h-4 w-4" />} label="Realisasi YTD" value={fmtNum(yjs.realYtd)} />
        <Kpi detail={yjs.shortageYtd >= 0 ? "Melampaui target YTD" : "Kekurangan terhadap target YTD"} icon={<Flag className="h-4 w-4" />} label={yjs.shortageYtd >= 0 ? "Surplus YTD" : "Shortage YTD"} tone={yjs.shortageYtd >= 0 ? "good" : "bad"} value={fmtSigned(yjs.shortageYtd)} />
        <Kpi detail={`Bulan lalu (s.d. tanggal sama): ${fmtNum(yjs.realMtdPrev)}`} label="Growth MTD" tone={(yjs.growthMtd ?? 0) >= 0 ? "good" : "bad"} value={fmtGrowth(yjs.growthMtd)} />
        <Kpi detail={`Total bulan lalu: ${fmtNum(yjs.realFmPrev)}`} label="Growth vs FM bulan lalu" tone={(yjs.growthFm ?? 0) >= 0 ? "good" : "bad"} value={fmtGrowth(yjs.growthFm)} />
        <Kpi detail="Dibanding YTD tahun lalu" label="Growth YTD" tone={(yjs.growthYtd ?? 0) >= 0 ? "good" : "bad"} value={fmtGrowth(yjs.growthYtd)} />
        <Kpi detail={`Rata-rata harian: ${calc.avgPerDay === null ? "–" : fmtNum(calc.avgPerDay)}`} label="Data terakhir" value={calc.calendar ? (calc.latest > 0 ? `Tgl ${calc.latest}` : "–") : "Rentang"} />
      </div>

      {/* PROYEKSI */}
      {calc.calendar && calc.latest > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500"><Rocket className="h-4 w-4" /> Estimasi akhir bulan</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{fmtNum(calc.projected)}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Estimasi run-rate: realisasi MTD ÷ {calc.latest} hari data × {calc.dayCount} hari. Ini perkiraan, bukan angka laporan.</p>
            <p className="mt-2 text-xs font-semibold" style={{ color: achColor(calc.projected !== null && yjs.targetFm > 0 ? calc.projected / yjs.targetFm : null) }}>
              ≈ {fmtPct(calc.projected !== null && yjs.targetFm > 0 ? calc.projected / yjs.targetFm : null)} dari target FM
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500"><CalendarDays className="h-4 w-4" /> Kebutuhan harian</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{calc.needPerDay === null ? (yjs.mtd >= yjs.targetFm ? "Tercapai" : "–") : fmtNum(Math.ceil(calc.needPerDay))}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {calc.needPerDay === null ? "Target FM sudah terlampaui atau tidak ada sisa hari." : `Estimasi per hari untuk ${calc.remaining} hari tersisa agar mencapai target FM: (target − MTD) ÷ sisa hari.`}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500"><Crown className="h-4 w-4" /> Hari terbaik</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{calc.bestDay ? `Tgl ${calc.bestDay.day}` : "–"}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{calc.bestDay ? `${fmtNum(calc.bestDay.value)} realisasi dalam satu hari (nilai tertinggi periode ini).` : "Belum ada realisasi harian."}</p>
          </div>
        </div>
      )}

      {/* TREND */}
      <Card
        subtitle={calc.calendar ? "Batang = realisasi harian, garis = kumulatif realisasi vs target linier (target FM ÷ jumlah hari)." : "Rentang periode gabungan: sumbu x adalah urutan hari dalam rentang, bukan tanggal kalender."}
        title="Tren harian Witel YJS"
      >
        <div className="h-[340px]">
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart data={calc.daily} margin={{ bottom: 4, left: 0, right: 12, top: 8 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" fontSize={11} tickLine={false} />
              <YAxis fontSize={11} tickFormatter={(v) => fmtNum(Number(v))} tickLine={false} width={48} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNum(Number(v))} labelFormatter={(l) => `${calc.calendar ? "Tanggal" : "Hari ke-"} ${l}`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar barSize={14} dataKey="harian" fill={t.secondary} name="Realisasi harian" radius={[4, 4, 0, 0]} />
              <Line dataKey="kumulatif" dot={false} name="Kumulatif realisasi" stroke={t.primary} strokeWidth={3} type="monotone" />
              {calc.calendar && <Line dataKey="targetKumulatif" dot={false} name="Target linier" stroke="#64748b" strokeDasharray="6 5" strokeWidth={2} type="monotone" />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* HEATMAP */}
      {calc.calendar && (
        <Card subtitle="Intensitas warna relatif terhadap hari tertinggi. Kotak kosong = belum ada realisasi (atau data belum masuk)." title="Peta panas realisasi harian">
          <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-10 lg:grid-cols-[repeat(16,minmax(0,1fr))]">
            {yjs.days.map((value, i) => {
              const v = value ?? 0;
              const intensity = v / calc.maxDay;
              return (
                <div
                  key={i}
                  className="grid aspect-square place-items-center rounded-lg text-[11px] font-bold"
                  style={{ background: v > 0 ? t.primary : "#f1f5f9", color: v > 0 && intensity > 0.45 ? "#fff" : "#475569", opacity: v > 0 ? 0.25 + 0.75 * intensity : 1 }}
                  title={`Tanggal ${i + 1}: ${fmtNum(v)}`}
                >
                  <span>{i + 1}</span>
                  <span className="text-[9px] font-semibold opacity-90">{v > 0 ? fmtNum(v) : ""}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* TELDA */}
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card subtitle="Target FM vs realisasi MTD per Telda di Witel YJS. Label = achievement." title="Capaian per Telda">
          <div className="h-[380px]">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={teldaChart} layout="vertical" margin={{ left: 8, right: 56, top: 4 }}>
                <CartesianGrid horizontal={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis fontSize={11} tickFormatter={(v) => fmtNum(Number(v))} type="number" />
                <YAxis dataKey="name" fontSize={11} tickLine={false} type="category" width={92} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNum(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar barSize={10} dataKey="Target" fill="#cbd5e1" radius={[0, 4, 4, 0]} />
                <Bar barSize={10} dataKey="Realisasi" radius={[0, 4, 4, 0]}>
                  {teldaChart.map((row, i) => <Cell key={i} fill={achColor(row.ach)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Warna realisasi: hijau ≥100% target, kuning 80–99%, merah &lt;80%.</p>
        </Card>
        <Card subtitle="Porsi tiap Telda terhadap total realisasi MTD seluruh Telda (kontribusi = Telda ÷ jumlah Telda)." title="Kontribusi Telda">
          {contribution.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada realisasi.</p>
          ) : (
            <>
              <div className="h-[220px]">
                <ResponsiveContainer height="100%" width="100%">
                  <PieChart>
                    <Pie data={contribution} dataKey="value" innerRadius={55} nameKey="name" outerRadius={90} paddingAngle={2}>
                      {contribution.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNum(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1.5">
                {[...contribution].sort((a, b) => b.value - a.value).map((row) => (
                  <li key={row.name} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2 font-semibold text-slate-700"><i className="h-2.5 w-2.5 rounded-full" style={{ background: palette[contribution.findIndex((c) => c.name === row.name) % palette.length] }} />{row.name}</span>
                    <span className="text-slate-500">{fmtNum(row.value)} · <b className="text-slate-800">{fmtPct(row.share)}</b></span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      {/* WITEL COMPARISON */}
      <Card subtitle="Achievement MTD seluruh witel, diurutkan. Batang YJS disorot; garis putus = 100% target." title="Posisi YJS di antara witel">
        <div className="h-[320px]">
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={witelChart} margin={{ bottom: 24, left: 0, right: 12, top: 16 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis angle={-20} dataKey="name" fontSize={10} height={52} interval={0} textAnchor="end" tickLine={false} />
              <YAxis fontSize={11} tickFormatter={(v) => `${v}%`} tickLine={false} width={44} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} />
              <ReferenceLine stroke="#334155" strokeDasharray="5 4" y={100} />
              <Bar dataKey="ach" name="Ach MTD" radius={[6, 6, 0, 0]}>
                {witelChart.map((row, i) => <Cell key={i} fill={row.isYjs ? t.primary : "#cbd5e1"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* TABEL */}
      <Card subtitle="Seluruh angka langsung dari laporan aktif (tanpa perhitungan ulang)." title="Rincian Witel & Telda">
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[980px] border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {["Wilayah", "Target FM", "Real MTD", "Ach", "Rank", "Shortage", "GR MTD", "Real YTD", "Ach YTD", "Rank YTD"].map((h, i) => (
                  <th key={h} className={`px-3 py-2.5 ${i > 0 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[{ row: yjs, strong: true, name: "WITEL YJS" }, ...teldaRows.map((row) => ({ row, strong: false, name: row.label })), { row: variant.telda.total, strong: true, name: `TOTAL TELDA (${variant.telda.total.label})` }].map(({ row, strong, name }, i) => (
                <tr key={`${name}-${i}`} className={`border-t border-slate-100 ${strong ? "bg-slate-50 font-bold text-slate-900" : "text-slate-700"}`}>
                  <td className="px-3 py-2 font-semibold">{name}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(row.targetFm)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(row.mtd)}</td>
                  <td className="px-3 py-2 text-right font-bold" style={{ color: achColor(row.ach) }}>{fmtPct(row.ach)}</td>
                  <td className="px-3 py-2 text-right">{row.rank ?? "–"}</td>
                  <td className={`px-3 py-2 text-right ${row.shortageFm < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSigned(row.shortageFm)}</td>
                  <td className="px-3 py-2 text-right"><GrowthBadge value={row.growthMtd} /></td>
                  <td className="px-3 py-2 text-right">{fmtNum(row.realYtd)}</td>
                  <td className="px-3 py-2 text-right font-bold" style={{ color: achColor(row.achYtd) }}>{fmtPct(row.achYtd)}</td>
                  <td className="px-3 py-2 text-right">{row.rankYtd ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* VALIDASI */}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-5 ${syncMtd ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
            {syncMtd ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{syncMtd ? `Realisasi MTD: jumlah semua Telda (${fmtNum(calc.teldaMtd)}) sama dengan Witel YJS.` : `Realisasi MTD: jumlah Telda ${fmtNum(calc.teldaMtd)} berbeda dari Witel YJS ${fmtNum(yjs.mtd)} (selisih ${fmtSigned(yjs.mtd - calc.teldaMtd)}). Biasanya ada baris MASTER dengan nama Telda yang belum terpetakan.`}</span>
          </div>
          <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-5 ${syncTarget ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
            {syncTarget ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{syncTarget ? `Target FM: jumlah semua Telda (${fmtNum(calc.teldaTarget)}) sama dengan Witel YJS.` : `Target FM: jumlah Telda ${fmtNum(calc.teldaTarget)} berbeda dari Witel YJS ${fmtNum(yjs.targetFm)}. Periksa tabel target.`}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SOROTAN HOME (HSI & WMS)                                            */
/* ------------------------------------------------------------------ */

export function HomeHighlights({
  theme, moduleName, periodLabel, cutoffLabel, witel, onOpenYjs, dailyMode,
}: {
  theme: "hsi" | "wms";
  moduleName: string;
  periodLabel: string;
  cutoffLabel: string;
  witel: MetricTable;
  onOpenYjs: () => void;
  dailyMode: "calendar" | "series";
}) {
  const t = themeStyle[theme];
  const sorted = useMemo(() => [...witel.rows].sort((a, b) => (b.ach ?? -1) - (a.ach ?? -1)), [witel.rows]);
  const yjs = witel.rows.find((r) => norm(r.label) === YJS_LABEL);
  const reached = witel.rows.filter((r) => (r.ach ?? 0) >= 1).length;
  const total = witel.total;
  const share = yjs && total.mtd > 0 ? yjs.mtd / total.mtd : null;
  const trend = useMemo(() => {
    const latest = lastPopulatedDay(total.days);
    const sums = cumulativeSums(total.days);
    return total.days.slice(0, Math.max(latest, 0)).map((v, i) => ({ day: i + 1, harian: v ?? 0, kumulatif: sums[i] }));
  }, [total.days]);

  return (
    <div className="space-y-5">
      <section className={`relative overflow-hidden rounded-2xl ${t.heroClass} p-6 text-white shadow-[0_24px_60px_-34px_rgba(0,0,0,0.7)]`}>
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/70">Ringkasan nasional witel · {moduleName}</p>
            <h2 className="mt-2 text-2xl font-extrabold uppercase tracking-tight sm:text-3xl">Sorotan Kinerja {t.label}</h2>
            <p className="mt-2 text-xs font-medium uppercase text-white/70">{periodLabel} · {cutoffLabel}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { l: "Total realisasi MTD", v: fmtNum(total.mtd) },
                { l: "Total target FM", v: fmtNum(total.targetFm) },
                { l: "Ach gabungan", v: fmtPct(total.ach) },
                { l: "Witel ≥ 100%", v: `${reached} / ${witel.rows.length}` },
              ].map((x) => (
                <div key={x.l} className="rounded-xl bg-white/12 px-3 py-3 ring-1 ring-white/15 backdrop-blur">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/65">{x.l}</p>
                  <p className="mt-1 text-xl font-extrabold">{x.v}</p>
                </div>
              ))}
            </div>
          </div>
          {yjs && (
            <div className="rounded-2xl bg-black/20 p-5 ring-1 ring-white/15">
              <div className="flex items-center gap-5">
                <Ring color="#34d399" label="YJS MTD" size={112} value={yjs.ach} />
                <div className="min-w-0 text-sm">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/65">Witel Yogya Jateng Selatan</p>
                  <p className="mt-1 text-2xl font-extrabold">{fmtNum(yjs.mtd)}<span className="ml-1 text-sm font-semibold text-white/70">/ {fmtNum(yjs.targetFm)}</span></p>
                  <p className="mt-1 text-xs text-white/75">Peringkat {yjs.rank ?? "–"} dari {witel.rows.length} · {share === null ? "–" : fmtPct(share)} dari total</p>
                </div>
              </div>
              <button className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-slate-900 transition hover:bg-white/90" onClick={onOpenYjs} type="button">
                <MapPinned className="h-4 w-4" /> Buka profil lengkap Witel YJS
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card subtitle="Diurutkan menurut achievement MTD. Bilah penuh = 100% target." title="Papan peringkat witel">
          <ol className="space-y-2.5">
            {sorted.map((row, i) => {
              const isYjs = norm(row.label) === YJS_LABEL;
              const pct = Math.min((row.ach ?? 0) * 100, 100);
              return (
                <li key={row.label} className={`rounded-xl border px-3 py-2.5 ${isYjs ? "border-transparent ring-2" : "border-slate-200/80"}`} style={isYjs ? { background: t.soft, boxShadow: `0 0 0 2px ${t.primary}33` } : undefined}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-2 font-bold text-slate-800">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-900 text-[11px] text-white">{i < 3 ? <Medal className="h-3.5 w-3.5" /> : i + 1}</span>
                      <span className="truncate">{row.label}</span>
                      {isYjs && <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase text-white" style={{ background: t.primary }}>YJS</span>}
                    </span>
                    <span className="shrink-0 font-extrabold" style={{ color: achColor(row.ach) }}>{fmtPct(row.ach)}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ background: achColor(row.ach), width: `${pct}%` }} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span>{fmtNum(row.mtd)} / {fmtNum(row.targetFm)}</span>
                    <span>GR MTD <GrowthBadge value={row.growthMtd} /></span>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="space-y-5">
          {dailyMode === "calendar" && trend.length > 0 && (
            <Card subtitle="Realisasi harian dan kumulatif seluruh witel." title="Tren harian gabungan">
              <div className="h-[250px]">
                <ResponsiveContainer height="100%" width="100%">
                  <ComposedChart data={trend} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" fontSize={11} tickLine={false} />
                    <YAxis fontSize={11} tickFormatter={(v) => fmtNum(Number(v))} tickLine={false} width={46} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNum(Number(v))} labelFormatter={(l) => `Tanggal ${l}`} />
                    <Bar barSize={10} dataKey="harian" fill={t.secondary} name="Harian" radius={[3, 3, 0, 0]} />
                    <Line dataKey="kumulatif" dot={false} name="Kumulatif" stroke={t.primary} strokeWidth={3} type="monotone" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          <Card subtitle="Ringkasan YTD seluruh witel." title="Capaian YTD">
            <div className="grid grid-cols-2 gap-3">
              <Kpi label="Real YTD gabungan" value={fmtNum(total.realYtd)} detail={`Target YTD: ${fmtNum(total.targetYtd)}`} />
              <Kpi label="Ach YTD gabungan" tone={(total.achYtd ?? 0) >= 1 ? "good" : "warn"} value={fmtPct(total.achYtd)} detail={`YJS: ${fmtPct(yjs?.achYtd)}`} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
