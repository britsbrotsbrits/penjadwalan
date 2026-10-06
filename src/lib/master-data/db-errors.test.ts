import { describe, expect, it } from "vitest";
import { mapDbError } from "./db-errors";

describe("mapDbError", () => {
  it("mengenali constraint unik berdasarkan nama", () => {
    expect(
      mapDbError(
        {
          code: "23505",
          message: 'duplicate key value violates unique constraint "subtests_code_key"',
        },
        "subtes",
      ),
    ).toBe("Kode subtes sudah dipakai.");
    expect(
      mapDbError(
        { code: "23505", message: 'duplicate key value violates unique constraint "rooms_name_lower_key"' },
        "ruangan",
      ),
    ).toBe("Nama ruangan sudah dipakai.");
    expect(
      mapDbError(
        { code: "23505", message: 'duplicate key value violates unique constraint "session_slots_slot_no_key"' },
        "slot",
      ),
    ).toBe("Nomor sesi sudah dipakai.");
  });

  it("mengenali tumpang tindih slot (exclusion violation)", () => {
    expect(
      mapDbError(
        {
          code: "23P01",
          message:
            'conflicting key value violates exclusion constraint "session_slots_no_overlap"',
        },
        "slot",
      ),
    ).toBe("Jam sesi tumpang tindih dengan sesi aktif lain.");
  });

  it("mengenali check constraint berdasarkan nama", () => {
    expect(
      mapDbError(
        { code: "23514", message: 'violates check constraint "rooms_capacity_range"' },
        "ruangan",
      ),
    ).toBe("Kapasitas harus antara 1 dan 500.");
    expect(
      mapDbError(
        { code: "23514", message: 'violates check constraint "session_slots_ends_same_day"' },
        "slot",
      ),
    ).toBe("Sesi harus selesai sebelum tengah malam.");
  });

  it("memakai teks details bila nama constraint ada di sana", () => {
    expect(
      mapDbError(
        { code: "23505", message: "duplicate key", details: 'constraint "subtests_name_lower_key"' },
        "subtes",
      ),
    ).toBe("Nama subtes sudah dipakai.");
  });

  it("fallback per kode bila constraint tidak dikenal", () => {
    expect(mapDbError({ code: "42501", message: "permission denied" }, "slot")).toBe(
      "Anda tidak memiliki izin untuk tindakan ini.",
    );
    expect(mapDbError({ code: "23505", message: "dup" }, "ruangan")).toBe(
      "Data ruangan yang sama sudah ada.",
    );
    expect(mapDbError({ code: "23514", message: "x" }, "hari")).toBe(
      "Data tidak memenuhi aturan validasi.",
    );
  });

  it("mengenali constraint struktur akademik", () => {
    const cases: Array<[string, string, Parameters<typeof mapDbError>[1], string]> = [
      ["23505", "programs_name_lower_key", "program", "Nama program sudah dipakai."],
      ["23505", "class_types_program_name_key", "tipe kelas", "Nama tipe kelas sudah dipakai di program ini."],
      ["23505", "rombels_class_type_name_key", "rombel", "Nama rombel sudah dipakai di tipe kelas ini."],
      ["23505", "students_student_code_key", "siswa", "Kode siswa sudah dipakai."],
      ["23514", "class_types_default_size_range", "tipe kelas", "Ukuran standar harus antara 1 dan 500."],
      ["23514", "rombels_dates_order", "rombel", "Tanggal selesai tidak boleh sebelum tanggal mulai."],
      ["23514", "students_student_code_format", "siswa", "Kode siswa hanya boleh huruf besar, angka, titik, garis bawah, dan strip (maksimal 30 karakter)."],
    ];
    for (const [code, constraint, entity, expected] of cases) {
      expect(mapDbError({ code, message: `violates constraint "${constraint}"` }, entity)).toBe(expected);
    }
  });

  it("mengenali kesalahan ruangan tetap rombel", () => {
    expect(
      mapDbError({ code: "23514", message: "rombels_fixed_room_active: ruangan tetap tidak ada atau tidak aktif" }, "rombel"),
    ).toBe("Ruangan tetap tidak ada atau sudah nonaktif.");
    expect(
      mapDbError({ code: "23503", message: 'violates foreign key constraint "rombels_fixed_room_id_fkey"' }, "rombel"),
    ).toBe("Ruangan tetap tidak ditemukan.");
  });

  it("mengenali constraint konfigurasi akademik", () => {
    const cases: Array<[string, string, "konfigurasi" | "distribusi", string]> = [
      ["23514", "scheduling_settings_value_range", "konfigurasi", "Nilai di luar rentang yang diizinkan (sesi per hari 1-99, total sesi per minggu 1-999)."],
      ["23514", "scheduling_settings_value_integer", "konfigurasi", "Nilai harus berupa bilangan bulat."],
      ["23505", "subtest_distribution_unique_subtest", "distribusi", "Subtes yang sama muncul lebih dari sekali dalam distribusi."],
      ["23505", "subtest_distribution_unique_label", "distribusi", "Nama item fleksibel sudah dipakai dalam distribusi ini."],
      ["23514", "subtest_distribution_shape", "distribusi", "Item fleksibel butuh nama dan minimal 2 subtes; item biasa butuh satu subtes."],
    ];
    for (const [code, constraint, entity, expected] of cases) {
      expect(mapDbError({ code, message: `violates constraint "${constraint}"` }, entity)).toBe(expected);
    }
    expect(mapDbError({ code: "P0002", message: "scope konfigurasi tidak ditemukan" }, "konfigurasi")).toBe(
      "Data konfigurasi tidak ditemukan.",
    );
  });

  it("mengenali constraint tutor", () => {
    expect(
      mapDbError({ code: "23514", message: 'violates check constraint "tutor_profiles_level_range"' }, "tutor"),
    ).toBe("Level harus antara 0 dan 99.");
    expect(
      mapDbError({ code: "23514", message: 'violates check constraint "tutor_profiles_rate_range"' }, "tutor"),
    ).toBe("Rate harus antara Rp0 dan Rp100.000.000 per sesi.");
    expect(
      mapDbError({ code: "23514", message: 'violates check constraint "profiles_full_name_length"' }, "tutor"),
    ).toBe("Nama maksimal 200 karakter.");
    expect(mapDbError({ code: "23503", message: "fk subtests" }, "kompetensi")).toBe(
      "Data terkait tidak ditemukan atau masih dipakai data lain.",
    );
    expect(mapDbError({ code: "P0002", message: "tutor tidak ditemukan" }, "tutor")).toBe(
      "Data tutor tidak ditemukan.",
    );
    expect(mapDbError({ code: "22023", message: "bentuk sel availability tidak valid" }, "availability")).toBe(
      "Input tidak valid.",
    );
  });

  it("mengenali token dari trigger dan RPC pemindahan siswa", () => {
    expect(
      mapDbError(
        { code: "23514", message: "students_target_rombel_active: rombel tujuan tidak ada atau tidak aktif" },
        "siswa",
      ),
    ).toBe("Rombel tujuan tidak ada atau sudah nonaktif.");
    expect(
      mapDbError(
        { code: "23514", message: "students_same_rombel: siswa sudah berada di rombel tersebut" },
        "siswa",
      ),
    ).toBe("Siswa sudah berada di rombel tersebut.");
  });

  it("fallback untuk FK, input tidak valid, dan data tidak ditemukan", () => {
    expect(mapDbError({ code: "23503", message: "fk" }, "rombel")).toBe(
      "Data terkait tidak ditemukan atau masih dipakai data lain.",
    );
    expect(mapDbError({ code: "22023", message: "alasan maksimal 500 karakter" }, "siswa")).toBe(
      "Input tidak valid.",
    );
    expect(mapDbError({ code: "P0002", message: "siswa tidak ditemukan" }, "siswa")).toBe(
      "Data siswa tidak ditemukan.",
    );
  });

  it("tidak pernah membocorkan pesan mentah database", () => {
    const message = mapDbError(
      { code: "XX000", message: "relation public.secret_table does not exist" },
      "slot",
    );
    expect(message).toBe("Terjadi kesalahan saat menyimpan data. Coba lagi.");
    expect(message.includes("secret_table")).toBe(false);
  });

  it("aman untuk error kosong", () => {
    expect(mapDbError({}, "hari")).toBe("Terjadi kesalahan saat menyimpan data. Coba lagi.");
  });
});
