"use client";

import { Activity, ArrowUpRight, CalendarDays, CircleAlert, Database, MapPinned, ShieldCheck, Target, TrendingUp } from "lucide-react";

type Metric = { label: string; value: string; detail: string; emphasis?: "positive" | "attention" };
type Theme = "hsi" | "wms" | "lts";

const themeConfig = {
  hsi: {
    name: "Home Service Internet", tag: "HSI", accent: "#3b82f6", light: "#eff6ff", ink: "#1d4ed8", marker: "bg-blue-500", icon: TrendingUp,
    description: "Monitor realisasi layanan internet, pencapaian target dan progres tahun berjalan.",
  },
  wms: {
    name: "WiFi Managed Service", tag: "WMS", accent: "#14b8a6", light: "#f0fdfa", ink: "#0f766e", marker: "bg-teal-500", icon: Activity,
    description: "Pantau produktivitas layanan WMS dan selisih pencapaian terhadap target.",
  },
  lts: {
    name: "Loss to Sales", tag: "LTS", accent: "#8b5cf6", light: "#f5f3ff", ink: "#6d28d9", marker: "bg-violet-500", icon: Target,
    description: "Evaluasi perbandingan Sales, CT0 dan CAPS menggunakan bobot masing-masing 50%.",
  },
} as const;

/** Pure presentation: source-of-truth is the computed active report supplied by each module. */
export function ExecutiveOverview({
  theme, period, scope, cutoff, metrics, message, pending = false, source,
}: {
  theme: Theme;
  period: string;
  scope: string;
  cutoff: string;
  metrics: Metric[];
  message: string;
  pending?: boolean;
  source: string;
}) {
  const config = themeConfig[theme];
  const SectionIcon = config.icon;

  return (
    <section aria-label={`Executive overview ${config.tag}`} className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_65px_-48px_rgba(15,23,42,.46)]">
      <div className="relative overflow-hidden bg-[#101f38] px-5 py-6 text-white sm:px-7 sm:py-7">
        <div className="pointer-events-none absolute -right-14 -top-28 h-80 w-80 rounded-full opacity-20 blur-3xl" style={{ backgroundColor: config.accent }} />
        <div className="pointer-events-none absolute bottom-0 right-[16%] h-28 w-48 rotate-[-28deg] rounded-full opacity-[.09] blur-2xl" style={{ backgroundColor: config.accent }} />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
              <SectionIcon className="h-6 w-6" style={{ color: config.accent }} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-slate-300">
                <span className={`h-1.5 w-1.5 rounded-full ${config.marker}`} /> Executive performance dashboard
              </div>
              <h2 className="mt-2 text-[clamp(1.35rem,2.4vw,2rem)] font-bold tracking-tight text-white">{config.name}</h2>
              <p className="mt-1 max-w-xl text-xs leading-5 text-slate-300 sm:text-sm">{config.description}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
            <span className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2"><CalendarDays className="h-3.5 w-3.5" />{period}</span>
            <span className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2"><MapPinned className="h-3.5 w-3.5" />{scope}</span>
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-[11px] text-slate-300">
          <span className="inline-flex items-center gap-1.5"><Database className="h-3.5 w-3.5" /> Sumber: {source}</span>
          <span className="inline-flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> {cutoff}</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Mengikuti periode &amp; wilayah terpilih</span>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
        {metrics.map((metric, index) => (
          <article key={`${metric.label}-${index}`} className="group relative min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_4px_18px_-14px_rgba(15,23,42,.25)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md sm:p-5">
            <div className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: metric.emphasis === "attention" ? "#f59e0b" : config.accent }} />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[.08em] text-slate-500">{metric.label}</p>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: metric.emphasis === "attention" ? "#fffbeb" : config.light }}>
                {metric.emphasis === "attention" ? <CircleAlert className="h-4 w-4 text-amber-600" /> : <ArrowUpRight className="h-4 w-4" style={{ color: config.ink }} />}
              </div>
            </div>
            <p className="mt-4 break-words text-[clamp(1.35rem,2.4vw,2rem)] font-extrabold leading-tight tracking-tight tabular-nums" style={{ color: metric.emphasis === "attention" ? "#b45309" : "#17243b" }} title={metric.value}>{metric.value}</p>
            <p className="mt-2 min-h-8 text-xs leading-4 text-slate-500">{metric.detail}</p>
            <div className="mt-3 h-px w-full bg-slate-100" />
          </article>
        ))}
      </div>
      <div className="mx-4 mb-4 flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-xs leading-5 sm:mx-5 sm:mb-5" style={{ backgroundColor: pending ? "#fffbeb" : "#f8fafc", borderColor: pending ? "#fde68a" : "#e2e8f0", color: pending ? "#92400e" : "#475569" }}>
        {pending ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>{message}</span>
      </div>
    </section>
  );
}
