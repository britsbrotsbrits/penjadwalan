import { describe, expect, it } from "vitest";
import {
  availabilityRowSchema,
  competenciesSchema,
  tutorProfileRowSchema,
  tutorUpdateSchema,
} from "./schemas";

const ID = "4e4b7779-079f-4fdc-8b32-7f6ea93c6920";
const ID2 = "07ee59b5-33e7-4c74-a9a8-e562de3a05ac";

function messageOf(result: { success: boolean; error?: { issues: Array<{ message: string }> } }) {
  return result.success ? null : (result.error?.issues[0]?.message ?? null);
}

const base = { tutorId: ID, fullName: " Budi ", level: "3", rate: "50000", accountActive: "on", schedulable: "on" };

describe("tutorUpdateSchema", () => {
  it("menerima input valid dan memangkas nama", () => {
    expect(tutorUpdateSchema.parse(base)).toEqual({
      tutorId: ID,
      fullName: "Budi",
      accountActive: true,
      level: 3,
      rate: 50000,
      schedulable: true,
    });
  });

  it("checkbox tidak dikirim berarti false", () => {
    const r = tutorUpdateSchema.parse({ tutorId: ID, fullName: "B", level: "0", rate: "" });
    expect(r.accountActive).toBe(false);
    expect(r.schedulable).toBe(false);
  });

  it("rate kosong atau tidak dikirim menjadi null (bukan 0)", () => {
    expect(tutorUpdateSchema.parse({ ...base, rate: "" }).rate).toBeNull();
    expect(tutorUpdateSchema.parse({ ...base, rate: "   " }).rate).toBeNull();
    const { rate: _omit, ...withoutRate } = base;
    expect(tutorUpdateSchema.parse(withoutRate).rate).toBeNull();
    expect(tutorUpdateSchema.parse({ ...base, rate: "0" }).rate).toBe(0);
  });

  it("rate: hanya angka bulat Rupiah, maksimal Rp100.000.000", () => {
    const msg = "Rate harus berupa angka bulat Rupiah tanpa titik atau koma.";
    expect(messageOf(tutorUpdateSchema.safeParse({ ...base, rate: "50.000" }))).toBe(msg);
    expect(messageOf(tutorUpdateSchema.safeParse({ ...base, rate: "50,5" }))).toBe(msg);
    expect(messageOf(tutorUpdateSchema.safeParse({ ...base, rate: "-1" }))).toBe(msg);
    expect(messageOf(tutorUpdateSchema.safeParse({ ...base, rate: "abc" }))).toBe(msg);
    expect(tutorUpdateSchema.safeParse({ ...base, rate: "100000000" }).success).toBe(true);
    expect(messageOf(tutorUpdateSchema.safeParse({ ...base, rate: "100000001" }))).toBe(
      "Rate maksimal Rp100.000.000 per sesi.",
    );
  });

  it("level 0..99 bilangan bulat", () => {
    expect(tutorUpdateSchema.safeParse({ ...base, level: "0" }).success).toBe(true);
    expect(tutorUpdateSchema.safeParse({ ...base, level: "99" }).success).toBe(true);
    expect(messageOf(tutorUpdateSchema.safeParse({ ...base, level: "100" }))).toBe("Level maksimal 99.");
    expect(messageOf(tutorUpdateSchema.safeParse({ ...base, level: "-1" }))).toBe("Level minimal 0.");
    expect(messageOf(tutorUpdateSchema.safeParse({ ...base, level: "1.5" }))).toBe("Level harus berupa bilangan bulat.");
  });

  it("nama wajib, maksimal 200, dan id harus UUID", () => {
    expect(messageOf(tutorUpdateSchema.safeParse({ ...base, fullName: "  " }))).toBe("Nama wajib diisi.");
    expect(messageOf(tutorUpdateSchema.safeParse({ ...base, fullName: "x".repeat(201) }))).toBe("Nama maksimal 200 karakter.");
    expect(messageOf(tutorUpdateSchema.safeParse({ ...base, tutorId: "x" }))).toBe("ID tidak valid.");
  });
});

describe("competenciesSchema", () => {
  it("menghapus duplikat", () => {
    expect(competenciesSchema.parse({ tutorId: ID, subtestIds: [ID2, ID, ID2] }).subtestIds).toEqual([ID2, ID]);
  });

  it("daftar kosong valid (tutor tanpa kompetensi)", () => {
    expect(competenciesSchema.parse({ tutorId: ID, subtestIds: [] }).subtestIds).toEqual([]);
  });

  it("menolak id bukan UUID dan daftar terlalu panjang", () => {
    expect(competenciesSchema.safeParse({ tutorId: ID, subtestIds: ["x"] }).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(messageOf(competenciesSchema.safeParse({ tutorId: ID, subtestIds: many }))).toBe("Terlalu banyak subtes.");
  });
});

describe("baris DB", () => {
  it("memetakan snake_case ke camelCase", () => {
    expect(
      tutorProfileRowSchema.parse({
        id: ID,
        profile_id: ID2,
        level: 2,
        rate_per_session: null,
        is_active: false,
        availability_updated_at: null,
      }),
    ).toEqual({ id: ID, profileId: ID2, level: 2, ratePerSession: null, isSchedulable: false, availabilityUpdatedAt: null });

    expect(availabilityRowSchema.parse({ tutor_id: ID, day_of_week: 3, slot_no: 4, available: true })).toEqual({
      tutorId: ID,
      day: 3,
      slotNo: 4,
      available: true,
    });
  });

  it("menolak bentuk salah", () => {
    expect(availabilityRowSchema.safeParse({ tutor_id: ID, day_of_week: "3", slot_no: 4, available: true }).success).toBe(false);
  });
});
