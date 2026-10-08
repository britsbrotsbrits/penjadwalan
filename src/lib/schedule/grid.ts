import { dayName } from "../master-data/time";
import { addDays } from "../validation/dates";

/**
 * Tabel jadwal mingguan (baris = sesi, kolom = hari) untuk satu mentor atau satu rombel. Murni.
 * Sel: ada sesi, "free" (mentor tersedia tetapi belum ada kelas, ditandai √), kosong, atau di luar periode.
 */

export type GridSlot = { slotNo: number; label: string };

export type GridEntry = { date: string; slotNo: number; lines: readonly string[] };

export type GridCell =
  | { kind: "session"; lines: string[] }
  | { kind: "free" }
  | { kind: "empty" }
  | { kind: "outside" };

export type WeekGrid = {
  title: string;
  subtitle: string;
  columns: Array<{ day: number; name: string; date: string }>;
  rows: Array<{ slotNo: number; label: string; cells: GridCell[] }>;
};

export const cellKey = (day: number, slotNo: number) => `${day}-${slotNo}`;

export function buildWeekGrid(input: {
  title: string;
  subtitle: string;
  /** Tanggal Senin dari minggu yang ditampilkan. */
  weekStart: string;
  days: readonly number[];
  slots: readonly GridSlot[];
  /** Sesi milik mentor/rombel ini (tanggal di luar minggu diabaikan). */
  entries: readonly GridEntry[];
  /** Sel hari-sesi saat mentor tersedia; hanya untuk tampilan mentor (tanda √). */
  availableCells?: ReadonlySet<string>;
  /** Tanggal di luar rentang ini ditampilkan sebagai "outside" (tanpa √). */
  periodStart?: string;
  periodEnd?: string;
}): WeekGrid {
  const days = [...input.days].sort((a, b) => a - b);
  const columns = days.map((day) => ({ day, name: dayName(day), date: addDays(input.weekStart, day - 1) }));
  const byCell = new Map<string, string[]>();
  for (const e of input.entries) {
    const col = columns.find((c) => c.date === e.date);
    if (!col) continue;
    const key = cellKey(col.day, e.slotNo);
    byCell.set(key, [...(byCell.get(key) ?? []), ...e.lines]);
  }
  const rows = input.slots.map((slot) => ({
    slotNo: slot.slotNo,
    label: slot.label,
    cells: columns.map((col): GridCell => {
      if ((input.periodStart && col.date < input.periodStart) || (input.periodEnd && col.date > input.periodEnd)) {
        return { kind: "outside" };
      }
      const key = cellKey(col.day, slot.slotNo);
      const lines = byCell.get(key);
      if (lines) return { kind: "session", lines };
      if (input.availableCells?.has(key)) return { kind: "free" };
      return { kind: "empty" };
    }),
  }));
  return { title: input.title, subtitle: input.subtitle, columns, rows };
}
