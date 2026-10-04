/**
 * Helper waktu untuk slot sesi. Murni: tanpa Supabase/React/Next.
 * Waktu direpresentasikan sebagai string "HH:MM" atau menit sejak tengah malam.
 */

export const MINUTES_PER_DAY = 24 * 60;

// "HH:MM" atau "HH:MM:00" (format `time` dari Postgres). Detik selain 00 ditolak
// karena DB juga menolaknya (session_slots_start_whole_minute).
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/;

/** Menit sejak tengah malam, atau null bila format salah. */
export function parseTime(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Menit -> "HH:MM". 1440 menjadi "24:00" (slot yang selesai tepat tengah malam). */
export function formatMinutes(totalMinutes: number): string {
  return `${pad2(Math.floor(totalMinutes / 60))}:${pad2(totalMinutes % 60)}`;
}

/** "07:00:00" -> "07:00". Nilai yang tidak dikenal dikembalikan apa adanya. */
export function normalizeTime(value: string): string {
  const minutes = parseTime(value);
  return minutes === null ? value : formatMinutes(minutes);
}

/** True bila slot (mulai + durasi) selesai paling lambat tengah malam. */
export function endsSameDay(start: string, durationMinutes: number): boolean {
  const startMinutes = parseTime(start);
  return startMinutes !== null && startMinutes + durationMinutes <= MINUTES_PER_DAY;
}

/** Jam selesai "HH:MM" = mulai + durasi, atau null bila input tidak valid / lewat tengah malam. */
export function slotEndTime(start: string, durationMinutes: number): string | null {
  const startMinutes = parseTime(start);
  if (startMinutes === null || !Number.isInteger(durationMinutes) || durationMinutes < 0) {
    return null;
  }
  const end = startMinutes + durationMinutes;
  return end > MINUTES_PER_DAY ? null : formatMinutes(end);
}

export type SlotRange = { start: string; durationMinutes: number };

/**
 * Apakah dua slot tumpang tindih. Rentang setengah terbuka [mulai, selesai):
 * 07:00-08:30 dan 08:30-10:00 TIDAK tumpang tindih. Sama dengan constraint di database.
 */
export function slotsOverlap(a: SlotRange, b: SlotRange): boolean {
  const aStart = parseTime(a.start);
  const bStart = parseTime(b.start);
  if (aStart === null || bStart === null) return false;
  return aStart < bStart + b.durationMinutes && bStart < aStart + a.durationMinutes;
}

/** Nama hari ISO: 1 = Senin ... 7 = Minggu. */
export const DAY_NAMES: Readonly<Record<number, string>> = {
  1: "Senin",
  2: "Selasa",
  3: "Rabu",
  4: "Kamis",
  5: "Jumat",
  6: "Sabtu",
  7: "Minggu",
};

export function dayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? `Hari ${dayOfWeek}`;
}
