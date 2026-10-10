import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { Pagination } from "@/components/pagination";
import { buttonClass, headerCellClass, inputClass, rowClass, secondaryButtonClass, selectClass } from "@/components/form-styles";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";
import { dayName } from "@/lib/master-data/time";
import { expandRequirements } from "@/lib/scheduler/requirements";
import {
  isEditableStatus,
  PERIOD_STATUS_LABEL,
  TRANSITION_ACTION,
  PERIOD_STATUS_TONE,
  reasonLabel,
} from "@/lib/schedule/labels";
import type { TeachingSession } from "@/lib/schedule/schemas";
import { allowedTransitions, canGenerateAdditional, needsConfirmation } from "@/lib/validation/transitions";
import { addDays, diffDays, isoDow, weekStart } from "@/lib/validation/dates";
import { VIOLATION_LABELS, type ViolationCode } from "@/lib/validation/violations";
import { checkWeeklyDistribution } from "@/lib/validation/weekly-distribution";
import {
  cancelSessionAction,
  createSessionAction,
  generateAdditionalAction,
  generateScheduleAction,
  setPeriodStatusAction,
  updatePeriodAction,
  updateSessionAction,
} from "@/server/schedule/actions";
import {
  getLatestRun,
  getPeriod,
  listPeriodSessions,
  listUnscheduled,
  listViolations,
  loadScheduleLookups,
  loadSchedulingSnapshot,
} from "@/server/schedule/queries";

// Generate berjalan langsung di server (DEC-06), jadi beri waktu lebih lama dari batas bawaan.
export const maxDuration = 60;

const PAGE_SIZE = 50;
const SHOWN = 20;

type SearchParams = { rombel?: string; tutor?: string; room?: string; week?: string; page?: string };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function SchedulePeriodPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireRole(["admin"]);
  const { id } = await params;
  const sp = await searchParams;

  const period = await getPeriod(id);
  if (!period) notFound();
  const editable = isEditableStatus(period.status);

  const [sessions, run, lookups, violationResult] = await Promise.all([
    listPeriodSessions(id),
    getLatestRun(id),
    loadScheduleLookups(),
    listViolations(id),
  ]);
  const unscheduled = run ? await listUnscheduled(run.id) : [];

  const rombelName = new Map(lookups.rombels.map((r) => [r.id, r.name]));
  const tutorName = new Map(lookups.tutors.map((t) => [t.id, t.name]));
  const roomName = new Map(lookups.rooms.map((r) => [r.id, r.name]));
  const subtestName = new Map(lookups.subtests.map((s) => [s.id, s.code]));
  const slotLabel = new Map(lookups.slots.map((s) => [s.slotNo, `Sesi ${s.slotNo} (${s.startTime}-${s.endTime})`]));
  const activeSlots = lookups.slots.filter((s) => s.isActive);

  // Validasi distribusi mingguan memakai konfigurasi SAAT INI (selisih dari saat generate ikut terlihat).
  let weeklyIssues: ReturnType<typeof checkWeeklyDistribution> = [];
  let weeklyError = false;
  if (sessions.length > 0) {
    try {
      const built = await loadSchedulingSnapshot();
      const { requirements } = expandRequirements(built.snapshot.rombels);
      weeklyIssues = checkWeeklyDistribution({
        sessions,
        requirements,
        periodStart: period.startDate,
        periodEnd: period.endDate,
        rombelIds: built.snapshot.rombels.map((r) => r.id),
        windows: built.rombelWindows,
      });
    } catch (e) {
      console.error("[schedule:weekly-check]", e);
      weeklyError = true;
    }
  }

  const violationsBySession = new Map<string, ViolationCode[]>();
  const violationCount = new Map<ViolationCode, number>();
  for (const v of violationResult.rows) {
    violationsBySession.set(v.sessionId, [...(violationsBySession.get(v.sessionId) ?? []), v.code]);
    violationCount.set(v.code, (violationCount.get(v.code) ?? 0) + 1);
  }
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  // Filter + halaman.
  const fRombel = one(sp.rombel);
  const fTutor = one(sp.tutor);
  const fRoom = one(sp.room);
  const fWeek = one(sp.week);
  const filtered = sessions.filter(
    (s) =>
      (!fRombel || s.rombelId === fRombel) &&
      (!fTutor || s.tutorId === fTutor) &&
      (!fRoom || s.roomId === fRoom) &&
      (!fWeek || weekStart(s.sessionDate) === fWeek),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number.parseInt(one(sp.page), 10) || 1), totalPages);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const weeks: string[] = [];
  for (let wk = weekStart(period.startDate); diffDays(wk, period.endDate) >= 0; wk = addDays(wk, 7)) weeks.push(wk);

  const hrefFor = (p: number) => {
    const q = new URLSearchParams();
    if (fRombel) q.set("rombel", fRombel);
    if (fTutor) q.set("tutor", fTutor);
    if (fRoom) q.set("room", fRoom);
    if (fWeek) q.set("week", fWeek);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return `/admin/jadwal/${id}${qs ? `?${qs}` : ""}`;
  };

  const totalMissing = unscheduled.reduce((n, u) => n + u.missingPerWeek, 0);
  const summary = (run?.summary ?? {}) as {
    issues?: Array<{ message?: string }>;
    configIssues?: Array<{ message?: string }>;
  };
  const runIssues = [...(summary.issues ?? []), ...(summary.configIssues ?? [])]
    .map((i) => i.message)
    .filter((m): m is string => typeof m === "string");

  const subtestOptions = lookups.subtests.map((s) => (
    <option key={s.id} value={s.id}>
      {s.code}
      {s.isActive ? "" : " (nonaktif)"}
    </option>
  ));
  const tutorOptions = lookups.tutors.map((t) => (
    <option key={t.id} value={t.id}>
      {t.name}
      {t.isActive ? "" : " (nonaktif)"}
    </option>
  ));
  const roomOptions = lookups.rooms.map((r) => (
    <option key={r.id} value={r.id}>
      {r.name} ({r.capacity})
      {r.isActive ? "" : " (nonaktif)"}
    </option>
  ));
  const slotOptions = activeSlots.map((s) => (
    <option key={s.slotNo} value={s.slotNo}>
      {slotLabel.get(s.slotNo)}
    </option>
  ));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/jadwal" className="text-sm text-primary hover:underline">
          &larr; Semua periode
        </Link>
      </div>
      <PageHeader
        title={period.name}
        description={`${period.startDate} s/d ${period.endDate}`}
        actions={
          <>
            <Link href={`/admin/jadwal/${period.id}/tabel`} className={secondaryButtonClass}>
              Tabel jadwal (PDF/PNG)
            </Link>
            <Badge tone={PERIOD_STATUS_TONE[period.status]}>{PERIOD_STATUS_LABEL[period.status]}</Badge>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pertemuan terjadwal" value={sessions.length} icon="calendar" tone="primary" />
        <StatCard
          label="Pelanggaran aturan"
          value={violationResult.truncated ? `${violationResult.rows.length}+` : violationResult.rows.length}
          icon="shield"
          tone={violationResult.rows.length === 0 ? "success" : "danger"}
          hint="menurut database"
        />
        <StatCard
          label="Belum terjadwal"
          value={`${totalMissing} /minggu`}
          icon="clock"
          tone={totalMissing === 0 ? "success" : "warning"}
          hint={run ? `generate terakhir, seed ${run.seed}` : "belum pernah generate"}
        />
        <StatCard
          label="Selisih distribusi"
          value={weeklyError ? "?" : weeklyIssues.length}
          icon="layers"
          tone={weeklyIssues.length === 0 && !weeklyError ? "success" : "warning"}
          hint="per rombel per minggu"
        />
      </div>

      {editable ? (
        <Card title="Generate jadwal">
          <p className="mb-3 max-w-3xl text-sm text-muted">
            Membuat jadwal untuk seluruh periode dari data saat ini (mentor aktif, availability, kompetensi, rombel, ruangan,
            distribusi subtes). Hasil dengan seed yang sama selalu sama. Generate <strong>menggantikan semua sesi periode ini</strong>,
            termasuk yang diedit manual.
          </p>
          <ActionForm action={generateScheduleAction} submitLabel="Generate jadwal" className="flex flex-col gap-3">
            <input type="hidden" name="periodId" value={period.id} />
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex w-56 flex-col gap-1 text-sm">
                Seed (opsional)
                <input name="seed" inputMode="numeric" placeholder="kosong = acak" className={inputClass} />
              </label>
              {sessions.length > 0 ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="confirmReplace" className="h-4 w-4 accent-primary" />
                  Ya, ganti {sessions.length} sesi yang ada
                </label>
              ) : null}
            </div>
          </ActionForm>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted">
            Jadwal berstatus {PERIOD_STATUS_LABEL[period.status]} dilindungi: tidak bisa digenerate ulang atau diedit.
          </p>
        </Card>
      )}

      {canGenerateAdditional(period.status) ? (
        <Card title="Generate Additional">
          <p className="mb-3 max-w-3xl text-sm text-muted">
            Melengkapi kebutuhan yang masih kurang <strong>tanpa mengubah atau menghapus sesi yang sudah ada</strong> (juga pada
            periode Approved). Sesi yang ada dianggap terisi, jadi sesi baru tidak akan bentrok dengannya. Sesi baru diberi tanda
            &quot;Tambahan&quot;.
          </p>
          <ActionForm action={generateAdditionalAction} submitLabel="Generate Additional" className="flex flex-col gap-3">
            <input type="hidden" name="periodId" value={period.id} />
            <label className="flex w-56 flex-col gap-1 text-sm">
              Seed (opsional)
              <input name="seed" inputMode="numeric" placeholder="kosong = acak" className={inputClass} />
            </label>
          </ActionForm>
        </Card>
      ) : null}

      {allowedTransitions(period.status).length > 0 ? (
        <Card title="Status periode">
          <p className="mb-3 max-w-3xl text-sm text-muted">
            Alur: Draft, Generated, Approved, Locked. Approved dan Locked melindungi sesi dari perubahan dan Generate ulang.
            Lock dan Cancel tidak bisa dibatalkan.
          </p>
          <div className="flex flex-col gap-4">
            {allowedTransitions(period.status).map((to) => (
              <div key={to} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                <ActionForm action={setPeriodStatusAction} submitLabel={TRANSITION_ACTION[to]?.label ?? to} className="flex flex-col gap-2">
                  <input type="hidden" name="periodId" value={period.id} />
                  <input type="hidden" name="to" value={to} />
                  <p className="text-sm text-muted">{TRANSITION_ACTION[to]?.hint}</p>
                  {needsConfirmation(to) ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="confirm" className="h-4 w-4 accent-primary" />
                      Ya, saya mengerti ini tidak bisa dibatalkan
                    </label>
                  ) : null}
                </ActionForm>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {run && runIssues.length > 0 ? (
        <Card title="Catatan data pada generate terakhir">
          <ul className="list-disc pl-5 text-sm">
            {runIssues.slice(0, 20).map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Validasi">
        {violationResult.rows.length === 0 && weeklyIssues.length === 0 && !weeklyError ? (
          <p className="text-sm text-emerald-700">
            {sessions.length === 0 ? "Belum ada sesi untuk divalidasi." : "Tidak ada pelanggaran aturan dan distribusi per minggu sesuai."}
          </p>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            {violationResult.rows.length > 0 ? (
              <div>
                <h4 className="mb-1">Pelanggaran aturan sesi{violationResult.truncated ? " (daftar terpotong)" : ""}</h4>
                <ul className="mb-2 flex flex-wrap gap-2">
                  {[...violationCount].map(([code, n]) => (
                    <li key={code}>
                      <Badge tone="danger">
                        {VIOLATION_LABELS[code]}: {n}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <ul className="list-disc pl-5">
                  {[...violationsBySession].slice(0, SHOWN).map(([sid, codes]) => {
                    const s = sessionById.get(sid);
                    return s ? (
                      <li key={sid}>
                        {s.sessionDate} · {rombelName.get(s.rombelId) ?? "?"} · {tutorName.get(s.tutorId) ?? "?"} ·{" "}
                        {codes.map((c) => VIOLATION_LABELS[c]).join("; ")}
                      </li>
                    ) : null;
                  })}
                </ul>
              </div>
            ) : null}
            {weeklyError ? <p className="text-red-600">Distribusi per minggu tidak dapat dihitung saat ini. Muat ulang halaman.</p> : null}
            {weeklyIssues.length > 0 ? (
              <div>
                <h4 className="mb-1">Selisih distribusi per minggu (hanya minggu penuh untuk kekurangan)</h4>
                <ul className="list-disc pl-5">
                  {weeklyIssues.slice(0, SHOWN).map((w, i) => (
                    <li key={i}>
                      {rombelName.get(w.rombelId) ?? "?"} · minggu {w.weekStart} ·{" "}
                      {w.kind === "SHORTFALL" ? "kurang" : "lebih"} {w.count} sesi{" "}
                      {subtestName.get(w.label) ?? w.label}
                    </li>
                  ))}
                </ul>
                {weeklyIssues.length > SHOWN ? <p className="mt-1 text-muted">dan {weeklyIssues.length - SHOWN} lainnya.</p> : null}
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {unscheduled.length > 0 ? (
        <Card title="Kebutuhan yang belum terjadwal (per minggu)">
          <div className="flex flex-col">
            <div className={`${rowClass} grid-cols-[1.5fr_1.5fr_0.6fr_3fr] ${headerCellClass}`}>
              <span>Rombel</span>
              <span>Kebutuhan</span>
              <span>Kurang</span>
              <span>Alasan</span>
            </div>
            {unscheduled.map((u) => (
              <div key={u.id} className={`${rowClass} grid-cols-[1.5fr_1.5fr_0.6fr_3fr] text-sm`}>
                <span>{rombelName.get(u.rombelId) ?? "?"}</span>
                <span>{subtestName.get(u.label) ?? u.label}</span>
                <span>{u.missingPerWeek}</span>
                <span>
                  {reasonLabel(u.reasonCode)}
                  {u.detail ? <span className="block text-xs text-muted">{u.detail}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="Daftar pertemuan">
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Rombel
            <select name="rombel" defaultValue={fRombel} className={selectClass}>
              <option value="">Semua</option>
              {lookups.rombels.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Mentor
            <select name="tutor" defaultValue={fTutor} className={selectClass}>
              <option value="">Semua</option>
              {tutorOptions}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ruangan
            <select name="room" defaultValue={fRoom} className={selectClass}>
              <option value="">Semua</option>
              {lookups.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Minggu
            <select name="week" defaultValue={fWeek} className={selectClass}>
              <option value="">Semua</option>
              {weeks.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass}>
            Terapkan
          </button>
          <Link href={`/admin/jadwal/${id}`} className={secondaryButtonClass}>
            Reset
          </Link>
        </form>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted">{sessions.length === 0 ? "Belum ada pertemuan. Generate jadwal atau tambah sesi manual." : "Tidak ada pertemuan yang cocok dengan filter."}</p>
        ) : (
          <div className="flex flex-col">
            <p className="mb-2 text-sm text-muted">
              {filtered.length} pertemuan · halaman {page} dari {totalPages}
            </p>
            <div className={`${rowClass} grid-cols-[1.4fr_1.6fr_1fr_0.8fr_1.3fr_1fr_auto] ${headerCellClass}`}>
              <span>Tanggal</span>
              <span>Sesi</span>
              <span>Rombel</span>
              <span>Subtes</span>
              <span>Mentor</span>
              <span>Ruangan</span>
              <span />
            </div>
            {pageRows.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                editable={editable}
                codes={violationsBySession.get(s.id) ?? []}
                names={{
                  rombel: rombelName.get(s.rombelId) ?? "?",
                  subtest: s.displayLabel ? `${s.displayLabel} (${subtestName.get(s.subtestId) ?? "?"})` : (subtestName.get(s.subtestId) ?? "?"),
                  tutor: tutorName.get(s.tutorId) ?? "?",
                  room: roomName.get(s.roomId) ?? "?",
                  slot: slotLabel.get(s.slotNo) ?? `Sesi ${s.slotNo}`,
                }}
                options={{ subtests: subtestOptions, tutors: tutorOptions, rooms: roomOptions, slots: slotOptions }}
              />
            ))}
            <div className="mt-4">
              <Pagination page={page} totalPages={totalPages} hrefFor={hrefFor} />
            </div>
          </div>
        )}
      </Card>

      {editable ? (
        <Card title="Tambah sesi manual">
          <ActionForm action={createSessionAction} submitLabel="Tambah sesi" resetOnSuccess className="flex flex-col gap-3">
            <input type="hidden" name="periodId" value={period.id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                Rombel
                <select name="rombelId" required className={selectClass} defaultValue="">
                  <option value="" disabled>
                    Pilih rombel
                  </option>
                  {lookups.rombels
                    .filter((r) => r.isActive)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Tanggal
                <input name="sessionDate" type="date" required min={period.startDate} max={period.endDate} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Sesi
                <select name="slotNo" required className={selectClass} defaultValue="">
                  <option value="" disabled>
                    Pilih sesi
                  </option>
                  {slotOptions}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Subtes
                <select name="subtestId" required className={selectClass} defaultValue="">
                  <option value="" disabled>
                    Pilih subtes
                  </option>
                  {subtestOptions}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Mentor
                <select name="tutorId" required className={selectClass} defaultValue="">
                  <option value="" disabled>
                    Pilih mentor
                  </option>
                  {tutorOptions}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Ruangan
                <select name="roomId" required className={selectClass} defaultValue="">
                  <option value="" disabled>
                    Pilih ruangan
                  </option>
                  {roomOptions}
                </select>
              </label>
            </div>
            <p className="text-xs text-muted">
              Setiap perubahan dicek: bentrok mentor/ruangan/rombel, kapasitas, kompetensi, availability, ruangan tetap, dan
              hari/sesi aktif. Yang melanggar ditolak dengan alasan.
            </p>
          </ActionForm>
        </Card>
      ) : null}

      {editable ? (
        <Card title="Periode">
          <ActionForm action={updatePeriodAction} submitLabel="Simpan periode" className="flex flex-col gap-3">
            <input type="hidden" name="id" value={period.id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                Nama
                <input name="name" required maxLength={100} defaultValue={period.name} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Tanggal mulai
                <input name="startDate" type="date" required defaultValue={period.startDate} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Tanggal selesai
                <input name="endDate" type="date" required defaultValue={period.endDate} className={inputClass} />
              </label>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}

type RowProps = {
  s: TeachingSession;
  editable: boolean;
  codes: readonly ViolationCode[];
  names: { rombel: string; subtest: string; tutor: string; room: string; slot: string };
  options: {
    subtests: ReactNode;
    tutors: ReactNode;
    rooms: ReactNode;
    slots: ReactNode;
  };
};

function SessionRow({ s, editable, codes, names, options }: RowProps) {
  return (
    <div className="border-b border-line py-2">
      <div className="grid grid-cols-[1.4fr_1.6fr_1fr_0.8fr_1.3fr_1fr_auto] items-center gap-3 text-sm">
        <span>
          {dayName(isoDow(s.sessionDate))}, {s.sessionDate}
        </span>
        <span>{names.slot}</span>
        <span>{names.rombel}</span>
        <span>{names.subtest}</span>
        <span>{names.tutor}</span>
        <span>{names.room}</span>
        <span className="flex items-center gap-2">
          {s.source === "MANUAL" ? <Badge tone="primary">Manual</Badge> : null}
          {s.source === "ADDITIONAL" ? <Badge tone="success">Tambahan</Badge> : null}
          {codes.length > 0 ? <Badge tone="danger">Pelanggaran</Badge> : null}
        </span>
      </div>
      {codes.length > 0 ? (
        <p className="mt-1 text-xs text-red-700">{codes.map((c) => VIOLATION_LABELS[c]).join("; ")}</p>
      ) : null}
      {editable ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-primary">Ubah / batalkan</summary>
          <div className="mt-2 flex flex-col gap-3 rounded-lg bg-neutral-soft p-3">
            <ActionForm action={updateSessionAction} submitLabel="Simpan perubahan" className="flex flex-col gap-3">
              <input type="hidden" name="id" value={s.id} />
              <div className="grid gap-3 sm:grid-cols-5">
                <label className="flex flex-col gap-1 text-xs">
                  Tanggal
                  <input name="sessionDate" type="date" required defaultValue={s.sessionDate} className={inputClass} />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Sesi
                  <select name="slotNo" defaultValue={String(s.slotNo)} className={selectClass}>
                    {options.slots}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Subtes
                  <select name="subtestId" defaultValue={s.subtestId} className={selectClass}>
                    {options.subtests}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Mentor
                  <select name="tutorId" defaultValue={s.tutorId} className={selectClass}>
                    {options.tutors}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Ruangan
                  <select name="roomId" defaultValue={s.roomId} className={selectClass}>
                    {options.rooms}
                  </select>
                </label>
              </div>
            </ActionForm>
            <ActionForm action={cancelSessionAction} submitLabel="Batalkan sesi ini">
              <input type="hidden" name="id" value={s.id} />
            </ActionForm>
          </div>
        </details>
      ) : null}
    </div>
  );
}

