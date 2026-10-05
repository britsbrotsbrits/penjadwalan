/**
 * Helper tanggal kalender (YYYY-MM-DD) untuk rombel. Murni, tanpa zona waktu:
 * tanggal diperlakukan sebagai teks kalender, bukan momen waktu.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True hanya untuk tanggal kalender yang benar-benar ada (2026-02-30 ditolak). */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** Format YYYY-MM-DD bisa dibandingkan sebagai teks. Negatif: a lebih awal, 0: sama. */
export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

/** "2026-03-05" -> "5 Mar 2026". Nilai tidak valid dikembalikan apa adanya. */
export function formatIsoDate(value: string): string {
  if (!isValidIsoDate(value)) return value;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Rentang tanggal rombel untuk tampilan. Keduanya kosong menghasilkan "-". */
export function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "-";
  if (start && end) return `${formatIsoDate(start)} - ${formatIsoDate(end)}`;
  if (start) return `Mulai ${formatIsoDate(start)}`;
  return `Sampai ${formatIsoDate(end as string)}`;
}
