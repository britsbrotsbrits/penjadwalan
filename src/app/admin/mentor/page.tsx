import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { headerCellClass, inputClass, rowClass } from "@/components/form-styles";
import { tutorDisplayName } from "@/lib/tutors/labels";
import { updateTutorAction } from "@/server/tutors/actions";
import { getAccountEmails, listTutorAccounts, listTutorProfiles } from "@/server/tutors/queries";

const GRID = "grid-cols-[minmax(11rem,1fr)_13rem_6rem_8rem_5rem_9rem_auto]";

export default async function MentorPage() {
  await requireRole(["admin"]);
  const [accounts, profiles] = await Promise.all([listTutorAccounts(), listTutorProfiles()]);
  const emails = await getAccountEmails(accounts.map((a) => a.id));

  const profileByAccount = new Map(profiles.map((p) => [p.profileId, p]));
  const rows = accounts.flatMap((account) => {
    const profile = profileByAccount.get(account.id);
    return profile ? [{ account, profile }] : [];
  });
  const missing = accounts.length - rows.length;
  const notSchedulable = rows.filter((r) => !r.profile.isSchedulable).length;

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Daftar Mentor</h1>
        <p className="mt-1 max-w-3xl text-sm opacity-70">
          Mentor (tutor) muncul di sini otomatis begitu akunnya dibuat di Supabase (Authentication → Users).
          Akun baru berstatus <strong>nonaktif</strong> dan <strong>belum dapat dijadwalkan</strong> sampai
          Anda mengisi nama, level, dan rate lalu mencentang kedua kotak. Akun dan mentor tidak dihapus,
          hanya dinonaktifkan.
        </p>
      </div>

      <section aria-label="Penjelasan kolom" className="rounded border border-current/20 p-4 text-sm">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong>Akun aktif</strong>: boleh login. Akun nonaktif tidak bisa masuk sama sekali.
          </li>
          <li>
            <strong>Dapat dijadwalkan</strong>: boleh dimasukkan ke penjadwalan. Mentor boleh login dan mengisi
            availability walau belum dapat dijadwalkan.
          </li>
          <li>
            <strong>Level</strong>: peringkat seniority 0 sampai 99 (makin tinggi makin senior). Seniority hanya
            preferensi lunak, bukan batas; bobotnya diatur di konfigurasi akademik (phase berikutnya).
          </li>
          <li>
            <strong>Rate</strong>: Rupiah per sesi, angka bulat tanpa titik. Kosong berarti belum diisi.
          </li>
        </ul>
        <p className="mt-3 opacity-70">
          {rows.length} mentor · {notSchedulable} belum dapat dijadwalkan
          {missing > 0 ? ` · ${missing} akun tanpa data mentor (hubungi pengembang)` : ""}.
        </p>
      </section>

      <section aria-label="Daftar mentor" className="overflow-x-auto">
        <div className="min-w-[68rem]">
          <div className={`${rowClass} ${GRID}`}>
            <span className={headerCellClass}>Nama</span>
            <span className={headerCellClass}>Email</span>
            <span className={headerCellClass}>Akun aktif</span>
            <span className={headerCellClass}>Dapat dijadwalkan</span>
            <span className={headerCellClass}>Level</span>
            <span className={headerCellClass}>Rate (Rp/sesi)</span>
            <span />
          </div>
          {rows.length === 0 ? (
            <p className="py-4 text-sm opacity-70">
              Belum ada akun mentor. Buat akun di Supabase (Authentication → Users → Add user), lalu muat ulang
              halaman ini.
            </p>
          ) : null}
          {rows.map(({ account, profile }) => {
            const email = emails.get(account.id) ?? null;
            return (
              <ActionForm
                key={profile.id}
                action={updateTutorAction}
                submitLabel="Simpan"
                className={`${rowClass} ${GRID}`}
              >
                <input type="hidden" name="tutorId" value={profile.id} />
                <input
                  name="fullName"
                  defaultValue={account.fullName}
                  placeholder="Nama lengkap"
                  aria-label={`Nama ${tutorDisplayName(account.fullName, email)}`}
                  required
                  maxLength={200}
                  className={inputClass}
                />
                <span className="break-all text-sm opacity-80">{email ?? "-"}</span>
                <label className="flex items-center gap-2 text-sm">
                  <input name="accountActive" type="checkbox" defaultChecked={account.isAccountActive} />
                  Aktif
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input name="schedulable" type="checkbox" defaultChecked={profile.isSchedulable} />
                  Ya
                </label>
                <input
                  name="level"
                  type="number"
                  min={0}
                  max={99}
                  defaultValue={profile.level}
                  aria-label={`Level ${tutorDisplayName(account.fullName, email)}`}
                  required
                  className={inputClass}
                />
                <input
                  name="rate"
                  inputMode="numeric"
                  defaultValue={profile.ratePerSession ?? ""}
                  placeholder="mis. 50000"
                  aria-label={`Rate ${tutorDisplayName(account.fullName, email)}`}
                  className={inputClass}
                />
              </ActionForm>
            );
          })}
        </div>
      </section>
    </main>
  );
}
