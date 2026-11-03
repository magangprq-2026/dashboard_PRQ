"use client";

import { Activity, CalendarRange, CheckCircle2, Database, Info, ShieldAlert } from "lucide-react";

type Metric = { label: string; value: string; detail: string; emphasis?: "positive" | "attention" };
type Theme = "hsi" | "wms" | "lts";
const colors = {
  hsi: { edge: "from-blue-600 via-cyan-400 to-sky-300", soft: "bg-blue-50 text-blue-800", number: "text-blue-700" },
  wms: { edge: "from-amber-500 via-orange-400 to-yellow-300", soft: "bg-amber-50 text-amber-900", number: "text-amber-800" },
  lts: { edge: "from-violet-600 via-fuchsia-400 to-purple-300", soft: "bg-violet-50 text-violet-800", number: "text-violet-700" },
};

/** Informational layer only: all metrics must be supplied from the active computed report. */
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
  const color = colors[theme];
  return (
    <section aria-label="Ringkasan eksekutif" className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_18px_45px_-34px_rgba(15,23,42,0.38)]">
      <div className={`h-1 bg-gradient-to-r ${color.edge}`} />
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-slate-500"><Activity className="h-4 w-4" /> Executive overview</p>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">Ringkasan kinerja {theme.toUpperCase()}</h2>
          <p className="mt-1 text-xs text-slate-500">Angka berasal dari laporan aktif dan mengikuti filter yang dipilih.</p>
        </div>
        <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${color.soft}`}>
          <CalendarRange className="h-3.5 w-3.5" /> {period}
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="min-w-0 rounded-xl border border-slate-200/80 bg-[linear-gradient(145deg,#fff,#f8fafc)] px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{metric.label}</p>
            <p className={`mt-2 truncate text-[clamp(1.3rem,2.1vw,1.8rem)] font-bold tracking-tight ${metric.emphasis === "attention" ? "text-amber-700" : metric.emphasis === "positive" ? "text-emerald-700" : color.number}`} title={metric.value}>{metric.value}</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">{metric.detail}</p>
          </div>
        ))}
      </div>
      <div className="mx-4 mb-4 grid gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex items-start gap-2 text-xs leading-5 text-slate-600">
          {pending ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />}
          <span>{message}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <span className="inline-flex items-center gap-1"><Database className="h-3.5 w-3.5" /> {source}</span>
          <span className="inline-flex items-center gap-1"><Info className="h-3.5 w-3.5" /> {scope}</span>
          <span className="inline-flex items-center gap-1">{cutoff}</span>
        </div>
      </div>
    </section>
  );
}
