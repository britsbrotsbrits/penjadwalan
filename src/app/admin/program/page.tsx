import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { createRowClass, headerCellClass, inputClass, rowClass } from "@/components/form-styles";
import { createProgramAction, updateProgramAction } from "@/server/academic/actions";
import { listPrograms } from "@/server/academic/queries";

const GRID = "grid-cols-[minmax(12rem,1fr)_6rem_5rem_auto]";

export default async function ProgramPage() {
  await requireRole(["admin"]);
  const programs = await listPrograms();

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Program</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-70">
          Program adalah tingkat paling atas (misalnya Kelas 3 SMA, Gap Year). Tiap program punya
          tipe kelas, dan tiap tipe kelas punya rombel. Program tidak dihapus, hanya dinonaktifkan.
        </p>
      </div>

      <section aria-labelledby="tambah-program" className="rounded border border-current/20 p-4">
        <h2 id="tambah-program" className="mb-3 font-medium">
          Tambah program
        </h2>
        <ActionForm
          action={createProgramAction}
          submitLabel="Tambah"
          resetOnSuccess
          className={`${createRowClass} ${GRID}`}
        >
          <input
            name="name"
            placeholder="Nama program"
            aria-label="Nama program baru"
            required
            maxLength={100}
            className={inputClass}
          />
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={9999}
            defaultValue={0}
            aria-label="Urutan program baru"
            required
            className={inputClass}
          />
          <label className="flex items-center gap-2 text-sm">
            <input name="isActive" type="checkbox" defaultChecked />
            Aktif
          </label>
        </ActionForm>
      </section>

      <section aria-label="Daftar program" className="overflow-x-auto">
        <div className="min-w-[36rem]">
          <div className={`${rowClass} ${GRID}`}>
            <span className={headerCellClass}>Nama</span>
            <span className={headerCellClass}>Urutan</span>
            <span className={headerCellClass}>Status</span>
            <span />
          </div>
          {programs.length === 0 ? (
            <p className="py-4 text-sm opacity-70">
              Belum ada program. Tambahkan di atas, atau jalankan seed awal (lihat README).
            </p>
          ) : null}
          {programs.map((program) => (
            <ActionForm
              key={program.id}
              action={updateProgramAction}
              submitLabel="Simpan"
              className={`${rowClass} ${GRID}`}
            >
              <input type="hidden" name="id" value={program.id} />
              <input
                name="name"
                defaultValue={program.name}
                aria-label={`Nama program ${program.name}`}
                required
                maxLength={100}
                className={inputClass}
              />
              <input
                name="sortOrder"
                type="number"
                min={0}
                max={9999}
                defaultValue={program.sortOrder}
                aria-label={`Urutan ${program.name}`}
                required
                className={inputClass}
              />
              <label className="flex items-center gap-2 text-sm">
                <input name="isActive" type="checkbox" defaultChecked={program.isActive} />
                Aktif
              </label>
            </ActionForm>
          ))}
        </div>
      </section>
    </main>
  );
}
