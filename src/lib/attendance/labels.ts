/** Status presensi dan teks untuk tampilan. Murni. */

export type AttendanceStatus = "HADIR" | "TUKAR" | "MENGGANTIKAN";

export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ["HADIR", "TUKAR", "MENGGANTIKAN"];

export const ATTENDANCE_LABEL: Readonly<Record<AttendanceStatus, string>> = {
  HADIR: "Hadir",
  TUKAR: "Tukar jadwal",
  MENGGANTIKAN: "Menggantikan",
};

export const ATTENDANCE_TONE: Readonly<Record<AttendanceStatus, "success" | "primary" | "warning">> = {
  HADIR: "success",
  TUKAR: "primary",
  MENGGANTIKAN: "warning",
};

/** TUKAR dan MENGGANTIKAN wajib menyebut mentor lawan; HADIR tidak boleh. */
export function needsOtherTutor(status: string): boolean {
  return status === "TUKAR" || status === "MENGGANTIKAN";
}

/** Kalimat ringkas, mis. "Menggantikan Linda" atau "Tukar dengan Fajar". */
export function describeAttendance(status: string, otherName: string): string {
  if (status === "HADIR") return "Hadir";
  const who = otherName.trim() || "(tanpa nama)";
  if (status === "TUKAR") return `Tukar dengan ${who}`;
  if (status === "MENGGANTIKAN") return `Menggantikan ${who}`;
  return status;
}

/** Hanya tiga status ini yang masuk presensi di sheet (Phase 16). Tidak hadir = tidak ada catatan. */
export function countsAsPresent(status: string): boolean {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(status);
}
