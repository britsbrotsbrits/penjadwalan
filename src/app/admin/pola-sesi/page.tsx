import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { selectClass } from "@/components/form-styles";
import { buildClassTypeLabels } from "@/lib/academic/labels";
import { describePattern, type PatternItem } from "@/lib/config/pattern";
import { patternFormDefaults } from "@/lib/config/pattern-form";
import { savePatternAction } from "@/server/config/actions";
import { listSessionPatterns } from "@/server/config/queries";
import { listClassTypes, listPrograms } from "@/server/academic/queries";
import { listSessionSlots } from "@/server/master-data/queries";

function slotLabel(slotNo: number, start: string, end: string): string {
  return `Sesi ${slotNo} (${start}-${end})`;
}

export default async function PolaSesiPage() {
  await requireRole(["admin"]);
  const [programs, classTypes, patterns, slots] = await Promise.all([
    listPrograms(),
    listClassTypes(),
    listSessionPatterns(),
    listSessionSlots(),
  ]);
  const activeSlots = slots.filter((s) => s.isActive);
  const classTypeLabels = buildClassTypeLabels(programs, classTypes);
  const programOrder = new Map(programs.map((p, i) => [p.id, i]));

  const own = (scopeType: PatternItem["scopeType"], scopeId: string) =>
    patterns.filter((p) => p.scopeType === scopeType && p.scopeId === scopeId);

  const PatternForm = ({ scopeType, scopeId, label }: { scopeType: "program" | "class_type"; scopeId: string; label: string }) => {
    const defaults = patternFormDefaults(own(scopeType, scopeId));
    return (
      <ActionForm action={savePatternAction} submitLabel="Simpan pola" className="flex flex-col gap-3 rounded border border-current/20 p-4">
        <input type="hidden" name="scopeType" value={scopeType} />
        <input type="hidden" name="scopeId" value={scopeId} />
        <div>
          <h3 className="font-medium">{label}</h3>
          <p className="text-xs opacity-70">
            {own(scopeType, scopeId).length > 0 ? `Pola sekarang: ${describePattern(own(scopeType, scopeId))}` : "Belum ada pola sendiri (mengikuti induknya, atau jadwal bebas)."}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {activeSlots.map((slot) => (
            <label key={slot.slotNo} className="flex min-w-40 flex-col gap-1 text-xs">
              {slotLabel(slot.slotNo, slot.startTime, slot.endTime)}
              <select name={`slot_${slot.slotNo}`} defaultValue={defaults.get(slot.slotNo) ?? ""} className={selectClass}>
                <option value="">(tidak dipakai)</option>
                <option value="SUBTEST">Subtes (mentor + ruangan)</option>
                <option value="DRILLING">Drilling (mandiri)</option>
              </select>
            </label>
          ))}
        </div>
      </ActionForm>
    );
  };

  const activeClassTypes = classTypes
    .filter((c) => c.isActive)
    .sort((a, b) => (programOrder.get(a.programId) ?? 99) - (programOrder.get(b.programId) ?? 99) || a.sortOrder - b.sortOrder);

  return (
    <main className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Pola Sesi</h1>
        <p className="mt-1 max-w-3xl text-sm opacity-70">
          Menentukan sesi mana yang dipakai kelas tiap hari. <strong>Subtes</strong> = ada mentor dan ruangan.{" "}
          <strong>Drilling</strong> = latihan mandiri, tidak ada mentor/ruangan, tampil sebagai DRILLING di jadwal.
          Contoh Gap Year: Sesi 1 Subtes, Sesi 2 Drilling, Sesi 3 Subtes. Pola diwariskan dari program ke tipe kelas
          (yang paling dekat dipakai). Sesi tetap per rombel (kelas 3 SMA Sesi 4 atau 5, hari khusus, siklus mingguan)
          diatur di menu Rombel dan mengalahkan pola di sini. Rombel tanpa pola dijadwalkan seperti sebelumnya.
        </p>
        {activeSlots.length === 0 ? <p className="mt-2 text-sm text-red-600">Belum ada sesi aktif. Atur di menu Kalender.</p> : null}
      </div>

      <section aria-label="Pola per program dan tipe kelas" className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Program dan tipe kelas</h2>
        {programs.filter((p) => p.isActive).map((p) => (
          <PatternForm key={p.id} scopeType="program" scopeId={p.id} label={`Program: ${p.name}`} />
        ))}
        {activeClassTypes.map((c) => (
          <PatternForm key={c.id} scopeType="class_type" scopeId={c.id} label={`Tipe kelas: ${classTypeLabels.get(c.id) ?? c.name}`} />
        ))}
      </section>

    </main>
  );
}
