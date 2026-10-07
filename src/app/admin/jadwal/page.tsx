import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { inputClass, rowClass, headerCellClass } from "@/components/form-styles";
import { Badge, Card, PageHeader } from "@/components/ui";
import { PERIOD_STATUS_LABEL, PERIOD_STATUS_TONE } from "@/lib/schedule/labels";
import { MAX_PERIOD_DAYS } from "@/lib/schedule/schemas";
import { createPeriodAction } from "@/server/schedule/actions";
import { listPeriods } from "@/server/schedule/queries";

export default async function SchedulePeriodsPage() {
  await requireRole(["admin"]);
  const periods = await listPeriods();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Jadwal"
        description="Satu periode jadwal = rentang tanggal. Jadwal dibuat per periode dari data mentor, rombel, ruangan, dan distribusi subtes saat ini."
      />

      <Card title="Buat periode baru">
        <ActionForm action={createPeriodAction} submitLabel="Buat periode" resetOnSuccess className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              Nama periode
              <input name="name" required maxLength={100} placeholder="mis. November 2026" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Tanggal mulai
              <input name="startDate" type="date" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Tanggal selesai
              <input name="endDate" type="date" required className={inputClass} />
            </label>
          </div>
          <p className="text-xs text-muted">
            Maksimal {MAX_PERIOD_DAYS} hari. Periode yang masih aktif tidak boleh tumpang tindih tanggalnya.
            Tanggal merah/libur belum diatur: setiap tanggal pada hari aktif akan terjadwal.
          </p>
        </ActionForm>
      </Card>

      <Card title="Daftar periode">
        {periods.length === 0 ? (
          <p className="text-sm text-muted">Belum ada periode. Buat satu di atas.</p>
        ) : (
          <div className="flex flex-col">
            <div className={`${rowClass} grid-cols-[2fr_2fr_1fr_auto] ${headerCellClass}`}>
              <span>Nama</span>
              <span>Tanggal</span>
              <span>Status</span>
              <span />
            </div>
            {periods.map((p) => (
              <div key={p.id} className={`${rowClass} grid-cols-[2fr_2fr_1fr_auto]`}>
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-muted">
                  {p.startDate} s/d {p.endDate}
                </span>
                <span>
                  <Badge tone={PERIOD_STATUS_TONE[p.status]}>{PERIOD_STATUS_LABEL[p.status]}</Badge>
                </span>
                <Link href={`/admin/jadwal/${p.id}`} className="text-sm font-medium text-primary hover:underline">
                  Buka
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
