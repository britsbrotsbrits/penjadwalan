/**
 * Prioritas jatah sesi mentor berdasarkan level (senioritas). Murni.
 *
 * - Jatah dasar (floor)  = 20% dari jumlah sesi yang dicentang mentor, dibulatkan ke atas. Semua mentor dapat dulu.
 * - Kuota                = sesi dicentang x level / 100, dibulatkan ke atas, minimal sama dengan jatah dasar.
 * - Setelah jatah dasar, mentor level tinggi diisi sampai kuotanya; yang melewati kuota hanya bila kebutuhan kelas
 *   tidak muat (kuota lunak, distribusi kelas tidak pernah dikorbankan).
 */

export const FLOOR_RATIO = 0.2;

export type TutorQuota = { floor: number; quota: number; level: number };

export function computeQuota(checkedCells: number, level: number): TutorQuota {
  const lv = Math.min(99, Math.max(0, Math.floor(level)));
  const floor = Math.ceil(checkedCells * FLOOR_RATIO - 1e-9);
  const quota = Math.max(floor, Math.ceil((checkedCells * lv) / 100 - 1e-9));
  return { floor, quota, level: lv };
}

/**
 * Nilai memberi mentor sesi ke-(n+1). Selalu turun seiring n (cekung), dan jenjangnya terpisah:
 * jatah dasar (>= 30) > sampai kuota (10..20, makin tinggi level makin besar) > melewati kuota (<= 5, makin banyak makin kecil).
 */
export function sessionValue(q: TutorQuota, n: number, overLoadWeight = 1): number {
  if (n < q.floor) return 40 - 0.5 * n;
  if (n < q.quota) return 10 + q.level / 10 - 0.05 * n;
  return q.level / 20 - overLoadWeight * (n - q.quota + 1);
}
