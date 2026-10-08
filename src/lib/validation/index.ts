// Phase 10: validation engine (murni). Dipakai laporan jadwal, manual adjustment, dan dashboard.
// Modul engine: TANPA impor Supabase/React/Next (ditegakkan ESLint).
// Pemeriksaan per sesi (kapasitas, kompetensi, availability, dst.) dijalankan database lewat
// _schedule_violations agar satu sumber kebenaran; di sini hanya pemeriksaan yang butuh konfigurasi
// (distribusi per minggu) plus kosakata pesan dan aritmetika tanggal.
export * from "./dates";
export * from "./expand";
export * from "./violations";
export * from "./weekly-distribution";
export * from "./transitions";
