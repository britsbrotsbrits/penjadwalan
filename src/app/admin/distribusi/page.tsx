import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { headerCellClass, inputClass, rowClass, selectClass } from "@/components/form-styles";
import { buildClassTypeLabels } from "@/lib/academic/labels";
import {
  resolveDistribution,
  type DistributionItem,
  type DistributionScope,
} from "@/lib/config/distribution";
import { describeSource, resolveSetting } from "@/lib/config/resolver";
import { FLEX_VALUE, MAX_DISTRIBUTION_ROWS } from "@/lib/config/schemas";
import { validateAcademicConfig } from "@/lib/config/validation";
import { idSchema } from "@/lib/master-data/schemas";
import { clearDistributionAction, saveDistributionAction } from "@/server/config/actions";
import { listDistributionItems, listSettings } from "@/server/config/queries";
import { listClassTypes, listPrograms, listRombels } from "@/server/academic/queries";
import { listCalendarDays, listSessionSlots, listSubtests } from "@/server/master-data/queries";

const SCOPE_LABEL: Record<DistributionScope, string> = {
  program: "Program",
  class_type: "Tipe kelas",
  rombel: "Rombel",
};
const EXTRA_BLANK_ROWS = 4;
const ROW_GRID = "grid-cols-[14rem_6rem_12rem_minmax(12rem,1fr)]";

function parseScope(raw: string | undefined): { type: DistributionScope; id: string } | null {
  if (!raw) return null;
  const [type, id] = raw.split(":");
  if (type !== "program" && type !== "class_type" && type !== "rombel") return null;
  return idSchema.safeParse(id).success ? { type, id: id! } : null;
}

export default async function DistribusiPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const requested = parseScope(Array.isArray(sp.scope) ? sp.scope[0] : sp.scope);

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

  const classTypeLabels = buildClassTypeLabels(programs, classTypes);
  const classTypeById = new Map(classTypes.map((c) => [c.id, c]));
  const subtestById = new Map(subtests.map((s) => [s.id, s]));
  const hasOwn = (type: DistributionScope, id: string) => items.some((i) => i.scopeType === type && i.scopeId === id);

  const entries: Array<{ type: DistributionScope; id: string; label: string }> = [
    ...programs.map((p) => ({ type: "program" as const, id: p.id, label: p.name })),
    ...classTypes.filter((c) => c.isActive).map((c) => ({ type: "class_type" as const, id: c.id, label: classTypeLabels.get(c.id) ?? c.name })),
    ...rombels
      .filter((r) => r.isActive && classTypeById.has(r.classTypeId))
      .map((r) => ({ type: "rombel" as const, id: r.id, label: `${classTypeLabels.get(r.classTypeId) ?? "?"} / ${r.name}` })),
  ];
  const selected = requested ? entries.find((e) => e.type === requested.type && e.id === requested.id) ?? null : null;

  // Konteks hierarki untuk scope terpilih.
  let ctx: { programId: string | null; classTypeId: string | null; rombelId: string | null } | null = null;
  if (selected) {
    if (selected.type === "program") ctx = { programId: selected.id, classTypeId: null, rombelId: null };
    else if (selected.type === "class_type") ctx = { programId: classTypeById.get(selected.id)?.programId ?? null, classTypeId: selected.id, rombelId: null };
    else {
      const r = rombels.find((x) => x.id === selected.id);
      const c = r ? classTypeById.get(r.classTypeId) : undefined;
      ctx = { programId: c?.programId ?? null, classTypeId: c?.id ?? null, rombelId: selected.id };
    }
  }

  const own = selected ? items.filter((i) => i.scopeType === selected.type && i.scopeId === selected.id).sort((a, b) => a.sortOrder - b.sortOrder) : [];
  const effective = ctx ? resolveDistribution(items, ctx) : ({ status: "missing" } as const);
  const inherited = selected && own.length === 0 && effective.status === "found";
  // Titik awal editor: item milik scope ini; bila belum ada, salin dari warisan (belum tersimpan sampai Simpan).
  const seed: DistributionItem[] = own.length > 0 ? own : effective.status === "found" ? effective.items : [];
  const rowCount = Math.min(MAX_DISTRIBUTION_ROWS, seed.length + EXTRA_BLANK_ROWS);

  const weekly = ctx ? resolveSetting(settings, "weekly_sessions", ctx) : ({ status: "missing" } as const);
  const perDay = ctx ? resolveSetting(settings, "sessions_per_day", ctx) : ({ status: "missing" } as const);
  const issues =
    ctx && selected
      ? validateAcademicConfig({
          sessionsPerDay: perDay,
          weeklySessions: weekly,
          distribution: effective,
          subtests,
          activeDayCount: days.filter((d) => d.isActive).length,
          activeSlotCount: slots.filter((s) => s.isActive).length,
        }).filter((i) => selected.type !== "program" || i.code.startsWith("DISTRIBUTION_"))
      : [];

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Distribusi Subtes</h1>
        <p className="mt-1 max-w-3xl text-sm opacity-70">
          Distribusi subtes per minggu bisa diatur di level program, tipe kelas, atau rombel. Level yang lebih
          spesifik <strong>menggantikan seluruh</strong> distribusi di atasnya (tidak digabung). Item fleksibel
          (mis. KMM/PPU Flexible) bukan subtes baru: satu slot yang boleh diisi salah satu subtes yang Anda pilih.
          Angka di sini baseline yang boleh diubah. Program tanpa distribusi hanya diberi peringatan.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <nav aria-label="Pilih level" className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto text-sm">
          {(["program", "class_type", "rombel"] as const).map((type) => (
            <div key={type} className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide opacity-50">{SCOPE_LABEL[type]}</span>
              {entries
                .filter((e) => e.type === type)
                .map((e) => {
                  const active = selected?.type === e.type && selected.id === e.id;
                  return (
                    <Link
                      key={e.id}
                      href={`/admin/distribusi?scope=${e.type}:${e.id}`}
                      aria-current={active ? "page" : undefined}
                      className={active ? "font-semibold underline" : "opacity-80 hover:underline"}
                    >
                      {e.label}
                      {hasOwn(e.type, e.id) ? " (ada)" : ""}
                    </Link>
                  );
                })}
            </div>
          ))}
        </nav>

        {!selected || !ctx ? (
          <p className="text-sm opacity-70">
            {requested ? "Level yang dipilih tidak ditemukan atau sudah nonaktif. " : ""}Pilih program, tipe kelas, atau rombel di kiri.
          </p>
        ) : (
          <section aria-label={`Distribusi ${selected.label}`} className="flex flex-col gap-4">
            <h2 className="text-lg font-medium">
              {SCOPE_LABEL[selected.type]}: {selected.label}
            </h2>

            <div className="rounded border border-current/20 p-3 text-sm">
              {effective.status === "found" ? (
                <p>
                  Distribusi efektif: <strong>{effective.total} sesi/minggu</strong>, berasal dari{" "}
                  <strong>{SCOPE_LABEL[effective.scopeType].toLowerCase()}</strong>.
                </p>
              ) : (
                <p>Distribusi belum ada di level ini maupun di atasnya.</p>
              )}
              <p className="mt-1">
                Total sesi per minggu:{" "}
                {weekly.status === "found" ? `${weekly.value} (${describeSource(weekly.source)})` : "belum diatur"}
              </p>
              {issues.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-0.5">
                  {issues.map((i) => (
                    <li key={i.code + i.message} className={i.severity === "error" ? "text-red-600" : "text-amber-600"}>
                      {i.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {inherited ? (
              <p className="text-sm text-amber-600">
                Level ini belum punya distribusi sendiri. Isian di bawah disalin dari level di atasnya dan BELUM
                tersimpan di sini sampai Anda menekan Simpan.
              </p>
            ) : null}

            <ActionForm
              key={`save:${selected.type}:${selected.id}`}
              action={saveDistributionAction}
              submitLabel="Simpan distribusi"
              className="flex flex-col gap-3"
            >
              <input type="hidden" name="scopeType" value={selected.type} />
              <input type="hidden" name="scopeId" value={selected.id} />
              <input type="hidden" name="rowCount" value={rowCount} />
              <div className={`${rowClass} ${ROW_GRID}`}>
                <span className={headerCellClass}>Subtes / item fleksibel</span>
                <span className={headerCellClass}>Sesi/minggu</span>
                <span className={headerCellClass}>Nama item fleksibel</span>
                <span className={headerCellClass}>Subtes yang boleh mengisi (fleksibel)</span>
              </div>
              {Array.from({ length: rowCount }, (_, i) => {
                const item = seed[i];
                const subtestValue = item ? (item.subtestId ?? FLEX_VALUE) : "";
                return (
                  <div key={`${selected.type}:${selected.id}:${i}`} className={`${rowClass} ${ROW_GRID}`}>
                    <select
                      name={`subtest_${i}`}
                      defaultValue={subtestValue}
                      aria-label={`Baris ${i + 1}: subtes`}
                      className={selectClass}
                    >
                      <option value="">(kosong)</option>
                      {subtests.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} - {s.name}
                          {s.isActive ? "" : " (nonaktif)"}
                        </option>
                      ))}
                      <option value={FLEX_VALUE}>Item fleksibel...</option>
                    </select>
                    <input
                      name={`sessions_${i}`}
                      type="number"
                      min={1}
                      max={99}
                      inputMode="numeric"
                      defaultValue={item ? item.sessionsPerWeek : ""}
                      aria-label={`Baris ${i + 1}: sesi per minggu`}
                      className={inputClass}
                    />
                    <input
                      name={`label_${i}`}
                      defaultValue={item?.label ?? ""}
                      maxLength={100}
                      placeholder="mis. KMM/PPU Flexible"
                      aria-label={`Baris ${i + 1}: nama item fleksibel`}
                      className={inputClass}
                    />
                    <select
                      name={`flex_${i}`}
                      multiple
                      size={Math.min(4, Math.max(2, subtests.length))}
                      defaultValue={item?.flexibleSubtestIds ? [...item.flexibleSubtestIds] : []}
                      aria-label={`Baris ${i + 1}: subtes yang boleh mengisi`}
                      className={selectClass}
                    >
                      {subtests.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
              <p className="text-xs opacity-60">
                Nama dan pilihan subtes di kolom kanan hanya dipakai bila baris dipilih &quot;Item fleksibel...&quot;
                (tahan Ctrl/Cmd untuk memilih lebih dari satu). Baris kosong diabaikan. Menyimpan mengganti seluruh
                distribusi di level ini.
              </p>
            </ActionForm>

            {own.length > 0 ? (
              <ActionForm
                key={`clear:${selected.type}:${selected.id}`}
                action={clearDistributionAction}
                submitLabel="Hapus distribusi level ini"
                className="flex flex-col gap-1"
              >
                <input type="hidden" name="scopeType" value={selected.type} />
                <input type="hidden" name="scopeId" value={selected.id} />
                <p className="text-xs opacity-60">Setelah dihapus, level ini mewarisi distribusi dari level di atasnya (bila ada).</p>
              </ActionForm>
            ) : null}

            {effective.status === "found" ? (
              <div>
                <h3 className="mb-1 text-sm font-medium">Distribusi efektif saat ini</h3>
                <ul className="text-sm">
                  {effective.items.map((i, idx) => (
                    <li key={idx}>
                      {i.subtestId
                        ? (subtestById.get(i.subtestId)?.code ?? "?")
                        : `${i.label} (${i.flexibleSubtestIds.map((id) => subtestById.get(id)?.code ?? "?").join(" atau ")})`}
                      : {i.sessionsPerWeek}
                    </li>
                  ))}
                  <li className="font-medium">Total: {effective.total}</li>
                </ul>
              </div>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
