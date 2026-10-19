// Membuat tabel di Neon: npm run db:setup  (butuh DATABASE_URL di environment atau file .env.local)
import { readFileSync, existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error("DATABASE_URL belum diisi. Salin connection string dari dashboard Neon ke .env.local.");
  process.exit(1);
}

const sql = neon(url);
const statements = readFileSync(new URL("../neon/schema.sql", import.meta.url), "utf8")
  .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n")
  .split(/;\s*(?:\n|$)/).map((statement) => statement.trim()).filter(Boolean);

for (const statement of statements) {
  await sql.query(statement);
  console.log("OK:", statement.split("\n")[0].slice(0, 80));
}
console.log(`Selesai: ${statements.length} statement dijalankan.`);
