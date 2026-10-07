import { describe, expect, it } from "vitest";
import { isEditableStatus, PERIOD_STATUS_LABEL, reasonLabel, UNSCHEDULED_REASON_LABEL } from "./labels";

describe("label jadwal", () => {
  it("hanya DRAFT dan GENERATED yang bisa diedit", () => {
    expect(isEditableStatus("DRAFT")).toBe(true);
    expect(isEditableStatus("GENERATED")).toBe(true);
    for (const s of ["APPROVED", "LOCKED", "CANCELLED"] as const) expect(isEditableStatus(s)).toBe(false);
    expect(Object.keys(PERIOD_STATUS_LABEL)).toHaveLength(5);
  });
  it("setiap alasan punya label; kode tak dikenal ditampilkan apa adanya", () => {
    expect(Object.keys(UNSCHEDULED_REASON_LABEL)).toHaveLength(9);
    expect(reasonLabel("NO_FREE_ROOM")).toBe("Semua ruangan yang muat sedang terpakai");
    expect(reasonLabel("LAIN")).toBe("LAIN");
  });
});
