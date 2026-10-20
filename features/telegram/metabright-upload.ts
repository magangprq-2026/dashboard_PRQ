// Upload data MetaBright (Impactful Award Telda) lewat bot Telegram.
// Parser dan format penyimpanan sama dengan upload di halaman web MetaBright:
// dashboard_state key "metabright" -> { periods: { [label]: Dataset }, selected, updatedAt }.
import { neon } from "@neondatabase/serverless";
import * as XLSX from "xlsx";
import { dbConfig } from "@/features/shared/backend/database/db";
import { parseSheet } from "@/features/metabright/domain/parse";
import { periodLabel } from "@/features/metabright/domain/utils";
import type { Dataset } from "@/features/metabright/domain/types";

const NAME_HINT = /impactful|meta\s*-?\s*bright|award\s*telda/i;
const PERIOD_IN_TEXT = /(20\d{2})(0[1-9]|1[0-2])/;

export type MetabrightUpload = { dataset: Dataset; label: string };

/** Nama file / caption menyebut MetaBright (mis. "Impactful Award Telda - 202610.xls"). */
export function hasMetabrightHint(fileName: string, caption?: string) {
  return NAME_HINT.test(`${caption ?? ""} ${fileName}`);
}

function readGrid(buffer: Buffer): unknown[][] {
  // Ekspor "xls" dari BRIGHT sering berupa tabel HTML; SheetJS tetap bisa membacanya.
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("File tidak memiliki sheet yang bisa dibaca.");
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { defval: "", header: 1, raw: false });
}

/** Parse file MetaBright dengan aturan yang sama seperti web. Melempar error berpesan jelas bila format tidak sesuai. */
export function parseMetabrightFile(fileName: string, caption: string | undefined, buffer: Buffer): MetabrightUpload {
  let dataset: Dataset;
  try {
    dataset = parseSheet(readGrid(buffer));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "format tidak dikenali";
    throw new Error(`File MetaBright tidak bisa dibaca: ${reason}.`);
  }
  if (dataset.indicators.length === 0) throw new Error("File MetaBright tidak memiliki kolom indikator (TARGET).");
  // Periode diambil dari nama file (mis. 202610), lalu dari caption bila nama file tidak memuatnya.
  const source = PERIOD_IN_TEXT.test(fileName) ? fileName : PERIOD_IN_TEXT.test(caption ?? "") ? (caption as string) : fileName;
  return { dataset, label: periodLabel(source) };
}

/** Pengenalan lewat struktur file (baris judul TELDA + kolom TARGET). Null bila bukan file MetaBright. */
export function tryParseMetabrightFile(fileName: string, caption: string | undefined, buffer: Buffer): MetabrightUpload | null {
  try {
    return parseMetabrightFile(fileName, caption, buffer);
  } catch {
    return null;
  }
}

/**
 * Simpan satu periode ke state "metabright" dalam SATU statement SQL atomik (periode lain tidak ikut tertimpa)
 * dan jadikan periode itu yang terpilih, supaya report Telegram dan web langsung menampilkannya.
 * Periode dengan label yang sama diganti (pembaruan data bulan itu).
 */
export async function importMetabright(upload: MetabrightUpload) {
  const config = dbConfig();
  if (!config) throw new Error("Database belum dikonfigurasi (DATABASE_URL).");
  const table = config.table;
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error("Nama tabel database tidak valid.");
  const sql = neon(config.url);
  const now = new Date().toISOString();
  const text =
    `insert into public."${table}" (key, payload, updated_at) values ('metabright', ` +
    `jsonb_build_object('periods', jsonb_build_object($1::text, $2::jsonb), 'selected', $1::text, 'updatedAt', $3::text), now()) ` +
    `on conflict (key) do update set updated_at = now(), payload = ` +
    `jsonb_set(jsonb_set(jsonb_set(jsonb_set(` +
    `coalesce("${table}".payload, '{}'::jsonb), '{periods}', coalesce("${table}".payload->'periods', '{}'::jsonb)), ` +
    `array['periods', $1::text], $2::jsonb), ` +
    `'{selected}', to_jsonb($1::text)), '{updatedAt}', to_jsonb($3::text))`;
  try {
    await sql.query(text, [upload.label, JSON.stringify(upload.dataset), now]);
  } catch {
    throw new Error("Gagal menyimpan data MetaBright ke database.");
  }
}
