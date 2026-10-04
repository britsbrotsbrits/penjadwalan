/**
 * Menerjemahkan error Postgres/PostgREST menjadi pesan yang bisa dibaca admin.
 * Murni: tanpa Supabase/React/Next. Jangan pernah menampilkan pesan mentah dari database ke user.
 */

export type DbErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

export type MasterEntity = "subtes" | "ruangan" | "slot" | "hari";

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
    default:
      return GENERIC;
  }
}
