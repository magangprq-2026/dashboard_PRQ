// Menu bot "LTS ALL SEGMEN": tiga CSV (T_PS, T_NAL, T_REG) yang dikirim dengan caption "all segmen" diubah menjadi
// satu file LTS_ALL_SEGMEN.xlsx (meniru contoh LTS_ALL_SEGMEN.xlsx):
//  - 3 sheet data : T_REG_Full Data_data (N), T_NAL_Full Data_data (N), T_PS_Full Data_data (N)  (isi CSV apa adanya)
//  - Sheet2       : 4 PivotTable asli — SALES (PS), CHURN (NAL), CT0 DGS & DES (NAL), CT0 SME/RBS/DBS (REG)
// Hanya konversi file; tidak ada yang masuk ke dashboard LTS. Ketiga file dikumpulkan sementara di dashboard_state
// (satu baris per jenis file) sampai lengkap, lalu dihapus setelah file Excel terkirim.
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { gunzipSync, gzipSync } from "node:zlib";
import { dbQuery } from "@/features/shared/backend/database/db";
import { writeDashboardStateByKey } from "@/features/shared/backend/database/dashboard-state";

export type SegmenKind = "ps" | "nal" | "reg";
export const SEGMEN_KINDS: SegmenKind[] = ["ps", "nal", "reg"];
export const SEGMEN_WINDOW_MINUTES = 30;
export const SEGMEN_FILENAME = "LTS_ALL_SEGMEN.xlsx";
const PIVOT_SHEET = "Sheet2";

export function segmenKindLabel(kind: SegmenKind) {
  return kind === "ps" ? "T_PS (Sales)" : kind === "nal" ? "T_NAL (Churn / CT0)" : "T_REG (CT0 SME/RBS/DBS)";
}

/** Caption yang memicu LTS ALL SEGMEN: all, segmen, all segmen, lts all segmen (huruf besar/kecil bebas). */
export function isSegmenCaption(caption: string | undefined | null): boolean {
  const c = (caption ?? "").toLowerCase().replace(/[\s_\-]+/g, " ").trim();
  return c === "all" || c === "segmen" || c === "all segmen" || c === "lts all segmen";
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------
function decodeCsv(buffer: Buffer): string {
  const text = buffer.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
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
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

function headerOf(buffer: Buffer): string[] {
  const head = decodeCsv(buffer.subarray(0, 16384));
  return (head.split(/\r?\n/, 1)[0] ?? "").split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
}

/** Jenis file dari judul kolomnya. Null bila bukan T_PS / T_NAL / T_REG. */
export function classifySegmenFile(fileName: string, buffer: Buffer): SegmenKind | null {
  if (!/\.csv$/i.test(fileName)) return null;
  const h = new Set(headerOf(buffer));
  if (h.has("Bayar Desc") && h.has("Nper") && h.has("Witel")) return "reg";
  if (h.has("Jml_Sales") && h.has("PERIOD") && h.has("WITEL") && h.has("DIVISI")) return "ps";
  if (h.has("SSL_DO") && h.has("SSL_CT0") && h.has("L_WITEL") && h.has("DIVISI")) return "nal";
  return null;
}

// Kolom yang disimpan sebagai angka (sama dengan contoh LTS_ALL_SEGMEN.xlsx). Kolom lain tetap teks.
const NUMERIC: Record<SegmenKind, string[]> = {
  reg: ["Nper", "TAHUN", "SND", "JML LYN", "Total Lalu", "Abonemen", "Abonemen Lalu", "Bayar", "BULAN PS", "Centite", "Datms", "Datrs", "Debit", "Debit Lalu", "Kredit", "Kredit Lalu", "NCLI", "Number of Records", "Pemakaian", "Pemakaian Lalu", "PPN", "Ppn Lalu", "Snd Group", "Status", "TAHUN PS", "Total", "Total Lalu (M)", "Total Net", "Total Net Lalu", "Type Pohon", "Umur Plg"],
  nal: ["PERIODE", "TAHUN", "SPEEDY", "TREG", "COUNT_SID", "SSL_AO", "SSL_CT0", "SSL_DO", "SSL_NAL", "BILLING", "COLLECTION", "DAYS_OF_STAY", "NCLI", "PIUTANG", "SND (Custom SQL Query)", "SSL_LOS", "TGL_PS", "TGL_PSB"],
  ps: ["Day of LAST_UPDATED_DATE", "IS_IPTV", "TAHUN", "IS_HSI_BASIC", "IS_HSI_BISNIS", "IS_HSI_ONLY", "IS_MESH_WIFI", "IS_NETMONK", "IS_OCA_BLAST", "IS_OCA_INT", "IS_PHONE", "IS_PMAHIR", "IS_PSEKOLAH", "IS_TOMPS", "ND", "ND_HSI", "ND_VOICE", "ORDER_ID", "TANGGAL", "COUNT_SID", "IS_EAZY", "IS_OCA_BREACH", "Jml_Sales", "ARPU_N1", "ARPU_N2", "ARPU_PAKET", "AVG", "AVG_REV", "BULAN_PS", "CTELDA", "HARGA", "Jml EAZY", "Jml NETMONK", "Jml OCA", "Jml Order", "Jml PMAHIR", "Jml PSEKOLAH", "PACKAGE_PRICE", "PACKAGE_USAGE", "PERIOD", "PERIOD_U", "REV_PACKAGE", "REV_SCALING (N)", "REV_SCALING (N+1)", "TARIF_NOT_NULL", "TARIF_TOT", "TGL_PS (Custom SQL Query)"],
};
const DATE_COLUMNS: Record<SegmenKind, string[]> = { reg: [], nal: [], ps: ["PS_DATE"] };
const SHEET_PREFIX: Record<SegmenKind, string> = { reg: "T_REG_Full Data_data", nal: "T_NAL_Full Data_data", ps: "T_PS_Full Data_data" };

type Cell = string | number | null;
type Source = { header: string[]; kind: SegmenKind; rows: Cell[][]; sheetName: string };

function excelDateSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 + 25569;
}

function sheetNameFor(kind: SegmenKind, fileName: string) {
  const n = /_(\d+)\.csv$/i.exec(fileName)?.[1];
  const name = n ? `${SHEET_PREFIX[kind]} (${n})` : SHEET_PREFIX[kind];
  return name.slice(0, 31);
}

function readSource(kind: SegmenKind, fileName: string, buffer: Buffer): Source {
  const all = parseCsv(decodeCsv(buffer));
  const header = (all[0] ?? []).map((c) => c.trim());
  if (all.length < 2) throw new Error(`${segmenKindLabel(kind)}: file tidak memiliki baris data.`);
  const numeric = new Set(NUMERIC[kind]);
  const dates = new Set(DATE_COLUMNS[kind]);
  const kinds = header.map((h) => (dates.has(h) ? "date" : numeric.has(h) ? "num" : "text"));
  const rows: Cell[][] = all.slice(1).map((r) =>
    header.map((_, i) => {
      const v = (r[i] ?? "").replace(/\r\n?/g, "\n");
      if (v === "") return null;
      if (kinds[i] === "num") {
        const n = Number(v);
        return Number.isFinite(n) ? n : v;
      }
      if (kinds[i] === "date") return excelDateSerial(v) ?? v;
      return v;
    }),
  );
  return { header, kind, rows, sheetName: sheetNameFor(kind, fileName) };
}

// ---------------------------------------------------------------------------------------------
// Definisi pivot (sama dengan contoh)
// ---------------------------------------------------------------------------------------------
type PivotDef = {
  colFields: string[];
  label: string;
  name: string;
  page: { field: string; hide?: string[]; select?: string }[];
  rowField: string;
  source: SegmenKind;
  value: { caption: string; field: string; fn: "count" | "sum" };
};

const PIVOTS: PivotDef[] = [
  { colFields: ["DIVISI", "PERIOD"], label: "SALES", name: "PivotTable1", page: [{ field: "PRODUK" }], rowField: "WITEL", source: "ps", value: { caption: "Sum of Jml_Sales", field: "Jml_Sales", fn: "sum" } },
  { colFields: ["DIVISI", "PERIODE"], label: "CHURN", name: "PivotTable2", page: [{ field: "L_PRODUK" }], rowField: "WITEL (NEW_TERRITORY)", source: "nal", value: { caption: "Sum of SSL_DO", field: "SSL_DO", fn: "sum" } },
  { colFields: ["DIVISI", "PERIODE"], label: "CT0 DGS & DES", name: "PivotTable3", page: [{ field: "L_PRODUK", hide: ["WMS"] }], rowField: "WITEL (NEW_TERRITORY)", source: "nal", value: { caption: "Sum of SSL_CT0", field: "SSL_CT0", fn: "sum" } },
  { colFields: ["Nper"], label: "CT0 SME/RBS/DBS", name: "PivotTable4", page: [{ field: "Bayar Desc", select: "Belum Bayar" }, { field: "Produk" }], rowField: "Witel", source: "reg", value: { caption: "Count of Witel", field: "Witel", fn: "count" } },
];

const CACHE_ORDER: SegmenKind[] = ["ps", "nal", "reg"]; // cacheId 1..3

function colLetter(index: number) {
  return XLSX.utils.encode_col(index);
}

const cmp = (a: Cell, b: Cell) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)));

function distinctSorted(src: Source, field: string): Cell[] {
  const idx = src.header.indexOf(field);
  if (idx < 0) throw new Error(`Kolom ${field} tidak ada di ${segmenKindLabel(src.kind)}.`);
  const set = new Map<string, Cell>();
  for (const r of src.rows) {
    const v = r[idx];
    if (v !== null) set.set(typeof v + String(v), v);
  }
  return [...set.values()].sort(cmp);
}

// ---------------------------------------------------------------------------------------------
// Sheet pivot (nilai awal) + tata letak
// ---------------------------------------------------------------------------------------------
type Layout = { last: number; lastCol: number; pages: number[]; label: number; table: number };

function layoutFor(defs: PivotDef[], rowCounts: number[]) {
  const out: Layout[] = [];
  let prevLast = 0;
  defs.forEach((d, i) => {
    const nCol = d.colFields.length;
    const nPage = d.page.length;
    let pages: number[];
    let label: number;
    let table: number;
    if (nPage === 1) {
      const pageRow = i === 0 ? 1 : prevLast + 3;
      pages = [pageRow];
      label = pageRow + 1;
      table = pageRow + 2;
    } else {
      label = prevLast + 2;
      pages = Array.from({ length: nPage }, (_, k) => label + 1 + k);
      table = pages[pages.length - 1] + 2;
    }
    const last = table + (nCol === 2 ? 3 : 2) + rowCounts[i];
    out.push({ label, last, lastCol: 0, pages, table });
    prevLast = last;
  });
  return out;
}

function matchesPage(d: PivotDef, src: Source, row: Cell[]) {
  for (const p of d.page) {
    const v = row[src.header.indexOf(p.field)];
    if (p.select !== undefined && String(v) !== p.select) return false;
    if (p.hide && p.hide.some((h) => String(v).toUpperCase() === h.toUpperCase())) return false;
  }
  return true;
}

function fillPivotSheet(ws: XLSX.WorkSheet, sources: Record<SegmenKind, Source>) {
  const put = (addr: string, v: string | number) => {
    ws[addr] = { t: typeof v === "number" ? "n" : "s", v };
  };
  const rowItems = PIVOTS.map((d) => distinctSorted(sources[d.source], d.rowField));
  const layouts = layoutFor(PIVOTS, rowItems.map((r) => r.length));
  let maxCol = 0;
  let maxRow = 0;
  PIVOTS.forEach((d, pi) => {
    const src = sources[d.source];
    const L = layouts[pi];
    const rows = rowItems[pi];
    const fIdx = (f: string) => src.header.indexOf(f);

    // filter halaman + judul
    d.page.forEach((p, k) => {
      put(`A${L.pages[k]}`, p.field);
      const hidden = p.hide && distinctSorted(src, p.field).some((v) => p.hide!.some((h) => String(v).toUpperCase() === h.toUpperCase()));
      put(`B${L.pages[k]}`, p.select ?? (hidden ? "(Multiple Items)" : "(All)"));
    });
    put(`A${L.label}`, d.label);

    // kolom
    const colItems = d.colFields.map((f) => distinctSorted(src, f));
    const colKeys: Cell[][] = colItems.length === 2 ? colItems[0].flatMap((a) => colItems[1].map((b) => [a, b])) : colItems[0].map((a) => [a]);
    const nCol = d.colFields.length;
    put(`A${L.table}`, d.value.caption);
    put(`B${L.table}`, "Column Labels");
    const innerRow = L.table + (nCol === 2 ? 2 : 1);
    if (nCol === 2) {
      colKeys.forEach((k, i) => {
        if (i === 0 || colKeys[i - 1][0] !== k[0]) put(`${colLetter(1 + i)}${L.table + 1}`, k[0] as string | number);
      });
      put(`${colLetter(1 + colKeys.length)}${L.table + 1}`, "Grand Total");
    } else {
      put(`${colLetter(1 + colKeys.length)}${innerRow}`, "Grand Total");
    }
    put(`A${innerRow}`, "Row Labels");
    colKeys.forEach((k, i) => put(`${colLetter(1 + i)}${innerRow}`, k[nCol - 1] as string | number));

    // nilai (sel tanpa baris data dibiarkan kosong, seperti PivotTable Excel)
    const agg = new Map<string, { n: number; sum: number }>();
    const rowIdx = fIdx(d.rowField);
    const colIdx = d.colFields.map(fIdx);
    const valIdx = fIdx(d.value.field);
    for (const r of src.rows) {
      if (!matchesPage(d, src, r)) continue;
      const rv = r[rowIdx];
      if (rv === null) continue;
      const add = d.value.fn === "count" ? (r[valIdx] === null ? 0 : 1) : typeof r[valIdx] === "number" ? (r[valIdx] as number) : 0;
      const key = `${String(rv)}#${colIdx.map((i) => String(r[i])).join("|")}`;
      const cur = agg.get(key) ?? { n: 0, sum: 0 };
      cur.n += 1;
      cur.sum += add;
      agg.set(key, cur);
    }
    const colKeyStr = colKeys.map((k) => k.map(String).join("|"));
    const dataStart = innerRow + 1;
    const all = [...rows.map((r, i) => ({ label: String(r), row: dataStart + i, name: String(r) as string | null })), { label: "Grand Total", row: dataStart + rows.length, name: null as string | null }];
    for (const line of all) {
      put(`A${line.row}`, line.label);
      let rowTotal = 0;
      let rowN = 0;
      colKeyStr.forEach((ck, i) => {
        let v = 0;
        let n = 0;
        for (const r of line.name === null ? rows : [line.name]) {
          const hit = agg.get(`${String(r)}#${ck}`);
          if (hit) {
            v += hit.sum;
            n += hit.n;
          }
        }
        if (n > 0) put(`${colLetter(1 + i)}${line.row}`, v);
        rowTotal += v;
        rowN += n;
      });
      if (rowN > 0) put(`${colLetter(1 + colKeyStr.length)}${line.row}`, rowTotal);
    }
    L.lastCol = 1 + colKeyStr.length;
    maxCol = Math.max(maxCol, L.lastCol);
    maxRow = Math.max(maxRow, L.last);
  });
  ws["!ref"] = `A1:${colLetter(maxCol)}${maxRow}`;
  ws["!cols"] = [{ wch: 28 }, ...Array.from({ length: maxCol }, () => ({ wch: 13 }))];
  return layouts;
}

// ---------------------------------------------------------------------------------------------
// OOXML PivotTable
// ---------------------------------------------------------------------------------------------
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const xmlEscape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function sharedItemsXml(values: Cell[]) {
  if (values.length > 0 && values.every((v) => typeof v === "number")) {
    const nums = values as number[];
    const integer = nums.every(Number.isInteger);
    return `<sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1"${integer ? ' containsInteger="1"' : ""} minValue="${Math.min(...nums)}" maxValue="${Math.max(...nums)}" count="${nums.length}">${nums.map((n) => `<n v="${n}"/>`).join("")}</sharedItems>`;
  }
  return `<sharedItems count="${values.length}">${values.map((v) => `<s v="${xmlEscape(String(v))}"/>`).join("")}</sharedItems>`;
}

function itemsXml(count: number, withDefault: boolean, hidden: Set<number> = new Set()) {
  const items = Array.from({ length: count }, (_, i) => `<item${hidden.has(i) ? ' h="1"' : ""} x="${i}"/>`).join("");
  return `<items count="${count + (withDefault ? 1 : 0)}">${items}${withDefault ? '<item t="default"/>' : ""}</items>`;
}

function buildCacheXml(src: Source, defs: PivotDef[]) {
  // Kolom yang butuh daftar item: kolom sumbu/halaman semua pivot dari sumber ini. Kolom nilai angka diberi min/max.
  const itemFields = new Set<string>();
  const valueFields = new Set<string>();
  for (const d of defs) {
    itemFields.add(d.rowField);
    d.colFields.forEach((f) => itemFields.add(f));
    d.page.forEach((p) => itemFields.add(p.field));
    if (d.value.fn === "sum") valueFields.add(d.value.field);
  }
  const fields = src.header.map((name, i) => {
    let shared = "<sharedItems/>";
    if (itemFields.has(name)) shared = sharedItemsXml(distinctSorted(src, name));
    else if (valueFields.has(name)) {
      let min = Infinity;
      let max = -Infinity;
      let integer = true;
      for (const r of src.rows) {
        const v = r[i];
        if (typeof v === "number") {
          min = Math.min(min, v);
          max = Math.max(max, v);
          if (!Number.isInteger(v)) integer = false;
        }
      }
      if (Number.isFinite(min)) shared = `<sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1"${integer ? ' containsInteger="1"' : ""} minValue="${min}" maxValue="${max}"/>`;
    }
    return `<cacheField name="${xmlEscape(name)}" numFmtId="0">${shared}</cacheField>`;
  });
  const serial = Date.now() / 86400000 + 25569;
  const ref = `A1:${colLetter(src.header.length - 1)}${src.rows.length + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="${NS_MAIN}" xmlns:r="${NS_REL}" r:id="rId1" refreshOnLoad="1" refreshedBy="PRIME Bot" refreshedDate="${serial}" createdVersion="8" refreshedVersion="8" minRefreshableVersion="3" recordCount="${src.rows.length}"><cacheSource type="worksheet"><worksheetSource ref="${ref}" sheet="${xmlEscape(src.sheetName)}"/></cacheSource><cacheFields count="${src.header.length}">${fields.join("")}</cacheFields></pivotCacheDefinition>`;
}

function buildPivotXml(d: PivotDef, src: Source, cacheId: number, L: Layout) {
  const idx = (f: string) => src.header.indexOf(f);
  const rowItems = distinctSorted(src, d.rowField);
  const colItems = d.colFields.map((f) => distinctSorted(src, f));
  const single = d.colFields.length === 1;
  const axisByIdx = new Map<number, string>();
  const fields = src.header.map((name, i) => {
    const asRow = name === d.rowField;
    const asCol = d.colFields.indexOf(name);
    const asPage = d.page.find((p) => p.field === name);
    const isData = name === d.value.field;
    axisByIdx.set(i, name);
    if (asRow) return `<pivotField axis="axisRow"${isData ? ' dataField="1"' : ""} showAll="0">${itemsXml(rowItems.length, true)}</pivotField>`;
    if (asCol >= 0) return `<pivotField axis="axisCol" showAll="0"${single ? "" : ' defaultSubtotal="0"'}>${itemsXml(colItems[asCol].length, single)}</pivotField>`;
    if (asPage) {
      const all = distinctSorted(src, name);
      const hidden = new Set<number>();
      all.forEach((v, k) => {
        if (asPage.hide?.some((h) => String(v).toUpperCase() === h.toUpperCase())) hidden.add(k);
      });
      return `<pivotField axis="axisPage"${asPage.hide ? ' multipleItemSelectionAllowed="1"' : ""} showAll="0">${itemsXml(all.length, true, hidden)}</pivotField>`;
    }
    if (isData) return `<pivotField dataField="1" showAll="0"/>`;
    return `<pivotField showAll="0"/>`;
  });

  const rowItemsXml = [...rowItems.map((_, i) => (i === 0 ? "<i><x/></i>" : `<i><x v="${i}"/></i>`)), '<i t="grand"><x/></i>'];
  const colItemsXml: string[] = [];
  if (single) {
    colItems[0].forEach((_, i) => colItemsXml.push(i === 0 ? "<i><x/></i>" : `<i><x v="${i}"/></i>`));
  } else {
    colItems[0].forEach((_, a) => {
      colItems[1].forEach((__, b) => {
        if (b === 0) colItemsXml.push(`<i>${a === 0 ? "<x/>" : `<x v="${a}"/>`}${"<x/>"}</i>`);
        else colItemsXml.push(`<i r="1"><x v="${b}"/></i>`);
      });
    });
  }
  colItemsXml.push('<i t="grand"><x/></i>');

  const pageFields = d.page
    .map((p) => {
      const all = distinctSorted(src, p.field);
      const pos = p.select !== undefined ? all.findIndex((v) => String(v) === p.select) : -1;
      return `<pageField fld="${idx(p.field)}"${pos >= 0 ? ` item="${pos}"` : ""} hier="-1"/>`;
    })
    .join("");

  const lastCol = colLetter(L.lastCol);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition xmlns="${NS_MAIN}" name="${d.name}" cacheId="${cacheId}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Values" updatedVersion="8" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="8" indent="0" outline="1" outlineData="1" multipleFieldFilters="0"><location ref="A${L.table}:${lastCol}${L.last}" firstHeaderRow="1" firstDataRow="${single ? 2 : 3}" firstDataCol="1" rowPageCount="${d.page.length}" colPageCount="1"/><pivotFields count="${src.header.length}">${fields.join("")}</pivotFields><rowFields count="1"><field x="${idx(d.rowField)}"/></rowFields><rowItems count="${rowItemsXml.length}">${rowItemsXml.join("")}</rowItems><colFields count="${d.colFields.length}">${d.colFields.map((f) => `<field x="${idx(f)}"/>`).join("")}</colFields><colItems count="${colItemsXml.length}">${colItemsXml.join("")}</colItems><pageFields count="${d.page.length}">${pageFields}</pageFields><dataFields count="1"><dataField name="${xmlEscape(d.value.caption)}" fld="${idx(d.value.field)}"${d.value.fn === "count" ? ' subtotal="count"' : ""} baseField="0" baseItem="0"/></dataFields><pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`;
}

async function addPivotTables(xlsx: Uint8Array, sources: Record<SegmenKind, Source>, layouts: Layout[], pivotSheetFile: string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(xlsx);
  const text = async (path: string) => {
    const f = zip.file(path);
    if (!f) throw new Error(`Bagian ${path} tidak ditemukan di file xlsx.`);
    return f.async("string");
  };
  const relsHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

  let wbRelsAdd = "";
  let pivotCachesXml = "";
  let types = "";
  CACHE_ORDER.forEach((kind, i) => {
    const n = i + 1;
    const defs = PIVOTS.filter((p) => p.source === kind);
    zip.file(`xl/pivotCache/pivotCacheDefinition${n}.xml`, buildCacheXml(sources[kind], defs));
    zip.file(`xl/pivotCache/pivotCacheRecords${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheRecords xmlns="${NS_MAIN}" xmlns:r="${NS_REL}" count="0"/>`);
    zip.file(`xl/pivotCache/_rels/pivotCacheDefinition${n}.xml.rels`, `${relsHead}<Relationship Id="rId1" Type="${REL_BASE}/pivotCacheRecords" Target="pivotCacheRecords${n}.xml"/></Relationships>`);
    wbRelsAdd += `<Relationship Id="rIdPivotCache${n}" Type="${REL_BASE}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition${n}.xml"/>`;
    pivotCachesXml += `<pivotCache cacheId="${n}" r:id="rIdPivotCache${n}"/>`;
    types += `<Override PartName="/xl/pivotCache/pivotCacheDefinition${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/><Override PartName="/xl/pivotCache/pivotCacheRecords${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/>`;
  });

  let sheetRels = "";
  PIVOTS.forEach((d, i) => {
    const n = i + 1;
    const cacheN = CACHE_ORDER.indexOf(d.source) + 1;
    zip.file(`xl/pivotTables/pivotTable${n}.xml`, buildPivotXml(d, sources[d.source], cacheN, layouts[i]));
    zip.file(`xl/pivotTables/_rels/pivotTable${n}.xml.rels`, `${relsHead}<Relationship Id="rId1" Type="${REL_BASE}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition${cacheN}.xml"/></Relationships>`);
    sheetRels += `<Relationship Id="rIdPivot${n}" Type="${REL_BASE}/pivotTable" Target="../pivotTables/pivotTable${n}.xml"/>`;
    types += `<Override PartName="/xl/pivotTables/pivotTable${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/>`;
  });

  const sheetRelsPath = `xl/worksheets/_rels/${pivotSheetFile}.rels`;
  const existing = zip.file(sheetRelsPath);
  zip.file(sheetRelsPath, existing ? (await existing.async("string")).replace("</Relationships>", `${sheetRels}</Relationships>`) : `${relsHead}${sheetRels}</Relationships>`);

  zip.file("xl/_rels/workbook.xml.rels", (await text("xl/_rels/workbook.xml.rels")).replace("</Relationships>", `${wbRelsAdd}</Relationships>`));
  const workbook = await text("xl/workbook.xml");
  if (!workbook.includes("</workbook>")) throw new Error("workbook.xml tidak valid.");
  zip.file("xl/workbook.xml", workbook.replace("</workbook>", `<pivotCaches>${pivotCachesXml}</pivotCaches></workbook>`));
  zip.file("[Content_Types].xml", (await text("[Content_Types].xml")).replace("</Types>", `${types}</Types>`));
  return zip.generateAsync({ compression: "DEFLATE", type: "uint8array" });
}

// ---------------------------------------------------------------------------------------------
// Bangun file
// ---------------------------------------------------------------------------------------------
export type SegmenFileInput = { buffer: Buffer; fileName: string };
export type SegmenResult = { bytes: Uint8Array; filename: string; periods: string[]; rowCounts: Record<SegmenKind, number> };

export async function buildSegmenWorkbook(files: Record<SegmenKind, SegmenFileInput>): Promise<SegmenResult> {
  const sources = {} as Record<SegmenKind, Source>;
  for (const kind of SEGMEN_KINDS) sources[kind] = readSource(kind, files[kind].fileName, files[kind].buffer);
  // Nama sheet harus unik walau nomor file sama.
  const used = new Set<string>();
  for (const kind of SEGMEN_KINDS) {
    let name = sources[kind].sheetName;
    for (let i = 2; used.has(name.toLowerCase()); i += 1) name = `${sources[kind].sheetName.slice(0, 28)} ${i}`;
    used.add(name.toLowerCase());
    sources[kind].sheetName = name;
  }

  const wb = XLSX.utils.book_new();
  // Urutan sheet sama dengan contoh: REG, NAL, PS, lalu sheet pivot.
  for (const kind of ["reg", "nal", "ps"] as SegmenKind[]) {
    const s = sources[kind];
    const ws = XLSX.utils.aoa_to_sheet([s.header, ...s.rows]);
    const dateCols = new Set(DATE_COLUMNS[kind]);
    s.header.forEach((h, c) => {
      if (!dateCols.has(h)) return;
      for (let r = 1; r <= s.rows.length; r += 1) {
        const cell = ws[XLSX.utils.encode_cell({ c, r })];
        if (cell && cell.t === "n") cell.z = "mm-dd-yy";
      }
    });
    ws["!cols"] = s.header.map((h) => ({ wch: Math.min(Math.max(h.length + 2, 11), 28) }));
    ws["!autofilter"] = { ref: `A1:${colLetter(s.header.length - 1)}${s.rows.length + 1}` };
    XLSX.utils.book_append_sheet(wb, ws, s.sheetName);
  }
  const pivotWs: XLSX.WorkSheet = {};
  const layouts = fillPivotSheet(pivotWs, sources);
  XLSX.utils.book_append_sheet(wb, pivotWs, PIVOT_SHEET);

  const plain = XLSX.write(wb, { bookType: "xlsx", compression: true, type: "array" }) as ArrayBuffer;
  const bytes = await addPivotTables(new Uint8Array(plain), sources, layouts, "sheet4.xml");

  const periods = new Set<string>();
  const nalPeriod = sources.nal.header.indexOf("PERIODE");
  for (const r of sources.nal.rows) if (r[nalPeriod] !== null) periods.add(String(r[nalPeriod]));
  return {
    bytes,
    filename: SEGMEN_FILENAME,
    periods: [...periods].sort(),
    rowCounts: { nal: sources.nal.rows.length, ps: sources.ps.rows.length, reg: sources.reg.rows.length },
  };
}

// ---------------------------------------------------------------------------------------------
// Penampung 3 file (dashboard_state, satu baris per jenis file per chat)
// ---------------------------------------------------------------------------------------------
const fileKey = (chatId: number, kind: SegmenKind) => `telegram:segmen:${chatId}:${kind}`;
const stateTable = () => {
  const t = process.env.DASHBOARD_STATE_TABLE || "dashboard_state";
  if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw new Error("Nama tabel database tidak valid.");
  return t;
};

export type SegmenProgress = { fileNames: Partial<Record<SegmenKind, string>>; missing: SegmenKind[]; present: Record<SegmenKind, boolean> };

/** Simpan satu file (menimpa file sejenis sebelumnya) dan kembalikan kelengkapan rangkaian. */
export async function saveSegmenFile(chatId: number, kind: SegmenKind, fileName: string, buffer: Buffer): Promise<SegmenProgress> {
  const saved = await writeDashboardStateByKey(fileKey(chatId, kind), {
    csvGzipBase64: gzipSync(buffer, { level: 6 }).toString("base64"),
    fileName,
    receivedAt: Date.now(),
    used: false,
  });
  if ("error" in saved.body) throw new Error("Gagal menyimpan file sementara ke database.");
  return segmenProgress(chatId);
}

export async function segmenProgress(chatId: number): Promise<SegmenProgress> {
  const keys = SEGMEN_KINDS.map((k) => fileKey(chatId, k));
  const result = await dbQuery<{ key: string; file_name: string | null; received_at: string | null; used: string | null }[]>(
    `select key, payload->>'fileName' as file_name, payload->>'receivedAt' as received_at, payload->>'used' as used from public."${stateTable()}" where key = any($1::text[])`,
    [keys],
  );
  if (result.error) throw new Error("Gagal membaca file sementara dari database.");
  const present = { nal: false, ps: false, reg: false } as Record<SegmenKind, boolean>;
  const fileNames: Partial<Record<SegmenKind, string>> = {};
  const cutoff = Date.now() - SEGMEN_WINDOW_MINUTES * 60_000;
  for (const row of result.data ?? []) {
    const kind = SEGMEN_KINDS.find((k) => fileKey(chatId, k) === row.key);
    if (!kind) continue;
    if (row.used === "true" || !(Number(row.received_at) >= cutoff)) continue;
    present[kind] = true;
    fileNames[kind] = row.file_name ?? undefined;
  }
  return { fileNames, missing: SEGMEN_KINDS.filter((k) => !present[k]), present };
}

/** Klaim atomik: hanya satu proses yang mendapat true bila ketiga file ada dan belum dipakai. */
export async function claimSegmenBatch(chatId: number): Promise<boolean> {
  const keys = SEGMEN_KINDS.map((k) => fileKey(chatId, k));
  const cutoff = Date.now() - SEGMEN_WINDOW_MINUTES * 60_000;
  const result = await dbQuery<{ key: string }[]>(
    `update public."${stateTable()}" set payload = jsonb_set(payload, '{used}', 'true'::jsonb) where key = any($1::text[]) and coalesce(payload->>'used','') <> 'true' and (payload->>'receivedAt')::bigint >= $2::bigint returning key`,
    [keys, cutoff],
  );
  return !result.error && (result.data?.length ?? 0) === SEGMEN_KINDS.length;
}

export async function releaseSegmenBatch(chatId: number): Promise<void> {
  const keys = SEGMEN_KINDS.map((k) => fileKey(chatId, k));
  await dbQuery(`update public."${stateTable()}" set payload = jsonb_set(payload, '{used}', 'false'::jsonb) where key = any($1::text[])`, [keys]);
}

export async function loadSegmenFiles(chatId: number): Promise<Record<SegmenKind, SegmenFileInput>> {
  const keys = SEGMEN_KINDS.map((k) => fileKey(chatId, k));
  const result = await dbQuery<{ key: string; payload: { csvGzipBase64?: string; fileName?: string } }[]>(`select key, payload from public."${stateTable()}" where key = any($1::text[])`, [keys]);
  if (result.error) throw new Error("Gagal membaca file sementara dari database.");
  const out = {} as Record<SegmenKind, SegmenFileInput>;
  for (const row of result.data ?? []) {
    const kind = SEGMEN_KINDS.find((k) => fileKey(chatId, k) === row.key);
    if (!kind || typeof row.payload?.csvGzipBase64 !== "string") continue;
    out[kind] = { buffer: gunzipSync(Buffer.from(row.payload.csvGzipBase64, "base64")), fileName: row.payload.fileName ?? `${kind}.csv` };
  }
  for (const k of SEGMEN_KINDS) if (!out[k]) throw new Error(`File ${segmenKindLabel(k)} tidak ditemukan.`);
  return out;
}

export async function clearSegmenFiles(chatId: number): Promise<void> {
  const keys = SEGMEN_KINDS.map((k) => fileKey(chatId, k));
  await dbQuery(`delete from public."${stateTable()}" where key = any($1::text[])`, [keys]);
}
