import { describe, expect, it } from "vitest";
import { buildWeekGrid, cellKey, patternNotes } from "./grid";
import { clip, escapeXml, gridSvgSize, renderGridSvg } from "./grid-svg";

const slots = [
  { slotNo: 1, label: "09:00-10:45" },
  { slotNo: 2, label: "11:00-12:45" },
];
const base = { title: "Mentor X", subtitle: "Minggu 1", weekStart: "2026-11-02", days: [1, 2, 3], slots };

describe("buildWeekGrid", () => {
  it("kolom hari berurutan dengan tanggalnya", () => {
    const g = buildWeekGrid({ ...base, days: [3, 1, 2], entries: [] });
    expect(g.columns.map((c) => [c.day, c.name, c.date])).toEqual([
      [1, "Senin", "2026-11-02"],
      [2, "Selasa", "2026-11-03"],
      [3, "Rabu", "2026-11-04"],
    ]);
  });

  it("sesi mengisi sel yang benar; sel mentor tersedia tanpa sesi = free (√); sisanya empty", () => {
    const g = buildWeekGrid({
      ...base,
      entries: [{ date: "2026-11-03", slotNo: 2, lines: ["BINDO", "GY MAT A"] }],
      availableCells: new Set([cellKey(1, 1), cellKey(2, 2), cellKey(3, 1)]),
    });
    expect(g.rows[0]!.cells.map((c) => c.kind)).toEqual(["free", "empty", "free"]);
    expect(g.rows[1]!.cells.map((c) => c.kind)).toEqual(["empty", "session", "empty"]);
    expect(g.rows[1]!.cells[1]).toEqual({ kind: "session", lines: ["BINDO", "GY MAT A"] });
  });

  it("sesi menimpa tanda √ (tersedia tetapi sudah terpakai)", () => {
    const g = buildWeekGrid({
      ...base,
      entries: [{ date: "2026-11-02", slotNo: 1, lines: ["X"] }],
      availableCells: new Set([cellKey(1, 1)]),
    });
    expect(g.rows[0]!.cells[0]!.kind).toBe("session");
  });

  it("tanggal di luar periode = outside, tanpa √", () => {
    const g = buildWeekGrid({
      ...base,
      availableCells: new Set([cellKey(1, 1), cellKey(2, 1), cellKey(3, 1)]),
      entries: [],
      periodStart: "2026-11-03",
      periodEnd: "2026-11-03",
    });
    expect(g.rows[0]!.cells.map((c) => c.kind)).toEqual(["outside", "free", "outside"]);
  });

  it("sesi di luar minggu diabaikan; tampilan kelas tanpa availability tidak punya √", () => {
    const g = buildWeekGrid({ ...base, entries: [{ date: "2026-11-09", slotNo: 1, lines: ["X"] }] });
    expect(g.rows.flatMap((r) => r.cells).every((c) => c.kind === "empty")).toBe(true);
  });
});

describe("renderGridSvg", () => {
  const g = buildWeekGrid({
    ...base,
    title: 'A & B <"x">',
    entries: [{ date: "2026-11-02", slotNo: 1, lines: ["BINDO", "Rombel panjang sekali sekali sekali sekali", "Ruang A"] }],
    availableCells: new Set([cellKey(2, 1)]),
  });
  const svg = renderGridSvg(g);

  it("SVG valid secara dasar: tag terbuka-tutup, ukuran sesuai", () => {
    const { width, height } = gridSvgSize(g);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain(`width="${width}"`);
    expect(svg).toContain(`height="${height}"`);
  });
  it("karakter khusus di-escape dan teks panjang dipotong", () => {
    expect(svg).toContain("A &amp; B &lt;&quot;x&quot;&gt;");
    expect(svg).not.toContain("sekali sekali sekali sekali<");
    expect(svg).toContain("…");
    expect(svg).toContain("√");
  });
  it("helper", () => {
    expect(escapeXml("<&>")).toBe("&lt;&amp;&gt;");
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(clip("abc", 4)).toBe("abc");
  });
  it("baris yang punya sel tiga baris menjadi lebih tinggi", () => {
    expect(gridSvgSize(g).rowHeights[0]!).toBeGreaterThan(gridSvgSize(g).rowHeights[1]!);
  });
});

import { neighbourWeeks, resolveWeek, weekRangeLabel } from "./week";

describe("week helpers", () => {
  it("minggu dipilih, dikembalikan ke Senin; tidak valid/di luar periode = minggu pertama", () => {
    expect(resolveWeek("2026-11-12", "2026-11-02", "2026-11-29")).toBe("2026-11-09");
    expect(resolveWeek(undefined, "2026-11-04", "2026-11-29")).toBe("2026-11-02");
    expect(resolveWeek("ngawur", "2026-11-02", "2026-11-29")).toBe("2026-11-02");
    expect(resolveWeek("2027-03-01", "2026-11-02", "2026-11-29")).toBe("2026-11-02");
  });
  it("minggu sebelum/sesudah dibatasi periode", () => {
    expect(neighbourWeeks("2026-11-02", "2026-11-02", "2026-11-29")).toEqual({ prev: null, next: "2026-11-09" });
    expect(neighbourWeeks("2026-11-23", "2026-11-02", "2026-11-29")).toEqual({ prev: "2026-11-16", next: null });
  });
  it("label rentang", () => {
    expect(weekRangeLabel("2026-11-02")).toBe("2 Nov 2026 – 8 Nov 2026");
  });
});

describe("catatan DRILLING / TRYOUT", () => {
  it("patternNotes: DRILLING di hari belajar, TRYOUT di semua sesi pola pada hari tryout", () => {
    const n = patternNotes({ regularDays: [1, 2], tryoutDay: 6, subtestSlots: [1, 3], drillingSlots: [2] });
    expect(n.get(cellKey(1, 2))).toBe("DRILLING");
    expect(n.get(cellKey(2, 2))).toBe("DRILLING");
    expect(n.get(cellKey(1, 1))).toBeUndefined();
    expect([1, 2, 3].map((s) => n.get(cellKey(6, s)))).toEqual(["TRYOUT", "TRYOUT", "TRYOUT"]);
    expect(patternNotes({ regularDays: [1], tryoutDay: null, subtestSlots: [4], drillingSlots: [] }).size).toBe(0);
  });
  it("sel catatan tampil sebagai note; sesi nyata dan outside menang atas catatan", () => {
    const notes = new Map([[cellKey(1, 1), "DRILLING"], [cellKey(2, 1), "DRILLING"], [cellKey(3, 1), "DRILLING"]]);
    const g = buildWeekGrid({
      ...base,
      entries: [{ date: "2026-11-03", slotNo: 1, lines: ["PK/PM", "Ajeng"] }],
      notes,
      periodStart: "2026-11-02",
      periodEnd: "2026-11-03",
    });
    expect(g.rows[0]!.cells[0]).toEqual({ kind: "note", text: "DRILLING" });
    expect(g.rows[0]!.cells[1]!.kind).toBe("session");
    expect(g.rows[0]!.cells[2]!.kind).toBe("outside");
  });
  it("SVG memuat tulisan DRILLING dan label fleksibel PK/PM", () => {
    const g = buildWeekGrid({
      ...base,
      entries: [{ date: "2026-11-02", slotNo: 2, lines: ["PK/PM", "Ajeng", "R1"] }],
      notes: new Map([[cellKey(1, 1), "DRILLING"]]),
    });
    const svg = renderGridSvg(g);
    expect(svg).toContain(">DRILLING<");
    expect(svg).toContain(">PK/PM<");
  });
});
