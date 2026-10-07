/**
 * Kode pelanggaran dari database (fungsi _schedule_violations) dan pesan untuk admin.
 * Murni. Token error dari RPC berbentuk "SCHED_VIOLATION:KODE1,KODE2".
 */

export const VIOLATION_LABELS = {
  CAPACITY: "Kapasitas ruangan lebih kecil dari jumlah siswa",
  COMPETENCY: "Mentor tidak berkompetensi untuk subtes ini",
  AVAILABILITY: "Mentor tidak tersedia pada hari dan sesi ini",
  FIXED_ROOM: "Rombel punya ruangan tetap yang berbeda",
  INACTIVE_TUTOR: "Mentor nonaktif",
  INACTIVE_ROOM: "Ruangan nonaktif",
  INACTIVE_ROMBEL: "Rombel nonaktif",
  INACTIVE_SUBTEST: "Subtes nonaktif",
  DAY_INACTIVE: "Hari ini bukan hari aktif",
  SLOT_INACTIVE: "Sesi ini nonaktif",
  OUT_OF_PERIOD: "Tanggal di luar periode jadwal",
} as const;

export type ViolationCode = keyof typeof VIOLATION_LABELS;

export function isViolationCode(value: string): value is ViolationCode {
  return Object.prototype.hasOwnProperty.call(VIOLATION_LABELS, value);
}

const TOKEN = "SCHED_VIOLATION:";

/** Mengambil kode pelanggaran dari pesan error RPC; kosong bila bukan pesan pelanggaran. */
export function parseViolationMessage(message: string | null | undefined): ViolationCode[] {
  if (!message) return [];
  const at = message.indexOf(TOKEN);
  if (at < 0) return [];
  const rest = message.slice(at + TOKEN.length).split(/[^A-Z_,]/)[0] ?? "";
  return rest.split(",").filter(isViolationCode);
}

export function describeViolations(codes: readonly ViolationCode[]): string {
  return codes.map((c) => VIOLATION_LABELS[c]).join("; ");
}
