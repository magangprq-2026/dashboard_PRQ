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
