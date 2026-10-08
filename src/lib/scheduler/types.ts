/**
 * Tipe bersama engine penjadwalan (scheduler, validator, simulator). Murni: tanpa Supabase/React/Next.
 *
 * Model: SATU MINGGU REPRESENTATIF (hari 1..7 x nomor sesi). Penanggalan per periode (DEC-01) belum
 * diputuskan, jadi engine bekerja pada pola mingguan; tanggal ditambahkan saat schedule_periods ada.
 * Snapshot adalah input beku: engine tidak membaca database.
 */

export type SchedSubtest = { id: string; code: string };
export type SchedRoom = { id: string; name: string; capacity: number };

/** Satu baris distribusi subtes (sudah teresolusi untuk rombel ini). */
export type SchedDistributionItem = {
  subtestId: string | null;
  /** Subtes yang boleh mengisi item fleksibel; kosong untuk item biasa. */
  flexibleSubtestIds: readonly string[];
  label: string | null;
  sessionsPerWeek: number;
};

export type SchedRombel = {
  id: string;
  name: string;
  classTypeId: string;
  /** Jumlah siswa untuk perbandingan kapasitas (DEC-02: aktual, atau ukuran standar bila belum ada). */
  studentCount: number;
  fixedRoomId: string | null;
  /** Hasil resolver konfigurasi; null = belum diatur (tidak dikarang). */
  sessionsPerDay: number | null;
  weeklySessions: number | null;
  /** null = distribusi belum ada. */
  distribution: readonly SchedDistributionItem[] | null;
};

export type SchedTutor = {
  id: string;
  name: string;
  /** Skala 0..99; arti dan bobotnya dikonfigurasi kelak. */
  level: number;
  competencies: readonly string[];
  /** Hanya sel yang TERSEDIA. Sel yang tidak tercantum = tidak tersedia (hard constraint). */
  availability: ReadonlyArray<{ day: number; slotNo: number }>;
};

export type SchedulingSnapshot = {
  days: readonly number[];
  slotNos: readonly number[];
  subtests: readonly SchedSubtest[];
  rooms: readonly SchedRoom[];
  rombels: readonly SchedRombel[];
  tutors: readonly SchedTutor[];
};

/** Kebutuhan sesi per minggu untuk satu rombel dan satu item distribusi. */
export type Requirement = {
  id: string;
  rombelId: string;
  /** Subtes yang boleh dipakai. Item biasa: satu; item fleksibel: dua atau lebih. */
  allowedSubtestIds: readonly string[];
  label: string;
  /** Jumlah sesi per minggu. */
  sessions: number;
};

export type ScheduledSession = {
  requirementId: string;
  rombelId: string;
  subtestId: string;
  tutorId: string;
  roomId: string;
  day: number;
  slotNo: number;
};

export type UnscheduledReason =
  | "NO_COMPETENT_TUTOR"
  | "NO_AVAILABLE_TUTOR_SLOT"
  | "NO_ROMBEL_SLOT"
  | "NO_ROOM_CAPACITY"
  | "NO_FREE_ROOM"
  | "FIXED_ROOM_BUSY"
  | "COMBINED_RULE_VIOLATION"
  | "DISTRIBUTION_MISMATCH"
  | "SCHEDULER_NOT_AVAILABLE";

export type UnscheduledItem = {
  requirementId: string;
  /** Jumlah sesi yang belum terpenuhi untuk kebutuhan ini. */
  missing: number;
  reason: UnscheduledReason;
  detail?: string;
};

export type SchedulerResult = {
  scheduled: readonly ScheduledSession[];
  unscheduled: readonly UnscheduledItem[];
};

export type SchedulerInput = {
  snapshot: SchedulingSnapshot;
  requirements: readonly Requirement[];
  /** Seed acak; hasil harus sama untuk input dan seed yang sama. */
  seed: number;
  /**
   * Sesi yang sudah ada (pola mingguan) dan tidak boleh disentuh: hanya mengisi hunian (Generate Additional).
   * Tidak pernah dipindahkan oleh repair dan tidak muncul di hasil.
   */
  frozen?: readonly ScheduledSession[];
};

export type SchedulerFn = (input: SchedulerInput) => SchedulerResult;
