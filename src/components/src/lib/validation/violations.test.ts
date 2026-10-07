import { describe, expect, it } from "vitest";
import { describeViolations, parseViolationMessage, VIOLATION_LABELS } from "./violations";

describe("pesan pelanggaran", () => {
  it("mengurai token dari pesan error", () => {
    expect(parseViolationMessage("SCHED_VIOLATION:AVAILABILITY,CAPACITY")).toEqual(["AVAILABILITY", "CAPACITY"]);
    expect(parseViolationMessage("error: SCHED_VIOLATION:COMPETENCY")).toEqual(["COMPETENCY"]);
    expect(parseViolationMessage("SCHED_VIOLATION:CAPACITY details here")).toEqual(["CAPACITY"]);
  });
  it("mengabaikan kode tak dikenal dan pesan lain", () => {
    expect(parseViolationMessage("SCHED_VIOLATION:NGAWUR,CAPACITY")).toEqual(["CAPACITY"]);
    expect(parseViolationMessage("hal lain")).toEqual([]);
    expect(parseViolationMessage(null)).toEqual([]);
    expect(parseViolationMessage(undefined)).toEqual([]);
  });
  it("setiap kode punya label", () => {
    for (const code of Object.keys(VIOLATION_LABELS)) {
      expect(describeViolations([code as keyof typeof VIOLATION_LABELS]).length).toBeGreaterThan(5);
    }
    expect(describeViolations(["CAPACITY", "FIXED_ROOM"])).toContain("; ");
  });
});
