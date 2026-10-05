import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import {
  createRowClass,
  headerCellClass,
  inputClass,
  rowClass,
  selectClass,
} from "@/components/form-styles";
import { createClassTypeAction, updateClassTypeAction } from "@/server/academic/actions";
import { listClassTypes, listPrograms } from "@/server/academic/queries";

const GRID = "grid-cols-[12rem_minmax(10rem,1fr)_7rem_6rem_5rem_auto]";

export default async function TipeKelasPage() {
  await requireRole(["admin"]);
  const [programs, classTypes] = await Promise.all([listPrograms(), listClassTypes()]);
  const programName = new Map(programs.map((p) => [p.id, p.name]));
  const activePrograms = programs.filter((p) => p.isActive);

  // Dikelompokkan per program mengikuti urutan program.
  const sorted = [...classTypes].sort((a, b) => {
    const pa = programs.findIndex((p) => p.id === a.programId);
    const pb = programs.findIndex((p) => p.id === b.programId);
    return pa - pb || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  });

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tipe Kelas</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-70">
          Tipe kelas adalah templat di bawah program (misalnya Junior, VVIP). Ukuran standar adalah
          jumlah siswa yang lazim per rombel; ini hanya peringatan di halaman Rombel, bukan batas
          keras. Program sebuah tipe kelas tidak bisa diubah setelah dibuat.
        </p>
      </div>

      <section aria-labelledby="tambah-tipe" className="rounded border border-current/20 p-4">
        <h2 id="tambah-tipe" className="mb-3 font-medium">
          Tambah tipe kelas
        </h2>
        {activePrograms.length === 0 ? (
          <p className="text-sm opacity-70">Belum ada program aktif. Tambahkan program dulu.</p>
        ) : (
          <ActionForm
            action={createClassTypeAction}
            submitLabel="Tambah"
            resetOnSuccess
            className={`${createRowClass} ${GRID}`}
          >
            <select name="programId" aria-label="Program" required className={selectClass} defaultValue="">
              <option value="" disabled>
                Pilih program
              </option>
              {activePrograms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              name="name"
              placeholder="Nama tipe kelas"
              aria-label="Nama tipe kelas baru"
              required
              maxLength={100}
              className={inputClass}
            />
            <input
              name="defaultSize"
              type="number"
              min={1}
              max={500}
              placeholder="Ukuran"
              aria-label="Ukuran standar baru"
              required
              className={inputClass}
            />
            <input
              name="sortOrder"
              type="number"
              min={0}
              max={9999}
              defaultValue={0}
              aria-label="Urutan tipe kelas baru"
              required
              className={inputClass}
            />
            <label className="flex items-center gap-2 text-sm">
              <input name="isActive" type="checkbox" defaultChecked />
              Aktif
            </label>
          </ActionForm>
        )}
      </section>

      <section aria-label="Daftar tipe kelas" className="overflow-x-auto">
        <div className="min-w-[52rem]">
          <div className={`${rowClass} ${GRID}`}>
            <span className={headerCellClass}>Program</span>
            <span className={headerCellClass}>Nama</span>
            <span className={headerCellClass}>Ukuran standar</span>
            <span className={headerCellClass}>Urutan</span>
            <span className={headerCellClass}>Status</span>
            <span />
          </div>
          {sorted.length === 0 ? (
            <p className="py-4 text-sm opacity-70">
              Belum ada tipe kelas. Tambahkan di atas, atau jalankan seed awal (lihat README).
            </p>
          ) : null}
          {sorted.map((ct) => (
            <ActionForm
              key={ct.id}
              action={updateClassTypeAction}
              submitLabel="Simpan"
              className={`${rowClass} ${GRID}`}
            >
              <input type="hidden" name="id" value={ct.id} />
              <span className="text-sm">{programName.get(ct.programId) ?? "?"}</span>
              <input
                name="name"
                defaultValue={ct.name}
                aria-label={`Nama tipe kelas ${ct.name}`}
                required
                maxLength={100}
                className={inputClass}
              />
              <input
                name="defaultSize"
                type="number"
                min={1}
                max={500}
                defaultValue={ct.defaultSize}
                aria-label={`Ukuran standar ${ct.name}`}
                required
                className={inputClass}
              />
              <input
                name="sortOrder"
                type="number"
                min={0}
                max={9999}
                defaultValue={ct.sortOrder}
                aria-label={`Urutan ${ct.name}`}
                required
                className={inputClass}
              />
              <label className="flex items-center gap-2 text-sm">
                <input name="isActive" type="checkbox" defaultChecked={ct.isActive} />
                Aktif
              </label>
            </ActionForm>
          ))}
        </div>
      </section>
    </main>
  );
}
