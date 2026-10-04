import { describe, expect, it } from "vitest";
import {
  activeDaysSchema,
  dayRowSchema,
  roomCreateSchema,
  roomRowSchema,
  slotCreateSchema,
  slotRowSchema,
  slotUpdateSchema,
  subtestCreateSchema,
  subtestRowSchema,
  subtestUpdateSchema,
} from "./schemas";

const ID = "00000000-0000-4000-8000-000000000001";

function message(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? "" : (result.error?.issues[0]?.message ?? "");
}

describe("subtestCreateSchema", () => {
  it("menormalkan kode ke huruf besar dan memangkas spasi", () => {
    const r = subtestCreateSchema.parse({ code: " pu ", name: " Penalaran Umum ", sortOrder: "3", isActive: "on" });
    expect(r).toEqual({ code: "PU", name: "Penalaran Umum", sortOrder: 3, isActive: true });
  });

  it("checkbox tidak dicentang (field tidak dikirim) menjadi false", () => {
    const r = subtestCreateSchema.parse({ code: "PU", name: "x", sortOrder: "0" });
    expect(r.isActive).toBe(false);
  });

  it("menolak kode berisi spasi atau simbol, dan kode kosong", () => {
    expect(subtestCreateSchema.safeParse({ code: "A B", name: "x", sortOrder: "0" }).success).toBe(false);
    expect(subtestCreateSchema.safeParse({ code: "A-B", name: "x", sortOrder: "0" }).success).toBe(false);
    expect(subtestCreateSchema.safeParse({ code: "", name: "x", sortOrder: "0" }).success).toBe(false);
  });

  it("menolak nama kosong dan urutan di luar rentang", () => {
    expect(message(subtestCreateSchema.safeParse({ code: "PU", name: "   ", sortOrder: "0" }))).toBe(
      "Nama wajib diisi.",
    );
    expect(subtestCreateSchema.safeParse({ code: "PU", name: "x", sortOrder: "10000" }).success).toBe(false);
    expect(subtestCreateSchema.safeParse({ code: "PU", name: "x", sortOrder: "abc" }).success).toBe(false);
  });
});

describe("subtestUpdateSchema", () => {
  it("mewajibkan id berformat UUID", () => {
    const base = { code: "PU", name: "x", sortOrder: "1", isActive: "on" };
    expect(subtestUpdateSchema.safeParse({ ...base, id: ID }).success).toBe(true);
    expect(subtestUpdateSchema.safeParse({ ...base, id: "bukan-uuid" }).success).toBe(false);
    expect(subtestUpdateSchema.safeParse(base).success).toBe(false);
  });
});

describe("roomCreateSchema", () => {
  it("menerima ruangan valid", () => {
    expect(roomCreateSchema.parse({ name: " Amsterdam ", capacity: "20", isActive: "on" })).toEqual({
      name: "Amsterdam",
      capacity: 20,
      isActive: true,
    });
  });

  it("menolak kapasitas 0, di atas 500, pecahan, dan bukan angka", () => {
    for (const capacity of ["0", "501", "1.5", "abc", ""]) {
      expect(roomCreateSchema.safeParse({ name: "R", capacity }).success).toBe(false);
    }
  });

  it("menolak nama kosong", () => {
    expect(roomCreateSchema.safeParse({ name: "  ", capacity: "5" }).success).toBe(false);
  });
});

describe("slotCreateSchema", () => {
  it("menerima slot valid dan menormalkan jam", () => {
    const r = slotCreateSchema.parse({
      slotNo: "1",
      startTime: "07:00",
      durationMinutes: "90",
      isActive: "on",
    });
    expect(r).toEqual({ slotNo: 1, startTime: "07:00", durationMinutes: 90, isActive: true });
  });

  it("menerima jam berformat HH:MM:00 dan menormalkannya", () => {
    const r = slotCreateSchema.parse({ slotNo: "1", startTime: "07:00:00", durationMinutes: "90" });
    expect(r.startTime).toBe("07:00");
  });

  it("menolak jam tidak valid", () => {
    for (const startTime of ["7:00", "25:00", "12:60", "abc", ""]) {
      expect(slotCreateSchema.safeParse({ slotNo: "1", startTime, durationMinutes: "60" }).success).toBe(false);
    }
  });

  it("menolak durasi di luar 15..480", () => {
    for (const durationMinutes of ["14", "481", "0", "x"]) {
      expect(slotCreateSchema.safeParse({ slotNo: "1", startTime: "07:00", durationMinutes }).success).toBe(false);
    }
  });

  it("menolak slot yang melewati tengah malam dengan pesan jelas", () => {
    const r = slotCreateSchema.safeParse({ slotNo: "1", startTime: "23:00", durationMinutes: "90" });
    expect(message(r)).toBe("Sesi harus selesai sebelum tengah malam.");
  });

  it("slot yang selesai tepat tengah malam masih sah", () => {
    expect(slotCreateSchema.safeParse({ slotNo: "1", startTime: "22:00", durationMinutes: "120" }).success).toBe(true);
  });

  it("menolak nomor sesi 0 atau 100", () => {
    expect(slotCreateSchema.safeParse({ slotNo: "0", startTime: "07:00", durationMinutes: "60" }).success).toBe(false);
    expect(slotCreateSchema.safeParse({ slotNo: "100", startTime: "07:00", durationMinutes: "60" }).success).toBe(false);
  });
});

describe("slotUpdateSchema", () => {
  it("mewajibkan id UUID dan tetap memeriksa batas tengah malam", () => {
    const base = { slotNo: "1", startTime: "07:00", durationMinutes: "90" };
    expect(slotUpdateSchema.safeParse({ ...base, id: ID }).success).toBe(true);
    expect(slotUpdateSchema.safeParse({ ...base, id: "x" }).success).toBe(false);
    expect(slotUpdateSchema.safeParse({ ...base, id: ID, startTime: "23:30" }).success).toBe(false);
  });
});

describe("activeDaysSchema", () => {
  it("mengurutkan dan membuang duplikat", () => {
    expect(activeDaysSchema.parse({ days: ["3", "1", "3", "6"] })).toEqual({ days: [1, 3, 6] });
  });

  it("menolak daftar kosong dengan pesan jelas", () => {
    expect(message(activeDaysSchema.safeParse({ days: [] }))).toBe("Pilih minimal satu hari aktif.");
  });

  it("menolak hari di luar 1..7 atau bukan angka", () => {
    expect(activeDaysSchema.safeParse({ days: ["0"] }).success).toBe(false);
    expect(activeDaysSchema.safeParse({ days: ["8"] }).success).toBe(false);
    expect(activeDaysSchema.safeParse({ days: ["senin"] }).success).toBe(false);
  });
});

describe("skema baris DB", () => {
  it("subtestRowSchema memetakan snake_case ke camelCase", () => {
    expect(
      subtestRowSchema.parse({ id: ID, code: "PU", name: "Penalaran Umum", sort_order: 3, is_active: true }),
    ).toEqual({ id: ID, code: "PU", name: "Penalaran Umum", sortOrder: 3, isActive: true });
  });

  it("roomRowSchema memetakan kolom", () => {
    expect(roomRowSchema.parse({ id: ID, name: "Amsterdam", capacity: 20, is_active: true })).toEqual({
      id: ID,
      name: "Amsterdam",
      capacity: 20,
      isActive: true,
    });
  });

  it("slotRowSchema menormalkan jam Postgres dan menghitung jam selesai", () => {
    expect(
      slotRowSchema.parse({ id: ID, slot_no: 1, start_time: "07:00:00", duration_minutes: 90, is_active: true }),
    ).toEqual({
      id: ID,
      slotNo: 1,
      startTime: "07:00",
      durationMinutes: 90,
      endTime: "08:30",
      isActive: true,
    });
  });

  it("dayRowSchema memetakan kolom", () => {
    expect(dayRowSchema.parse({ day_of_week: 1, is_active: true })).toEqual({ dayOfWeek: 1, isActive: true });
  });

  it("menolak baris dengan tipe kolom yang salah", () => {
    expect(roomRowSchema.safeParse({ id: ID, name: "A", capacity: "20", is_active: true }).success).toBe(false);
    expect(subtestRowSchema.safeParse({ id: "bukan-uuid", code: "PU", name: "x", sort_order: 1, is_active: true }).success).toBe(false);
  });
});
