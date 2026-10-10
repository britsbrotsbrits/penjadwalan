import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { createRowClass, headerCellClass, inputClass, rowClass, selectClass } from "@/components/form-styles";
import { dayName } from "@/lib/master-data/time";
import {
  createSlotAction,
  saveActiveDaysAction,
  saveTryoutDayAction,
  updateSlotAction,
} from "@/server/master-data/actions";
import { listCalendarDays, listSessionSlots } from "@/server/master-data/queries";

const GRID = "grid-cols-[5rem_8rem_7rem_5rem_5rem_auto]";

export default async function KalenderPage() {
  await requireRole(["admin"]);
  const [days, slots] = await Promise.all([listCalendarDays(), listSessionSlots()]);

  const activeDays = days.filter((day) => day.isActive);
  const activeSlots = slots.filter((slot) => slot.isActive);

  // Usulan nilai awal form tambah: nomor berikutnya, mulai tepat setelah slot terakhir.
  const lastSlot = slots.at(-1);
  const nextSlotNo = (lastSlot?.slotNo ?? 0) + 1;
  const nextStart = lastSlot && lastSlot.endTime && lastSlot.endTime !== "24:00" ? lastSlot.endTime : "07:00";

  return (
    <main className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Kalender</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-70">
          Atur hari aktif dan slot sesi harian. Semua nilai ini adalah pengaturan, bukan aturan
          tetap. Aturan jeda (break) antar sesi belum ditentukan, jadi slot boleh bersebelahan.
        </p>
      </div>

      <section aria-labelledby="hari-aktif" className="rounded border border-current/20 p-4">
        <h2 id="hari-aktif" className="mb-1 font-medium">
          Hari aktif
        </h2>
        <p className="mb-3 text-sm opacity-70">
          {activeDays.length === 0
            ? "Belum ada hari aktif."
            : `${activeDays.length} hari aktif: ${activeDays.map((d) => dayName(d.dayOfWeek)).join(", ")}.`}
        </p>
        <ActionForm
          action={saveActiveDaysAction}
          submitLabel="Simpan hari aktif"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap gap-4">
            {days.map((day) => (
              <label key={day.dayOfWeek} className="flex items-center gap-2 text-sm">
                <input
                  name="days"
                  type="checkbox"
                  value={day.dayOfWeek}
                  defaultChecked={day.isActive}
                />
                {dayName(day.dayOfWeek)}
              </label>
            ))}
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="hari-tryout" className="rounded border border-current/20 p-4">
        <h2 id="hari-tryout" className="mb-1 font-medium">
          Hari tryout
        </h2>
        <p className="mb-3 max-w-2xl text-sm opacity-70">
          Satu hari ditandai tryout (biasanya Sabtu). Hari itu bukan hari belajar reguler: scheduler tidak menjadwalkan
          kelas di sana, dan tabel jadwal kelas menampilkan TRYOUT pada sesi kelas.
        </p>
        <ActionForm action={saveTryoutDayAction} submitLabel="Simpan hari tryout" className="flex flex-col gap-3">
          <label className="flex max-w-xs flex-col gap-1 text-sm">
            Hari tryout
            <select name="day" defaultValue={String(days.find((d) => d.isTryout)?.dayOfWeek ?? "")} className={selectClass}>
              <option value="">(tidak ada)</option>
              {days.map((day) => (
                <option key={day.dayOfWeek} value={day.dayOfWeek}>
                  {dayName(day.dayOfWeek)}
                </option>
              ))}
            </select>
          </label>
        </ActionForm>
      </section>

      <section aria-labelledby="slot-sesi" className="flex flex-col gap-4">
        <div>
          <h2 id="slot-sesi" className="font-medium">
            Slot sesi harian
          </h2>
          <p className="mt-1 text-sm opacity-70">
            {activeSlots.length === 0
              ? "Belum ada slot aktif."
              : `${activeSlots.length} sesi aktif per hari. Jam selesai = jam mulai + durasi. Slot aktif tidak boleh tumpang tindih.`}
          </p>
        </div>

        <div className="rounded border border-current/20 p-4">
          <h3 className="mb-3 text-sm font-medium">Tambah slot</h3>
          <ActionForm
            action={createSlotAction}
            submitLabel="Tambah"
            resetOnSuccess
            className={`${createRowClass} ${GRID}`}
          >
            <input
              name="slotNo"
              type="number"
              min={1}
              max={99}
              defaultValue={nextSlotNo}
              aria-label="Nomor sesi baru"
              required
              className={inputClass}
            />
            <input
              name="startTime"
              type="time"
              defaultValue={nextStart}
              aria-label="Jam mulai sesi baru"
              required
              className={inputClass}
            />
            <input
              name="durationMinutes"
              type="number"
              min={15}
              max={480}
              defaultValue={90}
              aria-label="Durasi sesi baru (menit)"
              required
              className={inputClass}
            />
            <span />
            <label className="flex items-center gap-2 text-sm">
              <input name="isActive" type="checkbox" defaultChecked />
              Aktif
            </label>
          </ActionForm>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[44rem]">
            <div className={`${rowClass} ${GRID}`}>
              <span className={headerCellClass}>No</span>
              <span className={headerCellClass}>Mulai</span>
              <span className={headerCellClass}>Durasi (menit)</span>
              <span className={headerCellClass}>Selesai</span>
              <span className={headerCellClass}>Status</span>
              <span />
            </div>
            {slots.length === 0 ? (
              <p className="py-4 text-sm opacity-70">
                Belum ada slot. Tambahkan di atas, atau jalankan seed awal (lihat README).
              </p>
            ) : null}
            {slots.map((slot) => (
              <ActionForm
                key={slot.id}
                action={updateSlotAction}
                submitLabel="Simpan"
                className={`${rowClass} ${GRID}`}
              >
                <input type="hidden" name="id" value={slot.id} />
                <input
                  name="slotNo"
                  type="number"
                  min={1}
                  max={99}
                  defaultValue={slot.slotNo}
                  aria-label={`Nomor sesi ${slot.slotNo}`}
                  required
                  className={inputClass}
                />
                <input
                  name="startTime"
                  type="time"
                  defaultValue={slot.startTime}
                  aria-label={`Jam mulai sesi ${slot.slotNo}`}
                  required
                  className={inputClass}
                />
                <input
                  name="durationMinutes"
                  type="number"
                  min={15}
                  max={480}
                  defaultValue={slot.durationMinutes}
                  aria-label={`Durasi sesi ${slot.slotNo} (menit)`}
                  required
                  className={inputClass}
                />
                <span className="text-sm tabular-nums">{slot.endTime}</span>
                <label className="flex items-center gap-2 text-sm">
                  <input name="isActive" type="checkbox" defaultChecked={slot.isActive} />
                  Aktif
                </label>
              </ActionForm>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
