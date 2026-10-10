/**
 * Pola sesi harian per kelas. Murni: tanpa Supabase/React/Next.
 *
 * Pola = daftar nomor sesi dengan jenis SUBTEST (ada mentor + ruangan) atau DRILLING (latihan mandiri,
 * tanpa mentor dan ruangan). Diwariskan SEBAGAI SATU KESATUAN dari scope terdekat yang punya baris
 * (rombel > tipe kelas > program), sama seperti distribusi. Cermin fungsi database _rombel_pattern().
 * Contoh: Gap Year = 1 SUBTEST, 2 DRILLING, 3 SUBTEST. Rombel SMA = satu baris SUBTEST (sesi tetap).
 */

export type PatternScope = "program" | "class_type" | "rombel";
export type PatternKind = "SUBTEST" | "DRILLING";

export type PatternItem = {
  scopeType: PatternScope;
  scopeId: string;
  slotNo: number;
  kind: PatternKind;
};

export type PatternContext = {
  programId?: string | null;
  classTypeId?: string | null;
  rombelId?: string | null;
};

export type ResolvedPattern =
  | { status: "found"; scopeType: PatternScope; scopeId: string; items: PatternItem[]; subtestSlots: number[]; drillingSlots: number[] }
  | { status: "missing" };

export const PATTERN_KIND_LABEL: Readonly<Record<PatternKind, string>> = {
  SUBTEST: "Subtes (mentor + ruangan)",
  DRILLING: "Drilling (mandiri)",
};

export function resolvePattern(items: readonly PatternItem[], ctx: PatternContext): ResolvedPattern {
  const order: Array<[PatternScope, string | null | undefined]> = [
    ["rombel", ctx.rombelId],
    ["class_type", ctx.classTypeId],
    ["program", ctx.programId],
  ];
  for (const [scopeType, scopeId] of order) {
    if (!scopeId) continue;
    const own = items.filter((i) => i.scopeType === scopeType && i.scopeId === scopeId).sort((a, b) => a.slotNo - b.slotNo);
    if (own.length > 0) {
      return {
        status: "found",
        scopeType,
        scopeId,
        items: own,
        subtestSlots: own.filter((i) => i.kind === "SUBTEST").map((i) => i.slotNo),
        drillingSlots: own.filter((i) => i.kind === "DRILLING").map((i) => i.slotNo),
      };
    }
  }
  return { status: "missing" };
}

/** Ringkasan satu baris untuk admin, mis. "1 Subtes · 2 Drilling · 3 Subtes". */
export function describePattern(items: readonly Pick<PatternItem, "slotNo" | "kind">[]): string {
  return [...items]
    .sort((a, b) => a.slotNo - b.slotNo)
    .map((i) => `${i.slotNo} ${i.kind === "SUBTEST" ? "Subtes" : "Drilling"}`)
    .join(" · ");
}
