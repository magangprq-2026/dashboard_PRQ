// Normalisasi baris hasil upload MASTER (Excel/CSV) ke susunan kolom dashboard.
// Dipisahkan dari komponen React agar bisa dipakai bersama (web, Telegram, dan skrip uji paritas).
import { masterHeaders, type MasterRow } from "./reporting";

export function cleanWorkbookCell(value: unknown): MasterRow[number] {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const pad = (input: number) => String(input).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export function ensureRowWidth(row: unknown[]): MasterRow {
  return Array.from({ length: masterHeaders.length }, (_, index) => {
    const value = row[index];
    return value === undefined || value === "" ? null : (value as MasterRow[number]);
  });
}

function normalizedHeader(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function rowsIncludeMasterHeader(rows: unknown[][]) {
  const first = rows[0];
  if (!first) return false;
  const normalizedFirst = first.slice(0, masterHeaders.length).map(normalizedHeader);
  const normalizedHeaders = masterHeaders.map(normalizedHeader);
  return normalizedHeaders.every((header, index) => normalizedFirst[index] === header);
}

function rowsHaveMappableHeader(rows: unknown[][]) {
  const first = rows[0];
  if (!first) return false;
  const headerSet = new Set(first.map(normalizedHeader));
  return ["TANGGAL", "WITEL", "TELKOM_DAERAH", "JML_SALES", "DAY OF LAST_UPDATED_DATE"].every((header) => headerSet.has(header));
}

export function normalizeImportedMasterRows(sheetRows: unknown[][], sourceLabel: string) {
  if (rowsIncludeMasterHeader(sheetRows)) {
    return sheetRows.slice(1)
      .map((row) => ensureRowWidth(row.map(cleanWorkbookCell)))
      .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""));
  }

  if (rowsHaveMappableHeader(sheetRows)) {
    const sourceHeaders = sheetRows[0];
    const indexByImportedHeader = new Map(sourceHeaders.map((header, index) => [normalizedHeader(header), index]));
    const missingHeaders = masterHeaders.filter((header) => !indexByImportedHeader.has(normalizedHeader(header)));
    if (missingHeaders.length > 0) {
      throw new Error(`${sourceLabel} kurang kolom wajib: ${missingHeaders.slice(0, 5).join(", ")}${missingHeaders.length > 5 ? "..." : ""}`);
    }
    return sheetRows.slice(1)
      .map((row) => masterHeaders.map((header) => cleanWorkbookCell(row[indexByImportedHeader.get(normalizedHeader(header)) ?? -1])))
      .map(ensureRowWidth)
      .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""));
  }

  return sheetRows
    .map((row) => ensureRowWidth(row.map(cleanWorkbookCell)))
    .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""));
}
