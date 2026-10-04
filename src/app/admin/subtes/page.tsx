import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { createRowClass, headerCellClass, inputClass, rowClass } from "@/components/form-styles";
import { createSubtestAction, updateSubtestAction } from "@/server/master-data/actions";
import { listSubtests } from "@/server/master-data/queries";

const GRID = "grid-cols-[7rem_minmax(12rem,1fr)_6rem_5rem_auto]";

export default async function SubtesPage() {
  await requireRole(["admin"]);
  const subtests = await listSubtests();

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Subtes</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-70">
          Daftar subtes dapat ditambah dan diubah kapan saja. Subtes tidak dihapus, hanya
          dinonaktifkan, supaya riwayat jadwal dan attendance tetap utuh.
        </p>
      </div>

      <section aria-labelledby="tambah-subtes" className="rounded border border-current/20 p-4">
        <h2 id="tambah-subtes" className="mb-3 font-medium">
          Tambah subtes
        </h2>
        <ActionForm
          action={createSubtestAction}
          submitLabel="Tambah"
          resetOnSuccess
          className={`${createRowClass} ${GRID}`}
        >
          <input
            name="code"
            placeholder="Kode"
            aria-label="Kode subtes baru"
            required
            maxLength={20}
            className={`${inputClass} uppercase`}
          />
          <input
            name="name"
            placeholder="Nama subtes"
            aria-label="Nama subtes baru"
            required
            maxLength={100}
            className={inputClass}
          />
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={9999}
            defaultValue={subtests.length + 1}
            aria-label="Urutan subtes baru"
            required
            className={inputClass}
          />
          <label className="flex items-center gap-2 text-sm">
            <input name="isActive" type="checkbox" defaultChecked />
            Aktif
          </label>
        </ActionForm>
      </section>

      <section aria-label="Daftar subtes" className="overflow-x-auto">
        <div className="min-w-[44rem]">
          <div className={`${rowClass} ${GRID}`}>
            <span className={headerCellClass}>Kode</span>
            <span className={headerCellClass}>Nama</span>
            <span className={headerCellClass}>Urutan</span>
            <span className={headerCellClass}>Status</span>
            <span />
          </div>
          {subtests.length === 0 ? (
            <p className="py-4 text-sm opacity-70">
              Belum ada subtes. Tambahkan di atas, atau jalankan seed awal (lihat README).
            </p>
          ) : null}
          {subtests.map((subtest) => (
            <ActionForm
              key={subtest.id}
              action={updateSubtestAction}
              submitLabel="Simpan"
              className={`${rowClass} ${GRID}`}
            >
              <input type="hidden" name="id" value={subtest.id} />
              <input
                name="code"
                defaultValue={subtest.code}
                aria-label={`Kode ${subtest.name}`}
                required
                maxLength={20}
                className={`${inputClass} uppercase`}
              />
              <input
                name="name"
                defaultValue={subtest.name}
                aria-label={`Nama ${subtest.code}`}
                required
                maxLength={100}
                className={inputClass}
              />
              <input
                name="sortOrder"
                type="number"
                min={0}
                max={9999}
                defaultValue={subtest.sortOrder}
                aria-label={`Urutan ${subtest.code}`}
                required
                className={inputClass}
              />
              <label className="flex items-center gap-2 text-sm">
                <input name="isActive" type="checkbox" defaultChecked={subtest.isActive} />
                Aktif
              </label>
            </ActionForm>
          ))}
        </div>
      </section>
    </main>
  );
}
