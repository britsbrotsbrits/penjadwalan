import type { Rng } from "./rng";
import { cellKey, type SchedContext, type ScheduleState } from "./state";
import type { Requirement } from "./types";

/**
 * Tahap 1 scheduler class-first (Phase 14): menyusun JADWAL KELAS dari pola sesi dan distribusi subtes,
 * TANPA melihat mentor. Murni: tanpa Supabase/React/Next.
 *
 * Untuk satu rombel berpola: sel yang tersedia = hari reguler x sesi SUBTEST pola (dikurangi sel yang sudah
 * terisi sesi beku). Tiap kebutuhan distribusi dipecah menjadi satuan sesi; satuan disusun bergiliran antar
 * kebutuhan supaya subtes yang sama tidak menumpuk di hari yang sama, lalu disebar merata ke sel-sel.
 * Distribusi tidak pernah dikorbankan di tahap ini: satuan yang tidak muat dilaporkan sebagai kelebihan.
 */

export type PlannedUnit = { req: Requirement; day: number; slotNo: number };

export type ClassPlan = {
  units: PlannedUnit[];
  /** Satuan yang tidak mendapat sel karena pola menyediakan sel lebih sedikit dari distribusi. */
  overflow: Array<{ req: Requirement; missing: number }>;
  /** Sel pola yang bebas tetapi tidak dipakai distribusi. */
  spareCells: number;
};

export function planRombelCells(
  ctx: SchedContext,
  state: ScheduleState,
  rombelId: string,
  reqs: readonly Requirement[],
  rng: Rng,
): ClassPlan {
  const allowed = ctx.patternCells.get(rombelId) ?? new Set<string>();
  const cells = ctx.cells.filter((c) => allowed.has(c.key) && !state.rombelAt.has(`${rombelId}|${c.key}`));

  // Satuan sesi: bergiliran antar kebutuhan (urutan kebutuhan diacak berseed agar variatif tetapi deterministik).
  const order = [...reqs].sort((a, b) => b.sessions - a.sessions || a.id.localeCompare(b.id));
  const start = order.length > 0 ? rng.int(0, order.length - 1) : 0;
  const rotated = [...order.slice(start), ...order.slice(0, start)];
  const remaining = new Map(rotated.map((r) => [r.id, r.sessions] as const));
  const sequence: Requirement[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const r of rotated) {
      const left = remaining.get(r.id) ?? 0;
      if (left <= 0) continue;
      sequence.push(r);
      remaining.set(r.id, left - 1);
      progressed = true;
    }
  }

  const placed = Math.min(sequence.length, cells.length);
  const units: PlannedUnit[] = [];
  for (let i = 0; i < placed; i++) {
    // Sebar merata: sel ke-i dari `placed` satuan di antara seluruh sel yang tersedia.
    const cell = cells[Math.floor((i * cells.length) / placed)]!;
    units.push({ req: sequence[i]!, day: cell.day, slotNo: cell.slotNo });
  }

  avoidDayClashes(ctx, units);

  const overflowCount = new Map<string, number>();
  for (const r of sequence.slice(placed)) overflowCount.set(r.id, (overflowCount.get(r.id) ?? 0) + 1);
  const overflow = rotated.filter((r) => overflowCount.has(r.id)).map((req) => ({ req, missing: overflowCount.get(req.id)! }));

  return { units, overflow, spareCells: cells.length - placed };
}

/** Dua satuan pasti berpasangan terlarang bila SEMUA kombinasi subtesnya terlarang (item fleksibel boleh memilih yang aman). */
function unitsClash(ctx: SchedContext, a: Requirement, b: Requirement): boolean {
  if (ctx.exclusions.size === 0) return false;
  return a.allowedSubtestIds.every((x) => b.allowedSubtestIds.every((y) => ctx.exclusions.has(`${x}|${y}`)));
}

/**
 * Aturan lunak: subtes berpasangan terlarang (mis. PK dengan PM) tidak sehari dalam satu rombel. Menukar sel antar satuan
 * (jumlah satuan per sel tetap, distribusi utuh) selama biaya turun: pasangan terlarang sehari dihitung berat, subtes
 * yang sama sehari dihitung ringan (sebaran antar hari).
 */
function avoidDayClashes(ctx: SchedContext, units: PlannedUnit[]): void {
  if (ctx.exclusions.size === 0 || units.length < 2) return;
  const cost = (): number => {
    let c = 0;
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        if (units[i]!.day !== units[j]!.day) continue;
        if (unitsClash(ctx, units[i]!.req, units[j]!.req)) c += 10;
        else if (units[i]!.req.id === units[j]!.req.id) c += 1;
      }
    }
    return c;
  };
  let current = cost();
  for (let pass = 0; pass < 20 && current > 0; pass++) {
    let improved = false;
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i]!;
        const b = units[j]!;
        if (a.day === b.day) continue;
        [a.day, b.day] = [b.day, a.day];
        [a.slotNo, b.slotNo] = [b.slotNo, a.slotNo];
        const next = cost();
        if (next < current) { current = next; improved = true; }
        else {
          [a.day, b.day] = [b.day, a.day];
          [a.slotNo, b.slotNo] = [b.slotNo, a.slotNo];
        }
      }
    }
    if (!improved) break;
  }
}

export { cellKey };
