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
