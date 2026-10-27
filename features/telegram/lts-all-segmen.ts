// LTS ALL SEGMEN: tiga CSV Tableau (T_REG, T_NAL, T_PS) -> satu workbook "LTS_ALL_SEGMEN.xlsx".
//
// Isi workbook (meniru file contoh LTS_ALL_SEGMEN.xlsx):
//   1. T_REG_Full Data_data (n)  - data T_REG apa adanya (angka jadi angka, PS_DATE jadi tanggal)
//   2. T_NAL_Full Data_data (n)  - data T_NAL
//   3. T_PS_Full Data_data (n)   - data T_PS
//   4. Sheet2                    - 4 tabel ringkasan (SALES, CHURN, CT0 DGS & DES, CT0 SME/RBS/DBS)
//
// Modul ini sengaja tidak mengimpor apa pun dari proyek, hanya node:zlib-free JSZip, supaya bisa diuji sendiri.
// File xlsx ditulis langsung sebagai XML (bukan lewat SheetJS) agar hemat memori: T_PS bisa 20 ribu baris x 118 kolom.
import JSZip from "jszip";

export type AllSegmenKind = "reg" | "nal" | "ps";
export const ALL_SEGMEN_KINDS: AllSegmenKind[] = ["reg", "nal", "ps"];
export const ALL_SEGMEN_OUTPUT_NAME = "LTS_ALL_SEGMEN.xlsx";

export function allSegmenKindLabel(kind: AllSegmenKind) {
  return { reg: "T_REG", nal: "T_NAL", ps: "T_PS" }[kind];
}

// ---------------------------------------------------------------------------------------------
// Caption
// ---------------------------------------------------------------------------------------------
const CAPTIONS = new Set(["all", "segmen", "all segmen", "lts all segmen"]);

/** all / segmen / all segmen / lts all segmen, huruf besar-kecil bebas. Harus persis (bukan sekadar mengandung). */
export function isAllSegmenCaption(caption: string | undefined): boolean {
  const text = (caption ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return CAPTIONS.has(text);
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------
/** Parser CSV (RFC 4180): kutip ganda, koma/baris baru di dalam kutip, CRLF, dan BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Buang baris kosong total (mis. baris terakhir).
  return rows.filter((r) => r.length > 1 || (r[0] ?? "") !== "");
}

// ---------------------------------------------------------------------------------------------
// Deteksi jenis file
// ---------------------------------------------------------------------------------------------
// Kolom yang dibutuhkan tabel ringkasan; sekaligus ciri khas masing-masing file.
const REQUIRED: Record<AllSegmenKind, string[]> = {
  reg: ["Bayar Desc", "Nper", "Produk", "Witel"],
  nal: ["PERIODE", "DIVISI", "L_PRODUK", "WITEL (NEW_TERRITORY)", "SSL_CT0", "SSL_DO"],
  ps: ["PERIOD", "DIVISI", "PRODUK", "WITEL", "Jml_Sales"],
};

function firstLine(buffer: Buffer): string {
  const head = buffer.subarray(0, 8192).toString("utf8");
  const end = head.search(/[\r\n]/);
  return end === -1 ? head : head.slice(0, end);
}

/** Jenis file ditentukan dari header kolom. Nama file hanya memilih bila header cocok ke lebih dari satu jenis; header tak lengkap -> null (ditolak saat upload). */
export function detectAllSegmenKind(fileName: string, buffer: Buffer): AllSegmenKind | null {
  const header = parseCsv(firstLine(buffer))[0] ?? [];
  const have = new Set(header.map((h) => h.trim()));
  const hits = ALL_SEGMEN_KINDS.filter((kind) => REQUIRED[kind].every((col) => have.has(col)));
  if (hits.length === 1) return hits[0];
  const byName = /T[_ ]?(REG|NAL|PS)(?![A-Z])/i.exec(fileName)?.[1]?.toLowerCase() as AllSegmenKind | undefined;
  if (hits.length > 1) return byName && hits.includes(byName) ? byName : hits[0];
  return null;
}

/** Nama sheet seperti file contoh: "T_PS_Full Data_data (30)". Nomor diambil dari nama file bila ada. */
export function allSegmenSheetName(kind: AllSegmenKind, fileName: string): string {
  const prefix = `${allSegmenKindLabel(kind)}_Full Data_data`;
  const n = /data[ _]*\(?_*(\d+)_*\)?\s*\.[a-z]+$/i.exec(fileName)?.[1];
  return n ? `${prefix} (${n})` : prefix;
}

// ---------------------------------------------------------------------------------------------
// Tipe kolom (meniru deteksi tipe Power Query pada file contoh)
// ---------------------------------------------------------------------------------------------
type ColumnType = "int" | "float" | "date" | "text";
const INT_RE = /^-?(0|[1-9]\d{0,14})$/;
const FLOAT_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/; // termasuk notasi ilmiah, mis. 2.5e-05
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Power Query menentukan tipe dari 200 baris pertama; kolom yang kosong di 200 baris itu dibiarkan teks
// (itu sebabnya ND, LIMITER_FLAG, dst. di file contoh bertipe teks walau isinya angka).
const TYPE_SAMPLE_ROWS = 200;

function matchesType(type: ColumnType, v: string): boolean {
  if (type === "int") return INT_RE.test(v);
  if (type === "float") return FLOAT_RE.test(v) && Number.isFinite(Number(v));
  if (type === "date") return DATE_RE.test(v);
  return true;
}

function detectColumnType(rows: string[][], col: number): ColumnType {
  const sample: string[] = [];
  for (let i = 0; i < rows.length && i < TYPE_SAMPLE_ROWS; i += 1) {
    const v = rows[i][col];
    if (v !== undefined && v !== "") sample.push(v);
  }
  if (sample.length === 0) return "text";
  let type: ColumnType = "text";
  if (sample.every((v) => matchesType("int", v))) type = "int";
  else if (sample.every((v) => matchesType("float", v))) type = "float";
  else if (sample.every((v) => matchesType("date", v))) type = "date";
  if (type === "text") return "text";
  // Nilai di luar sampel yang tidak cocok -> kolom dijadikan teks supaya tidak ada data yang rusak.
  for (const row of rows) {
    const v = row[col];
    if (v !== undefined && v !== "" && !matchesType(type, v)) return "text";
  }
  return type;
}

function excelSerial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

// ---------------------------------------------------------------------------------------------
// Penulis xlsx (XML langsung)
// ---------------------------------------------------------------------------------------------
function colLetters(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
function esc(value: string): string {
  return value.replace(XML_ILLEGAL, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function strCell(ref: string, value: string, style = 0): string {
  const s = style ? ` s="${style}"` : "";
  const space = /^\s|\s$|\n/.test(value) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}"${s} t="inlineStr"><is><t${space}>${esc(value)}</t></is></c>`;
}
function numCell(ref: string, value: number, style = 0): string {
  const s = style ? ` s="${style}"` : "";
  return `<c r="${ref}"${s}><v>${value}</v></c>`;
}

// Gaya (index cellXfs di styles.xml): 0 biasa | 1 header data | 2 tanggal | 3 tebal
const S_HEADER = 1;
const S_DATE = 2;
const S_BOLD = 3;

type SheetTable = { headers: string[]; rows: string[][] };

function dataSheetXml(table: SheetTable): string {
  const { headers, rows } = table;
  const types = headers.map((_, c) => detectColumnType(rows, c));
  const lastCol = colLetters(headers.length - 1);
  const parts: string[] = [];
  parts.push(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<dimension ref="A1:${lastCol}${rows.length + 1}"/>` +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>',
  );
  const cols = headers.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(40, Math.max(11, h.length + 3))}" customWidth="1"/>`);
  parts.push(`<cols>${cols.join("")}</cols><sheetData>`);
  parts.push(`<row r="1">${headers.map((h, c) => strCell(`${colLetters(c)}1`, h, S_HEADER)).join("")}</row>`);
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    const rowNo = r + 2;
    let cells = "";
    for (let c = 0; c < headers.length; c += 1) {
      const v = row[c];
      if (v === undefined || v === "") continue;
      const ref = `${colLetters(c)}${rowNo}`;
      const t = types[c];
      if (t === "int" || t === "float") cells += numCell(ref, Number(v));
      else if (t === "date") cells += numCell(ref, excelSerial(v), S_DATE);
      else cells += strCell(ref, v);
    }
    parts.push(`<row r="${rowNo}">${cells}</row>`);
  }
  parts.push(`</sheetData><autoFilter ref="A1:${lastCol}${rows.length + 1}"/></worksheet>`);
  return parts.join("");
}

// ---------------------------------------------------------------------------------------------
// Sheet2: empat tabel ringkasan (mengikuti pivot pada file contoh)
// ---------------------------------------------------------------------------------------------
const BLANK = "(blank)";

type Agg = { sum: number; count: number };
type PivotInput = {
  /** nama sheet sumber, dipakai pada rumus */
  sheet: string;
  table: SheetTable;
  rowField: string;
  colField?: string; // DIVISI (tidak ada pada tabel REG)
  periodField: string;
  /** kolom yang dijumlah; null = hitung baris */
  valueField: string | null;
  /** syarat tambahan: [namaKolom, "=" | "<>", nilai] */
  condition?: { field: string; op: "=" | "<>"; value: string };
};

function colIndex(table: SheetTable, name: string): number {
  const i = table.headers.indexOf(name);
  if (i === -1) throw new Error(`Kolom "${name}" tidak ada di file.`);
  return i;
}

const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;
const num = (v: string) => (v === "" || v === undefined ? 0 : Number(v) || 0);
const keyOf = (...p: string[]) => p.join("\u0001");

type Pivot = {
  witels: string[];
  columns: { div: string; period: string }[];
  agg: Map<string, Agg>;
};

function buildPivot(input: PivotInput): Pivot {
  const { table } = input;
  const iRow = colIndex(table, input.rowField);
  const iDiv = input.colField ? colIndex(table, input.colField) : -1;
  const iPer = colIndex(table, input.periodField);
  const iVal = input.valueField ? colIndex(table, input.valueField) : -1;
  const iCond = input.condition ? colIndex(table, input.condition.field) : -1;
  const witels = new Set<string>();
  const cols = new Map<string, { div: string; period: string }>();
  const agg = new Map<string, Agg>();
  for (const row of table.rows) {
    if (input.condition) {
      const eq = (row[iCond] ?? "").trim().toLowerCase() === input.condition.value.toLowerCase();
      if (input.condition.op === "=" ? !eq : eq) continue;
    }
    const witel = (row[iRow] ?? "") === "" ? BLANK : row[iRow];
    const div = iDiv === -1 ? "" : (row[iDiv] ?? "") === "" ? BLANK : row[iDiv];
    const period = (row[iPer] ?? "") === "" ? BLANK : row[iPer];
    witels.add(witel);
    cols.set(keyOf(div, period), { div, period });
    const k = keyOf(witel, div, period);
    const cell = agg.get(k) ?? { count: 0, sum: 0 };
    cell.count += 1;
    if (iVal !== -1) cell.sum += num(row[iVal]);
    agg.set(k, cell);
  }
  const cmp = (a: string, b: string) => (a === BLANK ? 1 : b === BLANK ? -1 : a.localeCompare(b, "en", { sensitivity: "base", numeric: true }));
  return {
    agg,
    columns: [...cols.values()].sort((a, b) => cmp(a.div, b.div) || cmp(a.period, b.period)),
    witels: [...witels].sort(cmp),
  };
}

const criterion = (v: string) => (v === BLANK ? '"="' : `"${v.replace(/"/g, '""')}"`);

type SheetRows = Map<number, Map<number, string>>; // baris -> kolom -> xml sel
function put(grid: SheetRows, row: number, col: number, xml: string) {
  if (!grid.has(row)) grid.set(row, new Map());
  grid.get(row)!.set(col, xml);
}
const textAt = (grid: SheetRows, row: number, col: number, value: string, style = 0) => put(grid, row, col, strCell(`${colLetters(col)}${row}`, value, style));
const numAt = (grid: SheetRows, row: number, col: number, value: number, style = 0) => put(grid, row, col, numCell(`${colLetters(col)}${row}`, value, style));
function formulaAt(grid: SheetRows, row: number, col: number, formula: string, value: number | "", style = 0) {
  const ref = `${colLetters(col)}${row}`;
  const s = style ? ` s="${style}"` : "";
  const f = `<f>${esc(formula)}</f>`;
  put(grid, row, col, value === "" ? `<c r="${ref}"${s} t="str">${f}<v></v></c>` : `<c r="${ref}"${s}>${f}<v>${value}</v></c>`);
}

/** Menulis satu tabel ringkasan. Mengembalikan nomor baris terakhir (Grand Total). */
function writePivot(grid: SheetRows, top: number, input: PivotInput, dataLabel: string): number {
  const pivot = buildPivot(input);
  const { table, sheet } = input;
  const ref = (name: string) => {
    const l = colLetters(colIndex(table, name));
    return `${quoteSheet(sheet)}!$${l}:$${l}`;
  };
  const twoLevel = Boolean(input.colField);
  const headRows = twoLevel ? 3 : 2;
  const periodRow = top + headRows - 1; // baris yang memuat periode (dan "Row Labels")
  const firstRow = top + headRows;
  const lastRow = firstRow + pivot.witels.length - 1;
  const totalRow = lastRow + 1;
  const nCols = pivot.columns.length;
  const totalCol = 1 + nCols;

  textAt(grid, top, 0, dataLabel);
  textAt(grid, top, 1, "Column Labels");
  textAt(grid, periodRow, 0, "Row Labels");
  let prevDiv: string | null = null;
  pivot.columns.forEach((c, i) => {
    if (twoLevel && c.div !== prevDiv) textAt(grid, top + 1, 1 + i, c.div);
    prevDiv = c.div;
    if (/^\d+$/.test(c.period)) numAt(grid, periodRow, 1 + i, Number(c.period));
    else textAt(grid, periodRow, 1 + i, c.period);
  });
  textAt(grid, twoLevel ? top + 1 : periodRow, totalCol, "Grand Total");

  const colTotals = new Array<number>(nCols).fill(0);
  pivot.witels.forEach((witel, ri) => {
    const row = firstRow + ri;
    textAt(grid, row, 0, witel);
    let rowTotal = 0;
    pivot.columns.forEach((c, ci) => {
      const a = pivot.agg.get(keyOf(witel, c.div, c.period));
      const col = 1 + ci;
      const L = colLetters(col);
      const crit: string[] = [`${ref(input.rowField)},${witel === BLANK ? '"="' : `$A${row}`}`];
      if (twoLevel) crit.push(`${ref(input.colField!)},${criterion(c.div)}`);
      crit.push(`${ref(input.periodField)},${/^\d+$/.test(c.period) ? `${L}$${periodRow}` : criterion(c.period)}`);
      if (input.condition) crit.push(`${ref(input.condition.field)},"${input.condition.op === "<>" ? "<>" : ""}${input.condition.value}"`);
      const count = `COUNTIFS(${crit.join(",")})`;
      const body = input.valueField ? `SUMIFS(${ref(input.valueField)},${crit.join(",")})` : count;
      const value = a ? (input.valueField ? a.sum : a.count) : "";
      formulaAt(grid, row, col, `IF(${count}=0,"",${body})`, value);
      if (value !== "") {
        rowTotal += value;
        colTotals[ci] += value;
      }
    });
    formulaAt(grid, row, totalCol, `SUM(B${row}:${colLetters(nCols)}${row})`, rowTotal);
  });

  textAt(grid, totalRow, 0, "Grand Total", S_BOLD);
  let grand = 0;
  colTotals.forEach((t, ci) => {
    const L = colLetters(1 + ci);
    formulaAt(grid, totalRow, 1 + ci, `SUM(${L}${firstRow}:${L}${lastRow})`, t, S_BOLD);
    grand += t;
  });
  formulaAt(grid, totalRow, totalCol, `SUM(B${totalRow}:${colLetters(nCols)}${totalRow})`, grand, S_BOLD);
  return totalRow;
}

function summarySheetXml(sheets: Record<AllSegmenKind, { name: string; table: SheetTable }>): string {
  const grid: SheetRows = new Map();
  const { ps, nal, reg } = sheets;

  // 1) SALES: jumlah Jml_Sales dari T_PS, per WITEL x DIVISI x PERIOD
  textAt(grid, 1, 0, "PRODUK");
  textAt(grid, 1, 1, "(All)");
  textAt(grid, 2, 0, "SALES");
  const end1 = writePivot(grid, 3, { periodField: "PERIOD", colField: "DIVISI", rowField: "WITEL", sheet: ps.name, table: ps.table, valueField: "Jml_Sales" }, "Sum of Jml_Sales");

  // 2) CHURN: jumlah SSL_DO dari T_NAL, semua L_PRODUK
  const page2 = end1 + 3;
  textAt(grid, page2, 0, "L_PRODUK");
  textAt(grid, page2, 1, "(All)");
  textAt(grid, page2 + 1, 0, "CHURN");
  const end2 = writePivot(grid, page2 + 2, { periodField: "PERIODE", colField: "DIVISI", rowField: "WITEL (NEW_TERRITORY)", sheet: nal.name, table: nal.table, valueField: "SSL_DO" }, "Sum of SSL_DO");

  // 3) CT0 DGS & DES: jumlah SSL_CT0 dari T_NAL, L_PRODUK selain WMS
  const page3 = end2 + 3;
  textAt(grid, page3, 0, "L_PRODUK");
  textAt(grid, page3, 1, "(Multiple Items)");
  textAt(grid, page3 + 1, 0, "CT0 DGS & DES");
  const end3 = writePivot(
    grid,
    page3 + 2,
    { condition: { field: "L_PRODUK", op: "<>", value: "WMS" }, periodField: "PERIODE", colField: "DIVISI", rowField: "WITEL (NEW_TERRITORY)", sheet: nal.name, table: nal.table, valueField: "SSL_CT0" },
    "Sum of SSL_CT0",
  );

  // 4) CT0 SME/RBS/DBS: jumlah baris T_REG berstatus "Belum Bayar", per Witel x Nper
  const title4 = end3 + 2;
  textAt(grid, title4, 0, "CT0 SME/RBS/DBS");
  textAt(grid, title4 + 1, 0, "Bayar Desc");
  textAt(grid, title4 + 1, 1, "Belum Bayar");
  textAt(grid, title4 + 2, 0, "Produk");
  textAt(grid, title4 + 2, 1, "(All)");
  writePivot(grid, title4 + 4, { condition: { field: "Bayar Desc", op: "=", value: "Belum Bayar" }, periodField: "Nper", rowField: "Witel", sheet: reg.name, table: reg.table, valueField: null }, "Count of Witel");

  const rowsXml = [...grid.keys()]
    .sort((a, b) => a - b)
    .map((r) => {
      const cells = grid.get(r)!;
      return `<row r="${r}">${[...cells.keys()].sort((a, b) => a - b).map((c) => cells.get(c)!).join("")}</row>`;
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
    '<cols><col min="1" max="1" width="32" customWidth="1"/><col min="2" max="12" width="13" customWidth="1"/></cols>' +
    `<sheetData>${rowsXml}</sheetData></worksheet>`
  );
}

// ---------------------------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------------------------
const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

export type AllSegmenInput = Record<AllSegmenKind, { fileName: string; buffer: Buffer }>;
export type AllSegmenResult = {
  bytes: Buffer;
  fileName: string;
  rowCounts: Record<AllSegmenKind, number>;
  sheetNames: string[];
  periods: string[];
  divisions: string[];
};

function readTable(kind: AllSegmenKind, buffer: Buffer): SheetTable {
  const all = parseCsv(buffer.toString("utf8"));
  if (all.length === 0) throw new Error(`File ${allSegmenKindLabel(kind)} kosong.`);
  const headers = all[0].map((h) => h.trim());
  return { headers, rows: all.slice(1) };
}

function distinct(table: SheetTable, column: string): string[] {
  const i = table.headers.indexOf(column);
  if (i === -1) return [];
  return [...new Set(table.rows.map((r) => r[i]).filter((v) => v))];
}

/** Membuat workbook LTS ALL SEGMEN dari tiga CSV. Fungsi murni: tidak menyentuh database/jaringan. */
export async function buildAllSegmenWorkbook(input: AllSegmenInput): Promise<AllSegmenResult> {
  const tables = {} as Record<AllSegmenKind, { name: string; table: SheetTable }>;
  for (const kind of ALL_SEGMEN_KINDS) {
    tables[kind] = { name: allSegmenSheetName(kind, input[kind].fileName), table: readTable(kind, input[kind].buffer) };
    const missing = REQUIRED[kind].filter((c) => !tables[kind].table.headers.includes(c));
    if (missing.length) throw new Error(`File ${allSegmenKindLabel(kind)} tidak punya kolom: ${missing.join(", ")}.`);
  }
  const sheetNames = [tables.reg.name, tables.nal.name, tables.ps.name, "Sheet2"];
  if (new Set(sheetNames.map((n) => n.toLowerCase())).size !== sheetNames.length) throw new Error("Nama sheet bentrok.");

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      [1, 2, 3, 4].map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView activeTab="3"/></bookViews><sheets>' +
      sheetNames.map((n, i) => `<sheet name="${esc(n).replace(/"/g, "&quot;")}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      [1, 2, 3, 4].map((i) => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join("") +
      '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  zip.file("xl/styles.xml", STYLES_XML);
  zip.file("xl/worksheets/sheet1.xml", dataSheetXml(tables.reg.table));
  zip.file("xl/worksheets/sheet2.xml", dataSheetXml(tables.nal.table));
  zip.file("xl/worksheets/sheet3.xml", dataSheetXml(tables.ps.table));
  zip.file("xl/worksheets/sheet4.xml", summarySheetXml(tables));

  const bytes = await zip.generateAsync({ compression: "DEFLATE", compressionOptions: { level: 6 }, type: "nodebuffer" });
  return {
    bytes,
    divisions: [...new Set([...distinct(tables.ps.table, "DIVISI"), ...distinct(tables.nal.table, "DIVISI")])].sort(),
    fileName: ALL_SEGMEN_OUTPUT_NAME,
    periods: [...new Set([...distinct(tables.ps.table, "PERIOD"), ...distinct(tables.nal.table, "PERIODE"), ...distinct(tables.reg.table, "Nper")])].sort(),
    rowCounts: { nal: tables.nal.table.rows.length, ps: tables.ps.table.rows.length, reg: tables.reg.table.rows.length },
    sheetNames,
  };
}
