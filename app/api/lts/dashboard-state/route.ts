import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, hasPermission, SESSION_COOKIE, verifyMasterUnlockToken } from "@/features/hsi/backend/auth/session";
import { readLtsDashboardState, writeLtsDashboardState } from "@/features/lts/backend/dashboard-state/db-state";
import {
  ACCEPT_BODY_ENCODING_HEADER,
  BODY_ENCODING_HEADER,
  GZIP_THRESHOLD_BYTES,
  gunzipToText,
  gzipText,
} from "@/features/shared/http/gzip-json";

export const dynamic = "force-dynamic";

async function authorizedMasterUser(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  return hasPermission(user, "MASTER_ACCESS") && (await verifyMasterUnlockToken(request.headers.get("x-master-unlock-token") ?? undefined));
}

async function authorizedViewer(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  return hasPermission(user, "DASHBOARD_VIEW");
}

// Membaca data cukup dengan login (semua role, termasuk VIEWER) agar dashboard sama di semua perangkat.
// Menulis tetap wajib akun master + token master.
export async function GET(request: NextRequest) {
  if (!(await authorizedViewer(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await readLtsDashboardState();
  const status = result.status ?? 200;
  // Respons besar dikompres (batas respons fungsi Vercel ±4,5 MB) bila browser mendukung.
  if (request.headers.get(ACCEPT_BODY_ENCODING_HEADER) === "gzip") {
    const text = JSON.stringify(result.body);
    if (text.length > GZIP_THRESHOLD_BYTES) {
      return new Response(await gzipText(text), {
        headers: { "Cache-Control": "no-store", "Content-Type": "application/octet-stream", [BODY_ENCODING_HEADER]: "gzip" },
        status,
      });
    }
  }
  return NextResponse.json(result.body, { status });
}

export async function PUT(request: NextRequest) {
  if (!(await authorizedMasterUser(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown = null;
  try {
    payload =
      request.headers.get(BODY_ENCODING_HEADER) === "gzip"
        ? JSON.parse(await gunzipToText(await request.arrayBuffer()))
        : await request.json();
  } catch {
    payload = null;
  }
  const result = await writeLtsDashboardState(payload);
  return NextResponse.json(result.body, { status: result.status });
}
