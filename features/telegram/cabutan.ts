// Menu bot "Data Cabutan": mengubah CSV "T_NAL Full Data" menjadi file DO_<Bulan>.xlsx.
// Hanya konversi file (tanpa menyimpan apa pun ke database/portal).
//
// Isi file hasil (meniru contoh DO_Oktober.xlsx):
//  - Sheet1                    : PivotTable asli Excel - Sum of SSL_DO, baris L_WITEL, kolom PERIODE > DIVISI,
//                                filter halaman L_PRODUK (All). Bisa di-Refresh / diubah seperti pivot biasa.
//  - T_NAL_Full Data_data (2)  : seluruh isi CSV (61 kolom), angka disimpan sebagai angka.
import JSZip from "jszip";
import * as XLSX from "xlsx";

export const CABUTAN_DATA_SHEET = "T_NAL_Full Data_data (2)";
export const CABUTAN_SUMMARY_SHEET = "Sheet1";

const MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Kolom yang disimpan sebagai angka (sama dengan file contoh). Kolom lain, mis. ND, tetap teks.
const NUMERIC_COLUMNS = new Set([
  "PERIODE",
  "TAHUN",
  "SPEEDY",
  "TREG",
  "COUNT_SID",
  "SSL_AO",
  "SSL_CT0",
  "SSL_DO",
  "SSL_NAL",
  "BILLING",
  "COLLECTION",
  "DAYS_OF_STAY",
  "NCLI",
  "PIUTANG",
  "SND (Custom SQL Query)",
  "SSL_LOS",
  "TGL_PS",
  "TGL_PSB",
]);

const REQUIRED_COLUMNS = ["PERIODE", "L_WITEL", "DIVISI", "SSL_DO", "SSL_NAL", "KATEGORI_DO", "JENISPSB"];
const COLUMN_WIDTHS: Record<string, number> = { CUSTOMER_NAME: 40, INS_ADDRESS: 40, KCONTACT: 40, PACKAGE_NAME: 40 };

type CabutanSheetRows = { header: string[]; rows: string[][] };

function decodeCsv(buffer: Buffer): string {
  const text = buffer.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Parser CSV (RFC 4180): koma sebagai pemisah, kutip ganda, sel boleh berisi baris baru.
function parseCsv(text: string, delimiter = ","): string[][] {
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
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

// Ekspor BRIGHT kadang memakai "#" sebagai pemisah. "#" hanya dianggap pemisah bila di baris judul jumlahnya lebih banyak
// daripada koma (nama kolom bisa memuat "#", mis. "... Query) #1").
function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  const hashes = (line.match(/#/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  return hashes > commas ? "#" : ",";
}

// Judul kolom dibaca dengan parser CSV sungguhan (kutip ganda, BOM, pemisah "#"), bukan split(",") biasa.
function headerColumns(buffer: Buffer): string[] {
  const head = decodeCsv(buffer.subarray(0, 65536));
  return (parseCsv(head, detectDelimiter(head))[0] ?? []).map((c) => c.trim());
}

/**
 * CSV T_NAL valid untuk Data Cabutan: berekstensi .csv dan memuat semua kolom wajib.
 * Data Cabutan TIDAK dikenali otomatis: pengguna harus menulis "cabutan" di caption (lihat isCabutanCaption).
 * Tanpa caption tersebut, file dianggap data LTS.
 */
export function isCabutanFile(fileName: string, buffer: Buffer): boolean {
  if (!/\.csv$/i.test(fileName)) return false;
  const columns = new Set(headerColumns(buffer));
  return REQUIRED_COLUMNS.every((c) => columns.has(c));
}

/**
 * Penanda Data Cabutan di caption (huruf besar/kecil bebas): caption memuat kata "cabutan" (mis. "Cabutan", "Data Cabutan"),
 * atau caption hanya berisi huruf "y" sebagai singkatan. "y" harus berdiri sendiri, supaya huruf y di dalam kata lain
 * (mis. caption "lts nal" atau "sales") tidak terhitung.
 */
export function isCabutanCaption(caption: string | undefined): boolean {
  const text = (caption ?? "").trim();
  return /cabutan/i.test(text) || /^y$/i.test(text);
}

function readCabutanCsv(buffer: Buffer): CabutanSheetRows {
  const text = decodeCsv(buffer);
  const all = parseCsv(text, detectDelimiter(text));
  const header = (all[0] ?? []).map((c) => c.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) throw new Error(`Kolom wajib tidak ditemukan: ${missing.join(", ")}.`);
  const rows = all.slice(1).map((r) => {
    const out = header.map((_, i) => (r[i] ?? "").replace(/\r\n?/g, "\n"));
    return out;
  });
  if (rows.length === 0) throw new Error("File CSV tidak memiliki baris data.");
  return { header, rows };
}

function colLetter(index: number) {
  return XLSX.utils.encode_col(index);
}

function monthNameFromPeriod(period: number | null) {
  if (period) {
    const month = period % 100;
    if (month >= 1 && month <= 12) return MONTH_NAMES[month - 1];
  }
  const nowMonth = Number(new Intl.DateTimeFormat("en-US", { month: "numeric", timeZone: "Asia/Jakarta" }).format(new Date()));
  return MONTH_NAMES[nowMonth - 1] ?? "Bulan";
}

export type CabutanResult = {
  bytes: Uint8Array;
  cabutan: number;
  filename: string;
  monthName: string;
  periods: number[];
  rowCount: number;
  witelCount: number;
};

export async function buildCabutanWorkbook(buffer: Buffer): Promise<CabutanResult> {
  const { header, rows } = readCabutanCsv(buffer);
  const idx = (name: string) => header.indexOf(name);
  const iPeriode = idx("PERIODE");
  const iWitel = idx("L_WITEL");
  const iDivisi = idx("DIVISI");
  const iDo = idx("SSL_DO");

  // ---- Sheet data ----
  const body: (string | number | null)[][] = rows.map((r) =>
    r.map((value, c) => {
      if (value === "") return null;
      if (NUMERIC_COLUMNS.has(header[c])) {
        const n = Number(value);
        return Number.isFinite(n) ? n : value;
      }
      return value;
    }),
  );
  const dataSheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  dataSheet["!cols"] = header.map((h) => ({ wch: COLUMN_WIDTHS[h] ?? Math.min(Math.max(h.length + 2, 11), 26) }));
  dataSheet["!autofilter"] = { ref: `A1:${colLetter(header.length - 1)}${rows.length + 1}` };

  // ---- Sheet ringkasan (pivot) ----
  const sum = new Map<string, number>(); // "periode|witel|divisi" -> SSL_DO
  const periods = new Set<number>();
  const witels = new Set<string>();
  const divisis = new Set<string>();
  for (const r of body) {
    const period = Number(r[iPeriode]);
    const witel = String(r[iWitel] ?? "");
    const divisi = String(r[iDivisi] ?? "");
    const value = Number(r[iDo]) || 0;
    periods.add(period);
    witels.add(witel);
    divisis.add(divisi);
    const key = `${period}|${witel}|${divisi}`;
    sum.set(key, (sum.get(key) ?? 0) + value);
  }
  const periodList = [...periods].sort((a, b) => a - b);
  const witelList = [...witels].sort((a, b) => a.localeCompare(b));
  const divisiList = [...divisis].sort((a, b) => a.localeCompare(b));

  const lastRow = rows.length + 1;
  const summary: XLSX.WorkSheet = {};
  const put = (addr: string, v: string | number) => {
    summary[addr] = { t: typeof v === "number" ? "n" : "s", v };
  };

  put("A2", "L_PRODUK");
  put("B2", "(All)");
  put("A4", "Sum of SSL_DO");
  put("B4", "Column Labels");
  put("A6", "Row Labels");

  // Kolom: per periode -> [divisi...] + "<periode> Total"; terakhir "Grand Total".
  let colNo = 1;
  for (const p of periodList) {
    put(`${colLetter(colNo)}5`, p);
    for (const d of divisiList) {
      put(`${colLetter(colNo)}6`, d);
      colNo += 1;
    }
    put(`${colLetter(colNo)}5`, `${p} Total`);
    colNo += 1;
  }
  put(`${colLetter(colNo)}5`, "Grand Total");
  const lastCol = colNo;

  const cellValue = (p: number | null, witel: string | null, divisi: string | null) => {
    let total = 0;
    for (const [key, v] of sum) {
      const [kp, kw, kd] = key.split("|");
      if ((p === null || Number(kp) === p) && (witel === null || kw === witel) && (divisi === null || kd === divisi)) total += v;
    }
    return total;
  };

  const firstDataRow = 7;
  const totalRow = firstDataRow + witelList.length;
  const rowsToWrite = [...witelList.map((w, i) => ({ r: firstDataRow + i, witel: w as string | null })), { r: totalRow, witel: null }];
  for (const { r, witel } of rowsToWrite) {
    put(`A${r}`, witel ?? "Grand Total");
    let c = 1;
    for (const p of periodList) {
      for (const d of divisiList) {
        put(`${colLetter(c)}${r}`, cellValue(p, witel, d));
        c += 1;
      }
      put(`${colLetter(c)}${r}`, cellValue(p, witel, null));
      c += 1;
    }
    put(`${colLetter(c)}${r}`, cellValue(null, witel, null));
  }

  summary["!ref"] = `A2:${colLetter(lastCol)}${totalRow}`;
  summary["!cols"] = [{ wch: 26 }, ...Array.from({ length: lastCol }, () => ({ wch: 13 }))];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summary, CABUTAN_SUMMARY_SHEET);
  XLSX.utils.book_append_sheet(wb, dataSheet, CABUTAN_DATA_SHEET);

  // Bulan diambil dari PERIODE data (periode terbanyak); jika tidak ada, memakai bulan berjalan (WIB).
  const counts = new Map<number, number>();
  for (const r of body) counts.set(Number(r[iPeriode]), (counts.get(Number(r[iPeriode])) ?? 0) + 1);
  const mainPeriod = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const monthName = monthNameFromPeriod(mainPeriod);

  const plain = XLSX.write(wb, { bookType: "xlsx", compression: true, type: "array" }) as ArrayBuffer;
  const bytes = await addPivotTable(new Uint8Array(plain), {
    divisiList,
    divisiCol: iDivisi,
    doCol: iDo,
    header,
    lastRow,
    periodCol: iPeriode,
    periodList,
    produkCol: idx("L_PRODUK"),
    produkList: [...new Set(rows.map((r) => r[idx("L_PRODUK")] ?? ""))].sort((a, b) => a.localeCompare(b)),
    rowCount: rows.length,
    witelCol: iWitel,
    witelList,
    doMin: Math.min(...body.map((r) => Number(r[iDo]) || 0)),
    doMax: Math.max(...body.map((r) => Number(r[iDo]) || 0)),
  });
  return {
    bytes,
    cabutan: cellValue(null, null, null),
    filename: `DO_${monthName}.xlsx`,
    monthName,
    periods: periodList,
    rowCount: rows.length,
    witelCount: witelList.length,
  };
}

// ---------------------------------------------------------------------------------------------
// PivotTable asli. SheetJS tidak bisa membuat pivot, jadi bagian OOXML-nya disisipkan ke file xlsx.
// Cache dibuat tanpa catatan (count=0) dan refreshOnLoad="1": Excel membangun ulang cache dari sheet data
// saat file dibuka, sementara angka yang sudah ditulis di Sheet1 tampil sebagai nilai awal.
// ---------------------------------------------------------------------------------------------
type PivotSpec = {
  divisiCol: number;
  divisiList: string[];
  doCol: number;
  doMax: number;
  doMin: number;
  header: string[];
  lastRow: number;
  periodCol: number;
  periodList: number[];
  produkCol: number;
  produkList: string[];
  rowCount: number;
  witelCol: number;
  witelList: string[];
};

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sharedStrings(values: string[]) {
  return `<sharedItems count="${values.length}">${values.map((v) => `<s v="${xmlEscape(v)}"/>`).join("")}</sharedItems>`;
}

function itemList(count: number) {
  return `<items count="${count + 1}">${Array.from({ length: count }, (_, i) => `<item x="${i}"/>`).join("")}<item t="default"/></items>`;
}

function buildPivotCacheXml(spec: PivotSpec) {
  const fields = spec.header.map((name, i) => {
    let shared = "<sharedItems/>";
    if (i === spec.periodCol) {
      const min = Math.min(...spec.periodList);
      const max = Math.max(...spec.periodList);
      shared = `<sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" containsInteger="1" minValue="${min}" maxValue="${max}" count="${spec.periodList.length}">${spec.periodList.map((p) => `<n v="${p}"/>`).join("")}</sharedItems>`;
    } else if (i === spec.produkCol) shared = sharedStrings(spec.produkList);
    else if (i === spec.divisiCol) shared = sharedStrings(spec.divisiList);
    else if (i === spec.witelCol) shared = sharedStrings(spec.witelList);
    else if (i === spec.doCol) shared = `<sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" containsInteger="1" minValue="${spec.doMin}" maxValue="${spec.doMax}"/>`;
    return `<cacheField name="${xmlEscape(name)}" numFmtId="0">${shared}</cacheField>`;
  });
  const serial = Date.now() / 86400000 + 25569; // tanggal serial Excel
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="${NS_MAIN}" xmlns:r="${NS_REL}" r:id="rId1" refreshOnLoad="1" refreshedBy="PRIME Bot" refreshedDate="${serial}" createdVersion="8" refreshedVersion="8" minRefreshableVersion="3" recordCount="${spec.rowCount}"><cacheSource type="worksheet"><worksheetSource ref="A1:${colLetter(spec.header.length - 1)}${spec.lastRow}" sheet="${xmlEscape(CABUTAN_DATA_SHEET)}"/></cacheSource><cacheFields count="${spec.header.length}">${fields.join("")}</cacheFields></pivotCacheDefinition>`;
}

function buildPivotTableXml(spec: PivotSpec) {
  const nP = spec.periodList.length;
  const nD = spec.divisiList.length;
  const fields = spec.header.map((_, i) => {
    if (i === spec.periodCol) return `<pivotField axis="axisCol" showAll="0">${itemList(nP)}</pivotField>`;
    if (i === spec.produkCol) return `<pivotField axis="axisPage" showAll="0">${itemList(spec.produkList.length)}</pivotField>`;
    if (i === spec.divisiCol) return `<pivotField axis="axisCol" showAll="0">${itemList(nD)}</pivotField>`;
    if (i === spec.witelCol) return `<pivotField axis="axisRow" showAll="0">${itemList(spec.witelList.length)}</pivotField>`;
    if (i === spec.doCol) return `<pivotField dataField="1" showAll="0"/>`;
    return `<pivotField showAll="0"/>`;
  });
  const rowItems = [
    ...spec.witelList.map((_, i) => (i === 0 ? "<i><x/></i>" : `<i><x v="${i}"/></i>`)),
    '<i t="grand"><x/></i>',
  ];
  const colItems: string[] = [];
  spec.periodList.forEach((_, p) => {
    for (let d = 0; d < nD; d += 1) {
      if (d === 0) colItems.push(p === 0 ? "<i><x/><x/></i>" : `<i><x v="${p}"/><x/></i>`);
      else colItems.push(`<i r="1"><x v="${d}"/></i>`);
    }
    colItems.push(p === 0 ? '<i t="default"><x/></i>' : `<i t="default"><x v="${p}"/></i>`);
  });
  colItems.push('<i t="grand"><x/></i>');
  const lastCol = colLetter(1 + nP * (nD + 1));
  const lastRow = 6 + spec.witelList.length + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition xmlns="${NS_MAIN}" name="PivotTable1" cacheId="1" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Values" updatedVersion="8" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="8" indent="0" outline="1" outlineData="1" multipleFieldFilters="0"><location ref="A4:${lastCol}${lastRow}" firstHeaderRow="1" firstDataRow="3" firstDataCol="1" rowPageCount="1" colPageCount="1"/><pivotFields count="${spec.header.length}">${fields.join("")}</pivotFields><rowFields count="1"><field x="${spec.witelCol}"/></rowFields><rowItems count="${rowItems.length}">${rowItems.join("")}</rowItems><colFields count="2"><field x="${spec.periodCol}"/><field x="${spec.divisiCol}"/></colFields><colItems count="${colItems.length}">${colItems.join("")}</colItems><pageFields count="1"><pageField fld="${spec.produkCol}" hier="-1"/></pageFields><dataFields count="1"><dataField name="Sum of SSL_DO" fld="${spec.doCol}" baseField="0" baseItem="0"/></dataFields><pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`;
}

async function addPivotTable(xlsx: Uint8Array, spec: PivotSpec): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(xlsx);
  const text = async (path: string) => {
    const file = zip.file(path);
    if (!file) throw new Error(`Bagian ${path} tidak ditemukan di file xlsx.`);
    return file.async("string");
  };

  zip.file("xl/pivotCache/pivotCacheDefinition1.xml", buildPivotCacheXml(spec));
  zip.file("xl/pivotCache/pivotCacheRecords1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheRecords xmlns="${NS_MAIN}" xmlns:r="${NS_REL}" count="0"/>`);
  zip.file("xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_BASE}/pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>`);
  zip.file("xl/pivotTables/pivotTable1.xml", buildPivotTableXml(spec));
  zip.file("xl/pivotTables/_rels/pivotTable1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_BASE}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>`);

  // Sheet1 -> pivotTable
  const sheetRelsPath = "xl/worksheets/_rels/sheet1.xml.rels";
  const pivotRel = `<Relationship Id="rIdPivot1" Type="${REL_BASE}/pivotTable" Target="../pivotTables/pivotTable1.xml"/>`;
  const existingSheetRels = zip.file(sheetRelsPath);
  zip.file(
    sheetRelsPath,
    existingSheetRels
      ? (await existingSheetRels.async("string")).replace("</Relationships>", `${pivotRel}</Relationships>`)
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pivotRel}</Relationships>`,
  );

  // workbook -> pivotCache
  const wbRelsPath = "xl/_rels/workbook.xml.rels";
  zip.file(wbRelsPath, (await text(wbRelsPath)).replace("</Relationships>", `<Relationship Id="rIdPivotCache1" Type="${REL_BASE}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>`));
  const workbook = await text("xl/workbook.xml");
  if (!workbook.includes("</workbook>")) throw new Error("workbook.xml tidak valid.");
  zip.file("xl/workbook.xml", workbook.replace("</workbook>", '<pivotCaches><pivotCache cacheId="1" r:id="rIdPivotCache1"/></pivotCaches></workbook>'));

  const types = await text("[Content_Types].xml");
  zip.file(
    "[Content_Types].xml",
    types.replace(
      "</Types>",
      '<Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/><Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/><Override PartName="/xl/pivotCache/pivotCacheRecords1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/></Types>',
    ),
  );

  return zip.generateAsync({ compression: "DEFLATE", type: "uint8array" });
}
