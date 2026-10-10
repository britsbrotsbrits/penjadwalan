import { describe, expect, it } from "vitest";
import {
  classTypeCreateSchema,
  classTypeRowSchema,
  classTypeUpdateSchema,
  historyRowSchema,
  programCreateSchema,
  programUpdateSchema,
  rombelCountRowSchema,
  rombelCreateSchema,
  rombelDefaultsSchema,
  rombelUpdateSchema,
  studentCreateSchema,
  studentMoveSchema,
  studentRowSchema,
  studentUpdateSchema,
} from "./schemas";

const ID = "4e4b7779-079f-4fdc-8b32-7f6ea93c6920";
const ID2 = "07ee59b5-33e7-4c74-a9a8-e562de3a05ac";

function messageOf(result: { success: boolean; error?: { issues: Array<{ message: string }> } }) {
  return result.success ? null : (result.error?.issues[0]?.message ?? null);
}

describe("program", () => {
  it("menerima input valid dan memangkas nama", () => {
    const r = programCreateSchema.parse({ name: "  Gap Year ", sortOrder: "4", isActive: "on" });
    expect(r).toEqual({ name: "Gap Year", sortOrder: 4, isActive: true });
  });

  it("checkbox tidak dikirim berarti nonaktif", () => {
    expect(programCreateSchema.parse({ name: "X", sortOrder: "0" }).isActive).toBe(false);
  });

  it("menolak nama kosong, urutan di luar rentang, dan id buruk", () => {
    expect(messageOf(programCreateSchema.safeParse({ name: "  ", sortOrder: "1" }))).toBe(
      "Nama program wajib diisi.",
    );
    expect(messageOf(programCreateSchema.safeParse({ name: "X", sortOrder: "10000" }))).toBe(
      "Urutan maksimal 9999.",
    );
    expect(
      messageOf(programUpdateSchema.safeParse({ id: "x", name: "X", sortOrder: "1" })),
    ).toBe("ID tidak valid.");
  });
});

describe("tipe kelas", () => {
  it("create butuh programId; update tidak membawanya", () => {
    const create = classTypeCreateSchema.parse({
      programId: ID,
      name: "Junior",
      defaultSize: "14",
      sortOrder: "2",
      isActive: "on",
    });
    expect(create.programId).toBe(ID);

    const update = classTypeUpdateSchema.parse({
      id: ID,
      programId: ID2,
      name: "Junior",
      defaultSize: "14",
      sortOrder: "2",
    });
    expect("programId" in update).toBe(false);
  });

  it("ukuran standar 1..500", () => {
    const base = { programId: ID, name: "X", sortOrder: "0" };
    expect(classTypeCreateSchema.safeParse({ ...base, defaultSize: "1" }).success).toBe(true);
    expect(classTypeCreateSchema.safeParse({ ...base, defaultSize: "500" }).success).toBe(true);
    expect(messageOf(classTypeCreateSchema.safeParse({ ...base, defaultSize: "0" }))).toBe(
      "Ukuran standar minimal 1.",
    );
    expect(messageOf(classTypeCreateSchema.safeParse({ ...base, defaultSize: "501" }))).toBe(
      "Ukuran standar maksimal 500.",
    );
    expect(messageOf(classTypeCreateSchema.safeParse({ ...base, defaultSize: "2.5" }))).toBe(
      "Ukuran standar harus berupa bilangan bulat.",
    );
    expect(messageOf(classTypeCreateSchema.safeParse({ ...base, defaultSize: "abc" }))).toBe(
      "Ukuran standar harus berupa angka.",
    );
  });
});

describe("rombel", () => {
  const base = { classTypeId: ID, name: "Junior A", isActive: "on" };

  it("tanggal kosong menjadi null", () => {
    const r = rombelCreateSchema.parse({ ...base, startDate: "", endDate: "" });
    expect(r.startDate).toBeNull();
    expect(r.endDate).toBeNull();
    const r2 = rombelCreateSchema.parse(base);
    expect(r2.startDate).toBeNull();
  });

  it("menerima rentang valid, termasuk satu hari", () => {
    expect(
      rombelCreateSchema.safeParse({ ...base, startDate: "2026-01-01", endDate: "2026-12-31" })
        .success,
    ).toBe(true);
    expect(
      rombelCreateSchema.safeParse({ ...base, startDate: "2026-05-05", endDate: "2026-05-05" })
        .success,
    ).toBe(true);
    expect(rombelCreateSchema.safeParse({ ...base, startDate: "2026-05-05", endDate: "" }).success).toBe(
      true,
    );
  });

  it("menolak tanggal selesai sebelum mulai", () => {
    expect(
      messageOf(rombelCreateSchema.safeParse({ ...base, startDate: "2026-12-31", endDate: "2026-01-01" })),
    ).toBe("Tanggal selesai tidak boleh sebelum tanggal mulai.");
    expect(
      messageOf(
        rombelUpdateSchema.safeParse({ id: ID, name: "X", startDate: "2026-12-31", endDate: "2026-01-01" }),
      ),
    ).toBe("Tanggal selesai tidak boleh sebelum tanggal mulai.");
  });

  it("menolak tanggal yang tidak ada", () => {
    expect(
      messageOf(rombelCreateSchema.safeParse({ ...base, startDate: "2026-02-30", endDate: "" })),
    ).toBe("Tanggal mulai harus berupa tanggal yang valid (YYYY-MM-DD).");
  });

  it("ruangan tetap: kosong/tidak dikirim = null, UUID valid diterima, selain itu ditolak", () => {
    expect(rombelCreateSchema.parse({ ...base, fixedRoomId: "" }).fixedRoomId).toBeNull();
    expect(rombelCreateSchema.parse(base).fixedRoomId).toBeNull();
    expect(rombelCreateSchema.parse({ ...base, fixedRoomId: ID2 }).fixedRoomId).toBe(ID2);
    expect(messageOf(rombelCreateSchema.safeParse({ ...base, fixedRoomId: "bukan-uuid" }))).toBe("ID tidak valid.");
    expect(rombelUpdateSchema.parse({ id: ID, name: "X", fixedRoomId: ID2 }).fixedRoomId).toBe(ID2);
  });

  it("update tidak membawa classTypeId", () => {
    const r = rombelUpdateSchema.parse({ id: ID, classTypeId: ID2, name: "X", startDate: "", endDate: "" });
    expect("classTypeId" in r).toBe(false);
  });
});

describe("siswa", () => {
  it("create: kode kosong berarti otomatis (undefined)", () => {
    const r = studentCreateSchema.parse({ fullName: " Budi ", rombelId: ID, studentCode: "  " });
    expect(r.fullName).toBe("Budi");
    expect(r.studentCode).toBeUndefined();
    expect(studentCreateSchema.parse({ fullName: "Budi", rombelId: ID }).studentCode).toBeUndefined();
  });

  it("create: kode manual diubah ke huruf besar dan dicek formatnya", () => {
    expect(
      studentCreateSchema.parse({ fullName: "B", rombelId: ID, studentCode: "ab-01" }).studentCode,
    ).toBe("AB-01");
    expect(
      messageOf(studentCreateSchema.safeParse({ fullName: "B", rombelId: ID, studentCode: "a b" })),
    ).toBe(
      "Kode siswa hanya boleh huruf, angka, titik, garis bawah, dan strip (maksimal 30 karakter).",
    );
    expect(
      studentCreateSchema.safeParse({ fullName: "B", rombelId: ID, studentCode: "A".repeat(31) })
        .success,
    ).toBe(false);
  });

  it("create: nama wajib dan maksimal 200", () => {
    expect(messageOf(studentCreateSchema.safeParse({ fullName: " ", rombelId: ID }))).toBe(
      "Nama siswa wajib diisi.",
    );
    expect(
      messageOf(studentCreateSchema.safeParse({ fullName: "x".repeat(201), rombelId: ID })),
    ).toBe("Nama siswa maksimal 200 karakter.");
    expect(messageOf(studentCreateSchema.safeParse({ fullName: "B", rombelId: "bukan" }))).toBe(
      "ID tidak valid.",
    );
  });

  it("update: kode wajib, dan rombelId tidak dibawa", () => {
    const r = studentUpdateSchema.parse({
      id: ID,
      fullName: "Budi",
      studentCode: "sis000001",
      rombelId: ID2,
      isActive: "on",
    });
    expect(r.studentCode).toBe("SIS000001");
    expect(r.isActive).toBe(true);
    expect("rombelId" in r).toBe(false);
    expect(studentUpdateSchema.safeParse({ id: ID, fullName: "B", studentCode: "" }).success).toBe(
      false,
    );
  });
});

describe("pindah rombel", () => {
  it("alasan kosong menjadi null, alasan diisi dipangkas", () => {
    expect(studentMoveSchema.parse({ studentId: ID, rombelId: ID2, reason: "  " }).reason).toBeNull();
    expect(studentMoveSchema.parse({ studentId: ID, rombelId: ID2 }).reason).toBeNull();
    expect(
      studentMoveSchema.parse({ studentId: ID, rombelId: ID2, reason: " naik kelas " }).reason,
    ).toBe("naik kelas");
  });

  it("alasan maksimal 500 karakter", () => {
    expect(
      studentMoveSchema.safeParse({ studentId: ID, rombelId: ID2, reason: "x".repeat(500) }).success,
    ).toBe(true);
    expect(
      messageOf(studentMoveSchema.safeParse({ studentId: ID, rombelId: ID2, reason: "x".repeat(501) })),
    ).toBe("Alasan maksimal 500 karakter.");
  });

  it("id wajib UUID", () => {
    expect(studentMoveSchema.safeParse({ studentId: "x", rombelId: ID2 }).success).toBe(false);
    expect(studentMoveSchema.safeParse({ studentId: ID, rombelId: "" }).success).toBe(false);
  });
});

describe("baris DB", () => {
  it("memetakan snake_case ke camelCase", () => {
    expect(
      classTypeRowSchema.parse({
        id: ID,
        program_id: ID2,
        name: "Junior",
        default_size: 14,
        sort_order: 2,
        is_active: true,
      }),
    ).toEqual({ id: ID, programId: ID2, name: "Junior", defaultSize: 14, sortOrder: 2, isActive: true });

    expect(
      studentRowSchema.parse({
        id: ID,
        student_code: "SIS000001",
        full_name: "Budi",
        rombel_id: ID2,
        is_active: false,
      }),
    ).toEqual({ id: ID, studentCode: "SIS000001", fullName: "Budi", rombelId: ID2, isActive: false });

    expect(
      historyRowSchema.parse({
        id: ID,
        student_id: ID2,
        from_rombel_id: null,
        to_rombel_id: ID,
        changed_by: null,
        reason: null,
        changed_at: "2026-10-04T10:00:00+00:00",
      }),
    ).toEqual({
      id: ID,
      studentId: ID2,
      fromRombelId: null,
      toRombelId: ID,
      changedBy: null,
      reason: null,
      changedAt: "2026-10-04T10:00:00+00:00",
    });

    expect(
      rombelCountRowSchema.parse({ rombel_id: ID, active_students: 3, total_students: 5 }),
    ).toEqual({ rombelId: ID, activeStudents: 3, totalStudents: 5 });
  });

  it("menolak baris dengan bentuk salah", () => {
    expect(studentRowSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(
      rombelCountRowSchema.safeParse({ rombel_id: ID, active_students: "3", total_students: 5 }).success,
    ).toBe(false);
  });
});

describe("rombelDefaultsSchema", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const base = { rombelId: id, slotNo: "4", days: ["5", "2", "3", "2"], cycleWeeks: "3", cycleAnchor: "2026-11-03" };
  it("kelas 2: sesi 4, Selasa-Rabu-Jumat, tiap 3 minggu; hari dirapikan", () => {
    const r = rombelDefaultsSchema.parse(base);
    expect(r.slotNo).toBe(4);
    expect(r.days).toEqual([2, 3, 5]);
    expect(r.cycleWeeks).toBe(3);
    expect(r.cycleAnchor).toBe("2026-11-03");
  });
  it("kosong = tidak diatur; siklus 1 membuang jangkar", () => {
    const r = rombelDefaultsSchema.parse({ rombelId: id, slotNo: "", days: [], cycleWeeks: "", cycleAnchor: "2026-11-03" });
    expect(r).toEqual({ rombelId: id, slotNo: null, days: null, cycleWeeks: 1, cycleAnchor: null });
  });
  it("menolak sesi, hari, siklus, dan tanggal yang tidak valid", () => {
    expect(rombelDefaultsSchema.safeParse({ ...base, slotNo: "abc" }).success).toBe(false);
    expect(rombelDefaultsSchema.safeParse({ ...base, slotNo: "0" }).success).toBe(false);
    expect(rombelDefaultsSchema.safeParse({ ...base, days: ["8"] }).success).toBe(false);
    expect(rombelDefaultsSchema.safeParse({ ...base, days: ["x"] }).success).toBe(false);
    expect(rombelDefaultsSchema.safeParse({ ...base, cycleWeeks: "13" }).success).toBe(false);
    expect(rombelDefaultsSchema.safeParse({ ...base, cycleWeeks: "0" }).success).toBe(false);
    expect(rombelDefaultsSchema.safeParse({ ...base, cycleAnchor: "2026-02-30" }).success).toBe(false);
    expect(rombelDefaultsSchema.safeParse({ ...base, rombelId: "x" }).success).toBe(false);
  });
});
