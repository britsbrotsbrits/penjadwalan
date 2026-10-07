/**
 * Aritmetika tanggal kalender murni (tanpa zona waktu). Tanggal berbentuk "YYYY-MM-DD".
 * Semua hitungan memakai UTC supaya hasilnya sama di server mana pun.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Milidetik UTC tengah malam untuk tanggal valid, atau null. Tanggal mustahil (30 Feb) ditolak. */
export function parseIsoDate(value: string): number | null {
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

export function formatIsoDate(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mustParse(value: string): number {
  const ms = parseIsoDate(value);
  if (ms === null) throw new Error(`Tanggal tidak valid: ${value}`);
  return ms;
}

/** Hari ISO: 1 = Senin ... 7 = Minggu. */
export function isoDow(date: string): number {
  const js = new Date(mustParse(date)).getUTCDay(); // 0 = Minggu
  return js === 0 ? 7 : js;
}

export function addDays(date: string, days: number): string {
  return formatIsoDate(mustParse(date) + days * DAY_MS);
}

/** Selisih hari (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((mustParse(b) - mustParse(a)) / DAY_MS);
}

/** Senin pada minggu tanggal ini. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoDow(date));
}

/** Semua tanggal dari start sampai end (inklusif). Kosong bila end < start. */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const last = mustParse(end);
  for (let ms = mustParse(start); ms <= last; ms += DAY_MS) out.push(formatIsoDate(ms));
  return out;
}
