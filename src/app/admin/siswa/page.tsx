import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import {
  buttonClass,
  createRowClass,
  headerCellClass,
  inputClass,
  rowClass,
  selectClass,
} from "@/components/form-styles";
import { Pagination } from "@/components/pagination";
import { buildRombelLabels } from "@/lib/academic/labels";
import {
  STUDENT_PAGE_SIZE,
  buildStudentListQuery,
  parseStudentListParams,
  totalPages,
} from "@/lib/academic/search";
import { createStudentAction } from "@/server/academic/actions";
import {
  listClassTypes,
  listPrograms,
  listRombels,
  listStudents,
} from "@/server/academic/queries";

const GRID = "grid-cols-[9rem_minmax(12rem,1fr)_minmax(14rem,1fr)_6rem]";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SiswaPage({ searchParams }: Props) {
  await requireRole(["admin"]);
  const params = parseStudentListParams(await searchParams);

  const [programs, classTypes, rombels, result] = await Promise.all([
    listPrograms(),
    listClassTypes(),
    listRombels(),
    listStudents(params),
  ]);

  const labels = buildRombelLabels(programs, classTypes, rombels);
  const byLabel = (a: { id: string }, b: { id: string }) =>
    (labels.get(a.id) ?? "").localeCompare(labels.get(b.id) ?? "");
  const allRombels = [...rombels].sort(byLabel);
  const activeRombels = allRombels.filter((r) => r.isActive);
  const pages = totalPages(result.total);

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Siswa</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-70">
          Setiap siswa berada di tepat satu rombel. Kode siswa dibuat otomatis (SIS000001, dst) bila
          dikosongkan. Siswa tidak dihapus, hanya dinonaktifkan. Pindah rombel dilakukan di halaman
          detail siswa dan tercatat di riwayat.
        </p>
      </div>

      <section aria-labelledby="tambah-siswa" className="rounded border border-current/20 p-4">
        <h2 id="tambah-siswa" className="mb-3 font-medium">
          Tambah siswa
        </h2>
        {activeRombels.length === 0 ? (
          <p className="text-sm opacity-70">Belum ada rombel aktif. Tambahkan rombel dulu.</p>
        ) : (
          <ActionForm
            action={createStudentAction}
            submitLabel="Tambah"
            resetOnSuccess
            className={`${createRowClass} grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_10rem_auto]`}
          >
            <input
              name="fullName"
              placeholder="Nama lengkap"
              aria-label="Nama siswa baru"
              required
              maxLength={200}
              className={inputClass}
            />
            <select name="rombelId" aria-label="Rombel" required className={selectClass} defaultValue="">
              <option value="" disabled>
                Pilih rombel
              </option>
              {activeRombels.map((r) => (
                <option key={r.id} value={r.id}>
                  {labels.get(r.id)}
                </option>
              ))}
            </select>
            <input
              name="studentCode"
              placeholder="Kode (opsional)"
              aria-label="Kode siswa baru (opsional)"
              maxLength={30}
              className={`${inputClass} uppercase`}
            />
          </ActionForm>
        )}
      </section>

      <form
        method="get"
        action="/admin/siswa"
        aria-label="Filter siswa"
        className="grid items-end gap-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_9rem_auto]"
      >
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide opacity-80">
          Cari nama / kode
          <input
            name="q"
            defaultValue={params.q}
            maxLength={100}
            placeholder="Nama atau kode"
            className={`${inputClass} normal-case`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide opacity-80">
          Rombel
          <select name="rombel" defaultValue={params.rombelId} className={`${selectClass} normal-case`}>
            <option value="">Semua rombel</option>
            {allRombels.map((r) => (
              <option key={r.id} value={r.id}>
                {labels.get(r.id)}
                {r.isActive ? "" : " (nonaktif)"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide opacity-80">
          Status
          <select name="status" defaultValue={params.status} className={`${selectClass} normal-case`}>
            <option value="aktif">Aktif</option>
            <option value="nonaktif">Nonaktif</option>
            <option value="semua">Semua</option>
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className={buttonClass}>
            Terapkan
          </button>
          <Link href="/admin/siswa" className="px-2 py-1 text-sm underline">
            Reset
          </Link>
        </div>
      </form>

      <section aria-label="Daftar siswa" className="flex flex-col gap-3">
        <p className="text-sm opacity-70" role="status">
          {result.total} siswa ditemukan
          {result.total > STUDENT_PAGE_SIZE ? ` (${STUDENT_PAGE_SIZE} per halaman)` : ""}.
        </p>
        <div className="overflow-x-auto">
          <div className="min-w-[44rem]">
            <div className={`${rowClass} ${GRID}`}>
              <span className={headerCellClass}>Kode</span>
              <span className={headerCellClass}>Nama</span>
              <span className={headerCellClass}>Rombel</span>
              <span className={headerCellClass}>Status</span>
            </div>
            {result.rows.length === 0 ? (
              <p className="py-4 text-sm opacity-70">Tidak ada siswa yang cocok dengan filter ini.</p>
            ) : null}
            {result.rows.map((student) => (
              <div key={student.id} className={`${rowClass} ${GRID} text-sm`}>
                <span className="font-mono">{student.studentCode}</span>
                <Link href={`/admin/siswa/${student.id}`} className="underline">
                  {student.fullName}
                </Link>
                <span>{labels.get(student.rombelId) ?? "?"}</span>
                <span className={student.isActive ? "" : "opacity-60"}>
                  {student.isActive ? "Aktif" : "Nonaktif"}
                </span>
              </div>
            ))}
          </div>
        </div>
        <Pagination
          page={params.page}
          totalPages={pages}
          hrefFor={(page) => `/admin/siswa${buildStudentListQuery({ ...params, page })}`}
        />
      </section>
    </main>
  );
}
