import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { headerCellClass, inputClass, rowClass } from "@/components/form-styles";
import { buildClassTypeLabels } from "@/lib/academic/labels";
import { buildConfigOverview, type OverviewEntry } from "@/lib/config/overview";
import { resolveDistribution } from "@/lib/config/distribution";
import { describeSource, resolveSetting, type Resolved, type SettingRow } from "@/lib/config/resolver";
import { saveScopeConfigAction } from "@/server/config/actions";
import { listDistributionItems, listSettings } from "@/server/config/queries";
import { listClassTypes, listPrograms, listRombels } from "@/server/academic/queries";
import { listCalendarDays, listSessionSlots, listSubtests } from "@/server/master-data/queries";

const GRID = "grid-cols-[minmax(12rem,1fr)_6rem_6rem_15rem_minmax(14rem,1.4fr)_auto]";

function ownValue(settings: readonly SettingRow[], key: "sessions_per_day" | "weekly_sessions", scopeType: "program" | "class_type" | "rombel", scopeId: string): string {
  const row = settings.find((s) => s.key === key && s.scopeType === scopeType && s.scopeId === scopeId && s.dayOfWeek === null);
  return row && typeof row.value === "number" ? String(row.value) : "";
}

function effective(r: Resolved, unit: string): string {
  if (r.status === "found") return `${r.value} ${unit} (${describeSource(r.source)})`;
  if (r.status === "invalid") return `rusak (${describeSource(r.source)})`;
  return `- ${unit} belum diatur`;
}

export default async function SesiKurikulumPage() {
  await requireRole(["admin"]);
  const [programs, classTypes, rombels, settings, items, subtests, days, slots] = await Promise.all([
    listPrograms(),
    listClassTypes(),
    listRombels(),
    listSettings(),
    listDistributionItems(),
    listSubtests(),
    listCalendarDays(),
    listSessionSlots(),
  ]);

  const overview = buildConfigOverview({
    programs,
    classTypes,
    rombels,
    settings,
    distributionItems: items,
    subtests,
    activeDayCount: days.filter((d) => d.isActive).length,
    activeSlotCount: slots.filter((s) => s.isActive).length,
  });
  const classTypeLabels = buildClassTypeLabels(programs, classTypes);
  const programOrder = new Map(programs.map((p, i) => [p.id, i]));
  const classTypeById = new Map(classTypes.map((c) => [c.id, c]));
  const activeClassTypes = classTypes
    .filter((c) => c.isActive)
    .sort((a, b) => (programOrder.get(a.programId) ?? 99) - (programOrder.get(b.programId) ?? 99) || a.sortOrder - b.sortOrder);
  const activeRombels = rombels
    .filter((r) => r.isActive && classTypeById.has(r.classTypeId))
    .sort((a, b) => (classTypeLabels.get(a.classTypeId) ?? "").localeCompare(classTypeLabels.get(b.classTypeId) ?? "") || a.name.localeCompare(b.name));

  const Row = ({
    scopeType,
    scopeId,
    label,
    perDay,
    weekly,
    info,
    entry,
    distributionHref,
  }: {
    scopeType: "program" | "class_type" | "rombel";
    scopeId: string;
    label: string;
    perDay: Resolved;
    weekly: Resolved;
    info?: string;
    entry?: OverviewEntry;
    distributionHref: string;
  }) => (
    <ActionForm action={saveScopeConfigAction} submitLabel="Simpan" className={`${rowClass} ${GRID}`}>
      <input type="hidden" name="scopeType" value={scopeType} />
      <input type="hidden" name="scopeId" value={scopeId} />
      <span className="text-sm">
        {label}
        {info ? <span className="block text-xs opacity-60">{info}</span> : null}
      </span>
      <input
        name="sessionsPerDay"
        type="number"
        min={1}
        max={99}
        inputMode="numeric"
        defaultValue={ownValue(settings, "sessions_per_day", scopeType, scopeId)}
        placeholder="ikut"
        aria-label={`Sesi per hari ${label}`}
        className={inputClass}
      />
      <input
        name="weeklySessions"
        type="number"
        min={1}
        max={999}
        inputMode="numeric"
        defaultValue={ownValue(settings, "weekly_sessions", scopeType, scopeId)}
        placeholder="ikut"
        aria-label={`Total sesi per minggu ${label}`}
        className={inputClass}
      />
      <span className="text-xs">
        {effective(perDay, "sesi/hari")}
        <span className="block">{effective(weekly, "sesi/minggu")}</span>
        <Link href={distributionHref} className="underline">
          {entry?.distribution.status === "found"
            ? `Distribusi: ${entry.distribution.total} sesi (${describeScope(entry.distribution.scopeType)})`
            : "Distribusi belum ada"}
        </Link>
      </span>
      <span className="text-xs">
        {scopeType === "program" ? (
          <span className="opacity-60">Divalidasi di tipe kelas dan rombel</span>
        ) : entry && entry.issues.length > 0 ? (
          <ul className="flex flex-col gap-0.5">
            {entry.issues.map((i) => (
              <li key={i.code + i.message} className={i.severity === "error" ? "text-red-600" : "text-amber-600"}>
                {i.message}
              </li>
            ))}
          </ul>
        ) : entry ? (
          <span className="opacity-60">Tidak ada masalah</span>
        ) : null}
      </span>
    </ActionForm>
  );

  const header = (
    <div className={`${rowClass} ${GRID}`}>
      <span className={headerCellClass}>Nama</span>
      <span className={headerCellClass}>Sesi/hari</span>
      <span className={headerCellClass}>Sesi/minggu</span>
      <span className={headerCellClass}>Nilai efektif</span>
      <span className={headerCellClass}>Masalah</span>
      <span />
    </div>
  );

  return (
    <main className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Sesi &amp; Kurikulum</h1>
        <p className="mt-1 max-w-3xl text-sm opacity-70">
          Atur jumlah sesi per hari dan total sesi per minggu. Nilai paling spesifik yang diisi akan dipakai:
          rombel, lalu tipe kelas, lalu program. Kolom <strong>kosong</strong> berarti mengikuti level di atasnya.
          Nilai di sini adalah <em>default awal yang boleh Anda ubah</em>, bukan aturan tetap. Bila total sesi per minggu
          berbeda dari total distribusi subtes, sistem hanya melaporkan selisihnya; tidak ada sesi yang ditambah atau
          dikurangi otomatis. Override per hari tersedia di database tetapi belum punya layar (menyusul).
        </p>
      </div>

      <section aria-labelledby="h-program" className="overflow-x-auto">
        <h2 id="h-program" className="mb-2 font-medium">Program</h2>
        <div className="min-w-[70rem]">
          {header}
          {programs.map((p) => (
            <Row
              key={p.id}
              scopeType="program"
              scopeId={p.id}
              label={p.name}
              info={p.isActive ? undefined : "nonaktif"}
              perDay={resolveSetting(settings, "sessions_per_day", { programId: p.id })}
              weekly={resolveSetting(settings, "weekly_sessions", { programId: p.id })}
              distributionHref={`/admin/distribusi?scope=program:${p.id}`}
              entry={programEntry(items, p.id)}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="h-tipe" className="overflow-x-auto">
        <h2 id="h-tipe" className="mb-2 font-medium">Tipe kelas</h2>
        <div className="min-w-[70rem]">
          {header}
          {activeClassTypes.map((c) => {
            const entry = overview.classTypes.get(c.id)!;
            return (
              <Row
                key={c.id}
                scopeType="class_type"
                scopeId={c.id}
                label={classTypeLabels.get(c.id) ?? c.name}
                perDay={entry.sessionsPerDay}
                weekly={entry.weeklySessions}
                entry={entry}
                distributionHref={`/admin/distribusi?scope=class_type:${c.id}`}
              />
            );
          })}
        </div>
      </section>

      <section aria-labelledby="h-rombel" className="overflow-x-auto">
        <h2 id="h-rombel" className="mb-2 font-medium">Rombel aktif</h2>
        <div className="min-w-[70rem]">
          {header}
          {activeRombels.length === 0 ? <p className="py-4 text-sm opacity-70">Belum ada rombel aktif.</p> : null}
          {activeRombels.map((r) => {
            const entry = overview.rombels.get(r.id)!;
            return (
              <Row
                key={r.id}
                scopeType="rombel"
                scopeId={r.id}
                label={r.name}
                info={classTypeLabels.get(r.classTypeId)}
                perDay={entry.sessionsPerDay}
                weekly={entry.weeklySessions}
                entry={entry}
                distributionHref={`/admin/distribusi?scope=rombel:${r.id}`}
              />
            );
          })}
        </div>
      </section>
    </main>
  );
}

function describeScope(s: "program" | "class_type" | "rombel"): string {
  return s === "class_type" ? "dari tipe kelas" : s === "rombel" ? "dari rombel" : "dari program";
}

/** Program tidak divalidasi penuh (butuh tipe kelas); hanya tampilkan distribusi miliknya bila ada. */
function programEntry(items: Parameters<typeof resolveDistribution>[0], programId: string): OverviewEntry | undefined {
  const distribution = resolveDistribution(items, { programId });
  if (distribution.status === "missing") return undefined;
  return { sessionsPerDay: { status: "missing" }, weeklySessions: { status: "missing" }, distribution, issues: [] };
}
