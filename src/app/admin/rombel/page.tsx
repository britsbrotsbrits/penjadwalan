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
import { analyzeFixedRooms, worstSeverity } from "@/lib/rooms/fixed-room";
import { describePattern, resolvePattern } from "@/lib/config/pattern";
import { dayName } from "@/lib/master-data/time";
import { listSessionPatterns } from "@/server/config/queries";
import { listRooms, listSessionSlots } from "@/server/master-data/queries";
import { createRombelAction, saveRombelDefaultsAction, updateRombelAction } from "@/server/academic/actions";
import {
  listClassTypes,
  listPrograms,
  listRombelCounts,
  listRombels,
} from "@/server/academic/queries";

const GRID = "grid-cols-[13rem_minmax(9rem,1fr)_9rem_9rem_15rem_12rem_5rem_auto]";

const levelClass = {
  ok: "opacity-70",
  full: "text-amber-600",
  over: "font-medium text-red-600",
} as const;

export default async function RombelPage() {
  await requireRole(["admin"]);
  const [programs, classTypes, rombels, counts, rooms, patterns, slotRows] = await Promise.all([
    listPrograms(),
    listClassTypes(),
    listRombels(),
    listRombelCounts(),
    listRooms(),
    listSessionPatterns(),
    listSessionSlots(),
  ]);
  const activeSlots = slotRows.filter((x) => x.isActive);

  const classTypeLabels = buildClassTypeLabels(programs, classTypes);
  const classTypeById = new Map(classTypes.map((c) => [c.id, c]));
  const countByRombel = new Map(counts.map((c) => [c.rombelId, c]));
  const programOrder = new Map(programs.map((p, i) => [p.id, i]));
  const activeClassTypes = classTypes.filter((c) => c.isActive);
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const activeRooms = rooms.filter((r) => r.isActive);
  const analysis = analyzeFixedRooms({
    rombels,
    rooms,
    classTypes,
    counts: counts.map((c) => ({ rombelId: c.rombelId, activeStudents: c.activeStudents })),
  });
  const roomLabel = (r: { name: string; capacity: number; isActive: boolean }) =>
    `${r.name} (${r.capacity} kursi)${r.isActive ? "" : " - nonaktif"}`;

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
          Ruangan tetap (opsional) adalah ruangan yang selalu dipakai rombel ini; beberapa rombel boleh
          berbagi satu ruangan. Peringatan kapasitas dibandingkan dengan siswa aktif (atau ukuran standar bila belum
          ada siswa). Rombel tidak dihapus, hanya dinonaktifkan, dan siswa baru tidak bisa dimasukkan ke rombel
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
            className={`${createRowClass} grid-cols-[16rem_minmax(9rem,1fr)_9rem_9rem_15rem_5rem_auto]`}
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
            <select name="fixedRoomId" aria-label="Ruangan tetap baru" className={selectClass} defaultValue="">
              <option value="">Tanpa ruangan tetap</option>
              {activeRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {roomLabel(r)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input name="isActive" type="checkbox" defaultChecked />
              Aktif
            </label>
          </ActionForm>
        )}
      </section>

      <section aria-label="Daftar rombel" className="overflow-x-auto">
        <div className="min-w-[88rem]">
          <div className={`${rowClass} ${GRID}`}>
            <span className={headerCellClass}>Tipe kelas</span>
            <span className={headerCellClass}>Nama</span>
            <span className={headerCellClass}>Mulai</span>
            <span className={headerCellClass}>Selesai</span>
            <span className={headerCellClass}>Ruangan tetap</span>
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
            const evaluation = analysis.byRombel.get(rombel.id);
            const currentRoom = rombel.fixedRoomId ? roomById.get(rombel.fixedRoomId) : undefined;
            // Ruangan nonaktif yang masih terpasang tetap ditampilkan agar tidak hilang diam-diam.
            const roomOptions =
              currentRoom && !currentRoom.isActive ? [...activeRooms, currentRoom] : activeRooms;
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
                <div className="flex flex-col gap-1">
                  <select
                    name="fixedRoomId"
                    defaultValue={rombel.fixedRoomId ?? ""}
                    aria-label={`Ruangan tetap ${rombel.name}`}
                    className={selectClass}
                  >
                    <option value="">Tanpa ruangan tetap</option>
                    {roomOptions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {roomLabel(r)}
                      </option>
                    ))}
                  </select>
                  {evaluation && worstSeverity(evaluation) !== "ok" ? (
                    <ul className="flex flex-col gap-0.5 text-xs">
                      {evaluation.issues
                        .filter((i) => i.code !== "SIZE_ESTIMATED")
                        .map((i) => (
                          <li key={i.code} className={i.severity === "error" ? "text-red-600" : "text-amber-600"}>
                            {i.message}
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </div>
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

      <section aria-labelledby="sesi-default" className="flex flex-col gap-3">
        <div>
          <h2 id="sesi-default" className="text-lg font-semibold">
            Sesi default rombel
          </h2>
          <p className="max-w-3xl text-sm opacity-70">
            Jadwal kaku yang tidak boleh berpindah. <strong>Sesi default</strong> = rombel selalu belajar di sesi itu
            (contoh kelas 3 SMA: General A-E, VVIP A-B, dan Fast Track A selalu Sesi 4, yang lain Sesi 5).{" "}
            <strong>Hari</strong> = rombel hanya belajar pada hari yang dicentang (kosong = semua hari belajar).{" "}
            <strong>Siklus</strong> = belajar hanya 1 minggu tiap N minggu (contoh kelas 2 SMA: Selasa, Rabu, Jumat,
            siklus 3 minggu); isi <strong>Mulai siklus</strong> dengan tanggal di minggu pertama siklus (kosong =
            minggu pertama periode jadwal). Kosongkan sesi default bila rombel mengikuti pola tipe kelas
            (menu Pola Sesi, mis. Gap Year). Berlaku untuk Generate berikutnya.
          </p>
        </div>
        <div className="overflow-x-auto">
          <div className="flex min-w-[78rem] flex-col">
            {sorted
              .filter((r) => r.isActive)
              .map((rombel) => {
                const classType = classTypeById.get(rombel.classTypeId);
                const resolved = resolvePattern(patterns, {
                  rombelId: rombel.id,
                  classTypeId: rombel.classTypeId,
                  programId: classType?.programId,
                });
                const inherited = rombel.defaultSlotNo === null && resolved.status === "found" ? describePattern(resolved.items) : null;
                return (
                  <ActionForm
                    key={rombel.id}
                    action={saveRombelDefaultsAction}
                    submitLabel="Simpan"
                    className="grid grid-cols-[14rem_11rem_minmax(18rem,1fr)_6rem_10rem_auto] items-center gap-3 border-b border-current/10 py-2"
                  >
                    <input type="hidden" name="rombelId" value={rombel.id} />
                    <span className="text-sm">
                      {rombel.name}
                      <span className="block text-xs opacity-60">{classTypeLabels.get(rombel.classTypeId) ?? "?"}</span>
                    </span>
                    <label className="flex flex-col gap-1 text-xs">
                      Sesi default
                      <select name="slotNo" defaultValue={rombel.defaultSlotNo === null ? "" : String(rombel.defaultSlotNo)} className={selectClass}>
                        <option value="">{inherited ? `(ikut pola: ${inherited})` : "(tidak diatur)"}</option>
                        {activeSlots.map((slot) => (
                          <option key={slot.slotNo} value={slot.slotNo}>
                            Sesi {slot.slotNo} ({slot.startTime}-{slot.endTime})
                          </option>
                        ))}
                      </select>
                    </label>
                    <fieldset className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <legend className="mb-1">Hari belajar</legend>
                      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                        <label key={d} className="flex items-center gap-1">
                          <input name="days" type="checkbox" value={d} defaultChecked={rombel.defaultDays?.includes(d) ?? false} />
                          {dayName(d)}
                        </label>
                      ))}
                    </fieldset>
                    <label className="flex flex-col gap-1 text-xs">
                      Siklus (minggu)
                      <input name="cycleWeeks" type="number" min={1} max={12} defaultValue={rombel.cycleWeeks} className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      Mulai siklus
                      <input name="cycleAnchor" type="date" defaultValue={rombel.cycleAnchor ?? ""} className={inputClass} />
                    </label>
                  </ActionForm>
                );
              })}
          </div>
        </div>
      </section>
    </main>
  );
}
