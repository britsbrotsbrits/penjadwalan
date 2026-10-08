import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { selectClass } from "@/components/form-styles";
import { Badge, Card } from "@/components/ui";
import { ATTENDANCE_LABEL, ATTENDANCE_TONE, describeAttendance, type AttendanceStatus } from "@/lib/attendance/labels";
import { dayName } from "@/lib/master-data/time";
import { addDays, isoDow } from "@/lib/validation/dates";
import { listSessionSlots } from "@/server/master-data/queries";
import { submitAttendanceAction } from "@/server/attendance/actions";
import { listMyAttendance, listTodaySessions, listTutorNames } from "@/server/attendance/queries";
import { getMyTutorProfile } from "@/server/tutors/queries";

/** Tanggal hari ini di Asia/Jakarta (UTC+7), "YYYY-MM-DD". */
function todayJakarta(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function TutorAttendancePage() {
  await requireRole(["tutor"]);
  const mine = await getMyTutorProfile();
  if (!mine) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="text-sm text-red-600">Akun Anda belum terdaftar sebagai mentor. Hubungi admin.</p>
      </main>
    );
  }
  const today = todayJakarta();
  const [sessions, history, names, slots] = await Promise.all([
    listTodaySessions(),
    listMyAttendance(addDays(today, -30), today),
    listTutorNames(),
    listSessionSlots(),
  ]);
  const slotLabel = new Map(slots.map((s) => [s.slotNo, `${s.startTime}-${s.endTime}`]));
  const others = names.filter((n) => n.id !== mine.id);
  const ordered = [...sessions].sort(
    (a, b) => Number(b.plannedTutorId === mine.id) - Number(a.plannedTutorId === mine.id) || a.slotNo - b.slotNo || a.rombelName.localeCompare(b.rombelName),
  );

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-5 p-4 pb-24 sm:p-8">
      <div>
        <Link href="/tutor" className="text-sm text-primary hover:underline">
          &larr; Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Presensi</h1>
        <p className="mt-1 text-sm text-muted">
          {dayName(isoDow(today))}, {today}. Isi presensi untuk sesi yang Anda ajar hari ini. Gunakan <strong>Tukar</strong> bila Anda menukar jadwal,
          atau <strong>Menggantikan</strong> bila Anda mengajar menggantikan mentor lain, lalu pilih nama mentor itu. Presensi hanya bisa diisi
          sekali; hubungi admin untuk koreksi. Tidak hadir = tidak perlu diisi.
        </p>
      </div>

      <Card title="Sesi hari ini">
        {ordered.length === 0 ? (
          <p className="text-sm text-muted">Belum ada sesi hari ini pada jadwal yang sudah disetujui.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {ordered.map((s) => {
              const isMine = s.plannedTutorId === mine.id;
              return (
                <li key={s.sessionId} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <strong>Sesi {s.slotNo}</strong>
                    <span className="text-muted">{slotLabel.get(s.slotNo) ?? ""}</span>
                    <span>{s.rombelName}</span>
                    <span>{s.subtestCode}</span>
                    <span className="text-muted">{s.roomName}</span>
                    {isMine ? <Badge tone="primary">Jadwal saya</Badge> : <span className="text-muted">Jadwal: {s.plannedTutorName || "(tanpa nama)"}</span>}
                  </div>
                  {s.attendanceStatus ? (
                    <p className="text-sm">
                      <Badge tone={ATTENDANCE_TONE[s.attendanceStatus]}>{ATTENDANCE_LABEL[s.attendanceStatus]}</Badge>{" "}
                      Dicatat untuk {s.attendanceTutorName || "(tanpa nama)"}.
                    </p>
                  ) : (
                    <ActionForm action={submitAttendanceAction} submitLabel="Simpan presensi" className="flex flex-col gap-2">
                      <input type="hidden" name="sessionId" value={s.sessionId} />
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="flex flex-col gap-1 text-sm">
                          Status
                          <select name="status" defaultValue={isMine ? "HADIR" : "MENGGANTIKAN"} className={selectClass}>
                            {isMine ? <option value="HADIR">Hadir</option> : null}
                            <option value="TUKAR">Tukar jadwal</option>
                            <option value="MENGGANTIKAN">Menggantikan</option>
                          </select>
                        </label>
                        {isMine ? null : (
                          <label className="flex min-w-48 flex-col gap-1 text-sm">
                            Mentor lawan
                            <select name="otherTutorId" defaultValue={s.plannedTutorId} className={selectClass}>
                              <option value="">(pilih mentor)</option>
                              {others.map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {isMine ? (
                          <label className="flex min-w-48 flex-col gap-1 text-sm">
                            Mentor lawan (hanya untuk Tukar)
                            <select name="otherTutorId" defaultValue="" className={selectClass}>
                              <option value="">(tidak ada)</option>
                              {others.map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Riwayat 30 hari terakhir">
        {history.length === 0 ? (
          <p className="text-sm text-muted">Belum ada presensi.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {[...history].reverse().map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                <span>{h.sessionDate}</span>
                <span className="text-muted">Sesi {h.slotNo}</span>
                <span>{h.rombelName}</span>
                <span>{h.subtestCode}</span>
                <Badge tone={ATTENDANCE_TONE[h.status as AttendanceStatus]}>
                  {describeAttendance(h.status, h.status === "HADIR" ? "" : h.otherTutorName)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
