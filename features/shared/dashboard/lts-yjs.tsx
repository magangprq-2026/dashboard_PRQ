"use client";

/**
 * Tab "Witel YJS" dan sorotan Home untuk LTS.
 * Semua angka dibaca langsung dari `LtsComputedReport` (computeLtsReport). Tidak ada perhitungan ulang metrik:
 * Score = 50% CT0/Sales + 50% CAPS/Sales, SEMAKIN RENDAH SEMAKIN BAIK (peringkat 1 = nilai terendah), sesuai
 * aturan peringkat di `reporting.ts`.
 */

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, Crown, MapPinned, Medal, ShieldAlert, Trophy } from "lucide-react";
import type { LtsComputedReport, LtsReportRow, LtsReportTabKey } from "@/features/lts/domain/reporting/reporting";
import { Card, Kpi, YJS_LABEL, fmtNum, fmtPct, fmtSigned, themeStyle, yjsPanelTheme } from "@/features/shared/dashboard/witel-yjs";

const t = themeStyle.lts;
const norm = (v: string) => v.trim().toUpperCase();
const tooltipStyle = { borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 12px 30px -16px rgba(15,23,42,.35)" };

type TabInfo = { key: LtsReportTabKey; label: string };

export function LtsYjsPanel({
  reports, activeTab, onTabChange, tabs, showTabs = true,
}: {
  reports: Partial<Record<LtsReportTabKey, LtsComputedReport>>;
  activeTab: LtsReportTabKey;
  onTabChange: (tab: LtsReportTabKey) => void;
  tabs: TabInfo[];
  showTabs?: boolean;
}) {
  const available = tabs.filter((tab) => reports[tab.key]);
  const selected = reports[activeTab] ? activeTab : available[0]?.key;
  const report = selected ? reports[selected] : undefined;
  const yjs = report?.witel.rows.find((r) => norm(r.label) === YJS_LABEL);

  const derived = useMemo(() => {
    if (!report || !yjs) return null;
    const witelSorted = [...report.witel.rows].sort((a, b) => a.score - b.score);
    const hotdaSorted = [...report.hotda.rows].sort((a, b) => a.score - b.score);
    const sum = (key: "sales" | "caps") => report.hotda.rows.reduce((s, r) => s + r[key], 0);
    const hotdaCt0 = report.hotda.rows.reduce((s, r) => s + (r.ct0 ?? 0), 0);
    return { witelSorted, hotdaSorted, hotdaSales: sum("sales"), hotdaCaps: sum("caps"), hotdaCt0 };
  }, [report, yjs]);

  if (!report || !yjs || !derived) {
    return (
      <Card title="Witel Yogya Jateng Selatan" subtitle="Data belum tersedia">
        <p className="text-sm text-slate-600">Laporan LTS atau baris Witel YOGYA JATENG SELATAN belum tersedia. Upload dataset terkait di menu MASTER.</p>
      </Card>
    );
  }

  const ct0Pending = yjs.ct0 === null;
  const ratioCompare = [
    { name: "CT0 / Sales", YJS: yjs.ct0Ratio * 100, "TREG 3": report.witel.total.ct0Ratio * 100 },
    { name: "CAPS / Sales", YJS: yjs.capsRatio * 100, "TREG 3": report.witel.total.capsRatio * 100 },
    { name: "Score", YJS: yjs.score * 100, "TREG 3": report.witel.total.score * 100 },
  ];
  const witelScore = derived.witelSorted.map((r) => ({ name: norm(r.label) === YJS_LABEL ? "YJS" : r.label, score: r.score * 100, isYjs: norm(r.label) === YJS_LABEL }));
  const hotdaChart = derived.hotdaSorted.map((r) => ({ name: r.label, "CT0 / Sales": r.ct0Ratio * 100, "CAPS / Sales": r.capsRatio * 100, Score: r.score * 100 }));
  const syncSales = Math.abs(derived.hotdaSales - yjs.sales) < 0.5;
  const syncCaps = Math.abs(derived.hotdaCaps - yjs.caps) < 0.5;
  const syncCt0 = ct0Pending || Math.abs(derived.hotdaCt0 - (yjs.ct0 ?? 0)) < 0.5;
  const bestHotda = derived.hotdaSorted[0];

  const tableRows: { row: LtsReportRow; strong: boolean; name: string; coord?: string }[] = [
    { row: yjs, strong: true, name: "WITEL YJS" },
    ...report.hotda.rows.map((row) => ({ row, strong: false, name: row.label, coord: row.coordinator })),
    { row: report.hotda.total, strong: true, name: `TOTAL HOTDA (${report.hotda.total.label})` },
  ];

  return (
    <div className="space-y-5">
      <section className={`relative overflow-hidden rounded-2xl ${yjsPanelTheme.lts.heroClass} p-6 text-white shadow-[0_24px_60px_-34px_rgba(0,0,0,0.7)]`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1" style={{ backgroundColor: yjsPanelTheme.lts.accent }} />
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full opacity-20 blur-3xl" style={{ backgroundColor: yjsPanelTheme.lts.accent }} />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-[260px] flex-1">
            <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/70"><MapPinned className="h-4 w-4" /> Witel profile · LTS</p>
            <h2 className="mt-2 text-2xl font-extrabold uppercase tracking-tight sm:text-3xl">Witel Yogya Jateng Selatan</h2>
            <p className="mt-2 text-xs font-medium uppercase leading-5 text-white/70">{report.label} · {report.periodLabel} · {report.cutoffLabel} · Sumber: {report.sourceLabel}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/20"><Trophy className="h-3.5 w-3.5" /> Peringkat Score: {yjs.scoreRank ?? "–"} dari {report.witel.rows.length} witel</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/20"><Crown className="h-3.5 w-3.5" /> Witel terbaik: {derived.witelSorted[0]?.label ?? "–"}</span>
            </div>
            {showTabs && (
              <div className="mt-4 inline-flex flex-wrap rounded-xl bg-black/20 p-1">
                {available.map((tab) => (
                  <button key={tab.key} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${tab.key === selected ? "bg-white text-slate-900" : "text-white/80 hover:bg-white/10"}`} onClick={() => onTabChange(tab.key)} type="button">{tab.label}</button>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-2xl bg-black/20 px-8 py-6 text-center ring-1 ring-white/15">
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/65">Score LTS</p>
            <p className="mt-1 text-5xl font-extrabold">{fmtPct(yjs.score, 2)}</p>
            <p className="mt-2 text-[11px] text-white/70">50% CT0/Sales + 50% CAPS/Sales · lebih rendah = lebih baik</p>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi detail="Basis perhitungan LTS" label="Sales" value={fmtNum(yjs.sales)} />
        <Kpi detail={ct0Pending ? "REG periode ini belum tersedia" : `Rasio ${fmtPct(yjs.ct0Ratio, 2)} · peringkat ${yjs.ct0Rank ?? "–"}`} label="CT0" tone={ct0Pending ? "warn" : "default"} value={ct0Pending ? "Belum tersedia" : fmtNum(yjs.ct0)} />
        <Kpi detail={`Rasio ${fmtPct(yjs.capsRatio, 2)} · peringkat ${yjs.capsRank ?? "–"}`} label="CAPS" value={fmtNum(yjs.caps)} />
        <Kpi detail={`Peringkat ${yjs.scoreRank ?? "–"} dari ${report.witel.rows.length}`} label="Score" value={fmtPct(yjs.score, 2)} />
        <Kpi detail="Acuan tetap workbook" label="Churn" value={fmtNum(yjs.churn)} />
        <Kpi detail="Gap = Churn − CAPS (sesuai laporan)" label="Gap" tone={yjs.gap > 0 ? "warn" : "good"} value={fmtSigned(yjs.gap)} />
        <Kpi detail={`Score TREG 3: ${fmtPct(report.witel.total.score, 2)}`} label="Selisih Score vs TREG 3" tone={yjs.score <= report.witel.total.score ? "good" : "warn"} value={`${yjs.score - report.witel.total.score > 0 ? "+" : ""}${fmtPct(yjs.score - report.witel.total.score, 2)}`} />
        <Kpi detail={bestHotda ? `Score ${fmtPct(bestHotda.score, 2)}` : undefined} label="HOTDA terbaik" value={bestHotda?.label ?? "–"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card subtitle="Score tiap witel diurutkan dari terbaik (terendah). Batang YJS disorot." title="Peringkat Score witel">
          <div className="h-[330px]">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={witelScore} margin={{ bottom: 24, left: 0, right: 12, top: 12 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis angle={-20} dataKey="name" fontSize={10} height={52} interval={0} textAnchor="end" tickLine={false} />
                <YAxis fontSize={11} tickFormatter={(v) => `${v}%`} tickLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(2)}%`} />
                <Bar dataKey="score" name="Score" radius={[6, 6, 0, 0]}>
                  {witelScore.map((row, i) => <Cell key={i} fill={row.isYjs ? yjsPanelTheme.lts.primary : "#cbd5e1"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card subtitle="Perbandingan rasio Witel YJS dengan gabungan TREG 3." title="YJS vs TREG 3">
          <div className="h-[330px]">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={ratioCompare} margin={{ left: 0, right: 12, top: 12 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={11} tickLine={false} />
                <YAxis fontSize={11} tickFormatter={(v) => `${v}%`} tickLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(2)}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="YJS" fill={yjsPanelTheme.lts.primary} radius={[6, 6, 0, 0]} />
                <Bar dataKey="TREG 3" fill="#cbd5e1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card subtitle="CT0/Sales, CAPS/Sales, dan Score per HOTDA di Witel YJS, diurutkan dari Score terbaik." title="Performa HOTDA">
        <div className="h-[360px]">
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={hotdaChart} margin={{ bottom: 12, left: 0, right: 12, top: 12 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" fontSize={11} tickLine={false} />
              <YAxis fontSize={11} tickFormatter={(v) => `${v}%`} tickLine={false} width={48} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(2)}%`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="CT0 / Sales" fill={yjsPanelTheme.lts.secondary} radius={[4, 4, 0, 0]} />
              <Bar dataKey="CAPS / Sales" fill="#a78bfa" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Score" fill={yjsPanelTheme.lts.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card subtitle="Struktur tabel dikelompokkan agar Sales, CT0, CAPS, dan Score lebih mudah dipahami. Semua angka tetap dari laporan aktif." title="Rincian Witel & HOTDA">
        <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">Score = 50% CT0/Sales + 50% CAPS/Sales</span>
          <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-1 font-semibold text-violet-700">Ungu = kolom score utama</span>
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">Gap positif = masih ada kekurangan</span>
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">Gap negatif/0 = relatif aman</span>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
          <table className="w-full min-w-[1160px] border-separate border-spacing-0 text-xs tabular-nums">
            <thead>
              <tr className="text-center text-[10px] font-bold uppercase tracking-[0.18em] text-white" style={{ backgroundColor: '#5b21b6' }}>
                <th className="sticky left-0 z-20 border-r border-white/15 px-4 py-3 text-left" rowSpan={2}>Wilayah</th>
                <th className="border-r border-white/15 px-3 py-3 text-left" rowSpan={2}>Koordinator</th>
                <th className="border-r border-white/15 px-3 py-3" rowSpan={2}>Sales</th>
                <th className="border-r border-white/15 px-3 py-3" colSpan={3}>Bobot 50% CT0</th>
                <th className="border-r border-white/15 px-3 py-3" colSpan={3}>Bobot 50% CAPS</th>
                <th className="border-r border-white/15 px-3 py-3" colSpan={2}>Score</th>
                <th className="border-r border-white/15 px-3 py-3" rowSpan={2}>Churn</th>
                <th className="px-3 py-3" rowSpan={2}>Gap</th>
              </tr>
              <tr className="text-center text-[10px] font-bold uppercase tracking-[0.14em] text-white/95" style={{ backgroundColor: '#5b21b6' }}>
                <th className="border-r border-white/15 px-3 py-2">CT0</th>
                <th className="border-r border-white/15 px-3 py-2">CT0/Sales</th>
                <th className="border-r border-white/15 px-3 py-2">Rank</th>
                <th className="border-r border-white/15 px-3 py-2">CAPS</th>
                <th className="border-r border-white/15 px-3 py-2">CAPS/Sales</th>
                <th className="border-r border-white/15 px-3 py-2">Rank</th>
                <th className="border-r border-white/15 px-3 py-2">Score</th>
                <th className="border-r border-white/15 px-3 py-2">Rank</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map(({ row, strong, name, coord }, i) => (
                <tr key={`${name}-${i}`} className={`border-b border-slate-100 transition-colors hover:bg-violet-50 ${strong ? "bg-violet-100/80 font-bold text-slate-900" : i % 2 === 0 ? "bg-slate-50/75 text-slate-700" : "bg-white text-slate-700"}`} style={strong ? { boxShadow: 'inset 4px 0 0 #7c3aed' } : undefined}>
                  <td className="sticky left-0 z-10 whitespace-nowrap border-r border-slate-200 px-4 py-3 font-bold text-slate-900" style={{ backgroundColor: strong ? '#ede9fe' : i % 2 === 0 ? '#f8fafc' : '#ffffff' }}>{name}</td>
                  <td className="border-r border-slate-100 px-3 py-2 text-slate-500">{coord ?? "–"}</td>
                  <td className="border-r border-slate-100 px-3 py-2 text-right font-semibold">{fmtNum(row.sales)}</td>
                  <td className="border-r border-slate-100 px-3 py-2 text-right">{row.ct0 === null ? "–" : fmtNum(row.ct0)}</td>
                  <td className="border-r border-slate-100 bg-slate-50/70 px-3 py-2 text-right">{row.ct0 === null ? "–" : fmtPct(row.ct0Ratio, 2)}</td>
                  <td className="border-r border-slate-100 px-3 py-2 text-right">{row.ct0Rank ?? "–"}</td>
                  <td className="border-r border-slate-100 px-3 py-2 text-right">{fmtNum(row.caps)}</td>
                  <td className="border-r border-slate-100 bg-slate-50/70 px-3 py-2 text-right">{fmtPct(row.capsRatio, 2)}</td>
                  <td className="border-r border-slate-100 px-3 py-2 text-right">{row.capsRank ?? "–"}</td>
                  <td className="border-r border-slate-100 bg-violet-50/90 px-3 py-3 text-right font-extrabold text-violet-800">{fmtPct(row.score, 2)}</td>
                  <td className="border-r border-slate-100 px-3 py-2 text-right">{row.scoreRank ?? "–"}</td>
                  <td className="border-r border-slate-100 px-3 py-2 text-right">{fmtNum(row.churn)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${row.gap > 0 ? "text-amber-700" : "text-emerald-600"}`}>{fmtSigned(row.gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {[
            { ok: syncSales, okText: `Sales: jumlah HOTDA (${fmtNum(derived.hotdaSales)}) sama dengan Witel YJS.`, badText: `Sales: jumlah HOTDA ${fmtNum(derived.hotdaSales)} berbeda dari Witel YJS ${fmtNum(yjs.sales)}. Ada baris yang Telda-nya belum terpetakan ke HOTDA.` },
            { ok: syncCt0, okText: ct0Pending ? "CT0: REG periode ini belum terbit, belum dibandingkan." : `CT0: jumlah HOTDA (${fmtNum(derived.hotdaCt0)}) sama dengan Witel YJS.`, badText: `CT0: jumlah HOTDA ${fmtNum(derived.hotdaCt0)} berbeda dari Witel YJS ${fmtNum(yjs.ct0)}.` },
            { ok: syncCaps, okText: `CAPS: jumlah HOTDA (${fmtNum(derived.hotdaCaps)}) sama dengan Witel YJS.`, badText: `CAPS: jumlah HOTDA ${fmtNum(derived.hotdaCaps)} berbeda dari Witel YJS ${fmtNum(yjs.caps)}.` },
          ].map((c, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-5 ${c.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{c.ok ? c.okText : c.badText}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function LtsHomeHighlights({ report, onOpenYjs }: { report: LtsComputedReport; onOpenYjs: () => void }) {
  const sorted = useMemo(() => [...report.witel.rows].sort((a, b) => a.score - b.score), [report.witel.rows]);
  const yjs = report.witel.rows.find((r) => norm(r.label) === YJS_LABEL);
  const total = report.witel.total;
  const maxScore = Math.max(...sorted.map((r) => r.score), 0.0001);
  const ct0Pending = total.ct0 === null;

  return (
    <div className="space-y-5">
      <section className={`relative overflow-hidden rounded-2xl ${t.heroClass} p-6 text-white shadow-[0_24px_60px_-34px_rgba(0,0,0,0.7)]`}>
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/70">Ringkasan TREG 3 · {report.label}</p>
            <h2 className="mt-2 text-2xl font-extrabold uppercase tracking-tight sm:text-3xl">Sorotan Kinerja LTS</h2>
            <p className="mt-2 text-xs font-medium uppercase text-white/70">{report.periodLabel} · {report.cutoffLabel}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { l: "Total Sales", v: fmtNum(total.sales) },
                { l: "Total CT0", v: ct0Pending ? "Belum ada" : fmtNum(total.ct0) },
                { l: "Total CAPS", v: fmtNum(total.caps) },
                { l: "Score TREG 3", v: fmtPct(total.score, 2) },
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
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/65">Witel Yogya Jateng Selatan</p>
              <p className="mt-1 text-4xl font-extrabold">{fmtPct(yjs.score, 2)}</p>
              <p className="mt-1 text-xs text-white/75">Score · peringkat {yjs.scoreRank ?? "–"} dari {report.witel.rows.length} · Sales {fmtNum(yjs.sales)}</p>
              <button className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-slate-900 transition hover:bg-white/90" onClick={onOpenYjs} type="button">
                <MapPinned className="h-4 w-4" /> Buka profil lengkap Witel YJS
              </button>
            </div>
          )}
        </div>
      </section>

      <Card subtitle="Score lebih rendah = lebih baik. Panjang bilah relatif terhadap score tertinggi." title="Papan peringkat witel (Score LTS)">
        <ol className="grid gap-2.5 lg:grid-cols-2">
          {sorted.map((row, i) => {
            const isYjs = norm(row.label) === YJS_LABEL;
            return (
              <li key={row.label} className="rounded-xl border border-slate-200/80 px-3 py-2.5" style={isYjs ? { background: t.soft, boxShadow: `0 0 0 2px ${t.primary}33` } : undefined}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2 font-bold text-slate-800">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-900 text-[11px] text-white">{i < 3 ? <Medal className="h-3.5 w-3.5" /> : i + 1}</span>
                    <span className="truncate">{row.label}</span>
                    {isYjs && <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase text-white" style={{ background: t.primary }}>YJS</span>}
                  </span>
                  <span className="shrink-0 font-extrabold text-slate-800">{fmtPct(row.score, 2)}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ background: isYjs ? t.primary : t.secondary, width: `${(row.score / maxScore) * 100}%` }} />
                </div>
                <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[11px] text-slate-500">
                  <span>Sales {fmtNum(row.sales)} · CAPS {fmtNum(row.caps)}</span>
                  <span>CT0 {row.ct0 === null ? "–" : fmtPct(row.ct0Ratio, 2)} · CAPS {fmtPct(row.capsRatio, 2)}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
