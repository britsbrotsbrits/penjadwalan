import { describe, expect, it } from "vitest";
import { parseProfileRow } from "./profile";

const row = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "tutor",
  full_name: "Tutor A",
  is_active: true,
};

describe("parseProfileRow", () => {
  it("mengubah baris valid menjadi CurrentProfile", () => {
    expect(parseProfileRow(row)).toEqual({
      id: row.id,
      role: "tutor",
      fullName: "Tutor A",
      isActive: true,
    });
  });

  it("null untuk baris kosong atau tidak ada", () => {
    expect(parseProfileRow(null)).toBeNull();
    expect(parseProfileRow(undefined)).toBeNull();
  });

  it("null untuk role yang tidak dikenal", () => {
    expect(parseProfileRow({ ...row, role: "superadmin" })).toBeNull();
  });

  it("null untuk tipe kolom yang salah", () => {
    expect(parseProfileRow({ ...row, is_active: "true" })).toBeNull();
    expect(parseProfileRow({ ...row, id: "bukan-uuid" })).toBeNull();
  });
});
