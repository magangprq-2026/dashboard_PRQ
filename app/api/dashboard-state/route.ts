import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, hasPermission, SESSION_COOKIE, verifyMasterUnlockToken } from "@/features/hsi/backend/auth/session";
import { readDashboardState, writeDashboardState } from "@/features/hsi/backend/dashboard-state/db-state";

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

  const result = await readDashboardState();
  return NextResponse.json(result.body, { status: result.status });
}

export async function PUT(request: NextRequest) {
  if (!(await authorizedMasterUser(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const result = await writeDashboardState(payload);
  return NextResponse.json(result.body, { status: result.status });
}
