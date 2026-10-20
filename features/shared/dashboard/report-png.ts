// Pembuat gambar PNG report (HSI, WMS, LTS) di browser untuk tombol "Download".
// Kode gambarnya sama dengan features/telegram/report-images/table-kit.ts (bot Telegram), hanya memakai
// Canvas browser, sehingga hasil unduhan dari web identik dengan gambar yang dikirim bot.
import type { BannerText, ReportTheme, TableCol } from "@/features/shared/dashboard/report-table";

type Ctx = CanvasRenderingContext2D;
export type TableSpec<R> = { cols: TableCol<R>[]; rows: R[]; total: R };

const GROUP_H = 40;
const SUB_H = 30;
const ROW_H = 38;
const BANNER_H = 158;
const MARGIN = 26;
const TABLE_GAP = 24;
const FOOTER_H = 52;
const FONT = "Arial";

export function formatJakartaDateTime(date: Date, seconds = true) {
  const dateText = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", timeZone: "Asia/Jakarta", year: "numeric" }).format(date);
  const timeText = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    timeZone: "Asia/Jakarta",
  })
    .format(date)
    .replace(/\./g, ":");
  return `${dateText}${seconds ? "," : " •"} ${timeText} WIB`;
}

function wrapText(ctx: Ctx, text: string, maxWidth: number, maxLines = 3) {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(next).width <= maxWidth) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function fitText(ctx: Ctx, text: string, x: number, y: number, width: number, h: number, align: "left" | "center", size: number, bold: boolean) {
  let fontSize = size;
  ctx.font = `${bold ? "700" : "600"} ${fontSize}px ${FONT}`;
  while (fontSize > 9 && ctx.measureText(text).width > width - 12) {
    fontSize -= 1;
    ctx.font = `${bold ? "700" : "600"} ${fontSize}px ${FONT}`;
  }
  ctx.textBaseline = "middle";
  ctx.textAlign = align;
  ctx.fillText(text, align === "left" ? x + 12 : x + width / 2, y + h / 2 + 0.5);
}

function headerCell(ctx: Ctx, text: string, x: number, y: number, w: number, h: number, fill: string, color: string, size = 11.5) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapText(ctx, text, w - 10);
  const lineHeight = size + 3;
  const startY = y + h / 2 - ((lines.length - 1) * lineHeight) / 2 + 0.5;
  lines.forEach((line, index) => ctx.fillText(line, x + w / 2, startY + index * lineHeight));
}

const tableWidth = (cols: { width: number }[]) => cols.reduce((sum, col) => sum + col.width, 0);
const tableHeight = (rowCount: number) => GROUP_H + SUB_H + rowCount * ROW_H;

function drawTable<R>(ctx: Ctx, theme: ReportTheme, spec: TableSpec<R>, x: number, y: number) {
  const { cols, rows, total } = spec;
  const width = tableWidth(cols);
  const bodyRows = [...rows, total];
  const height = tableHeight(bodyRows.length);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 10);
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, width, height);

  let cursor = x;
  let index = 0;
  while (index < cols.length) {
    const col = cols[index];
    if (col.group) {
      let span = 1;
      let spanWidth = col.width;
      while (cols[index + span]?.group === col.group) {
        spanWidth += cols[index + span].width;
        span += 1;
      }
      headerCell(ctx, col.group, cursor, y, spanWidth, GROUP_H, col.fill, col.text ?? "#ffffff", 12.5);
      let inner = cursor;
      for (let k = index; k < index + span; k += 1) {
        headerCell(ctx, cols[k].head, inner, y + GROUP_H, cols[k].width, SUB_H, cols[k].subFill ?? "#ffffff", cols[k].subText ?? theme.text, 11);
        inner += cols[k].width;
      }
      cursor += spanWidth;
      index += span;
      continue;
    }
    if (col.sub) {
      headerCell(ctx, col.head, cursor, y, col.width, GROUP_H, col.fill, col.text ?? "#ffffff");
      headerCell(ctx, col.sub, cursor, y + GROUP_H, col.width, SUB_H, col.subFill ?? "#ffffff", col.subText ?? theme.text, 11);
    } else {
      headerCell(ctx, col.head, cursor, y, col.width, GROUP_H + SUB_H, col.fill, col.text ?? "#ffffff", 13);
    }
    cursor += col.width;
    index += 1;
  }

  const bodyTop = y + GROUP_H + SUB_H;
  bodyRows.forEach((row, rowIndex) => {
    const isTotal = rowIndex === bodyRows.length - 1;
    const rowY = bodyTop + rowIndex * ROW_H;
    let cellX = x;
    for (const col of cols) {
      const style = col.cell(row, rowIndex);
      const zebra = rowIndex % 2 === 0 ? "#ffffff" : theme.zebra;
      ctx.fillStyle = isTotal ? theme.ink : (style.fill ?? zebra);
      ctx.fillRect(cellX, rowY, col.width, ROW_H);
      ctx.strokeStyle = isTotal ? "rgba(255,255,255,0.14)" : theme.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX + 0.5, rowY + 0.5, col.width - 1, ROW_H - 1);
      ctx.fillStyle = isTotal ? "#ffffff" : (style.color ?? theme.text);
      fitText(ctx, style.text, cellX, rowY, col.width, ROW_H, col.align ?? "center", isTotal ? 14 : 13, isTotal || Boolean(style.bold));
      cellX += col.width;
    }
  });
  ctx.restore();

  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x + 0.75, y + 0.75, width - 1.5, height - 1.5, 10);
  ctx.stroke();
  return height;
}

function drawDots(ctx: Ctx, x: number, y: number, cols: number, rows: number, gap: number, alpha: number) {
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      ctx.beginPath();
      ctx.arc(x + c * gap, y + r * gap, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBanner(ctx: Ctx, theme: ReportTheme, width: number, text: BannerText) {
  const gradient = ctx.createLinearGradient(0, 0, width, BANNER_H);
  gradient.addColorStop(0, theme.bannerStops[0]);
  gradient.addColorStop(0.5, theme.bannerStops[1]);
  gradient.addColorStop(1, theme.bannerStops[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, BANNER_H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, BANNER_H);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (const side of [0, 1]) {
    const base = side === 0 ? 0 : width;
    const dir = side === 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(base, 0);
    ctx.lineTo(base + dir * 190, 0);
    ctx.lineTo(base + dir * 90, BANNER_H);
    ctx.lineTo(base, BANNER_H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(base + dir * 190, 0);
    ctx.lineTo(base + dir * 90, BANNER_H);
    ctx.stroke();
  }
  drawDots(ctx, 36, 28, 7, 5, 16, 0.14);
  drawDots(ctx, width - 36 - 6 * 16, 28, 7, 5, 16, 0.14);
  ctx.restore();

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 42px ${FONT}`;
  ctx.fillText(text.title, width / 2, 52);

  const size = 21;
  const parts = [
    { color: "#ffffff", font: `600 ${size}px ${FONT}`, text: "PERIODE : " },
    { color: theme.highlight, font: `700 ${size}px ${FONT}`, text: text.periodLabel },
    { color: "rgba(255,255,255,0.55)", font: `400 ${size}px ${FONT}`, text: "     |     " },
    { color: "#ffffff", font: `600 ${size}px ${FONT}`, text: text.scope },
  ];
  ctx.textAlign = "left";
  const widths = parts.map((part) => {
    ctx.font = part.font;
    return ctx.measureText(part.text).width;
  });
  let cursor = (width - widths.reduce((sum, w) => sum + w, 0)) / 2;
  parts.forEach((part, i) => {
    ctx.font = part.font;
    ctx.fillStyle = part.color;
    ctx.fillText(part.text, cursor, 96);
    cursor += widths[i];
  });

  if (text.note) {
    ctx.textAlign = "center";
    ctx.font = `600 13px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(text.note, width / 2, 130);
  }

  const accent = ctx.createLinearGradient(0, 0, width, 0);
  accent.addColorStop(0, "rgba(255,255,255,0)");
  accent.addColorStop(0.5, theme.highlight);
  accent.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = accent;
  ctx.fillRect(0, BANNER_H - 4, width, 4);
}

export type ReportPageSpec = {
  banner: BannerText;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tables: TableSpec<any>[];
  theme: ReportTheme;
  timestamp: Date;
  footer: string;
};

/** Banner + tabel-tabel + footer menjadi satu PNG (Blob). Lebar mengikuti tabel terlebar. */
export async function renderReportPngBlob(spec: ReportPageSpec): Promise<Blob> {
  await document.fonts?.ready;
  const scale = 2;
  const widest = Math.max(...spec.tables.map((table) => tableWidth(table.cols)));
  const width = Math.max(widest + MARGIN * 2, 980);
  const bodyHeight = spec.tables.reduce((sum, table) => sum + tableHeight(table.rows.length + 1), 0) + (spec.tables.length - 1) * TABLE_GAP;
  const height = BANNER_H + MARGIN + bodyHeight + MARGIN + FOOTER_H;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas browser tidak tersedia.");
  ctx.scale(scale, scale);

  ctx.fillStyle = spec.theme.canvasBg;
  ctx.fillRect(0, 0, width, height);
  drawBanner(ctx, spec.theme, width, spec.banner);

  let y = BANNER_H + MARGIN;
  for (const table of spec.tables) {
    const tableW = tableWidth(table.cols);
    y += drawTable(ctx, spec.theme, table, (width - tableW) / 2, y) + TABLE_GAP;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = spec.theme.muted;
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText(`${spec.footer}  •  Diunduh ${formatJakartaDateTime(spec.timestamp, false)}`, width / 2, height - FOOTER_H + 16);
  ctx.font = `700 11px ${FONT}`;
  ctx.fillStyle = "#9f1239";
  ctx.fillText("CONFIDENTIAL - INTERNAL USE ONLY", width / 2, height - FOOTER_H + 36);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("PNG gagal dibuat."))), "image/png");
  });
}
