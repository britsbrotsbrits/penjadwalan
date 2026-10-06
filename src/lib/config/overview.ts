import { resolveDistribution, type DistributionItem, type ResolvedDistribution } from "./distribution";
import { resolveSetting, type Resolved, type SettingRow } from "./resolver";
import { validateAcademicConfig, type ConfigIssue, type SubtestInfo } from "./validation";

/**
 * Ringkasan konfigurasi per tipe kelas dan per rombel aktif: nilai efektif (beserta sumbernya),
 * distribusi efektif, dan daftar masalah. Murni: dipakai halaman admin dan, kelak, validator
 * sebelum penjadwalan.
 */

export type OverviewProgram = { id: string; name: string };
export type OverviewClassType = { id: string; programId: string; name: string; isActive: boolean };
export type OverviewRombel = { id: string; classTypeId: string; name: string; isActive: boolean };

export type OverviewEntry = {
  sessionsPerDay: Resolved;
  weeklySessions: Resolved;
  distribution: ResolvedDistribution;
  issues: ConfigIssue[];
};

export type ConfigOverview = {
  classTypes: Map<string, OverviewEntry>;
  rombels: Map<string, OverviewEntry>;
};

export type OverviewInput = {
  programs: readonly OverviewProgram[];
  classTypes: readonly OverviewClassType[];
  rombels: readonly OverviewRombel[];
  settings: readonly SettingRow[];
  distributionItems: readonly DistributionItem[];
  subtests: readonly SubtestInfo[];
  activeDayCount: number;
  activeSlotCount: number;
};

export function buildConfigOverview(input: OverviewInput): ConfigOverview {
  const programIds = new Set(input.programs.map((p) => p.id));
  const classTypeById = new Map(input.classTypes.map((c) => [c.id, c]));

  const entry = (ctx: { programId: string | null; classTypeId: string; rombelId: string | null }): OverviewEntry => {
    const sessionsPerDay = resolveSetting(input.settings, "sessions_per_day", ctx);
    const weeklySessions = resolveSetting(input.settings, "weekly_sessions", ctx);
    const distribution = resolveDistribution(input.distributionItems, ctx);
    return {
      sessionsPerDay,
      weeklySessions,
      distribution,
      issues: validateAcademicConfig({
        sessionsPerDay,
        weeklySessions,
        distribution,
        subtests: input.subtests,
        activeDayCount: input.activeDayCount,
        activeSlotCount: input.activeSlotCount,
      }),
    };
  };

  const classTypes = new Map<string, OverviewEntry>();
  for (const c of input.classTypes) {
    if (!c.isActive) continue;
    classTypes.set(c.id, entry({ programId: programIds.has(c.programId) ? c.programId : null, classTypeId: c.id, rombelId: null }));
  }

  const rombels = new Map<string, OverviewEntry>();
  for (const r of input.rombels) {
    if (!r.isActive) continue;
    const c = classTypeById.get(r.classTypeId);
    if (!c) continue;
    rombels.set(r.id, entry({ programId: c.programId, classTypeId: c.id, rombelId: r.id }));
  }

  return { classTypes, rombels };
}
