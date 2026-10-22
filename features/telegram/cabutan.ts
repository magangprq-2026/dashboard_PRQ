// Menu bot "Data Cabutan": mengubah CSV "T_NAL Full Data" menjadi file DO_<Bulan>.xlsx.
// Hanya konversi file (tanpa menyimpan apa pun ke database/portal).
//
// Isi file hasil:
//  - Sheet1                    : ringkasan Sum of SSL_DO per L_WITEL (baris) x DIVISI (kolom), meniru pivot contoh DO_Oktober.xlsx.
//                                Angkanya berupa rumus SUMIFS ke sheet data, jadi ikut berubah bila data diedit.
//  - T_NAL_Full Data_data (2)  : seluruh isi CSV (61 kolom), angka disimpan sebagai angka.
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
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
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

function headerLine(buffer: Buffer): string {
  const head = decodeCsv(buffer.subarray(0, 8192));
  return head.split(/\r?\n/, 1)[0] ?? "";
}

// File dikenali dari baris judul kolomnya (bukan nama file), karena nama "T_NAL_..." juga mengandung "nal" milik LTS.
export function isCabutanFile(fileName: string, buffer: Buffer): boolean {
  if (!/\.csv$/i.test(fileName)) return false;
  const columns = new Set(headerLine(buffer).split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
  return REQUIRED_COLUMNS.every((c) => columns.has(c));
}

function readCabutanCsv(buffer: Buffer): CabutanSheetRows {
  const all = parseCsv(decodeCsv(buffer));
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

export function buildCabutanWorkbook(buffer: Buffer): CabutanResult {
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
  const rng = (c: number) => `'${CABUTAN_DATA_SHEET}'!$${colLetter(c)}$2:$${colLetter(c)}$${lastRow}`;
  const summary: XLSX.WorkSheet = {};
  const put = (addr: string, v: string | number, f?: string) => {
    summary[addr] = f ? { f, t: typeof v === "number" ? "n" : "s", v } : { t: typeof v === "number" ? "n" : "s", v };
  };

  put("A2", "L_PRODUK");
  put("B2", "(All)");
  put("A4", "Sum of SSL_DO");
  put("B4", "Column Labels");
  put("A6", "Row Labels");

  // Kolom: per periode -> [divisi...] + "<periode> Total"; terakhir "Grand Total".
  type Col = { divisi?: string; kind: "cell" | "grand" | "total"; period?: number };
  const cols: Col[] = [];
  for (const p of periodList) {
    for (const d of divisiList) cols.push({ divisi: d, kind: "cell", period: p });
    cols.push({ kind: "total", period: p });
  }
  cols.push({ kind: "grand" });

  cols.forEach((col, i) => {
    const letter = colLetter(i + 1);
    if (col.kind === "cell") {
      if (col.divisi === divisiList[0]) put(`${letter}5`, col.period!);
      put(`${letter}6`, col.divisi!);
    } else if (col.kind === "total") {
      put(`${letter}5`, `${col.period} Total`);
    } else {
      put(`${letter}5`, "Grand Total");
    }
  });

  const firstDataRow = 7;
  const totalRow = firstDataRow + witelList.length;
  const cellValue = (p: number | null, witel: string | null, divisi: string | null) => {
    let total = 0;
    for (const [key, v] of sum) {
      const [kp, kw, kd] = key.split("|");
      if ((p === null || Number(kp) === p) && (witel === null || kw === witel) && (divisi === null || kd === divisi)) total += v;
    }
    return total;
  };

  const rowsToWrite = [...witelList.map((w, i) => ({ r: firstDataRow + i, witel: w as string | null })), { r: totalRow, witel: null }];
  for (const { r, witel } of rowsToWrite) {
    put(`A${r}`, witel ?? "Grand Total");
    cols.forEach((col, i) => {
      const letter = colLetter(i + 1);
      const wCrit = witel === null ? "" : `,${rng(iWitel)},$A${r}`;
      let formula: string;
      let value: number;
      if (col.kind === "cell") {
        formula = `SUMIFS(${rng(iDo)},${rng(iPeriode)},${col.period},${rng(iDivisi)},${letter}$6${wCrit})`;
        value = cellValue(col.period!, witel, col.divisi!);
      } else if (col.kind === "total") {
        formula = `SUMIFS(${rng(iDo)},${rng(iPeriode)},${col.period}${wCrit})`;
        value = cellValue(col.period!, witel, null);
      } else {
        formula = witel === null ? `SUM(${rng(iDo)})` : `SUMIFS(${rng(iDo)},${rng(iWitel)},$A${r})`;
        value = cellValue(null, witel, null);
      }
      put(`${letter}${r}`, value, formula);
    });
  }
  summary["!ref"] = `A2:${colLetter(cols.length)}${totalRow}`;
  summary["!cols"] = [{ wch: 26 }, ...cols.map(() => ({ wch: 13 }))];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summary, CABUTAN_SUMMARY_SHEET);
  XLSX.utils.book_append_sheet(wb, dataSheet, CABUTAN_DATA_SHEET);
  wb.Workbook = { CalcPr: { fullCalcOnLoad: true } } as XLSX.WorkBook["Workbook"];

  // Bulan diambil dari PERIODE data (periode terbanyak); jika tidak ada, memakai bulan berjalan (WIB).
  const counts = new Map<number, number>();
  for (const r of body) counts.set(Number(r[iPeriode]), (counts.get(Number(r[iPeriode])) ?? 0) + 1);
  const mainPeriod = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const monthName = monthNameFromPeriod(mainPeriod);

  const bytes = XLSX.write(wb, { bookType: "xlsx", compression: true, type: "array" }) as ArrayBuffer;
  return {
    bytes: new Uint8Array(bytes),
    cabutan: cellValue(null, null, null),
    filename: `DO_${monthName}.xlsx`,
    monthName,
    periods: periodList,
    rowCount: rows.length,
    witelCount: witelList.length,
  };
}
