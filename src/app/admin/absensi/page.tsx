import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { inputClass, selectClass } from "@/components/form-styles";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";
import { ATTENDANCE_LABEL, ATTENDANCE_TONE, describeAttendance } from "@/lib/attendance/labels";
import { dateParamSchema } from "@/lib/attendance/schemas";
import { dayName } from "@/lib/master-data/time";
import { addDays, isoDow } from "@/lib/validation/dates";
import { adminDeleteAttendanceAction, adminSetAttendanceAction } from "@/server/attendance/actions";
import { listAttendanceBetween, listSessionsBetween } from "@/server/attendance/queries";
import { loadScheduleLookups } from "@/server/schedule/queries";

function todayJakarta(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function AdminAttendancePage({ searchParams }: { searchParams: Promise<{ tanggal?: string | string[] }> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const raw = Array.isArray(sp.tanggal) ? sp.tanggal[0] : sp.tanggal;
  const parsed = raw ? dateParamSchema.safeParse(raw) : null;
  const date = parsed?.success ? parsed.data : todayJakarta();

  const [sessions, records, lookups] = await Promise.all([listSessionsBetween(date, date), listAttendanceBetween(date, date), loadScheduleLookups()]);
  const bySession = new Map(records.map((r) => [r.sessionId, r]));
  const tutorName = new Map(lookups.tutors.map((t) => [t.id, t.name]));
  const rombelName = new Map(lookups.rombels.map((r) => [r.id, r.name]));
  const roomName = new Map(lookups.rooms.map((r) => [r.id, r.name]));
  const subtestCode = new Map(lookups.subtests.map((s) => [s.id, s.code]));
  const slotLabel = new Map(lookups.slots.map((s) => [s.slotNo, `${s.startTime}-${s.endTime}`]));
  const count = (st: string) => records.filter((r) => r.status === st).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Presensi"
        description="Catatan siapa yang mengajar tiap sesi. Hadir, Tukar, dan Menggantikan masuk presensi; sesi tanpa catatan dianggap tidak hadir."
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <Link href={`?tanggal=${addDays(date, -1)}`} className="text-primary hover:underline">
            &larr; Hari sebelumnya
          </Link>
          <strong>
            {dayName(isoDow(date))}, {date}
          </strong>
          <Link href={`?tanggal=${addDays(date, 1)}`} className="text-primary hover:underline">
            Hari berikutnya &rarr;
          </Link>
          <form method="get" className="ml-auto flex items-end gap-2">
            <label className="flex flex-col gap-1">
              Pilih tanggal
              <input type="date" name="tanggal" defaultValue={date} className={inputClass} />
            </label>
            <button type="submit" className="rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-neutral-soft">
              Tampilkan
            </button>
          </form>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sesi pada tanggal ini" value={sessions.length} icon="calendar" tone="primary" />
        <StatCard label="Hadir" value={count("HADIR")} icon="users" tone="success" />
        <StatCard label="Tukar" value={count("TUKAR")} icon="users" tone="primary" />
        <StatCard label="Menggantikan" value={count("MENGGANTIKAN")} icon="users" tone="warning" />
      </div>

      <Card title="Sesi dan presensi">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted">Tidak ada sesi terjadwal pada tanggal ini.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {sessions.map((s) => {
              const rec = bySession.get(s.id);
              return (
                <li key={s.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <strong>Sesi {s.slotNo}</strong>
                    <span className="text-muted">{slotLabel.get(s.slotNo) ?? ""}</span>
                    <span>{rombelName.get(s.rombelId) ?? "?"}</span>
                    <span>{subtestCode.get(s.subtestId) ?? "?"}</span>
                    <span className="text-muted">{roomName.get(s.roomId) ?? "?"}</span>
                    <span className="text-muted">Jadwal: {tutorName.get(s.tutorId) ?? "?"}</span>
                    {rec ? (
                      <Badge tone={ATTENDANCE_TONE[rec.status]}>
                        {ATTENDANCE_LABEL[rec.status]}: {tutorName.get(rec.tutorId) ?? "?"}
                        {rec.status === "HADIR" ? "" : ` (${describeAttendance(rec.status, tutorName.get(rec.otherTutorId ?? "") ?? "")})`}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Belum ada catatan</Badge>
                    )}
                  </div>
                  <details>
                    <summary className="cursor-pointer text-sm text-primary">{rec ? "Koreksi / hapus" : "Catat presensi"}</summary>
                    <div className="mt-2 flex flex-col gap-3">
                      <ActionForm action={adminSetAttendanceAction} submitLabel="Simpan" className="flex flex-col gap-2">
                        <input type="hidden" name="sessionId" value={s.id} />
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="flex min-w-44 flex-col gap-1 text-sm">
                            Mentor yang mengajar
                            <select name="tutorId" defaultValue={rec?.tutorId ?? s.tutorId} className={selectClass}>
                              {lookups.tutors.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 text-sm">
                            Status
                            <select name="status" defaultValue={rec?.status ?? "HADIR"} className={selectClass}>
                              <option value="HADIR">Hadir</option>
                              <option value="TUKAR">Tukar jadwal</option>
                              <option value="MENGGANTIKAN">Menggantikan</option>
                            </select>
                          </label>
                          <label className="flex min-w-44 flex-col gap-1 text-sm">
                            Mentor lawan (Tukar/Menggantikan)
                            <select name="otherTutorId" defaultValue={rec?.otherTutorId ?? ""} className={selectClass}>
                              <option value="">(tidak ada)</option>
                              {lookups.tutors.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
                            Catatan (opsional)
                            <input name="note" defaultValue={rec?.editNote ?? ""} maxLength={500} className={inputClass} />
                          </label>
                        </div>
                      </ActionForm>
                      {rec ? (
                        <ActionForm action={adminDeleteAttendanceAction} submitLabel="Hapus catatan ini">
                          <input type="hidden" name="id" value={rec.id} />
                        </ActionForm>
                      ) : null}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted">
        Penghapusan bersifat permanen dan belum punya riwayat (audit log menyusul di Phase 17). Ekspor ke Google Sheets menyusul di Phase 16.
      </p>
    </div>
  );
}
