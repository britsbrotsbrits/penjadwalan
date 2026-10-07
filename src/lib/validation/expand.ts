import type { ScheduledSession } from "../scheduler/types";
import { eachDate, isoDow } from "./dates";

/** Satu pertemuan bertanggal. */
export type DatedSession = {
  sessionDate: string;
  slotNo: number;
  rombelId: string;
  subtestId: string;
  tutorId: string;
  roomId: string;
};

/** Jendela tanggal aktif rombel (tanggal mulai/selesai rombel; null = tidak dibatasi). */
export type RombelWindow = { start: string | null; end: string | null };

/**
 * Mengubah pola mingguan hasil scheduler (hari x sesi) menjadi pertemuan bertanggal pada tiap
 * tanggal periode yang jatuh di hari itu. Urutan hasil: tanggal, lalu nomor sesi, lalu rombel
 * (deterministik). Libur/tanggal merah belum dimodelkan: setiap tanggal bertemu hari yang cocok dipakai.
 * Bila rombel punya tanggal mulai/selesai, sesinya hanya dibuat di dalam jendela itu.
 */
export function expandWeeklyPattern(
  pattern: readonly ScheduledSession[],
  periodStart: string,
  periodEnd: string,
  windows?: ReadonlyMap<string, RombelWindow>,
): DatedSession[] {
  const byDay = new Map<number, ScheduledSession[]>();
  for (const s of pattern) {
    const list = byDay.get(s.day) ?? [];
    list.push(s);
    byDay.set(s.day, list);
  }
  const out: DatedSession[] = [];
  for (const date of eachDate(periodStart, periodEnd)) {
    const sessions = byDay.get(isoDow(date));
    if (!sessions) continue;
    const sorted = [...sessions].sort((a, b) => a.slotNo - b.slotNo || a.rombelId.localeCompare(b.rombelId));
    for (const s of sorted) {
      const w = windows?.get(s.rombelId);
      if (w && ((w.start !== null && date < w.start) || (w.end !== null && date > w.end))) continue;
      out.push({
        sessionDate: date,
        slotNo: s.slotNo,
        rombelId: s.rombelId,
        subtestId: s.subtestId,
        tutorId: s.tutorId,
        roomId: s.roomId,
      });
    }
  }
  return out;
}
