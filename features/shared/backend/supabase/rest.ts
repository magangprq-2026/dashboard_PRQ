// Lapisan database server-side. Dulu memanggil Supabase REST (PostgREST); sekarang memakai Neon Postgres
// lewat driver HTTP @neondatabase/serverless. Nama fungsi (supabaseGet / supabaseUpsert) sengaja
// dipertahankan supaya semua pemanggil lama tidak perlu diubah.
//
// Query dibangun sebagai SQL berparameter. Nama tabel/kolom divalidasi (hanya huruf kecil, angka, underscore),
// sedangkan semua nilai dikirim sebagai parameter ($1, $2, ...), jadi aman dari SQL injection.
import { neon } from "@neondatabase/serverless";

export type SupabaseResult<T> =
  | { data: T; error: null; status: number }
  | { data: null; error: string; status: number };

type DatabaseConfig = {
  table: string;
  url: string;
};

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const UPSERT_CHUNK_SIZE = 500;

// Neon di Vercel (integrasi Storage) otomatis mengisi DATABASE_URL dan POSTGRES_URL.
export function databaseUrl() {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || "").trim() || null;
}

export function supabaseConfig(table = process.env.SUPABASE_DASHBOARD_TABLE || "dashboard_state"): DatabaseConfig | null {
  const url = databaseUrl();
  if (!url) return null;
  return { table, url };
}

const NOT_CONFIGURED = "Database Neon belum dikonfigurasi (isi DATABASE_URL).";

function safeIdentifier(value: string) {
  return IDENTIFIER.test(value) ? value : null;
}

function quoteIdentifier(value: string) {
  return `"${value}"`;
}

function plainError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Driver mengembalikan timestamptz sebagai Date; PostgREST dulu mengembalikan string ISO.
// Dikonversi supaya format data ke pemanggil sama seperti sebelumnya.
function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeRows<T>(rows: unknown): T {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row) =>
    Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, normalizeValue(value)])),
  ) as T;
}

export type BuiltQuery = { text: string; params: unknown[] };

// Mendukung subset PostgREST yang dipakai aplikasi ini:
//   select=a,b | kolom=eq.x | kolom=gt.n | kolom=in.(a,b) | kolom=not.is.null | order=kolom.desc | limit=n
export function buildSelect(table: string, query: string): BuiltQuery | { error: string } {
  const safeTable = safeIdentifier(table);
  if (!safeTable) return { error: `Nama tabel tidak valid: ${table}` };

  let columns = "*";
  let orderBy = "";
  let limit = "";
  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const part of query.split("&").filter(Boolean)) {
    const separator = part.indexOf("=");
    if (separator < 0) return { error: `Query tidak valid: ${part}` };
    const key = decodeURIComponent(part.slice(0, separator));
    const rawValue = decodeURIComponent(part.slice(separator + 1));

    if (key === "select") {
      const names = rawValue.split(",").map((name) => name.trim()).filter(Boolean);
      if (names.length === 0) return { error: "select kosong." };
      const invalid = names.find((name) => name !== "*" && !safeIdentifier(name));
      if (invalid) return { error: `Kolom select tidak valid: ${invalid}` };
      columns = names.map((name) => (name === "*" ? "*" : quoteIdentifier(name))).join(", ");
      continue;
    }

    if (key === "limit") {
      const parsed = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(parsed) || parsed < 0) return { error: `limit tidak valid: ${rawValue}` };
      limit = ` limit ${Math.min(parsed, 10000)}`;
      continue;
    }

    if (key === "order") {
      const clauses: string[] = [];
      for (const item of rawValue.split(",").filter(Boolean)) {
        const [column, direction = "asc"] = item.split(".");
        if (!safeIdentifier(column) || !["asc", "desc"].includes(direction)) return { error: `order tidak valid: ${item}` };
        clauses.push(`${quoteIdentifier(column)} ${direction}`);
      }
      if (clauses.length > 0) orderBy = ` order by ${clauses.join(", ")}`;
      continue;
    }

    const column = safeIdentifier(key);
    if (!column) return { error: `Kolom filter tidak valid: ${key}` };
    const quoted = quoteIdentifier(column);

    if (rawValue.startsWith("eq.")) {
      params.push(rawValue.slice(3));
      conditions.push(`${quoted} = $${params.length}`);
    } else if (rawValue.startsWith("gt.")) {
      params.push(rawValue.slice(3));
      conditions.push(`${quoted} > $${params.length}`);
    } else if (rawValue === "not.is.null") {
      conditions.push(`${quoted} is not null`);
    } else if (rawValue === "is.null") {
      conditions.push(`${quoted} is null`);
    } else if (rawValue.startsWith("in.(") && rawValue.endsWith(")")) {
      const items = rawValue.slice(4, -1).split(",").map((item) => item.trim().replace(/^"|"$/g, "")).filter(Boolean);
      if (items.length === 0) {
        conditions.push("false");
      } else {
        const placeholders = items.map((item) => {
          params.push(item);
          return `$${params.length}`;
        });
        conditions.push(`${quoted} in (${placeholders.join(", ")})`);
      }
    } else {
      return { error: `Operator filter belum didukung: ${key}=${rawValue}` };
    }
  }

  const where = conditions.length > 0 ? ` where ${conditions.join(" and ")}` : "";
  return { params, text: `select ${columns} from public.${quoteIdentifier(safeTable)}${where}${orderBy}${limit}` };
}

export function buildUpsert(table: string, rows: Record<string, unknown>[], onConflict: string, returningAll: boolean): BuiltQuery | { error: string } {
  const safeTable = safeIdentifier(table);
  if (!safeTable) return { error: `Nama tabel tidak valid: ${table}` };

  const conflictColumns = onConflict.split(",").map((column) => column.trim()).filter(Boolean);
  if (conflictColumns.length === 0 || conflictColumns.some((column) => !safeIdentifier(column))) {
    return { error: `Kolom on_conflict tidak valid: ${onConflict}` };
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const invalidColumn = columns.find((column) => !safeIdentifier(column));
  if (invalidColumn) return { error: `Kolom tidak valid: ${invalidColumn}` };

  const columnList = columns.map(quoteIdentifier).join(", ");
  const updates = columns
    .filter((column) => !conflictColumns.includes(column))
    .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`);
  const conflictList = conflictColumns.map(quoteIdentifier).join(", ");
  const target = `public.${quoteIdentifier(safeTable)}`;
  // jsonb_populate_recordset mengubah JSON ke tipe kolom tabel (text, integer, timestamptz, jsonb, dst.) sekaligus.
  const text =
    `insert into ${target} (${columnList}) select ${columnList} from jsonb_populate_recordset(null::${target}, $1::jsonb) ` +
    `on conflict (${conflictList}) ${updates.length > 0 ? `do update set ${updates.join(", ")}` : "do nothing"}${returningAll ? " returning *" : ""}`;
  return { params: [], text };
}

export async function supabaseGet<T>(table: string, query: string): Promise<SupabaseResult<T>> {
  const config = supabaseConfig(table);
  if (!config) return { data: null, error: NOT_CONFIGURED, status: 503 };

  let built: BuiltQuery | { error: string };
  try {
    built = buildSelect(config.table, query);
  } catch (error) {
    return { data: null, error: plainError(error), status: 400 };
  }
  if ("error" in built) return { data: null, error: built.error, status: 400 };

  try {
    const sql = neon(config.url);
    const rows = await sql.query(built.text, built.params);
    return { data: normalizeRows<T>(rows), error: null, status: 200 };
  } catch (error) {
    return { data: null, error: plainError(error), status: 500 };
  }
}

export async function supabaseUpsert<T>(
  table: string,
  payload: unknown,
  onConflict: string,
  options: { returning?: "minimal" | "representation" } = {},
): Promise<SupabaseResult<T>> {
  const config = supabaseConfig(table);
  if (!config) return { data: null, error: NOT_CONFIGURED, status: 503 };

  const rows = (Array.isArray(payload) ? payload : [payload]).filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
  if (rows.length === 0) return { data: (options.returning === "representation" ? [] : null) as T, error: null, status: 204 };

  const returningAll = options.returning === "representation";
  const built = buildUpsert(config.table, rows, onConflict, returningAll);
  if ("error" in built) return { data: null, error: built.error, status: 400 };

  try {
    const sql = neon(config.url);
    const returned: unknown[] = [];
    for (let index = 0; index < rows.length; index += UPSERT_CHUNK_SIZE) {
      const chunk = rows.slice(index, index + UPSERT_CHUNK_SIZE);
      const result = await sql.query(built.text, [JSON.stringify(chunk)]);
      if (returningAll && Array.isArray(result)) returned.push(...result);
    }
    if (returningAll) return { data: normalizeRows<T>(returned), error: null, status: 200 };
    return { data: null as T, error: null, status: 204 };
  } catch (error) {
    return { data: null, error: plainError(error), status: 500 };
  }
}
