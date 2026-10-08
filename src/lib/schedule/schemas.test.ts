import { describe, expect, it } from "vitest";
import { generateAdditionalSchema, generateSchema, statusChangeSchema, periodCreateSchema, sessionCreateSchema, sessionUpdateSchema } from "./schemas";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("periodCreateSchema", () => {
  it("menerima periode valid dan memangkas nama", () => {
    const r = periodCreateSchema.safeParse({ name: "  Nov 2026 ", startDate: "2026-11-02", endDate: "2026-11-29" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Nov 2026");
  });
  it("menolak nama kosong, tanggal mustahil, terbalik, dan terlalu panjang", () => {
    const msg = (v: object) => {
      const r = periodCreateSchema.safeParse(v);
      return r.success ? null : r.error.issues[0]!.message;
    };
    expect(msg({ name: " ", startDate: "2026-11-02", endDate: "2026-11-29" })).toBe("Nama periode wajib diisi.");
    expect(msg({ name: "x", startDate: "2026-02-30", endDate: "2026-03-10" })).toBe("Tanggal mulai tidak valid.");
    expect(msg({ name: "x", startDate: "2026-11-10", endDate: "2026-11-02" })).toBe("Tanggal selesai tidak boleh sebelum tanggal mulai.");
    expect(msg({ name: "x", startDate: "2026-01-01", endDate: "2026-04-03" })).toBe("Periode maksimal 92 hari.");
    expect(msg({ name: "x", startDate: "2026-01-01", endDate: "2026-04-02" })).toBeNull(); // tepat 92 hari
    expect(msg({ name: "x".repeat(101), startDate: "2026-11-02", endDate: "2026-11-03" })).toBe("Nama periode maksimal 100 karakter.");
  });
});

describe("generateSchema", () => {
  it("seed kosong = otomatis (null); angka valid dipakai", () => {
    expect(generateSchema.parse({ periodId: uuid, seed: "", confirmReplace: "on" })).toEqual({ periodId: uuid, seed: null, confirmReplace: true });
    expect(generateSchema.parse({ periodId: uuid, seed: " 42 " }).seed).toBe(42);
    expect(generateSchema.parse({ periodId: uuid, seed: "0" }).seed).toBe(0);
  });
  it("menolak seed negatif, desimal, di luar rentang, dan bukan angka", () => {
    for (const seed of ["-1", "1.5", "4294967296", "abc"]) {
      expect(generateSchema.safeParse({ periodId: uuid, seed }).success).toBe(false);
    }
  });
});

describe("skema sesi", () => {
  const base = { sessionDate: "2026-11-02", slotNo: "1", subtestId: uuid, tutorId: uuid, roomId: uuid };
  it("menerima input valid (sesi dari form berupa string)", () => {
    expect(sessionCreateSchema.safeParse({ periodId: uuid, rombelId: uuid, ...base }).success).toBe(true);
    const u = sessionUpdateSchema.parse({ id: uuid, ...base });
    expect(u.slotNo).toBe(1);
  });
  it("menolak id bukan uuid, sesi di luar 1..99, dan tanggal buruk", () => {
    expect(sessionUpdateSchema.safeParse({ id: "x", ...base }).success).toBe(false);
    expect(sessionUpdateSchema.safeParse({ id: uuid, ...base, slotNo: "0" }).success).toBe(false);
    expect(sessionUpdateSchema.safeParse({ id: uuid, ...base, slotNo: "100" }).success).toBe(false);
    expect(sessionUpdateSchema.safeParse({ id: uuid, ...base, slotNo: "1.5" }).success).toBe(false);
    expect(sessionUpdateSchema.safeParse({ id: uuid, ...base, sessionDate: "2026-02-31" }).success).toBe(false);
    expect(sessionCreateSchema.safeParse({ periodId: uuid, ...base }).success).toBe(false);
  });
});

describe("schema Phase 11", () => {
  it("status: LOCKED dan CANCELLED wajib konfirmasi", () => {
    expect(statusChangeSchema.safeParse({ periodId: uuid, to: "LOCKED", confirm: "" }).success).toBe(false);
    expect(statusChangeSchema.safeParse({ periodId: uuid, to: "CANCELLED", confirm: "on" }).success).toBe(true);
    expect(statusChangeSchema.safeParse({ periodId: uuid, to: "APPROVED", confirm: "" }).success).toBe(true);
    expect(statusChangeSchema.safeParse({ periodId: uuid, to: "DRAFT", confirm: "on" }).success).toBe(false);
    expect(statusChangeSchema.safeParse({ periodId: "x", to: "APPROVED", confirm: "" }).success).toBe(false);
  });
  it("additional: seed opsional dan dibatasi", () => {
    expect(generateAdditionalSchema.safeParse({ periodId: uuid, seed: "" }).success).toBe(true);
    expect(generateAdditionalSchema.safeParse({ periodId: uuid, seed: "-1" }).success).toBe(false);
  });
});
