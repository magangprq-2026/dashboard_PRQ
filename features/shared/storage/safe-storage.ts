// Tulis ke localStorage tanpa pernah melempar error. Kuota browser sekitar 5 MB; bila penuh,
// data tetap aman karena sumber utamanya adalah database server (Neon).
export function safeStorageSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeStorageRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // diabaikan
  }
}

// Jumlah salinan "Back" per periode. Tiap salinan berisi seluruh baris data, jadi dibatasi agar tidak membengkak.
export const MAX_SNAPSHOTS_PER_PERIOD = 3;
