import type { UnscheduledReason } from "../scheduler/types";
import type { PeriodStatus } from "../validation/transitions";

export type { PeriodStatus };

/** Label status periode dan alasan belum terjadwal untuk admin. Murni. */

export const PERIOD_STATUS_LABEL: Readonly<Record<PeriodStatus, string>> = {
  DRAFT: "Draft",
  GENERATED: "Generated",
  APPROVED: "Approved",
  LOCKED: "Locked",
  CANCELLED: "Cancelled",
};

export const PERIOD_STATUS_TONE: Readonly<Record<PeriodStatus, "neutral" | "primary" | "success" | "locked" | "danger">> = {
  DRAFT: "neutral",
  GENERATED: "primary",
  APPROVED: "success",
  LOCKED: "locked",
  CANCELLED: "danger",
};

/** Hanya DRAFT dan GENERATED yang bisa diedit/digenerate ulang (cermin aturan di database). */
export function isEditableStatus(status: PeriodStatus): boolean {
  return status === "DRAFT" || status === "GENERATED";
}

export const UNSCHEDULED_REASON_LABEL: Readonly<Record<UnscheduledReason, string>> = {
  NO_COMPETENT_TUTOR: "Tidak ada mentor yang kompeten",
  NO_AVAILABLE_TUTOR_SLOT: "Mentor yang kompeten tidak tersedia di sesi yang kosong",
  NO_ROMBEL_SLOT: "Rombel tidak punya sesi kosong yang cukup",
  NO_ROOM_CAPACITY: "Tidak ada ruangan dengan kapasitas cukup",
  NO_FREE_ROOM: "Semua ruangan yang muat sedang terpakai",
  FIXED_ROOM_BUSY: "Ruangan tetap rombel sedang terpakai",
  COMBINED_RULE_VIOLATION: "Melanggar aturan sesi gabungan",
  DISTRIBUTION_MISMATCH: "Total distribusi tidak sama dengan total sesi per minggu",
  SCHEDULER_NOT_AVAILABLE: "Scheduler belum tersedia",
};

export function reasonLabel(code: string): string {
  return (UNSCHEDULED_REASON_LABEL as Record<string, string>)[code] ?? code;
}

/** Teks tombol dan penjelasan untuk tiap perpindahan status. */
export const TRANSITION_ACTION: Readonly<Record<string, { label: string; hint: string }>> = {
  APPROVED: { label: "Setujui jadwal", hint: "Sesi dilindungi dari perubahan dan Generate ulang. Butuh minimal satu sesi dan nol pelanggaran." },
  GENERATED: { label: "Tarik persetujuan", hint: "Kembali ke Generated supaya jadwal bisa diedit atau digenerate ulang." },
  LOCKED: { label: "Kunci periode", hint: "Final dan tidak bisa dibuka lagi. Dipakai sebagai dasar absensi dan payroll." },
  CANCELLED: { label: "Batalkan periode", hint: "Semua sesi dibatalkan, tanggal dan slotnya bebas dipakai periode lain. Tidak bisa dibuka lagi." },
};

export const SESSION_SOURCE_LABEL: Readonly<Record<string, string>> = {
  GENERATED: "Generate",
  MANUAL: "Manual",
  ADDITIONAL: "Tambahan",
};
