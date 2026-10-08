import { describe, expect, it } from "vitest";
import { allowedTransitions, canGenerateAdditional, canTransition, needsConfirmation, PERIOD_TRANSITIONS } from "./transitions";

describe("transisi status periode", () => {
  it("hanya pasangan yang diizinkan", () => {
    const statuses = Object.keys(PERIOD_TRANSITIONS);
    const ok = new Set(["GENERATED>APPROVED", "APPROVED>GENERATED", "APPROVED>LOCKED", "DRAFT>CANCELLED", "GENERATED>CANCELLED", "APPROVED>CANCELLED"]);
    for (const f of statuses) for (const t of statuses) expect(canTransition(f, t)).toBe(ok.has(`${f}>${t}`));
  });
  it("LOCKED dan CANCELLED final; status tak dikenal tidak punya transisi", () => {
    expect(allowedTransitions("LOCKED")).toEqual([]);
    expect(allowedTransitions("CANCELLED")).toEqual([]);
    expect(allowedTransitions("NGAWUR")).toEqual([]);
  });
  it("additional hanya pada GENERATED dan APPROVED", () => {
    expect(["DRAFT", "GENERATED", "APPROVED", "LOCKED", "CANCELLED"].filter(canGenerateAdditional)).toEqual(["GENERATED", "APPROVED"]);
  });
  it("konfirmasi untuk LOCKED dan CANCELLED saja", () => {
    expect(["APPROVED", "GENERATED", "LOCKED", "CANCELLED"].filter(needsConfirmation)).toEqual(["LOCKED", "CANCELLED"]);
  });
});
