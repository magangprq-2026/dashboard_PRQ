"use client";

export type DashboardPeriodFilterMode = "current-month" | "monthly" | "date-range" | "ytd";

export type DashboardPeriodFilterState = {
  endDate: string;
  endMonth: string;
  mode: DashboardPeriodFilterMode;
  startDate: string;
  startMonth: string;
};

export type DashboardPeriodOption = {
  label: string;
  periodKey: string;
};

type DashboardPeriodFilterProps = {
  className?: string;
  onChange: (value: DashboardPeriodFilterState) => void;
  options: DashboardPeriodOption[];
  theme?: "hsi" | "wms" | "lts";
  validationMessage?: string | null;
  value: DashboardPeriodFilterState;
};

const themeClasses = {
  hsi: {
    focus: "focus:border-blue-400 focus:ring-blue-100 hover:border-blue-300",
    text: "text-[#071426]",
  },
  lts: {
    focus: "focus:border-violet-400 focus:ring-violet-100 hover:border-violet-300",
    text: "text-[#24103f]",
  },
  wms: {
    focus: "focus:border-amber-400 focus:ring-amber-100 hover:border-amber-300",
    text: "text-[#2a1a10]",
  },
} as const;

function inputClass(theme: keyof typeof themeClasses) {
  const selected = themeClasses[theme];
  return `h-9 rounded-md border border-[#d8e1ec] bg-white px-3 text-xs font-semibold ${selected.text} shadow-sm outline-none transition focus:ring-4 ${selected.focus}`;
}

function dateInputForMonth(periodKey: string, day: "first" | "last") {
  const year = Number(periodKey.slice(0, 4));
  const month = Number(periodKey.slice(4, 6));
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return "";
  const date = day === "first" ? 1 : new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

export function defaultPeriodFilter(periodKey: string): DashboardPeriodFilterState {
  const year = periodKey.slice(0, 4);
  const month = periodKey.slice(4, 6);
  const startDate = `${year}-${month}-01`;
  const endDate = `${year}-${month}-${String(new Date(Number(year), Number(month), 0).getDate()).padStart(2, "0")}`;
  return {
    endDate,
    endMonth: periodKey,
    mode: "current-month",
    startDate,
    startMonth: periodKey,
  };
}

export function DashboardPeriodFilter({
  className = "",
  onChange,
  options,
  theme = "hsi",
  validationMessage,
  value,
}: DashboardPeriodFilterProps) {
  const fieldClass = inputClass(theme);
  const sortedOptions = options.length > 0 ? options : [{ label: value.startMonth, periodKey: value.startMonth }];
  const setValue = (patch: Partial<DashboardPeriodFilterState>) => onChange({ ...value, ...patch });
  // Bulan jangkar (anchor) selalu bulan akhir: current-month (start = end), ytd (Jan..end), monthly (start..end).
  // Saat ganti mode, state diselaraskan dari bulan jangkar supaya data yang tampil tidak "meloncat" ke bulan lain.
  const anchorMonth = value.endMonth || value.startMonth;
  const changeMode = (mode: DashboardPeriodFilterMode) => {
    if (mode === "current-month") return setValue({ endMonth: anchorMonth, mode, startMonth: anchorMonth });
    if (mode === "ytd") return setValue({ endMonth: anchorMonth, mode, startMonth: `${anchorMonth.slice(0, 4)}01` });
    if (mode === "date-range") {
      return setValue({
        endDate: dateInputForMonth(value.endMonth || value.startMonth, "last"),
        mode,
        startDate: dateInputForMonth(value.startMonth || value.endMonth, "first"),
      });
    }
    // monthly: pastikan bulan awal ada di daftar opsi (mis. Jan tidak ada di arsip setelah dari mode YTD).
    const keys = sortedOptions.map((option) => option.periodKey).sort();
    const end = keys.includes(anchorMonth) ? anchorMonth : value.endMonth;
    const start = keys.includes(value.startMonth) ? value.startMonth : (keys[0] ?? value.startMonth);
    return setValue({ endMonth: end, mode, startMonth: start > end ? end : start });
  };
  const onMonthChange = (periodKey: string) => {
    // Mode current-month & ytd hanya menampilkan satu dropdown bulan; dropdown itu menentukan bulan akhir.
    if (value.mode === "current-month") return setValue({ endMonth: periodKey, startMonth: periodKey });
    if (value.mode === "ytd") return setValue({ endMonth: periodKey, startMonth: `${periodKey.slice(0, 4)}01` });
    return setValue({ startMonth: periodKey });
  };

  return (
    <div className={`grid gap-1 text-[11px] font-semibold uppercase text-slate-500 ${className}`}>
      <span>PERIODE</span>
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${fieldClass} w-[145px]`} value={value.mode} onChange={(event) => changeMode(event.target.value as DashboardPeriodFilterMode)}>
          <option value="current-month">Current Month</option>
          <option value="monthly">Month Range</option>
          <option value="date-range">Date Range</option>
          <option value="ytd">YTD</option>
        </select>
        {value.mode === "date-range" ? (
          <>
            <input
              aria-label="Start date"
              className={`${fieldClass} w-[145px]`}
              type="date"
              value={value.startDate}
              onChange={(event) => setValue({ startDate: event.target.value })}
            />
            <input
              aria-label="End date"
              className={`${fieldClass} w-[145px]`}
              type="date"
              value={value.endDate}
              onChange={(event) => setValue({ endDate: event.target.value })}
            />
          </>
        ) : (
          <>
            <select className={`${fieldClass} w-[170px]`} value={value.mode === "ytd" ? value.endMonth : value.startMonth} onChange={(event) => onMonthChange(event.target.value)}>
              {sortedOptions.map((option) => (
                <option key={option.periodKey} value={option.periodKey}>
                  {option.label}
                </option>
              ))}
            </select>
            {value.mode === "monthly" && (
              <select className={`${fieldClass} w-[170px]`} value={value.endMonth} onChange={(event) => setValue({ endMonth: event.target.value })}>
                {sortedOptions.map((option) => (
                  <option key={option.periodKey} value={option.periodKey}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>
      {validationMessage && <span className="max-w-[460px] text-[10px] font-semibold normal-case text-rose-600">{validationMessage}</span>}
    </div>
  );
}
