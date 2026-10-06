import { requireRole } from "@/lib/auth/session";
import { buttonClass, headerCellClass, inputClass, selectClass } from "@/components/form-styles";
import { MODE_LABELS, SIMULATION_MODES, type SimulationMode } from "@/lib/simulator/generator";
import { runSimulation } from "@/lib/simulator/runner";
import type { FeasibilityIssue } from "@/lib/scheduler/feasibility";

// Simulator murni in-memory: data sintetis, tidak membaca atau menulis database produksi.
// Dijalankan lewat GET (?mode=...&seed=...) sehingga hasil bisa diulang dan dibagikan lewat URL.

const MAX_SEED = 2_147_483_647;
const SHOWN_ISSUES = 15;

function parseMode(raw: string | string[] | undefined): SimulationMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (SIMULATION_MODES as readonly string[]).includes(v ?? "") ? (v as SimulationMode) : "small";
}

function parseSeed(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= MAX_SEED ? n : 1;
}

function groupByCode(issues: readonly FeasibilityIssue[]): Map<string, FeasibilityIssue[]> {
  const map = new Map<string, FeasibilityIssue[]>();
  for (const i of issues) map.set(i.code, [...(map.get(i.code) ?? []), i]);
  return map;
}

export default async function SimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[]; seed?: string | string[] }>;
}) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const mode = parseMode(sp.mode);
  const seed = parseSeed(sp.seed);
  const run = runSimulation({ mode, seed });
  const { scenario, report, feasibility } = run;
  const grouped = groupByCode(feasibility.issues);
  const subtestCode = new Map(run.snapshot.subtests.map((s) => [s.id, s.code]));

  const stat = (label: string, value: string | number) => (
    <div className="rounded border border-current/20 p-3">
      <div className="text-xs opacity-60">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Simulator Penjadwalan</h1>
        <p className="mt-1 max-w-3xl text-sm opacity-70">
          Membuat data sintetis (bukan data produksi) lalu menghitung kebutuhan sesi dan menganalisis apakah
          jadwal lengkap mungkin dibuat. Seed yang sama selalu menghasilkan skenario yang sama. Scheduler
          sungguhan baru dibangun di Phase 9, jadi bagian &quot;hasil penjadwalan&quot; di bawah masih kosong.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded border border-current/20 p-4">
        <label className="flex flex-col gap-1 text-sm">
          Mode
          <select name="mode" defaultValue={mode} className={selectClass}>
            {SIMULATION_MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Seed (0 sampai {MAX_SEED.toLocaleString("id-ID")})
          <input name="seed" type="number" min={0} max={MAX_SEED} defaultValue={seed} className={inputClass} />
        </label>
        <button type="submit" className={buttonClass}>
          Jalankan
        </button>
      </form>

      <section aria-labelledby="h-skenario">
        <h2 id="h-skenario" className="mb-2 font-medium">
          Skenario: {MODE_LABELS[mode]} (seed {seed})
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stat("Rombel", scenario.rombels)}
          {stat("Siswa", scenario.students)}
          {stat("Tutor", scenario.tutors)}
          {stat("Ruangan", scenario.rooms)}
          {stat("Hari x sesi", `${scenario.days} x ${scenario.slotsPerDay}`)}
          {stat("Kebutuhan (item)", scenario.requirements)}
          {stat("Sesi dibutuhkan / minggu", scenario.requiredSessions)}
          {stat("Sel availability tutor", scenario.tutorCells)}
        </div>
        <ul className="mt-2 list-disc pl-5 text-xs opacity-70">
          {run.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="h-kelayakan">
        <h2 id="h-kelayakan" className="mb-2 font-medium">
          Analisis kelayakan
        </h2>
        <p className={feasibility.feasible ? "text-sm text-green-600" : "text-sm font-medium text-red-600"}>
          {feasibility.feasible
            ? "Syarat dasar terpenuhi: tidak ada penghalang yang pasti. (Ini belum menjamin jadwal ada; itu tugas scheduler.)"
            : "TIDAK LAYAK: jadwal lengkap pasti tidak mungkin. Alasannya di bawah."}
        </p>
        {[...grouped.entries()].map(([code, list]) => (
          <details key={code} className="mt-2" open={list.some((i) => i.severity === "error")}>
            <summary className="cursor-pointer text-sm">
              <span className={list[0]!.severity === "error" ? "text-red-600" : "text-amber-600"}>{code}</span> ({list.length})
            </summary>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {list.slice(0, SHOWN_ISSUES).map((i, idx) => (
                <li key={idx}>{i.message}</li>
              ))}
              {list.length > SHOWN_ISSUES ? <li className="opacity-60">... dan {list.length - SHOWN_ISSUES} lainnya</li> : null}
            </ul>
          </details>
        ))}
      </section>

      <section aria-labelledby="h-discrepancy">
        <h2 id="h-discrepancy" className="mb-2 font-medium">
          Discrepancy distribusi ({run.requirementIssues.length})
        </h2>
        {run.requirementIssues.length === 0 ? (
          <p className="text-sm opacity-70">Tidak ada.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {run.requirementIssues.slice(0, SHOWN_ISSUES).map((i) => (
              <li key={i.rombelId + i.code} className="text-amber-600">
                {i.message}
              </li>
            ))}
            {run.requirementIssues.length > SHOWN_ISSUES ? <li className="opacity-60">... dan {run.requirementIssues.length - SHOWN_ISSUES} lainnya</li> : null}
          </ul>
        )}
      </section>

      <section aria-labelledby="h-supply" className="overflow-x-auto">
        <h2 id="h-supply" className="mb-2 font-medium">
          Pasokan vs kebutuhan per subtes
        </h2>
        <table className="min-w-[32rem] text-sm">
          <thead>
            <tr className="text-left">
              <th className={headerCellClass}>Subtes</th>
              <th className={headerCellClass}>Kebutuhan sesi</th>
              <th className={headerCellClass}>Tutor kompeten</th>
              <th className={headerCellClass}>Sel tersedia</th>
            </tr>
          </thead>
          <tbody>
            {feasibility.subtestSupply.map((s) => (
              <tr key={s.subtestId} className="border-t border-current/10">
                <td className="py-1">{s.code}</td>
                <td>{s.required}</td>
                <td>{s.competentTutors}</td>
                <td className={s.required > s.supplyCells ? "text-red-600" : ""}>{s.supplyCells}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs opacity-60">
          Kebutuhan hanya menghitung item biasa; item fleksibel (mis. KMM/PPU) dihitung terpisah di analisis.
        </p>
      </section>

      <section aria-labelledby="h-room" className="overflow-x-auto">
        <h2 id="h-room" className="mb-2 font-medium">
          Kebutuhan ruangan menurut ukuran kelas
        </h2>
        <table className="min-w-[32rem] text-sm">
          <thead>
            <tr className="text-left">
              <th className={headerCellClass}>Kelas berukuran minimal</th>
              <th className={headerCellClass}>Sesi dibutuhkan</th>
              <th className={headerCellClass}>Ruangan yang muat</th>
              <th className={headerCellClass}>Slot ruangan</th>
            </tr>
          </thead>
          <tbody>
            {feasibility.roomBottlenecks.map((b) => (
              <tr key={b.minSize} className="border-t border-current/10">
                <td className="py-1">{b.minSize}</td>
                <td className={b.requiredSessions > b.roomSlots ? "text-red-600" : ""}>{b.requiredSessions}</td>
                <td>{b.roomCount}</td>
                <td>{b.roomSlots}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="h-hasil">
        <h2 id="h-hasil" className="mb-2 font-medium">
          Hasil penjadwalan
        </h2>
        {!run.schedulerAvailable ? (
          <p className="text-sm text-amber-600">
            Scheduler belum tersedia (Phase 9): tidak ada sesi yang dijadwalkan, jadi penyelesaian 0% dan semua
            kebutuhan dicatat SCHEDULER_NOT_AVAILABLE. Metrik di bawah akan terisi setelah scheduler ada.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stat("Dibutuhkan", report.required)}
          {stat("Terjadwal", report.scheduled)}
          {stat("Belum terjadwal", report.unscheduledSessions)}
          {stat("Penyelesaian", `${report.completionPercent}%`)}
          {stat("Pelanggaran", report.violations.length)}
          {stat("Tutor aktif / idle", `${report.workload.active} / ${report.workload.idle}`)}
          {stat("Beban tutor min-maks", `${report.workload.min} - ${report.workload.max}`)}
          {stat("Permintaan tutor belum terpenuhi", "belum dimodelkan")}
        </div>
      </section>
    </main>
  );
}
