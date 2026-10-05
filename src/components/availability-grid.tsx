import { cellKey } from "@/lib/tutors/availability";
import { dayName } from "@/lib/master-data/time";

type Slot = { slotNo: number; startTime: string; endTime: string };

type Props = {
  days: readonly number[];
  slots: readonly Slot[];
  /** Kunci "hari-sesi" -> tersedia. Sel yang tidak ada di peta = belum pernah diisi. */
  values: ReadonlyMap<string, boolean>;
};

/**
 * Grid centang hari x sesi. Dipakai di dalam <ActionForm>; setiap centang dikirim sebagai
 * name="cell" value="hari-sesi". Komponen server (tanpa state): form membaca nilai saat submit.
 * Sel yang belum pernah disimpan diberi garis putus-putus sebagai penanda (dianggap tidak tersedia).
 */
export function AvailabilityGrid({ days, slots, values }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">Availability per hari dan sesi</caption>
        <thead>
          <tr>
            <th scope="col" className="p-2 text-left text-xs font-medium uppercase tracking-wide opacity-60">
              Sesi
            </th>
            {days.map((day) => (
              <th key={day} scope="col" className="p-2 text-center text-xs font-medium uppercase tracking-wide opacity-60">
                {dayName(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.slotNo} className="border-t border-current/10">
              <th scope="row" className="p-2 text-left font-normal">
                <span className="font-medium">Sesi {slot.slotNo}</span>
                <span className="block text-xs opacity-60">
                  {slot.startTime}-{slot.endTime}
                </span>
              </th>
              {days.map((day) => {
                const key = cellKey(day, slot.slotNo);
                const saved = values.get(key);
                return (
                  <td key={key} className="p-1 text-center">
                    <label
                      className={`flex h-9 w-full cursor-pointer items-center justify-center rounded border ${
                        saved === undefined ? "border-dashed border-current/40" : "border-current/20"
                      }`}
                      title={saved === undefined ? "Belum pernah diisi" : undefined}
                    >
                      <input
                        type="checkbox"
                        name="cell"
                        value={key}
                        defaultChecked={saved === true}
                        aria-label={`${dayName(day)} sesi ${slot.slotNo} (${slot.startTime}-${slot.endTime}) tersedia`}
                      />
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
