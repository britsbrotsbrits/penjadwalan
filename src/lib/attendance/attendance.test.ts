import { describe, expect, it } from "vitest";
import { adminAttendanceSchema, attendanceDeleteSchema, dateParamSchema, submitAttendanceSchema } from "./schemas";
import { ATTENDANCE_LABEL, countsAsPresent, describeAttendance, needsOtherTutor } from "./labels";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const S = "33333333-3333-4333-8333-333333333333";

describe("labels", () => {
  it("lawan wajib hanya untuk TUKAR dan MENGGANTIKAN", () => {
    expect(["HADIR", "TUKAR", "MENGGANTIKAN", "X"].map(needsOtherTutor)).toEqual([false, true, true, false]);
  });
  it("kalimat ringkas", () => {
    expect(describeAttendance("HADIR", "")).toBe("Hadir");
    expect(describeAttendance("TUKAR", "Fajar")).toBe("Tukar dengan Fajar");
    expect(describeAttendance("MENGGANTIKAN", "  ")).toBe("Menggantikan (tanpa nama)");
    expect(ATTENDANCE_LABEL.HADIR).toBe("Hadir");
  });
  it("hanya tiga status yang masuk presensi sheet", () => {
    expect(["HADIR", "TUKAR", "MENGGANTIKAN", "TIDAK_HADIR", ""].map(countsAsPresent)).toEqual([true, true, true, false, false]);
  });
});

describe("submitAttendanceSchema", () => {
  it("HADIR tanpa lawan lolos; dengan lawan ditolak", () => {
    expect(submitAttendanceSchema.safeParse({ sessionId: S, status: "HADIR", otherTutorId: "" }).success).toBe(true);
    expect(submitAttendanceSchema.safeParse({ sessionId: S, status: "HADIR", otherTutorId: B }).success).toBe(false);
  });
  it("TUKAR dan MENGGANTIKAN wajib lawan", () => {
    for (const status of ["TUKAR", "MENGGANTIKAN"]) {
      expect(submitAttendanceSchema.safeParse({ sessionId: S, status, otherTutorId: "" }).success).toBe(false);
      expect(submitAttendanceSchema.safeParse({ sessionId: S, status, otherTutorId: B }).success).toBe(true);
    }
  });
  it("status dan id tidak valid ditolak", () => {
    expect(submitAttendanceSchema.safeParse({ sessionId: S, status: "ABSEN", otherTutorId: "" }).success).toBe(false);
    expect(submitAttendanceSchema.safeParse({ sessionId: "x", status: "HADIR", otherTutorId: "" }).success).toBe(false);
    expect(submitAttendanceSchema.safeParse({ sessionId: S, status: "TUKAR", otherTutorId: "bukan-uuid" }).success).toBe(false);
  });
});

describe("adminAttendanceSchema", () => {
  const ok = { sessionId: S, tutorId: A, status: "MENGGANTIKAN", otherTutorId: B, note: " koreksi " };
  it("catatan di-trim dan dibatasi 500", () => {
    const r = adminAttendanceSchema.safeParse(ok);
    expect(r.success && r.data.note).toBe("koreksi");
    expect(adminAttendanceSchema.safeParse({ ...ok, note: "x".repeat(501) }).success).toBe(false);
  });
  it("lawan tidak boleh sama dengan pengajar", () => {
    expect(adminAttendanceSchema.safeParse({ ...ok, otherTutorId: A }).success).toBe(false);
  });
  it("aturan lawan sama seperti mentor", () => {
    expect(adminAttendanceSchema.safeParse({ ...ok, status: "HADIR" }).success).toBe(false);
    expect(adminAttendanceSchema.safeParse({ ...ok, status: "HADIR", otherTutorId: "" }).success).toBe(true);
    expect(adminAttendanceSchema.safeParse({ ...ok, tutorId: "" }).success).toBe(false);
  });
});

describe("lain-lain", () => {
  it("delete dan tanggal", () => {
    expect(attendanceDeleteSchema.safeParse({ id: S }).success).toBe(true);
    expect(attendanceDeleteSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(dateParamSchema.safeParse("2026-10-08").success).toBe(true);
    expect(dateParamSchema.safeParse("2026-13-40").success).toBe(false);
  });
});
