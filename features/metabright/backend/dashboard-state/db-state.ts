import { readDashboardStateByKey, writeDashboardStateByKey } from "@/features/shared/backend/database/dashboard-state";

export const METABRIGHT_STATE_KEY = "metabright";

export function readMetabrightDashboardState() {
  return readDashboardStateByKey(METABRIGHT_STATE_KEY);
}

export function writeMetabrightDashboardState(payload: unknown) {
  return writeDashboardStateByKey(METABRIGHT_STATE_KEY, payload);
}
