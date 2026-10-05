/**
 * Helper grid availability tutor (hari x nomor sesi). Murni: tanpa Supabase/React/Next.
 * Availability adalah HARD CONSTRAINT penjadwalan; sel yang tidak ada dianggap TIDAK tersedia.
 */

export type AvailabilityCell = { day: number; slotNo: number; available: boolean };

/** Bentuk yang diterima fungsi database set_tutor_availability(). */
export type AvailabilityPayloadCell = { day: number; slot_no: number; available: boolean };

const KEY_PATTERN = /^([1-7])-([1-9]\d?)$/;

export function cellKey(day: number, slotNo: number): string {
  return `${day}-${slotNo}`;
}

/** "3-5" -> {day: 3, slotNo: 5}; null bila bukan kunci sel yang valid (hari 1..7, sesi 1..99). */
export function parseCellKey(key: string): { day: number; slotNo: number } | null {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  return { day: Number(match[1]), slotNo: Number(match[2]) };
}

/**
 * Susun payload penuh dari sel yang DICENTANG di form. Setiap kombinasi hari x sesi pada grid
 * dikirim (tercentang = available, selain itu = tidak), sehingga hasil simpan selalu lengkap.
 * Kunci di luar grid ditolak (null), bukan diabaikan diam-diam.
 */
export function buildAvailabilityPayload(
  checkedKeys: readonly string[],
  days: readonly number[],
  slotNos: readonly number[],
): AvailabilityPayloadCell[] | null {
  const checked = new Set<string>();
  for (const key of checkedKeys) {
    const parsed = parseCellKey(key);
    if (!parsed) return null;
    if (!days.includes(parsed.day) || !slotNos.includes(parsed.slotNo)) return null;
    checked.add(key);
  }
  const payload: AvailabilityPayloadCell[] = [];
  for (const day of days) {
    for (const slotNo of slotNos) {
      payload.push({ day, slot_no: slotNo, available: checked.has(cellKey(day, slotNo)) });
    }
  }
  return payload;
}

/** Peta kunci sel -> available, dari baris yang tersimpan. */
export function toAvailabilityMap(cells: readonly AvailabilityCell[]): Map<string, boolean> {
  return new Map(cells.map((c) => [cellKey(c.day, c.slotNo), c.available]));
}

export type AvailabilitySummary = {
  /** Jumlah sel pada grid saat ini (hari aktif x slot aktif). */
  total: number;
  available: number;
  /** Sel pada grid yang belum pernah disimpan (mis. slot baru ditambahkan setelah tutor mengisi). */
  unfilled: number;
};

export function summarizeAvailability(
  cells: readonly AvailabilityCell[],
  days: readonly number[],
  slotNos: readonly number[],
): AvailabilitySummary {
  const map = toAvailabilityMap(cells);
  let available = 0;
  let unfilled = 0;
  for (const day of days) {
    for (const slotNo of slotNos) {
      const value = map.get(cellKey(day, slotNo));
      if (value === undefined) unfilled += 1;
      else if (value) available += 1;
    }
  }
  return { total: days.length * slotNos.length, available, unfilled };
}

export type AvailabilityStatus = "belum_diisi" | "perlu_dilengkapi" | "lengkap";

/**
 * Status untuk daftar admin:
 *  - belum_diisi: tutor belum pernah menyimpan availability (availability_updated_at kosong)
 *  - perlu_dilengkapi: pernah menyimpan, tetapi ada sel grid saat ini yang belum terisi
 *  - lengkap: semua sel grid saat ini sudah terisi (tersedia atau tidak)
 */
export function availabilityStatus(
  updatedAt: string | null,
  summary: AvailabilitySummary,
): AvailabilityStatus {
  if (updatedAt === null) return "belum_diisi";
  return summary.unfilled > 0 ? "perlu_dilengkapi" : "lengkap";
}

export const AVAILABILITY_STATUS_LABEL: Readonly<Record<AvailabilityStatus, string>> = {
  belum_diisi: "Belum diisi",
  perlu_dilengkapi: "Perlu dilengkapi",
  lengkap: "Lengkap",
};
