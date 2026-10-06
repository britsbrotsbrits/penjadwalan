/**
 * Distribusi subtes per minggu. Murni: tanpa Supabase/React/Next.
 *
 * Distribusi diwariskan SEBAGAI SATU KESATUAN dari scope terdekat yang punya item
 * (rombel > tipe kelas > program). Item tidak digabung antar level: menggabungkan akan menghasilkan
 * total yang tidak dimaksudkan siapa pun. Item fleksibel (mis. "KMM/PPU Flexible") BUKAN subtes
 * baru; ia satu slot yang boleh diisi salah satu subtes di flexibleSubtestIds.
 */

export type DistributionScope = "program" | "class_type" | "rombel";

export type DistributionItem = {
  scopeType: DistributionScope;
  scopeId: string;
  subtestId: string | null;
  flexibleSubtestIds: readonly string[];
  label: string | null;
  sessionsPerWeek: number;
  sortOrder: number;
};

export type DistributionContext = {
  programId?: string | null;
  classTypeId?: string | null;
  rombelId?: string | null;
};

export type ResolvedDistribution =
  | {
      status: "found";
      scopeType: DistributionScope;
      scopeId: string;
      items: DistributionItem[];
      total: number;
    }
  | { status: "missing" };

export function totalSessions(items: readonly Pick<DistributionItem, "sessionsPerWeek">[]): number {
  return items.reduce((sum, i) => sum + i.sessionsPerWeek, 0);
}

export function resolveDistribution(
  items: readonly DistributionItem[],
  ctx: DistributionContext,
): ResolvedDistribution {
  const order: Array<[DistributionScope, string | null | undefined]> = [
    ["rombel", ctx.rombelId],
    ["class_type", ctx.classTypeId],
    ["program", ctx.programId],
  ];
  for (const [scopeType, scopeId] of order) {
    if (!scopeId) continue;
    const own = items
      .filter((i) => i.scopeType === scopeType && i.scopeId === scopeId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (own.length > 0) return { status: "found", scopeType, scopeId, items: own, total: totalSessions(own) };
  }
  return { status: "missing" };
}
