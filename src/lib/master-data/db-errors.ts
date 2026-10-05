/**
 * Menerjemahkan error Postgres/PostgREST menjadi pesan yang bisa dibaca admin.
 * Murni: tanpa Supabase/React/Next. Jangan pernah menampilkan pesan mentah dari database ke user.
 */

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
  | "siswa";

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
  { constraint: "students_same_rombel", message: "Siswa sudah berada di rombel tersebut." },
];

export function mapDbError(error: DbErrorLike, entity: MasterEntity): string {
  const text = `${error.message ?? ""} ${error.details ?? ""}`;

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
