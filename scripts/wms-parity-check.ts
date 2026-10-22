// Uji paritas: hasil dashboard WMS vs nilai hasil hitung Excel pada sheet "Report Sementara <bulan berjalan>".
// Pakai:  npx tsx scripts/wms-parity-check.ts "path/ke/workbook.xlsx"
// File harus workbook lengkap (sheet MASTER, HELPER, TARGET, REAL, dan sheet Report Sementara yang sudah dihitung Excel).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { computeWmsReport, groupMasterRowsByPeriod, type MasterRow } from "../features/wms/domain/reporting/reporting";
import { normalizeImportedMasterRows } from "../features/wms/domain/reporting/master-import";
import { parseWmsReference } from "../features/wms/domain/reporting/reference";

const require = createRequire(import.meta.url);
const XLSX = require(path.resolve(process.cwd(), "public/vendor/xlsx.full.min.js"));
const file = process.argv[2];
if (!file) throw new Error("Pakai: npx tsx scripts/wms-parity-check.ts <workbook.xlsx>");

const wb = XLSX.read(readFileSync(file), { cellDates: true, type: "buffer" });
// Pembacaan dipaksa mulai dari kolom A/baris 1 agar indeks sama dengan nomor kolom Excel (A=0, B=1, ...).
const sheet = (name: string) => {
  const found = wb.SheetNames.find((n: string) => n.trim().toUpperCase() === name.toUpperCase());
  if (!found) return null;
  const ws = wb.Sheets[found];
  const end = XLSX.utils.decode_range(ws["!ref"] ?? "A1").e;
  return XLSX.utils.sheet_to_json(ws, { blankrows: true, defval: null, header: 1, range: { s: { c: 0, r: 0 }, e: end }, raw: true });
};
const rows = normalizeImportedMasterRows(sheet("MASTER") as unknown[][], "MASTER");
const parsed = parseWmsReference(sheet);
if (!parsed.reference) throw new Error(`Data acuan tidak terbaca: ${parsed.problems.join("; ") || "sheet HELPER/TARGET/REAL tidak ada"}`);
const reference = parsed.reference;

// Sheet laporan bulan berjalan: "Report Sementara <nama bulan>" yang di-link REAL (kolom bulan = reportPeriodKey).
const monthPrefixes = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"];
const monthIndex = Number(reference.reportPeriodKey.slice(4)) - 1;
const reportSheetName = wb.SheetNames.find((n: string) => {
  const upper = n.trim().toUpperCase();
  return upper.startsWith("REPORT SEMENTARA ") && upper.slice("REPORT SEMENTARA ".length).startsWith(monthPrefixes[monthIndex]);
});
if (!reportSheetName) throw new Error(`Sheet Report Sementara bulan ${monthPrefixes[monthIndex]} tidak ditemukan`);
const rep = sheet(reportSheetName) as unknown[][];
const cell = (r: number, c: number) => rep[r - 1]?.[c - 1];

// Waktu hitung Excel dibaca dari teks "Cut Off: 21 October 2026; 15:30 WIB" pada sheet.
const cutText = String(rep.flat().find((v) => typeof v === "string" && v.startsWith("Cut Off:")) ?? "");
const m = /Cut Off: (\d+) (\w+) (\d+); (\d+):(\d+)/.exec(cutText);
const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const now = m ? new Date(Date.UTC(+m[3], months.indexOf(m[2]), +m[1], +m[4], +m[5]) - 7 * 3600e3) : new Date();

const grouped = groupMasterRowsByPeriod(rows as MasterRow[]);
const allRows = Object.values(grouped).flat();
const report = computeWmsReport(allRows, reference.reportPeriodKey, { now, reference });

const cols = { mtd: 37, ach: 38, rank: 39, shortageFm: 40, realMtdPrev: 41, growthMtd: 42, realFmPrev: 43, growthFm: 45, realYtd: 46, achYtd: 47, growthYtd: 48, rankYtd: 49, shortageYtd: 50, targetFm: 4, targetYtd: 5 } as const;
let diffs = 0, checks = 0;
const scopes = [
  { name: "WITEL", rows: report.witel.rows, total: report.witel.total, first: 6 },
  { name: "TELDA", rows: report.telda.rows, total: report.telda.total, first: 22 },
];
for (const sc of scopes) {
  [...sc.rows, sc.total].forEach((row, i) => {
    for (const [key, col] of Object.entries(cols)) {
      const excel = cell(sc.first + i, col);
      const mine = (row as unknown as Record<string, number | null>)[key];
      const excelNum = typeof excel === "number" ? excel : null;
      checks += 1;
      const same = (mine === null && excelNum === null) || (mine !== null && excelNum !== null && Math.abs(mine - excelNum) < 1e-9);
      if (!same) { diffs += 1; console.log(`BEDA  ${sc.name}/${row.label}/${key}: dashboard=${mine} excel=${excel}`); }
    }
    row.days.forEach((v, d) => {
      const excel = cell(sc.first + i, 6 + d);
      const excelNum = typeof excel === "number" && excel !== 0 ? excel : null;
      checks += 1;
      if ((v ?? null) !== excelNum) { diffs += 1; console.log(`BEDA  ${sc.name}/${row.label}/tgl ${d + 1}: dashboard=${v} excel=${excel}`); }
    });
  });
}
console.log(`\nSheet: ${reportSheetName} | cut-off: ${cutText || "(tidak ada, pakai waktu sekarang)"} | baris MASTER: ${rows.length}`);
console.log(`${checks} sel dibandingkan, ${diffs} berbeda -> ${diffs === 0 ? "SAMA DENGAN XLSX" : "ADA SELISIH"}`);
process.exit(diffs === 0 ? 0 : 1);
