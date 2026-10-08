import { addDays, parseIsoDate, weekStart } from "../validation/dates";

/** Senin dari minggu yang dipilih; parameter tidak valid atau di luar periode jatuh ke minggu pertama periode. */
export function resolveWeek(param: string | undefined, periodStart: string, periodEnd: string): string {
  const first = weekStart(periodStart);
  const last = weekStart(periodEnd);
  if (param && parseIsoDate(param) !== null) {
    const w = weekStart(param);
    if (w >= first && w <= last) return w;
  }
  return first;
}

export function neighbourWeeks(week: string, periodStart: string, periodEnd: string): { prev: string | null; next: string | null } {
  const prev = addDays(week, -7);
  const next = addDays(week, 7);
  return { prev: prev >= weekStart(periodStart) ? prev : null, next: next <= weekStart(periodEnd) ? next : null };
}

/** "2 Nov 2026" */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function weekRangeLabel(weekMonday: string): string {
  return `${shortDate(weekMonday)} – ${shortDate(addDays(weekMonday, 6))}`;
}
