import { readDashboardStateByKey, writeDashboardStateByKey } from "@/features/shared/backend/database/dashboard-state";

// Data MetaBright (Impactful Award Telda) disimpan di tabel dashboard_state dengan key "metabright",
// sama seperti HSI ("default"), WMS ("wms"), dan LTS ("lts"). Dibaca juga oleh bot Telegram.
export const METABRIGHT_STATE_KEY = "metabright";

export function readMetabrightDashboardState() {
  return readDashboardStateByKey(METABRIGHT_STATE_KEY);
}

export function writeMetabrightDashboardState(payload: unknown) {
  return writeDashboardStateByKey(METABRIGHT_STATE_KEY, payload);
}
