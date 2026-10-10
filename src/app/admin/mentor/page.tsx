import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { headerCellClass, inputClass, rowClass, selectClass } from "@/components/form-styles";
import { tutorDisplayName } from "@/lib/tutors/labels";
import { addTutorAction, updateTutorAction, updateTutorEmailAction } from "@/server/tutors/actions";
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
          Tambahkan mentor lewat formulir di bawah (tidak perlu membuka Supabase). Akun baru berstatus <strong>nonaktif</strong> dan <strong>belum dapat dijadwalkan</strong> sampai
          Anda mengisi nama, level, dan rate lalu mencentang kedua kotak. Akun dan mentor tidak dihapus,
          hanya dinonaktifkan.
        </p>
      </div>

      <section aria-label="Tambah mentor" className="rounded border border-current/20 p-4">
        <h2 className="text-lg font-semibold">Tambah mentor</h2>
        <p className="mt-1 max-w-3xl text-sm opacity-70">
          Membuat akun login dan data mentor sekaligus, tanpa membuka Supabase. Dengan &quot;kirim email undangan&quot;,
          mentor menerima email untuk menetapkan password sendiri. Kompetensi dan availability diisi di menu masing-masing.
        </p>
        <ActionForm action={addTutorAction} submitLabel="Tambah mentor" resetOnSuccess className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-52 flex-col gap-1 text-sm">
              Nama lengkap
              <input name="fullName" required maxLength={200} className={inputClass} />
            </label>
            <label className="flex min-w-64 flex-col gap-1 text-sm">
              Email
              <input name="email" type="email" required maxLength={254} className={inputClass} />
            </label>
            <label className="flex w-24 flex-col gap-1 text-sm">
              Level
              <input name="level" type="number" min={0} max={99} defaultValue={0} required className={inputClass} />
            </label>
            <label className="flex w-40 flex-col gap-1 text-sm">
              Rate (Rp/sesi)
              <input name="rate" inputMode="numeric" placeholder="opsional" className={inputClass} />
            </label>
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2">
              <input name="schedulable" type="checkbox" defaultChecked /> Dapat dijadwalkan
            </label>
            <label className="flex items-center gap-2">
              <input name="sendInvite" type="checkbox" defaultChecked /> Kirim email undangan
            </label>
          </div>
        </ActionForm>
      </section>

      <section aria-label="Ubah email mentor" className="rounded border border-current/20 p-4">
        <h2 className="text-lg font-semibold">Ubah email mentor</h2>
        <p className="mt-1 max-w-3xl text-sm opacity-70">
          Untuk mengganti email sementara (misalnya nama@sementara.local) dengan email asli. Centang kirim email atur-password
          supaya mentor bisa membuat password dan login.
        </p>
        <ActionForm action={updateTutorEmailAction} submitLabel="Simpan email" className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-52 flex-col gap-1 text-sm">
              Mentor
              <select name="tutorId" required className={selectClass}>
                <option value="">(pilih mentor)</option>
                {rows.map(({ account, profile }) => (
                  <option key={profile.id} value={profile.id}>
                    {tutorDisplayName(account.fullName, emails.get(account.id) ?? null)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-64 flex-col gap-1 text-sm">
              Email baru
              <input name="email" type="email" required maxLength={254} className={inputClass} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input name="sendReset" type="checkbox" defaultChecked /> Kirim email atur-password
            </label>
          </div>
        </ActionForm>
      </section>

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
            <strong>Level</strong>: peringkat seniority 0 sampai 99 (makin tinggi makin senior). Menentukan jatah sesi
            per minggu: setiap mentor dapat dulu 20% dari sesi yang dicentang, lalu mentor level tinggi diisi sampai
            kuota (sesi dicentang x level / 100). Kuota bersifat lunak: bisa dilewati bila kebutuhan kelas tidak muat.
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
