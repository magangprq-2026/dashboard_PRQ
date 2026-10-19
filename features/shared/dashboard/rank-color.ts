/**
 * Warna rank untuk tabel REPORT (HSI, WMS, LTS, MetaBright).
 * Rank 1 = hijau, rank terakhir = merah, di antaranya gradasi hijau -> kuning -> oranye -> merah.
 */
const GREEN_HUE = 142;
const RED_HUE = 0;

export type RankColor = { bg: string; fg: string; border: string };

export function rankColor(rank: number | null | undefined, total: number): RankColor | null {
  if (rank == null || !Number.isFinite(rank) || rank < 1) return null;
  const count = Math.max(1, Math.round(total));
  const ratio = count <= 1 ? 0 : Math.min(1, Math.max(0, (rank - 1) / (count - 1)));
  const hue = Math.round(GREEN_HUE + (RED_HUE - GREEN_HUE) * ratio);
  return {
    bg: `hsl(${hue}, 72%, 38%)`,
    fg: "#ffffff",
    border: `hsl(${hue}, 72%, 28%)`,
  };
}

/** Ambil jumlah peringkat dari sekumpulan baris (rank terbesar yang ada). */
export function rankTotal(ranks: Array<number | null | undefined>): number {
  let max = 0;
  for (const rank of ranks) {
    if (typeof rank === "number" && Number.isFinite(rank) && rank > max) max = rank;
  }
  return max;
}

/** Style inline untuk pill rank di tabel HTML. */
export function rankPillStyle(rank: number | null | undefined, total: number): { backgroundColor: string; color: string; boxShadow: string } | undefined {
  const color = rankColor(rank, total);
  if (!color) return undefined;
  return { backgroundColor: color.bg, color: color.fg, boxShadow: `0 0 0 1px ${color.border}` };
}

/**
 * Palet 6 warna bertahap (hijau -> hijau muda -> kuning -> oranye muda -> oranye -> merah).
 * Dipakai di report LTS. Rank dibagi rata ke 6 tingkat; rank 1 selalu hijau, rank terakhir selalu merah.
 */
export const RANK_STEP_PALETTE: RankColor[] = [
  { bg: "#01ad23", fg: "#ffffff", border: "#018a1c" },
  { bg: "#80c02b", fg: "#ffffff", border: "#659a22" },
  { bg: "#ffd334", fg: "#422006", border: "#d9b01f" },
  { bg: "#f79c31", fg: "#ffffff", border: "#cf7f1f" },
  { bg: "#ec6430", fg: "#ffffff", border: "#c44d20" },
  { bg: "#e12f2e", fg: "#ffffff", border: "#b92222" },
];

export function rankStepColor(rank: number | null | undefined, total: number): RankColor | null {
  if (rank == null || !Number.isFinite(rank) || rank < 1) return null;
  const count = Math.max(1, Math.round(total));
  const steps = RANK_STEP_PALETTE.length;
  const position = Math.min(Math.max(rank, 1), count);
  const index =
    count <= steps
      ? count === 1
        ? 0
        : Math.round(((position - 1) / (count - 1)) * (steps - 1))
      : Math.min(steps - 1, Math.floor(((position - 1) * steps) / count));
  return RANK_STEP_PALETTE[index];
}

export function rankStepPillStyle(rank: number | null | undefined, total: number): { backgroundColor: string; color: string; boxShadow: string } | undefined {
  const color = rankStepColor(rank, total);
  if (!color) return undefined;
  return { backgroundColor: color.bg, color: color.fg, boxShadow: `0 0 0 1px ${color.border}` };
}
