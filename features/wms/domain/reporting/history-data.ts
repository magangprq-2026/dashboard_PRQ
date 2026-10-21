// Data historis WMS diambil dari sheet "REAL" pada workbook
// R-25-PRQ-JJS-RWMS_Reporting_WMS_2026 - Newest.xlsx (nilai input/hardcode di sheet tsb).
//
// prevDays  : REAL!B:AF  -> realisasi harian bulan sebelumnya (sumber "REAL MTD bulan lalu")
// prevTotal : REAL!AG    -> kolom "Total" bulan sebelumnya (sumber "REAL FM bulan lalu")
// y2026     : REAL!AL:AT -> total bulanan Jan..Sep 2026 (dasar "REAL YTD")
// y2025     : REAL!BA:BL -> total bulanan Jan..Des 2025 (dasar "GR YTD")
//
// Berlaku untuk laporan periode `reportPeriodKey`. Untuk periode lain, data bulan
// lalu dihitung dari baris MASTER yang tersimpan di dashboard.

export type WmsHistoryEntry = {
  prevDays: readonly number[];
  prevTotal: number;
  y2025: readonly number[];
  y2026: readonly number[];
};

export const wmsHistory = {
  reportPeriodKey: "202610",
  lastClosedMonth2026: 9,
  witel: {
    "BALI": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5.0,0,10.0,0], prevTotal: 209.0, y2026: [8.0,7.0,17.0,11.0,51.0,20.0,30.0,209.0,15.0], y2025: [0.0,0.0,1.0,0.0,0.0,1.0,0.0,3.0,0.0,0.0,1.0,0.0] },
    "JATIM BARAT": { prevDays: [1.0,1.0,1.0,0,0,0,0,1.0,1.0,1.0,0,0,0,1.0,1.0,0,2.0,2.0,0,1.0,2.0,4.0,2.0,5.0,3.0,0,2.0,0,1.0,3.0,0], prevTotal: 17.0, y2026: [11.0,16.0,5.0,7.0,13.0,13.0,9.0,17.0,35.0], y2025: [7.0,10.0,19.0,8.0,20.0,16.0,13.0,10.0,3.0,9.0,6.0,5.0] },
    "JATIM TIMUR": { prevDays: [1.0,1.0,1.0,3.0,1.0,0,6.0,1.0,1.0,0,1.0,4.0,1.0,1.0,3.0,3.0,2.0,6.0,2.0,0,5.0,9.0,3.0,6.0,12.0,6.0,1.0,4.0,8.0,9.0,0], prevTotal: 109.0, y2026: [12.0,17.0,10.0,14.0,12.0,9.0,53.0,109.0,101.0], y2025: [13.0,34.0,26.0,23.0,29.0,16.0,23.0,17.0,11.0,15.0,12.0,23.0] },
    "NUSA TENGGARA": { prevDays: [0,0,2.0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1.0,0,0,0,1.0,2.0,0,0], prevTotal: 1.0, y2026: [31.0,7.0,12.0,4.0,14.0,9.0,3.0,1.0,6.0], y2025: [3.0,6.0,10.0,11.0,10.0,9.0,7.0,1.0,1.0,5.0,2.0,8.0] },
    "SEMARANG JATENG UTARA": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,1.0,0,0,0,1.0,0,0,0,0,0,1.0,0,0,0,0,0,0,0], prevTotal: 2.0, y2026: [1.0,4.0,4.0,2.0,2.0,3.0,5.0,2.0,3.0], y2025: [3.0,7.0,4.0,5.0,8.0,6.0,6.0,4.0,7.0,6.0,2.0,5.0] },
    "SOLO JATENG TIMUR": { prevDays: [1.0,0,0,0,0,0,0,0,0,0,1.0,0,0,0,0,1.0,0,0,0,0,0,0,0,0,0,0,1.0,0,0,0,0], prevTotal: 0.0, y2026: [1.0,0.0,1.0,3.0,1.0,0.0,3.0,0.0,4.0], y2025: [4.0,13.0,8.0,12.0,25.0,4.0,4.0,13.0,7.0,8.0,3.0,7.0] },
    "SURAMADU": { prevDays: [0,0,2.0,0,0,0,0,5.0,0,0,2.0,0,0,6.0,0,1.0,0,0,1.0,2.0,8.0,0,0,4.0,3.0,0,1.0,1.0,3.0,7.0,0], prevTotal: 77.0, y2026: [3.0,22.0,5.0,20.0,16.0,21.0,63.0,77.0,46.0], y2025: [21.0,18.0,28.0,31.0,37.0,28.0,25.0,12.0,16.0,15.0,21.0,6.0] },
    "YOGYA JATENG SELATAN": { prevDays: [0,0,0,0,0,0,0,0,0,0,1.0,0,0,0,0,0,0,1.0,0,0,0,0,0,0,0,0,0,0,0,2.0,0], prevTotal: 5.0, y2026: [2.0,4.0,9.0,3.0,12.0,5.0,9.0,5.0,4.0], y2025: [0.0,2.0,8.0,5.0,7.0,7.0,5.0,3.0,6.0,1.0,4.0,1.0] },
  } as Record<string, WmsHistoryEntry>,
  telda: {
    "BANJARNEGARA": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0.0, y2026: [0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0], y2025: [0.0,0.0,0.0,0.0,0.0,1.0,1.0,0.0,0.0,0.0,0.0,0.0] },
    "BANTUL": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0, y2026: [0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0], y2025: [0,0,0,0,0,0,0,0,0,0,0,0] },
    "CILACAP": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0, y2026: [0.0,0.0,0.0,0.0,0.0,0.0,3.0,3.0,3.0], y2025: [0,0,0,0,0,0,0,0,0,0,0,0] },
    "GUNUNG KIDUL": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0.0, y2026: [0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0], y2025: [0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0] },
    "KEBUMEN": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0, y2026: [0.0,0.0,0.0,0.0,2.0,3.0,6.0,11.0,12.0], y2025: [0,0,0,0,0,0,0,0,0,0,0,0] },
    "MAGELANG": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0, y2026: [0.0,0.0,2.0,2.0,2.0,2.0,2.0,2.0,2.0], y2025: [0,0,0,0,0,0,0,0,0,0,0,0] },
    "MEA YOGYAKARTA": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0.0, y2026: [1.0,1.0,3.0,2.0,0.0,3.0,0.0,0.0,0.0], y2025: [0.0,1.0,0.0,1.0,0.0,0.0,0.0,0.0,2.0,0.0,0.0,0.0] },
    "MUNTILAN": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0.0, y2026: [0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0], y2025: [0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0] },
    "PURBALINGGA": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0, y2026: [1.0,1.0,4.0,5.0,9.0,9.0,11.0,11.0,12.0], y2025: [0,0,0,0,0,0,0,0,0,0,0,0] },
    "PURWOKERTO": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0, y2026: [0.0,3.0,4.0,4.0,7.0,7.0,8.0,8.0,10.0], y2025: [0,0,0,0,0,0,0,0,0,0,0,0] },
    "PURWOREJO": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], prevTotal: 1, y2026: [0,0,0,0,0,1,1,1,0], y2025: [0,0,0,1,0,1,1,0,1,1,0,1] },
    "SLEMAN": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0.0, y2026: [0.0,0.0,0.0,0.0,3.0,0.0,0.0,0.0,0.0], y2025: [0.0,0.0,0.0,0.0,1.0,0.0,0.0,2.0,0.0,0.0,0.0,0.0] },
    "TEMANGGUNG": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0.0, y2026: [0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0], y2025: [0.0,0.0,1.0,0.0,0.0,1.0,1.0,0.0,1.0,0.0,0.0,0.0] },
    "WONOSOBO": { prevDays: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], prevTotal: 0, y2026: [0.0,0.0,0.0,0.0,0.0,1.0,1.0,1.0,1.0], y2025: [0,0,0,0,0,0,0,0,0,0,0,0] },
  } as Record<string, WmsHistoryEntry>,
};

// Telda (14 baris REAL) -> nama TELKOM_DAERAH di MASTER (kolom K).
// MEA YOGYAKARTA di MASTER tertulis "INNER - YOGYA JATENG SELATAN" (lihat Report Sementara!AZ).
export const wmsTeldaMasterNames: Record<string, readonly string[]> = {
  "BANJARNEGARA": ["BANJARNEGARA"],
  "BANTUL": ["BANTUL"],
  "CILACAP": ["CILACAP"],
  "GUNUNG KIDUL": ["GUNUNG KIDUL"],
  "KEBUMEN": ["KEBUMEN"],
  "MAGELANG": ["MAGELANG"],
  "MEA YOGYAKARTA": ["INNER - YOGYA JATENG SELATAN", "MEA YOGYAKARTA"],
  "MUNTILAN": ["MUNTILAN"],
  "PURBALINGGA": ["PURBALINGGA"],
  "PURWOKERTO": ["PURWOKERTO"],
  "PURWOREJO": ["PURWOREJO"],
  "SLEMAN": ["SLEMAN"],
  "TEMANGGUNG": ["TEMANGGUNG"],
  "WONOSOBO": ["WONOSOBO"],
};

// Baris "BRANCH" pada laporan = penjumlahan beberapa telda
// (Report Sementara!F22:F29 dan kolom AO/AQ/AT).
export const wmsBranchMembers: Record<string, readonly string[]> = {
  "BANTUL": ["BANTUL", "GUNUNG KIDUL"],
  "CILACAP": ["CILACAP"],
  "KEBUMEN": ["KEBUMEN", "PURWOREJO"],
  "MAGELANG": ["MAGELANG", "MUNTILAN"],
  "PURBALINGGA": ["PURBALINGGA", "BANJARNEGARA"],
  "PURWOKERTO": ["PURWOKERTO"],
  "WONOSOBO": ["WONOSOBO", "TEMANGGUNG"],
  "YOGYAKARTA": ["MEA YOGYAKARTA", "SLEMAN"],
};
