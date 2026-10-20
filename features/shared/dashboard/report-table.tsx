// Tabel report versi web (HSI, WMS, LTS) dengan gaya yang sama persis dengan gambar PNG Telegram
// (features/telegram/report-images/table-kit.ts): banner judul di tengah, header dua baris,
// angka rata tengah, sel diwarnai hijau/kuning/merah, dan baris Total gelap.
// File ini murni React/CSS (tidak mengimpor @napi-rs/canvas) sehingga aman dipakai di browser.
import type { CSSProperties, ReactNode } from "react";

export type ReportTheme = {
  /** Gradien banner kiri → kanan. */
  bannerStops: [string, string, string];
  /** Warna penyorot periode di banner. */
  highlight: string;
  /** Warna gelap utama: header kolom label dan baris Total. */
  ink: string;
  /** Latar halaman di belakang tabel. */
  canvasBg: string;
  zebra: string;
  line: string;
  text: string;
  muted: string;
};

export type CellStyle = { text: string; fill?: string; color?: string; bold?: boolean };

export type TableCol<R> = {
  /** Teks header. Bila ada `group`, ini jadi header baris ke-2 di bawah judul grup. */
  head: string;
  /** Teks baris ke-2 (satuan, mis. "MTD" atau "%"). Dipakai bila tidak ada `group`. */
  sub?: string;
  group?: string;
  width: number;
  fill: string;
  text?: string;
  subFill?: string;
  subText?: string;
  align?: "left" | "center";
  /** Kunci unik kolom (opsional); bawaannya dibuat dari group/head/indeks. */
  key?: string;
  cell: (row: R, index: number) => CellStyle;
};

const GROUP_H = 40;
const SUB_H = 30;
const ROW_H = 38;
const BANNER_H = 158;
const FONT = "Arial, 'Liberation Sans', Helvetica, sans-serif";

// ---------- Warna nilai (sama dengan PNG) ----------
export const GOOD = { color: "#166534", fill: "#dcfce7" };
export const NEAR = { color: "#92400e", fill: "#fef3c7" };
export const LOW = { color: "#9f1239", fill: "#ffe4e6" };

type Tone = { color: string; fill: string } | null;

export function achTone(value: number | null | undefined): Tone {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value >= 1) return GOOD;
  if (value >= 0.8) return NEAR;
  return LOW;
}

/** Peringkat terbaik (sepertiga atas) hijau, tengah kuning, sepertiga bawah merah. */
export function rankTone(rank: number | null | undefined, count: number): Tone {
  if (rank === null || rank === undefined || !Number.isFinite(rank) || count <= 0) return null;
  const third = Math.max(1, Math.round(count / 3));
  if (rank <= third) return GOOD;
  if (rank > count - third) return LOW;
  return NEAR;
}

/** Selisih/pertumbuhan: negatif merah, positif hijau, nol netral. */
export function signTone(value: number | null | undefined): Tone {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return null;
  return value < 0 ? LOW : GOOD;
}

// ---------- Periode & hari ----------
const MONTHS_ID = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];

/** "OKTOBER 2026" → { year: 2026, month: 10 }. */
export function parsePeriodLabel(label: string) {
  const match = label.toUpperCase().match(/([A-Z]+)\s+(\d{4})/);
  if (!match) return null;
  const month = MONTHS_ID.indexOf(match[1]) + 1;
  return month > 0 ? { month, year: Number(match[2]) } : null;
}

/** Sabtu/Minggu → "weekend", selain itu "weekday". Tanpa periode yang valid → "weekday". */
export function dayKind(period: { month: number; year: number } | null, day: number): "weekday" | "weekend" {
  if (!period) return "weekday";
  const weekday = new Date(Date.UTC(period.year, period.month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6 ? "weekend" : "weekday";
}

// ---------- Banner ----------
export type BannerText = {
  title: string;
  periodLabel: string;
  scope: string;
  /** Baris kecil di bawah periode, mis. "TARGET RKAP • DATA S.D. TANGGAL 19". */
  note?: string;
};

function Dots({ side, theme }: { side: "left" | "right"; theme: ReportTheme }) {
  void theme;
  const style: CSSProperties = {
    backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.14) 2.2px, transparent 2.6px)",
    backgroundSize: "16px 16px",
    height: 4 * 16 + 8,
    position: "absolute",
    top: 24,
    width: 6 * 16 + 8,
    ...(side === "left" ? { left: 32 } : { right: 32 }),
  };
  return <div aria-hidden style={style} />;
}

function Ribbon({ side }: { side: "left" | "right" }) {
  const left = side === "left";
  return (
    <div
      aria-hidden
      style={{
        background: "rgba(255,255,255,0.05)",
        bottom: 0,
        clipPath: left ? "polygon(0 0, 100% 0, 47% 100%, 0 100%)" : "polygon(0 0, 100% 0, 100% 100%, 53% 100%)",
        position: "absolute",
        top: 0,
        width: 190,
        ...(left ? { left: 0 } : { right: 0 }),
      }}
    />
  );
}

export function ReportBanner({ theme, text }: { theme: ReportTheme; text: BannerText }) {
  return (
    <div
      className="relative overflow-hidden text-center"
      style={{
        background: `linear-gradient(100deg, ${theme.bannerStops[0]} 0%, ${theme.bannerStops[1]} 50%, ${theme.bannerStops[2]} 100%)`,
        fontFamily: FONT,
        height: BANNER_H,
      }}
    >
      <Ribbon side="left" />
      <Ribbon side="right" />
      <Dots side="left" theme={theme} />
      <Dots side="right" theme={theme} />
      <h2
        className="absolute m-0 w-full truncate px-4 text-center font-bold leading-none text-white"
        style={{ fontSize: 42, left: 0, top: 52, transform: "translateY(-50%)" }}
      >
        {text.title}
      </h2>
      <p
        className="absolute m-0 flex w-full items-center justify-center whitespace-pre px-4 leading-none text-white"
        style={{ fontSize: 21, fontWeight: 600, left: 0, top: 96, transform: "translateY(-50%)" }}
      >
        <span>PERIODE : </span>
        <span style={{ color: theme.highlight, fontWeight: 700 }}>{text.periodLabel}</span>
        <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 400 }}>{"     |     "}</span>
        <span>{text.scope}</span>
      </p>
      {text.note && (
        <p
          className="absolute m-0 w-full px-4 text-center leading-none"
          style={{ color: "rgba(255,255,255,0.72)", fontSize: 13, fontWeight: 600, left: 0, top: 130, transform: "translateY(-50%)" }}
        >
          {text.note}
        </p>
      )}
      <div
        aria-hidden
        style={{
          background: `linear-gradient(90deg, rgba(255,255,255,0), ${theme.highlight}, rgba(255,255,255,0))`,
          bottom: 0,
          height: 4,
          left: 0,
          position: "absolute",
          right: 0,
        }}
      />
    </div>
  );
}

// ---------- Tabel ----------
const headBase: CSSProperties = {
  borderBottom: "1px solid rgba(255,255,255,0.28)",
  borderRight: "1px solid rgba(255,255,255,0.28)",
  fontWeight: 700,
  lineHeight: 1.25,
  overflow: "hidden",
  padding: "0 5px",
  position: "sticky",
  textAlign: "center",
  verticalAlign: "middle",
  whiteSpace: "normal",
};

function colKey<R>(col: TableCol<R>, index: number) {
  return col.key ?? `${col.group ?? ""}|${col.head}|${index}`;
}

export function ReportTable<R>({ cols, rows, theme, total, maxHeight = "72vh" }: { cols: TableCol<R>[]; rows: R[]; theme: ReportTheme; total: R; maxHeight?: string }) {
  const width = cols.reduce((sum, col) => sum + col.width, 0);
  const bodyRows = [...rows, total];

  // Susun header: kelompokkan kolom bergrup yang berurutan menjadi satu sel baris-1.
  const top: ReactNode[] = [];
  const bottom: ReactNode[] = [];
  let index = 0;
  while (index < cols.length) {
    const col = cols[index];
    const sticky = index === 0;
    const stickyLeft: CSSProperties = sticky ? { boxShadow: "6px 0 10px -6px rgba(0,0,0,0.45)", left: 0, zIndex: 30 } : { zIndex: 20 };
    if (col.group) {
      let span = 1;
      while (cols[index + span]?.group === col.group) span += 1;
      top.push(
        <th
          key={`g-${index}`}
          colSpan={span}
          style={{ ...headBase, ...stickyLeft, background: col.fill, color: col.text ?? "#ffffff", fontSize: 12.5, height: GROUP_H, top: 0 }}
        >
          {col.group}
        </th>,
      );
      for (let k = index; k < index + span; k += 1) {
        const c = cols[k];
        bottom.push(
          <th
            key={`s-${colKey(c, k)}`}
            style={{ ...headBase, zIndex: 20, background: c.subFill ?? "#ffffff", color: c.subText ?? theme.text, fontSize: 11, height: SUB_H, top: GROUP_H }}
          >
            {c.head}
          </th>,
        );
      }
      index += span;
      continue;
    }
    if (col.sub) {
      top.push(
        <th key={`h-${colKey(col, index)}`} style={{ ...headBase, ...stickyLeft, background: col.fill, color: col.text ?? "#ffffff", fontSize: 11.5, height: GROUP_H, top: 0 }}>
          {col.head}
        </th>,
      );
      bottom.push(
        <th key={`u-${colKey(col, index)}`} style={{ ...headBase, zIndex: 20, background: col.subFill ?? "#ffffff", color: col.subText ?? theme.text, fontSize: 11, height: SUB_H, top: GROUP_H }}>
          {col.sub}
        </th>,
      );
    } else {
      top.push(
        <th
          key={`h-${colKey(col, index)}`}
          rowSpan={2}
          style={{ ...headBase, ...stickyLeft, background: col.fill, color: col.text ?? "#ffffff", fontSize: 13, height: GROUP_H + SUB_H, top: 0 }}
        >
          {col.head}
        </th>,
      );
    }
    index += 1;
  }

  return (
    <div
      className="overflow-auto"
      style={{ background: theme.canvasBg, fontFamily: FONT, maxHeight }}
    >
      <div style={{ border: `1.5px solid ${theme.ink}`, borderRadius: 10, margin: "26px auto", overflow: "clip", width: "fit-content", maxWidth: "none" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width }}>
          <colgroup>
            {cols.map((col, i) => (
              <col key={colKey(col, i)} style={{ width: col.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>{top}</tr>
            <tr>{bottom}</tr>
          </thead>
          <tbody>
            {bodyRows.map((row, rowIndex) => {
              const isTotal = rowIndex === bodyRows.length - 1;
              const zebra = rowIndex % 2 === 0 ? "#ffffff" : theme.zebra;
              return (
                <tr key={rowIndex}>
                  {cols.map((col, colIndex) => {
                    const style = col.cell(row, rowIndex);
                    const left = (col.align ?? "center") === "left";
                    const bold = isTotal || Boolean(style.bold);
                    return (
                      <td
                        key={colKey(col, colIndex)}
                        style={{
                          background: isTotal ? theme.ink : (style.fill ?? zebra),
                          borderBottom: `1px solid ${isTotal ? "rgba(255,255,255,0.14)" : theme.line}`,
                          borderRight: `1px solid ${isTotal ? "rgba(255,255,255,0.14)" : theme.line}`,
                          color: isTotal ? "#ffffff" : (style.color ?? theme.text),
                          fontSize: isTotal ? 14 : 13,
                          fontWeight: bold ? 700 : 600,
                          height: ROW_H,
                          overflow: "hidden",
                          padding: "0 6px",
                          textAlign: left ? "left" : "center",
                          textOverflow: "ellipsis",
                          verticalAlign: "middle",
                          whiteSpace: "nowrap",
                          ...(colIndex === 0 ? { boxShadow: "6px 0 10px -6px rgba(0,0,0,0.3)", left: 0, paddingLeft: 12, position: "sticky", zIndex: 10 } : {}),
                        }}
                      >
                        {style.text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Banner (opsional, cukup di tabel pertama) + tabel dalam satu kartu, seperti satu halaman PNG. */
export function ReportCard<R>({ banner, cols, rows, theme, total }: { banner?: BannerText; cols: TableCol<R>[]; rows: R[]; theme: ReportTheme; total: R }) {
  return (
    <section className="overflow-hidden rounded-2xl border shadow-sm" style={{ borderColor: theme.line }}>
      {banner && <ReportBanner text={banner} theme={theme} />}
      <ReportTable cols={cols} rows={rows} theme={theme} total={total} />
    </section>
  );
}
