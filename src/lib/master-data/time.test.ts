import { describe, expect, it } from "vitest";
import {
  dayName,
  endsSameDay,
  formatMinutes,
  normalizeTime,
  parseTime,
  slotEndTime,
  slotsOverlap,
} from "./time";

describe("parseTime", () => {
  it("membaca HH:MM dan HH:MM:00", () => {
    expect(parseTime("07:00")).toBe(420);
    expect(parseTime("07:00:00")).toBe(420);
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("23:59")).toBe(1439);
  });

  it("menolak format salah, jam/menit di luar rentang, dan detik bukan nol", () => {
    expect(parseTime("7:00")).toBeNull();
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("12:60")).toBeNull();
    expect(parseTime("12:30:15")).toBeNull();
    expect(parseTime("abc")).toBeNull();
    expect(parseTime("")).toBeNull();
  });
});

describe("formatMinutes / normalizeTime", () => {
  it("memformat menit menjadi HH:MM", () => {
    expect(formatMinutes(0)).toBe("00:00");
    expect(formatMinutes(510)).toBe("08:30");
    expect(formatMinutes(1440)).toBe("24:00");
  });

  it("membuang detik dari nilai time Postgres", () => {
    expect(normalizeTime("07:00:00")).toBe("07:00");
    expect(normalizeTime("17:30")).toBe("17:30");
  });

  it("nilai tidak valid dikembalikan apa adanya", () => {
    expect(normalizeTime("bukan jam")).toBe("bukan jam");
  });
});

describe("slotEndTime", () => {
  it("menghitung jam selesai dari default 90 menit", () => {
    expect(slotEndTime("07:00", 90)).toBe("08:30");
    expect(slotEndTime("17:30", 90)).toBe("19:00");
  });

  it("slot yang selesai tepat tengah malam masih sah", () => {
    expect(slotEndTime("22:00", 120)).toBe("24:00");
  });

  it("null bila melewati tengah malam atau input tidak valid", () => {
    expect(slotEndTime("23:00", 90)).toBeNull();
    expect(slotEndTime("xx", 90)).toBeNull();
    expect(slotEndTime("07:00", -5)).toBeNull();
    expect(slotEndTime("07:00", 1.5)).toBeNull();
  });
});

describe("endsSameDay", () => {
  it("true bila selesai paling lambat tengah malam", () => {
    expect(endsSameDay("22:00", 120)).toBe(true);
    expect(endsSameDay("07:00", 90)).toBe(true);
  });

  it("false bila melewati tengah malam atau jam salah", () => {
    expect(endsSameDay("22:00", 121)).toBe(false);
    expect(endsSameDay("nope", 30)).toBe(false);
  });
});

describe("slotsOverlap", () => {
  const a = { start: "07:00", durationMinutes: 90 };

  it("slot bersebelahan TIDAK tumpang tindih (setengah terbuka)", () => {
    expect(slotsOverlap(a, { start: "08:30", durationMinutes: 90 })).toBe(false);
    expect(slotsOverlap({ start: "08:30", durationMinutes: 90 }, a)).toBe(false);
  });

  it("slot yang beririsan tumpang tindih", () => {
    expect(slotsOverlap(a, { start: "08:00", durationMinutes: 60 })).toBe(true);
    expect(slotsOverlap(a, { start: "06:00", durationMinutes: 90 })).toBe(true);
    expect(slotsOverlap(a, { start: "07:15", durationMinutes: 15 })).toBe(true);
    expect(slotsOverlap(a, a)).toBe(true);
  });

  it("slot berjauhan tidak tumpang tindih", () => {
    expect(slotsOverlap(a, { start: "13:00", durationMinutes: 90 })).toBe(false);
  });

  it("jam tidak valid dianggap tidak tumpang tindih", () => {
    expect(slotsOverlap(a, { start: "zz", durationMinutes: 90 })).toBe(false);
  });
});

describe("dayName", () => {
  it("memetakan 1..7 ke nama hari", () => {
    expect(dayName(1)).toBe("Senin");
    expect(dayName(6)).toBe("Sabtu");
    expect(dayName(7)).toBe("Minggu");
  });

  it("fallback untuk nilai di luar 1..7", () => {
    expect(dayName(9)).toBe("Hari 9");
  });
});
