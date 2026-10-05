import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import {
  createRowClass,
  headerCellClass,
  inputClass,
  rowClass,
  selectClass,
} from "@/components/form-styles";
import { buildClassTypeLabels, sizeStatus } from "@/lib/academic/labels";
import { createRombelAction, updateRombelAction } from "@/server/academic/actions";
import {
  listClassTypes,
  listPrograms,
  listRombelCounts,
  listRombels,
} from "@/server/academic/queries";

const GRID = "grid-cols-[13rem_minmax(9rem,1fr)_9rem_9rem_12rem_5rem_auto]";

const levelClass = {
  ok: "opacity-70",
  full: "text-amber-600",
  over: "font-medium text-red-600",
} as const;

export default async function RombelPage() {
  await requireRole(["admin"]);
  const [programs, classTypes, rombels, counts] = await Promise.all([
    listPrograms(),
    listClassTypes(),
    listRombels(),
    listRombelCounts(),
  ]);

  const classTypeLabels = buildClassTypeLabels(programs, classTypes);
  const classTypeById = new Map(classTypes.map((c) => [c.id, c]));
  const countByRombel = new Map(counts.map((c) => [c.rombelId, c]));
  const programOrder = new Map(programs.map((p, i) => [p.id, i]));
  const activeClassTypes = classTypes.filter((c) => c.isActive);

  const sorted = [...rombels].sort((a, b) => {
    const ca = classTypeById.get(a.classTypeId);
    const cb = classTypeById.get(b.classTypeId);
    const pa = ca ? (programOrder.get(ca.programId) ?? 999) : 999;
    const pb = cb ? (programOrder.get(cb.programId) ?? 999) : 999;
    return (
      pa - pb ||
      (ca?.sortOrder ?? 0) - (cb?.sortOrder ?? 0) ||
      a.classTypeId.localeCompare(b.classTypeId) ||
      a.name.localeCompare(b.name)
    );
  });

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Rombel</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-70">
          Rombel (rombongan belajar) adalah kelas nyata, misalnya Junior A, yang dibuat dari sebuah
          tipe kelas. Tipe kelas sebuah rombel tidak bisa diubah setelah dibuat. Jumlah siswa
          dibandingkan dengan ukuran standar tipe kelasnya; melebihi ukuran hanya peringatan.
          Rombel tidak dihapus, hanya dinonaktifkan, dan siswa baru tidak bisa dimasukkan ke rombel
          nonaktif.
        </p>
      </div>

      <section aria-labelledby="tambah-rombel" className="rounded border border-current/20 p-4">
        <h2 id="tambah-rombel" className="mb-3 font-medium">
          Tambah rombel
        </h2>
        {activeClassTypes.length === 0 ? (
          <p className="text-sm opacity-70">Belum ada tipe kelas aktif. Tambahkan tipe kelas dulu.</p>
        ) : (
          <ActionForm
            action={createRombelAction}
            submitLabel="Tambah"
            resetOnSuccess
            className={`${createRowClass} grid-cols-[16rem_minmax(9rem,1fr)_9rem_9rem_5rem_auto]`}
          >
            <select
              name="classTypeId"
              aria-label="Tipe kelas"
              required
              className={selectClass}
              defaultValue=""
            >
              <option value="" disabled>
                Pilih tipe kelas
              </option>
              {activeClassTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {classTypeLabels.get(c.id)}
                </option>
              ))}
            </select>
            <input
              name="name"
              placeholder="Nama rombel"
              aria-label="Nama rombel baru"
              required
              maxLength={100}
              className={inputClass}
            />
            <input name="startDate" type="date" aria-label="Tanggal mulai baru" className={inputClass} />
            <input name="endDate" type="date" aria-label="Tanggal selesai baru" className={inputClass} />
            <label className="flex items-center gap-2 text-sm">
              <input name="isActive" type="checkbox" defaultChecked />
              Aktif
            </label>
          </ActionForm>
        )}
      </section>

      <section aria-label="Daftar rombel" className="overflow-x-auto">
        <div className="min-w-[70rem]">
          <div className={`${rowClass} ${GRID}`}>
            <span className={headerCellClass}>Tipe kelas</span>
            <span className={headerCellClass}>Nama</span>
            <span className={headerCellClass}>Mulai</span>
            <span className={headerCellClass}>Selesai</span>
            <span className={headerCellClass}>Siswa aktif</span>
            <span className={headerCellClass}>Status</span>
            <span />
          </div>
          {sorted.length === 0 ? (
            <p className="py-4 text-sm opacity-70">Belum ada rombel. Tambahkan di atas.</p>
          ) : null}
          {sorted.map((rombel) => {
            const classType = classTypeById.get(rombel.classTypeId);
            const count = countByRombel.get(rombel.id);
            const active = count?.activeStudents ?? 0;
            const status = classType ? sizeStatus(active, classType.defaultSize) : null;
            return (
              <ActionForm
                key={rombel.id}
                action={updateRombelAction}
                submitLabel="Simpan"
                className={`${rowClass} ${GRID}`}
              >
                <input type="hidden" name="id" value={rombel.id} />
                <span className="text-sm">{classTypeLabels.get(rombel.classTypeId) ?? "?"}</span>
                <input
                  name="name"
                  defaultValue={rombel.name}
                  aria-label={`Nama rombel ${rombel.name}`}
                  required
                  maxLength={100}
                  className={inputClass}
                />
                <input
                  name="startDate"
                  type="date"
                  defaultValue={rombel.startDate ?? ""}
                  aria-label={`Tanggal mulai ${rombel.name}`}
                  className={inputClass}
                />
                <input
                  name="endDate"
                  type="date"
                  defaultValue={rombel.endDate ?? ""}
                  aria-label={`Tanggal selesai ${rombel.name}`}
                  className={inputClass}
                />
                <span className="text-sm">
                  {active}
                  {classType ? ` / ${classType.defaultSize}` : ""}
                  {status ? (
                    <span className={`block text-xs ${levelClass[status.level]}`}>{status.label}</span>
                  ) : null}
                </span>
                <label className="flex items-center gap-2 text-sm">
                  <input name="isActive" type="checkbox" defaultChecked={rombel.isActive} />
                  Aktif
                </label>
              </ActionForm>
            );
          })}
        </div>
      </section>
    </main>
  );
}
