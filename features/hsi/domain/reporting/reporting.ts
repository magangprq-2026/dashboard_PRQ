import { seedData } from "./seed-data";

export type CellValue = string | number | boolean | null;
export type MasterRow = CellValue[];

type TargetConfig = {
  label: string;
  rawDatel?: string;
  monthly: readonly CellValue[];
  targetYtd: CellValue;
};

type PreviousConfig = {
  mtd: Record<string, CellValue>;
  fm: Record<string, CellValue>;
  ytd: Record<string, CellValue>;
  ytdPrev: Record<string, CellValue>;
  // Total Jan..bulan lalu tahun berjalan (sheet REAL kolom AL..AT). Bila ada, REAL YTD = ytdBase + MTD bulan ini,
  // sama seperti kolom AX di workbook R24.
  ytdBase?: Record<string, number>;
};
type ReportingPeriod = {
  days: number;
  month: number;
  monthIndex: number;
  monthName: string;
  previousMonthName: string;
  year: number;
};

export type ReportRow = {
  label: string;
  targetFm: number;
  targetYtd: number;
  days: (number | null)[];
  mtd: number;
  targetAch: number | null;
  rankAch: number | null;
  shortageFm: number;
  realMtdPrev: number;
  growthMtd: number | null;
  realFmPrev: number;
  growthFm: number | null;
  realYtd: number;
  achYtd: number | null;
  growthYtd: number | null;
  rankYtd: number | null;
  shortageYtd: number;
};

export type ReportTable = {
  title: string;
  subtitle: string;
  rows: ReportRow[];
  total: ReportRow;
};

export type ComputedReport = {
  periodLabel: string;
  previousMonthLabel: string;
  cutoffLabel: string;
  source: string;
  updatedAt: string | null;
  witel: ReportTable;
  branch: ReportTable;
  targetStf: {
    witel: ReportTable;
    branch: ReportTable;
  };
  dailyTrend: { day: number; realisasi: number; cumulative: number }[];
  // Tanggal (hari ke-) yang sengaja belum dihitung karena data diambil sebelum jam 12 siang; null bila tidak ada.
  excludedDay?: number | null;
  validation: { checked: number; mismatches: number; notes: string[] };
};

const DEFAULT_PERIOD = seedData.period;
const monthNames = [
  "JANUARI",
  "FEBRUARI",
  "MARET",
  "APRIL",
  "MEI",
  "JUNI",
  "JULI",
  "AGUSTUS",
  "SEPTEMBER",
  "OKTOBER",
  "NOVEMBER",
  "DESEMBER",
];
const shortMonthNames = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AUG", "SEPT", "OKT", "NOV", "DES"];
const MASTER_INDEX = {
  witel: seedData.masterHeaders.indexOf("WITEL"),
  datel: seedData.masterHeaders.indexOf("DATEL"),
  ndem: seedData.masterHeaders.indexOf("NDEM"),
  lastUpdated: seedData.masterHeaders.indexOf("LAST UPDATED DATE"),
};

const excelEpoch = new Date(1899, 11, 30);

function toNumber(value: CellValue): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asText(value: CellValue): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function validNdem(value: CellValue): boolean {
  return asText(value).replace(/'/g, "").trim().length > 0;
}

function parsePeriodKey(periodKey: string | null | undefined) {
  if (!periodKey || !/^\d{6}$/.test(periodKey)) return null;
  const year = Number(periodKey.slice(0, 4));
  const month = Number(periodKey.slice(4, 6));
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { month, year };
}

function periodFromKey(periodKey: string | null | undefined): ReportingPeriod {
  const parsed = parsePeriodKey(periodKey);
  const year = parsed?.year ?? DEFAULT_PERIOD.year;
  const month = parsed?.month ?? DEFAULT_PERIOD.month;
  const previousMonth = month <= 1 ? 12 : month - 1;
  return {
    days: new Date(year, month, 0).getDate(),
    month,
    monthIndex: month - 1,
    monthName: monthNames[month - 1] ?? DEFAULT_PERIOD.monthName,
    previousMonthName: shortMonthNames[previousMonth - 1] ?? DEFAULT_PERIOD.previousMonthName,
    year,
  };
}

function excelSerialToDate(value: number): Date {
  return new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
}

function normalizeWorkbookDate(value: CellValue, period: ReportingPeriod): Date | null {
  let parsed: Date | null = null;

  if (typeof value === "number") {
    parsed = excelSerialToDate(value);
  } else if (typeof value === "string") {
    const text = value.trim();
    const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    const ymd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (dmy) {
      parsed = new Date(
        Number(dmy[3]),
        Number(dmy[2]) - 1,
        Number(dmy[1]),
        Number(dmy[4] ?? 0),
        Number(dmy[5] ?? 0),
        Number(dmy[6] ?? 0),
      );
    } else if (ymd) {
      parsed = new Date(
        Number(ymd[1]),
        Number(ymd[2]) - 1,
        Number(ymd[3]),
        Number(ymd[4] ?? 0),
        Number(ymd[5] ?? 0),
        Number(ymd[6] ?? 0),
      );
    }
  }

  if (!parsed || Number.isNaN(parsed.getTime())) return null;

  if (parsed.getMonth() + 1 === period.month) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  // Mirrors the workbook helper formula that swaps day/month when Excel parses
  // imported dates with the wrong locale.
  return new Date(parsed.getFullYear(), parsed.getDate() - 1, parsed.getMonth() + 1);
}

function buildCounts(masterRows: MasterRow[], key: "witel" | "datel", period: ReportingPeriod, skipDay: number | null = null) {
  const index = key === "witel" ? MASTER_INDEX.witel : MASTER_INDEX.datel;
  const counts = new Map<string, number[]>();

  for (const [rowIndex, row] of masterRows.entries()) {
    // The workbook's FILTER spills the first MASTER record into HELPER!A1, while
    // the COUNTIFS ranges start from HELPER!A2. Keeping this offset preserves the
    // published report totals exactly.
    if (rowIndex === 0) continue;
    if (!validNdem(row[MASTER_INDEX.ndem])) continue;
    const label = asText(row[index]);
    if (!label) continue;
    const normalizedDate = normalizeWorkbookDate(row[MASTER_INDEX.lastUpdated], period);
    if (
      !normalizedDate ||
      normalizedDate.getFullYear() !== period.year ||
      normalizedDate.getMonth() !== period.monthIndex
    ) {
      continue;
    }
    const day = normalizedDate.getDate();
    if (day < 1 || day > period.days) continue;
    // Rumus workbook: kolom tanggal hari ini dikosongkan bila data diambil sebelum jam 12 siang.
    if (skipDay !== null && day === skipDay) continue;
    const existing = counts.get(label) ?? Array(period.days).fill(0);
    existing[day - 1] += 1;
    counts.set(label, existing);
  }

  return counts;
}

function sumDayArrays(arrays: number[][], dayCount: number): number[] {
  return Array.from({ length: dayCount }, (_, day) =>
    arrays.reduce((sum, current) => sum + (current[day] ?? 0), 0),
  );
}

function rankDescending(rows: ReportRow[], metric: "targetAch" | "achYtd") {
  for (const row of rows) {
    const current = row[metric];
    row[metric === "targetAch" ? "rankAch" : "rankYtd"] =
      current === null ? null : rows.filter((candidate) => (candidate[metric] ?? -Infinity) > current).length + 1;
  }
}

function safeRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function safeGrowth(current: number, previous: number): number | null {
  return previous === 0 ? null : current / previous - 1;
}

function makeRow(
  label: string,
  target: TargetConfig,
  daysRaw: number[],
  previous: PreviousConfig,
  referenceMtd: number,
  monthIndex: number,
): ReportRow {
  const days = daysRaw.map((value) => (value === 0 ? null : value));
  const mtd = daysRaw.reduce((sum, value) => sum + value, 0);
  const targetFm = toNumber(target.monthly[monthIndex]);
  const targetYtd = toNumber(target.targetYtd);
  const realMtdPrev = toNumber(previous.mtd[label]);
  const realFmPrev = toNumber(previous.fm[label]);
  const excelYtd = toNumber(previous.ytd[label]);
  const dynamicYtdBase = previous.ytdBase?.[label];
  const ytdBaseBeforeCurrentMonth = dynamicYtdBase !== undefined ? dynamicYtdBase : Math.max(0, excelYtd - referenceMtd);
  const realYtd = ytdBaseBeforeCurrentMonth + mtd;
  const ytdPrev = toNumber(previous.ytdPrev[label]);

  return {
    label,
    targetFm,
    targetYtd,
    days,
    mtd,
    targetAch: safeRatio(mtd, targetFm),
    rankAch: null,
    shortageFm: mtd - targetFm,
    realMtdPrev,
    growthMtd: safeGrowth(mtd, realMtdPrev),
    realFmPrev,
    growthFm: safeGrowth(mtd, realFmPrev),
    realYtd,
    achYtd: safeRatio(realYtd, targetYtd),
    growthYtd: safeGrowth(realYtd, ytdPrev),
    rankYtd: null,
    shortageYtd: realYtd - targetYtd,
  };
}

function makeTotal(label: string, rows: ReportRow[], dayCount: number): ReportRow {
  const daysRaw = Array.from({ length: dayCount }, (_, day) =>
    rows.reduce((sum, row) => sum + (row.days[day] ?? 0), 0),
  );
  const total: ReportRow = {
    label,
    targetFm: rows.reduce((sum, row) => sum + row.targetFm, 0),
    targetYtd: rows.reduce((sum, row) => sum + row.targetYtd, 0),
    days: daysRaw,
    mtd: rows.reduce((sum, row) => sum + row.mtd, 0),
    targetAch: null,
    rankAch: null,
    shortageFm: 0,
    realMtdPrev: rows.reduce((sum, row) => sum + row.realMtdPrev, 0),
    growthMtd: null,
    realFmPrev: rows.reduce((sum, row) => sum + row.realFmPrev, 0),
    growthFm: null,
    realYtd: rows.reduce((sum, row) => sum + row.realYtd, 0),
    achYtd: null,
    growthYtd: null,
    rankYtd: null,
    shortageYtd: 0,
  };
  total.targetAch = safeRatio(total.mtd, total.targetFm);
  total.shortageFm = total.mtd - total.targetFm;
  total.growthMtd = safeGrowth(total.mtd, total.realMtdPrev);
  total.growthFm = safeGrowth(total.mtd, total.realFmPrev);
  total.achYtd = safeRatio(total.realYtd, total.targetYtd);
  total.shortageYtd = total.realYtd - total.targetYtd;
  const previousYtd = rows.reduce((sum, row) => {
    const ytdPrevious = toNumber(
      (seedData.previousByWitel.ytdPrev as Record<string, CellValue>)[row.label] ??
        (seedData.previousByBranch.ytdPrev as Record<string, CellValue>)[row.label],
    );
    return sum + ytdPrevious;
  }, 0);
  total.growthYtd = safeGrowth(total.realYtd, previousYtd);
  return total;
}

type JakartaClock = { year: number; month: number; day: number; hour: number };

function jakartaClock(savedAt: string | null): JakartaClock | null {
  if (!savedAt) return null;
  const time = new Date(savedAt);
  if (Number.isNaN(time.getTime())) return null;
  const jakarta = new Date(time.getTime() + 7 * 60 * 60 * 1000);
  return {
    year: jakarta.getUTCFullYear(),
    month: jakarta.getUTCMonth() + 1,
    day: jakarta.getUTCDate(),
    hour: jakarta.getUTCHours(),
  };
}

// Hari yang dipakai untuk "REAL MTD bulan lalu". Meniru 'REAL '!AH1 di workbook R24:
// sebelum jam 12 siang memakai kemarin, selain itu hari ini; bila tanggal itu akhir bulan, memakai tanggal akhir bulan sebelumnya.
// Periode yang sudah lewat memakai satu bulan penuh.
function previousMonthCutDay(clock: JakartaClock | null, period: ReportingPeriod, lastDataDay: number) {
  if (!clock) return lastDataDay;
  if (period.year * 12 + period.month < clock.year * 12 + clock.month) return 31;
  const baseDate = new Date(Date.UTC(clock.year, clock.month - 1, clock.hour < 12 ? clock.day - 1 : clock.day));
  const nextDay = new Date(baseDate.getTime() + 24 * 60 * 60 * 1000);
  const isMonthEnd = nextDay.getUTCDate() === 1;
  if (!isMonthEnd) return baseDate.getUTCDate();
  return new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), 0)).getUTCDate();
}

function sumNumbers(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

function previousFromReal(
  source: Record<string, { daily: number[]; months: number[]; ytdPrev: number }>,
  fallbackYtdPrev: Record<string, CellValue>,
  cutDay: number,
  monthIndex: number,
): PreviousConfig {
  const config: PreviousConfig = { mtd: {}, fm: {}, ytd: {}, ytdPrev: { ...fallbackYtdPrev }, ytdBase: {} };
  for (const [label, row] of Object.entries(source)) {
    config.mtd[label] = sumNumbers(row.daily.slice(0, Math.max(0, cutDay)));
    config.fm[label] = sumNumbers(row.daily);
    config.ytdBase![label] = sumNumbers(row.months.slice(0, monthIndex));
    config.ytd[label] = config.ytdBase![label];
    config.ytdPrev[label] = row.ytdPrev;
  }
  return config;
}

type PreviousSet = { witel: PreviousConfig; branch: PreviousConfig; dynamic: boolean };

function buildPreviousSet(period: ReportingPeriod, clock: JakartaClock | null, lastDataDay: number): PreviousSet {
  const reference = seedData.realReference;
  if (reference && reference.forPeriod === period.year * 100 + period.month) {
    const cutDay = previousMonthCutDay(clock, period, lastDataDay);
    return {
      witel: previousFromReal(reference.witel, seedData.previousByWitel.ytdPrev as Record<string, CellValue>, cutDay, period.monthIndex),
      branch: previousFromReal(reference.telda, seedData.previousByBranch.ytdPrev as Record<string, CellValue>, cutDay, period.monthIndex),
      dynamic: true,
    };
  }
  return {
    witel: seedData.previousByWitel as PreviousConfig,
    branch: seedData.previousByBranch as PreviousConfig,
    dynamic: false,
  };
}

type ReferenceKind = "witel" | "branch" | "stfWitel" | "stfBranch";

function referenceMtd(label: string, kind: ReferenceKind) {
  const source = seedData.excelReference[kind];
  return toNumber((source.find((row) => row.label === label)?.mtd ?? 0) as CellValue);
}

function hasPreviousValue(source: Record<string, CellValue>, label: string) {
  return Object.prototype.hasOwnProperty.call(source, label) && source[label] !== null && source[label] !== "";
}

function previousValueOrMemberSum(
  source: Record<string, CellValue>,
  label: string,
  memberRows: ReportRow[],
  selector: (row: ReportRow) => number,
) {
  if (hasPreviousValue(source, label)) return toNumber(source[label]);
  return memberRows.reduce((sum, row) => sum + selector(row), 0);
}

function previousYtdPrevOrMemberSum(source: Record<string, CellValue>, label: string, members: string[]) {
  if (hasPreviousValue(source, label)) return toNumber(source[label]);
  return members.reduce((sum, member) => sum + toNumber(source[member]), 0);
}

function makeGroupedBranchRow(
  group: (typeof seedData.branchGroups)[number],
  memberRows: ReportRow[],
  referenceKind: "branch" | "stfBranch",
  period: ReportingPeriod,
  previousSet: PreviousSet,
) {
  const daysRaw = sumDayArrays(memberRows.map((row) => row.days.map((day) => day ?? 0)), period.days);
  const target: TargetConfig = {
    label: group.label,
    monthly: Array.from({ length: 12 }, (_, month) =>
      memberRows.reduce((sum, row) => sum + (month === period.monthIndex ? row.targetFm : 0), 0),
    ),
    targetYtd: memberRows.reduce((sum, row) => sum + row.targetYtd, 0),
  };
  const dynamicPrevious: PreviousConfig | null = previousSet.dynamic
    ? {
        mtd: { [group.label]: memberRows.reduce((sum, row) => sum + row.realMtdPrev, 0) },
        fm: { [group.label]: memberRows.reduce((sum, row) => sum + row.realFmPrev, 0) },
        ytd: {},
        ytdBase: {
          [group.label]: group.members.reduce((sum, member) => sum + (previousSet.branch.ytdBase?.[member] ?? 0), 0),
        },
        ytdPrev: {
          [group.label]: previousYtdPrevOrMemberSum(
            seedData.previousByBranch.ytdPrev as Record<string, CellValue>,
            group.label,
            group.members,
          ),
        },
      }
    : null;
  const previous: PreviousConfig = dynamicPrevious ?? {
    mtd: {
      [group.label]: previousValueOrMemberSum(
        seedData.previousByBranch.mtd as Record<string, CellValue>,
        group.label,
        memberRows,
        (row) => row.realMtdPrev,
      ),
    },
    fm: {
      [group.label]: previousValueOrMemberSum(
        seedData.previousByBranch.fm as Record<string, CellValue>,
        group.label,
        memberRows,
        (row) => row.realFmPrev,
      ),
    },
    ytd: {
      [group.label]: previousValueOrMemberSum(
        seedData.previousByBranch.ytd as Record<string, CellValue>,
        group.label,
        memberRows,
        (row) => row.realYtd,
      ),
    },
    ytdPrev: {
      [group.label]: previousYtdPrevOrMemberSum(
        seedData.previousByBranch.ytdPrev as Record<string, CellValue>,
        group.label,
        group.members,
      ),
    },
  };
  return makeRow(group.label, target, daysRaw, previous, referenceMtd(group.label, referenceKind), period.monthIndex);
}

function validation(rows: ReportRow[], kind: ReferenceKind) {
  const reference = seedData.excelReference[kind];
  const notes: string[] = [];
  let checked = 0;
  let mismatches = 0;
  // Referensi Excel adalah foto data pada hari tertentu. Realisasi (mtd) & shortage hanya dibandingkan bila data
  // yang diupload sama dengan foto itu (total mtd sama); kalau sudah ada data baru, hanya target yang divalidasi,
  // supaya status "SELISIH" tidak muncul palsu setiap kali master diperbarui.
  const totalRow = rows[rows.length - 1];
  const totalReference = totalRow ? reference.find((item) => item.label === totalRow.label) : undefined;
  const sameSnapshot = Boolean(totalRow && totalReference) && Math.abs(toNumber(totalRow.mtd as CellValue) - toNumber(totalReference!.mtd as CellValue)) <= 0.0001;
  for (const row of rows) {
    const expected = reference.find((item) => item.label === row.label);
    if (!expected) continue;
    checked += 1;
    const fields: Array<keyof ReportRow> = sameSnapshot ? ["targetFm", "targetYtd", "mtd", "shortageFm"] : ["targetFm", "targetYtd"];
    for (const field of fields) {
      const actualValue = toNumber(row[field] as CellValue);
      const expectedValue = toNumber(expected[field] as CellValue);
      if (Math.abs(actualValue - expectedValue) > 0.0001) {
        mismatches += 1;
        notes.push(`${kind}:${row.label}:${field} expected ${expectedValue}, got ${actualValue}`);
      }
    }
  }
  return { checked, mismatches, notes };
}

function makeBranchRows(
  targets: readonly TargetConfig[],
  datelCounts: Map<string, number[]>,
  referenceKind: "branch" | "stfBranch",
  period: ReportingPeriod,
  previousSet: PreviousSet,
) {
  const teldaRows = new Map(
    targets.map((target) => {
      const days = datelCounts.get(target.rawDatel ?? target.label) ?? Array(period.days).fill(0);
      const row = makeRow(
        target.label,
        target,
        days,
        previousSet.branch,
        referenceMtd(target.label, referenceKind),
        period.monthIndex,
      );
      return [target.label, row] as const;
    }),
  );

  const rows = seedData.branchGroups.map((group) => {
    const memberRows = group.members.map((member) => teldaRows.get(member)).filter(Boolean) as ReportRow[];
    return makeGroupedBranchRow(group, memberRows, referenceKind, period, previousSet);
  });
  rankDescending(rows, "targetAch");
  rankDescending(rows, "achYtd");
  return rows;
}

export function computeReport(masterRows: MasterRow[], savedAt: string | null = null, periodKey?: string): ComputedReport {
  const period = periodFromKey(periodKey);
  const clock = jakartaClock(savedAt);
  // Sebelum jam 12 siang, tanggal hari ini belum dihitung (aturan kolom tanggal di workbook R24).
  const skipDay =
    clock && clock.year === period.year && clock.month === period.month && clock.hour < 12 ? clock.day : null;
  const witelCounts = buildCounts(masterRows, "witel", period, skipDay);
  const datelCounts = buildCounts(masterRows, "datel", period, skipDay);
  let lastDataDay = 0;
  for (const counts of witelCounts.values()) {
    counts.forEach((value, index) => {
      if (value > 0) lastDataDay = Math.max(lastDataDay, index + 1);
    });
  }
  const previousSet = buildPreviousSet(period, clock, lastDataDay);

  const witelRows = seedData.witelTargets.map((target) =>
    makeRow(
      target.label,
      target,
      witelCounts.get(target.label) ?? Array(period.days).fill(0),
      previousSet.witel,
      referenceMtd(target.label, "witel"),
      period.monthIndex,
    ),
  );
  rankDescending(witelRows, "targetAch");
  rankDescending(witelRows, "achYtd");

  const teldaRows = new Map(
    seedData.teldaTargets.map((target) => {
      const days = datelCounts.get(target.rawDatel) ?? Array(period.days).fill(0);
      const row = makeRow(
        target.label,
        target,
        days,
        previousSet.branch,
        referenceMtd(target.label, "branch"),
        period.monthIndex,
      );
      return [target.label, row] as const;
    }),
  );

  const branchRows = seedData.branchGroups.map((group) => {
    const memberRows = group.members.map((member) => teldaRows.get(member)).filter(Boolean) as ReportRow[];
    return makeGroupedBranchRow(group, memberRows, "branch", period, previousSet);
  });
  rankDescending(branchRows, "targetAch");
  rankDescending(branchRows, "achYtd");

  const stfWitelRows = seedData.stfWitelTargets.map((target) =>
    makeRow(
      target.label,
      target,
      witelCounts.get(target.label) ?? Array(period.days).fill(0),
      previousSet.witel,
      referenceMtd(target.label, "stfWitel"),
      period.monthIndex,
    ),
  );
  rankDescending(stfWitelRows, "targetAch");
  rankDescending(stfWitelRows, "achYtd");

  const stfBranchRows = makeBranchRows(seedData.stfTeldaTargets, datelCounts, "stfBranch", period, previousSet);

  const witelTotal = makeTotal("Total", witelRows, period.days);
  const branchTotal = makeTotal("YK JATENG SELATAN", branchRows, period.days);
  const stfWitelTotal = makeTotal("Total", stfWitelRows, period.days);
  const stfBranchTotal = makeTotal("YK JATENG SELATAN", stfBranchRows, period.days);
  const trend = Array.from({ length: period.days }, (_, index) => {
    const day = index + 1;
    const realisasi = witelTotal.days[index] ?? 0;
    const cumulative = witelTotal.days.slice(0, index + 1).reduce<number>((sum, value) => sum + (value ?? 0), 0);
    return { day, realisasi, cumulative };
  });
  const shouldValidate = period.year === DEFAULT_PERIOD.year && period.month === DEFAULT_PERIOD.month;
  const v1 = shouldValidate ? validation([...witelRows, witelTotal], "witel") : { checked: 0, mismatches: 0, notes: [] };
  const v2 = shouldValidate ? validation([...branchRows, branchTotal], "branch") : { checked: 0, mismatches: 0, notes: [] };
  const v3 = shouldValidate ? validation([...stfWitelRows, stfWitelTotal], "stfWitel") : { checked: 0, mismatches: 0, notes: [] };
  const v4 = shouldValidate ? validation([...stfBranchRows, stfBranchTotal], "stfBranch") : { checked: 0, mismatches: 0, notes: [] };

  return {
    periodLabel: `${period.monthName} ${period.year}`,
    previousMonthLabel: `${period.previousMonthName} ${period.month <= 1 ? period.year - 1 : period.year}`,
    cutoffLabel: savedAt ? new Date(savedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : seedData.initialCutoff,
    updatedAt: savedAt,
    source: seedData.source,
    witel: {
      title: "PS HARIAN HSI",
      subtitle: "WITEL YOGYA JATENG SELATAN",
      rows: witelRows,
      total: witelTotal,
    },
    branch: {
      title: "PS HARIAN HSI",
      subtitle: "WITEL YOGYA JATENG SELATAN",
      rows: branchRows,
      total: branchTotal,
    },
    targetStf: {
      witel: {
        title: "PS HARIAN HSI",
        subtitle: "WITEL YOGYA JATENG SELATAN",
        rows: stfWitelRows,
        total: stfWitelTotal,
      },
      branch: {
        title: "PS HARIAN HSI",
        subtitle: "WITEL YOGYA JATENG SELATAN",
        rows: stfBranchRows,
        total: stfBranchTotal,
      },
    },
    dailyTrend: trend,
    excludedDay: skipDay,
    validation: {
      checked: v1.checked + v2.checked + v3.checked + v4.checked,
      mismatches: v1.mismatches + v2.mismatches + v3.mismatches + v4.mismatches,
      notes: [...v1.notes, ...v2.notes, ...v3.notes, ...v4.notes].slice(0, 8),
    },
  };
}

export function initialMasterRows(): MasterRow[] {
  return seedData.masterRows.map((row) => [...row]) as MasterRow[];
}

export const masterHeaders = [...seedData.masterHeaders] as string[];
