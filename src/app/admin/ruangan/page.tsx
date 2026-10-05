import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { createRowClass, headerCellClass, inputClass, rowClass } from "@/components/form-styles";
import { summarizeCapacity } from "@/lib/master-data/capacity";
import { createRoomAction, updateRoomAction } from "@/server/master-data/actions";
import { listRooms } from "@/server/master-data/queries";
import { buildRombelLabels } from "@/lib/academic/labels";
import { analyzeFixedRooms } from "@/lib/rooms/fixed-room";
import {
  listClassTypes,
  listPrograms,
  listRombelCounts,
  listRombels,
} from "@/server/academic/queries";

const GRID = "grid-cols-[minmax(12rem,1fr)_8rem_5rem_auto]";

export default async function RuanganPage() {
  await requireRole(["admin"]);
  const [rooms, programs, classTypes, rombels, counts] = await Promise.all([
    listRooms(),
    listPrograms(),
    listClassTypes(),
    listRombels(),
    listRombelCounts(),
  ]);
  const activeCount = rooms.filter((room) => room.isActive).length;
  const groups = summarizeCapacity(rooms);

  // Pemakaian sebagai ruangan tetap (hanya rombel aktif).
  const rombelLabels = buildRombelLabels(programs, classTypes, rombels);
  const analysis = analyzeFixedRooms({
    rombels,
    rooms,
    classTypes,
    counts: counts.map((c) => ({ rombelId: c.rombelId, activeStudents: c.activeStudents })),
  });
  const usage = rooms
    .map((room) => ({ room, rombelIds: analysis.byRoom.get(room.id) ?? [] }))
    .filter((u) => u.rombelIds.length > 0);

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Ruangan</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-70">
          Kapasitas adalah batas keras penjadwalan: sebuah ruangan hanya boleh dipakai rombel yang
          jumlah siswanya tidak melebihi kapasitas. Daftar ruangan awal belum final; tambahkan
          ruangan lain di sini. Ruangan tidak dihapus, hanya dinonaktifkan.
        </p>
      </div>

      <section aria-label="Ringkasan kapasitas" className="rounded border border-current/20 p-4">
        <p className="text-sm">
          Ruangan aktif: <strong>{activeCount}</strong> dari {rooms.length}
        </p>
        {groups.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {groups.map((group) => (
              <li key={group.capacity} className="rounded border border-current/20 px-2 py-1">
                {group.capacity} siswa: {group.count} ruangan
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {usage.length > 0 ? (
        <section aria-labelledby="ruangan-tetap" className="rounded border border-current/20 p-4">
          <h2 id="ruangan-tetap" className="mb-1 font-medium">
            Dipakai sebagai ruangan tetap
          </h2>
          <p className="mb-3 text-sm opacity-70">
            Ruangan yang ditetapkan untuk rombel aktif (diatur di halaman Rombel). Beberapa rombel boleh
            berbagi satu ruangan, tetapi tidak boleh bentrok waktu saat dijadwalkan. Menonaktifkan ruangan
            yang dipakai di sini tidak diblokir, tetapi rombelnya perlu dipindahkan ke ruangan lain.
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {usage.map(({ room, rombelIds }) => (
              <li key={room.id} className="rounded border border-current/10 p-2">
                <p className="font-medium">
                  {room.name} ({room.capacity} kursi)
                  {room.isActive ? "" : <span className="ml-2 text-red-600">Nonaktif, ganti ruangan rombel di bawah</span>}
                  {rombelIds.length >= 2 ? (
                    <span className="ml-2 text-xs font-normal text-amber-600">
                      Dibagi {rombelIds.length} rombel: pastikan waktunya tidak bentrok
                    </span>
                  ) : null}
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {rombelIds.map((id) => {
                    const issues = (analysis.byRombel.get(id)?.issues ?? []).filter(
                      (i) => i.code === "ROOM_TOO_SMALL",
                    );
                    return (
                      <li key={id}>
                        {rombelLabels.get(id) ?? "?"}
                        {issues.map((i) => (
                          <span
                            key={i.code}
                            className={`ml-2 text-xs ${i.severity === "error" ? "text-red-600" : "text-amber-600"}`}
                          >
                            {i.message}
                          </span>
                        ))}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="tambah-ruangan" className="rounded border border-current/20 p-4">
        <h2 id="tambah-ruangan" className="mb-3 font-medium">
          Tambah ruangan
        </h2>
        <ActionForm
          action={createRoomAction}
          submitLabel="Tambah"
          resetOnSuccess
          className={`${createRowClass} ${GRID}`}
        >
          <input
            name="name"
            placeholder="Nama ruangan"
            aria-label="Nama ruangan baru"
            required
            maxLength={100}
            className={inputClass}
          />
          <input
            name="capacity"
            type="number"
            min={1}
            max={500}
            placeholder="Kapasitas"
            aria-label="Kapasitas ruangan baru"
            required
            className={inputClass}
          />
          <label className="flex items-center gap-2 text-sm">
            <input name="isActive" type="checkbox" defaultChecked />
            Aktif
          </label>
        </ActionForm>
      </section>

      <section aria-label="Daftar ruangan" className="overflow-x-auto">
        <div className="min-w-[40rem]">
          <div className={`${rowClass} ${GRID}`}>
            <span className={headerCellClass}>Nama</span>
            <span className={headerCellClass}>Kapasitas</span>
            <span className={headerCellClass}>Status</span>
            <span />
          </div>
          {rooms.length === 0 ? (
            <p className="py-4 text-sm opacity-70">
              Belum ada ruangan. Tambahkan di atas, atau jalankan seed awal (lihat README).
            </p>
          ) : null}
          {rooms.map((room) => (
            <ActionForm
              key={room.id}
              action={updateRoomAction}
              submitLabel="Simpan"
              className={`${rowClass} ${GRID}`}
            >
              <input type="hidden" name="id" value={room.id} />
              <input
                name="name"
                defaultValue={room.name}
                aria-label={`Nama ruangan ${room.name}`}
                required
                maxLength={100}
                className={inputClass}
              />
              <input
                name="capacity"
                type="number"
                min={1}
                max={500}
                defaultValue={room.capacity}
                aria-label={`Kapasitas ${room.name}`}
                required
                className={inputClass}
              />
              <label className="flex items-center gap-2 text-sm">
                <input name="isActive" type="checkbox" defaultChecked={room.isActive} />
                Aktif
              </label>
            </ActionForm>
          ))}
        </div>
      </section>
    </main>
  );
}
