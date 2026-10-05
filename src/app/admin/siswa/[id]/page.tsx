import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { inputClass, selectClass } from "@/components/form-styles";
import { buildRombelLabels } from "@/lib/academic/labels";
import { isUuid } from "@/lib/academic/search";
import { moveStudentAction, updateStudentAction } from "@/server/academic/actions";
import {
  getProfileNames,
  getStudent,
  listClassTypes,
  listPrograms,
  listRombels,
  listStudentHistory,
} from "@/server/academic/queries";

type Props = { params: Promise<{ id: string }> };

const dateTime = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

function formatChangedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${dateTime.format(date)} WIB`;
}

export default async function SiswaDetailPage({ params }: Props) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const student = await getStudent(id);
  if (!student) notFound();

  const [programs, classTypes, rombels, history] = await Promise.all([
    listPrograms(),
    listClassTypes(),
    listRombels(),
    listStudentHistory(id),
  ]);
  const names = await getProfileNames(
    history.map((h) => h.changedBy).filter((v): v is string => v !== null),
  );

  const labels = buildRombelLabels(programs, classTypes, rombels);
  const label = (rombelId: string | null) =>
    rombelId === null ? "-" : (labels.get(rombelId) ?? "?");
  const targets = rombels
    .filter((r) => r.isActive && r.id !== student.rombelId)
    .sort((a, b) => (labels.get(a.id) ?? "").localeCompare(labels.get(b.id) ?? ""));

  return (
    <main className="flex flex-col gap-6">
      <div>
        <Link href="/admin/siswa" className="text-sm underline">
          &larr; Daftar siswa
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{student.fullName}</h1>
        <p className="mt-1 text-sm opacity-70">
          <span className="font-mono">{student.studentCode}</span> · {label(student.rombelId)} ·{" "}
          {student.isActive ? "Aktif" : "Nonaktif"}
        </p>
      </div>

      <section aria-labelledby="data-siswa" className="rounded border border-current/20 p-4">
        <h2 id="data-siswa" className="mb-3 font-medium">
          Data siswa
        </h2>
        <ActionForm
          action={updateStudentAction}
          submitLabel="Simpan"
          className="grid items-center gap-3 sm:grid-cols-[minmax(12rem,1fr)_10rem_5rem_auto]"
        >
          <input type="hidden" name="id" value={student.id} />
          <input
            name="fullName"
            defaultValue={student.fullName}
            aria-label="Nama lengkap"
            required
            maxLength={200}
            className={inputClass}
          />
          <input
            name="studentCode"
            defaultValue={student.studentCode}
            aria-label="Kode siswa"
            required
            maxLength={30}
            className={`${inputClass} font-mono uppercase`}
          />
          <label className="flex items-center gap-2 text-sm">
            <input name="isActive" type="checkbox" defaultChecked={student.isActive} />
            Aktif
          </label>
        </ActionForm>
      </section>

      <section aria-labelledby="pindah-rombel" className="rounded border border-current/20 p-4">
        <h2 id="pindah-rombel" className="mb-1 font-medium">
          Pindah rombel
        </h2>
        <p className="mb-3 text-sm opacity-70">
          Rombel saat ini: {label(student.rombelId)}. Perpindahan tercatat di riwayat bersama alasan
          dan nama admin yang memindahkan.
        </p>
        {targets.length === 0 ? (
          <p className="text-sm opacity-70">Tidak ada rombel aktif lain sebagai tujuan.</p>
        ) : (
          <ActionForm
            action={moveStudentAction}
            submitLabel="Pindahkan"
            className="grid items-center gap-3 sm:grid-cols-[minmax(14rem,1fr)_minmax(12rem,1fr)_auto]"
          >
            <input type="hidden" name="studentId" value={student.id} />
            <select
              name="rombelId"
              aria-label="Rombel tujuan"
              required
              className={selectClass}
              defaultValue=""
            >
              <option value="" disabled>
                Pilih rombel tujuan
              </option>
              {targets.map((r) => (
                <option key={r.id} value={r.id}>
                  {labels.get(r.id)}
                </option>
              ))}
            </select>
            <input
              name="reason"
              placeholder="Alasan (opsional)"
              aria-label="Alasan pindah"
              maxLength={500}
              className={inputClass}
            />
          </ActionForm>
        )}
      </section>

      <section aria-labelledby="riwayat" className="flex flex-col gap-2">
        <h2 id="riwayat" className="font-medium">
          Riwayat rombel
        </h2>
        {history.length === 0 ? (
          <p className="text-sm opacity-70">Belum ada riwayat.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {history.map((h) => (
              <li key={h.id} className="rounded border border-current/20 p-3 text-sm">
                <p className="font-medium">
                  {h.fromRombelId === null
                    ? `Ditempatkan di ${label(h.toRombelId)}`
                    : `${label(h.fromRombelId)} → ${label(h.toRombelId)}`}
                </p>
                <p className="opacity-70">
                  {formatChangedAt(h.changedAt)} ·{" "}
                  {h.changedBy === null
                    ? "Sistem / SQL Editor"
                    : names.get(h.changedBy) || "Admin (tanpa nama)"}
                </p>
                {h.reason ? <p className="mt-1">Alasan: {h.reason}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
