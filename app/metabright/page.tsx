import { cookies } from "next/headers";
import { getSessionUser, permissionsForUser, SESSION_COOKIE } from "@/features/hsi/backend/auth/session";
import { MetabrightDashboard } from "@/features/metabright/frontend/metabright-dashboard";

export const dynamic = "force-dynamic";

export default async function MetabrightPage() {
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  return <MetabrightDashboard permissions={permissionsForUser(user)} />;
}
