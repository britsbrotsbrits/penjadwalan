/**
 * Menerjemahkan error Postgres/PostgREST menjadi pesan yang bisa dibaca admin.
 * Murni: tanpa Supabase/React/Next. Jangan pernah menampilkan pesan mentah dari database ke user.
 */

import { describeViolations, parseViolationMessage } from "../validation/violations";

export type DbErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

export type MasterEntity =
  | "subtes"
  | "ruangan"
  | "slot"
  | "hari"
  | "program"
  | "tipe kelas"
  | "rombel"
  | "siswa"
  | "tutor"
  | "kompetensi"
  | "availability"
  | "konfigurasi"
  | "distribusi"
  | "jadwal"
  | "periode jadwal";

const GENERIC = "Terjadi kesalahan saat menyimpan data. Coba lagi.";

// Urutan penting: nama constraint spesifik dicek sebelum fallback per kode.
const BY_CONSTRAINT: ReadonlyArray<{ constraint: string; message: string }> = [
  { constraint: "subtests_code_key", message: "Kode subtes sudah dipakai." },
  { constraint: "subtests_name_lower_key", message: "Nama subtes sudah dipakai." },
  { constraint: "rooms_name_lower_key", message: "Nama ruangan sudah dipakai." },
  { constraint: "session_slots_slot_no_key", message: "Nomor sesi sudah dipakai." },
  {
    constraint: "session_slots_no_overlap",
    message: "Jam sesi tumpang tindih dengan sesi aktif lain.",
  },
  {
    constraint: "session_slots_ends_same_day",
    message: "Sesi harus selesai sebelum tengah malam.",
  },
  {
    constraint: "session_slots_duration_range",
    message: "Durasi harus antara 15 dan 480 menit.",
  },
  {
    constraint: "session_slots_slot_no_range",
    message: "Nomor sesi harus antara 1 dan 99.",
  },
  {
    constraint: "session_slots_start_whole_minute",
    message: "Jam mulai tidak boleh memakai detik.",
  },
  { constraint: "rooms_capacity_range", message: "Kapasitas harus antara 1 dan 500." },
  { constraint: "rooms_name_length", message: "Nama ruangan harus 1 sampai 100 karakter." },
  {
    constraint: "subtests_code_format",
    message: "Kode subtes hanya boleh huruf besar, angka, dan garis bawah (maksimal 20 karakter).",
  },
  { constraint: "subtests_name_length", message: "Nama subtes harus 1 sampai 100 karakter." },
  { constraint: "subtests_sort_order_range", message: "Urutan harus antara 0 dan 9999." },

  // Struktur akademik (Phase 4). Token dari trigger/RPC dicek di sini juga karena
  // dikirim lewat teks pesan error.
  { constraint: "programs_name_lower_key", message: "Nama program sudah dipakai." },
  { constraint: "programs_name_length", message: "Nama program harus 1 sampai 100 karakter." },
  { constraint: "programs_sort_order_range", message: "Urutan harus antara 0 dan 9999." },
  {
    constraint: "class_types_program_name_key",
    message: "Nama tipe kelas sudah dipakai di program ini.",
  },
  { constraint: "class_types_name_length", message: "Nama tipe kelas harus 1 sampai 100 karakter." },
  {
    constraint: "class_types_default_size_range",
    message: "Ukuran standar harus antara 1 dan 500.",
  },
  { constraint: "class_types_sort_order_range", message: "Urutan harus antara 0 dan 9999." },
  {
    constraint: "rombels_class_type_name_key",
    message: "Nama rombel sudah dipakai di tipe kelas ini.",
  },
  { constraint: "rombels_name_length", message: "Nama rombel harus 1 sampai 100 karakter." },
  {
    constraint: "rombels_dates_order",
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai.",
  },
  { constraint: "students_student_code_key", message: "Kode siswa sudah dipakai." },
  {
    constraint: "students_student_code_format",
    message: "Kode siswa hanya boleh huruf besar, angka, titik, garis bawah, dan strip (maksimal 30 karakter).",
  },
  { constraint: "students_full_name_length", message: "Nama siswa harus 1 sampai 200 karakter." },
  {
    constraint: "student_rombel_history_reason_length",
    message: "Alasan pindah maksimal 500 karakter.",
  },
  {
    constraint: "students_target_rombel_active",
    message: "Rombel tujuan tidak ada atau sudah nonaktif.",
  },
  {
    constraint: "rombels_fixed_room_active",
    message: "Ruangan tetap tidak ada atau sudah nonaktif.",
  },
  { constraint: "rombels_fixed_room_id_fkey", message: "Ruangan tetap tidak ditemukan." },
  { constraint: "students_same_rombel", message: "Siswa sudah berada di rombel tersebut." },

  // Tutor (Phase 5)
  { constraint: "tutor_profiles_level_range", message: "Level harus antara 0 dan 99." },
  {
    constraint: "tutor_profiles_rate_range",
    message: "Rate harus antara Rp0 dan Rp100.000.000 per sesi.",
  },
  { constraint: "profiles_full_name_length", message: "Nama maksimal 200 karakter." },
  {
    constraint: "tutor_availability_day_range",
    message: "Hari availability harus antara 1 dan 7.",
  },
  {
    constraint: "tutor_availability_slot_range",
    message: "Nomor sesi availability harus antara 1 dan 99.",
  },

  // Konfigurasi akademik (Phase 7)
  {
    constraint: "scheduling_settings_value_range",
    message: "Nilai di luar rentang yang diizinkan (sesi per hari 1-99, total sesi per minggu 1-999).",
  },
  { constraint: "scheduling_settings_value_integer", message: "Nilai harus berupa bilangan bulat." },
  {
    constraint: "subtest_distribution_unique_subtest",
    message: "Subtes yang sama muncul lebih dari sekali dalam distribusi.",
  },
  {
    constraint: "subtest_distribution_unique_label",
    message: "Nama item fleksibel sudah dipakai dalam distribusi ini.",
  },
  {
    constraint: "subtest_distribution_shape",
    message: "Item fleksibel butuh nama dan minimal 2 subtes; item biasa butuh satu subtes.",
  },
  {
    constraint: "subtest_distribution_sessions_range",
    message: "Sesi per minggu harus antara 1 dan 99.",
  },

  // Jadwal bertanggal (Phase 10)
  { constraint: "teaching_sessions_tutor_slot_key", message: "Mentor sudah mengajar pada tanggal dan sesi itu." },
  { constraint: "teaching_sessions_room_slot_key", message: "Ruangan sudah dipakai pada tanggal dan sesi itu." },
  { constraint: "teaching_sessions_rombel_slot_key", message: "Rombel sudah punya sesi pada tanggal dan sesi itu." },
  { constraint: "teaching_sessions_slot_no_fkey", message: "Nomor sesi tidak ditemukan." },
  { constraint: "schedule_periods_name_lower_key", message: "Nama periode sudah dipakai." },
  { constraint: "schedule_periods_name_length", message: "Nama periode harus 1 sampai 100 karakter." },
  { constraint: "schedule_periods_dates_order", message: "Tanggal selesai tidak boleh sebelum tanggal mulai." },
  { constraint: "schedule_periods_max_length", message: "Periode maksimal 92 hari." },
  { constraint: "schedule_periods_no_overlap", message: "Rentang tanggal tumpang tindih dengan periode lain yang masih aktif." },
  { constraint: "scheduling_runs_seed_range", message: "Seed harus bilangan bulat 0 sampai 4294967295." },
  { constraint: "unscheduled_missing_range", message: "Data kebutuhan belum terpenuhi tidak valid." },
  { constraint: "unscheduled_reason_code", message: "Alasan belum terjadwal tidak dikenal." },
];

const STATUS_LABEL: Readonly<Record<string, string>> = {
  DRAFT: "Draft",
  GENERATED: "Generated",
  APPROVED: "Approved",
  LOCKED: "Locked",
  CANCELLED: "Cancelled",
};

export function mapDbError(error: DbErrorLike, entity: MasterEntity): string {
  const text = `${error.message ?? ""} ${error.details ?? ""}`;

  // Token dari RPC jadwal (dikirim lewat teks pesan).
  const violations = parseViolationMessage(error.message);
  if (violations.length > 0) return `Perubahan ditolak: ${describeViolations(violations)}.`;
  const notEditable = /SCHED_NOT_EDITABLE:([A-Z]+)/.exec(text);
  if (notEditable) {
    return `Jadwal berstatus ${STATUS_LABEL[notEditable[1]!] ?? notEditable[1]} tidak dapat diubah.`;
  }
  const bad = /SCHED_BAD_TRANSITION:([A-Z]+):([A-Z]+)/.exec(text);
  if (bad) {
    return `Status ${STATUS_LABEL[bad[1]!] ?? bad[1]} tidak bisa langsung menjadi ${STATUS_LABEL[bad[2]!] ?? bad[2]}.`;
  }
  if (text.includes("SCHED_APPROVE_EMPTY")) return "Periode belum punya sesi terjadwal, jadi belum bisa disetujui.";
  const approveViol = /SCHED_APPROVE_VIOLATIONS:(\d+)/.exec(text);
  if (approveViol) return `Jadwal masih punya ${approveViol[1]} pelanggaran aturan dan belum bisa disetujui. Perbaiki dulu.`;
  const addNo = /SCHED_ADDITIONAL_NOT_ALLOWED:([A-Z]+)/.exec(text);
  if (addNo) return `Generate Additional hanya untuk periode Generated atau Approved (status sekarang: ${STATUS_LABEL[addNo[1]!] ?? addNo[1]}).`;
  if (text.includes("SCHED_SESSIONS_OUTSIDE_RANGE")) {
    return "Masih ada sesi di luar rentang tanggal yang baru. Batalkan atau pindahkan sesi itu dulu.";
  }

  for (const { constraint, message } of BY_CONSTRAINT) {
    if (text.includes(constraint)) return message;
  }

  switch (error.code) {
    case "42501":
      return "Anda tidak memiliki izin untuk tindakan ini.";
    case "23505":
      return `Data ${entity} yang sama sudah ada.`;
    case "23P01":
      return "Data bentrok dengan data aktif lain.";
    case "23514":
      return "Data tidak memenuhi aturan validasi.";
    case "23503":
      return "Data terkait tidak ditemukan atau masih dipakai data lain.";
    case "22023":
      return "Input tidak valid.";
    case "P0002":
      return `Data ${entity} tidak ditemukan.`;
    default:
      return GENERIC;
  }
}
