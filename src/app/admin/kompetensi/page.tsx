import { requireRole } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { saveCompetenciesAction } from "@/server/tutors/actions";
import { listSubtests } from "@/server/master-data/queries";
import { tutorDisplayName } from "@/lib/tutors/labels";
import {
  getAccountEmails,
  listCompetencies,
  listTutorAccounts,
  listTutorProfiles,
} from "@/server/tutors/queries";

export default async function KompetensiPage() {
  await requireRole(["admin"]);
  const [accounts, profiles, competencies, subtests] = await Promise.all([
    listTutorAccounts(),
    listTutorProfiles(),
    listCompetencies(),
    listSubtests(),
  ]);
  const emails = await getAccountEmails(accounts.map((a) => a.id));

  const profileByAccount = new Map(profiles.map((p) => [p.profileId, p]));
  const held = new Map<string, Set<string>>();
  for (const c of competencies) {
    const set = held.get(c.tutorId) ?? new Set<string>();
    set.add(c.subtestId);
    held.set(c.tutorId, set);
  }

  const tutors = accounts.flatMap((account) => {
    const profile = profileByAccount.get(account.id);
    return profile ? [{ account, profile }] : [];
  });
  const withoutAny = tutors.filter((t) => (held.get(t.profile.id)?.size ?? 0) === 0).length;

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Kompetensi Mentor</h1>
        <p className="mt-1 max-w-3xl text-sm opacity-70">
          Centang subtes yang boleh diajar tiap mentor. Kompetensi adalah batas keras penjadwalan: mentor
          hanya akan dijadwalkan pada subtes yang dicentang. Setiap penyimpanan mengganti seluruh daftar
          kompetensi mentor itu.
        </p>
      </div>

      <p className="text-sm opacity-70" role="status">
        {tutors.length} mentor · {withoutAny} belum punya kompetensi.
      </p>

      {subtests.length === 0 ? (
        <p className="text-sm opacity-70">Belum ada subtes. Tambahkan di menu Subtes.</p>
      ) : null}

      <section aria-label="Kompetensi per mentor" className="flex flex-col gap-3">
        {tutors.length === 0 ? (
          <p className="text-sm opacity-70">Belum ada mentor. Lihat menu Daftar Mentor.</p>
        ) : null}
        {tutors.map(({ account, profile }) => {
          const mine = held.get(profile.id) ?? new Set<string>();
          const name = tutorDisplayName(account.fullName, emails.get(account.id) ?? null);
          // Subtes nonaktif hanya ditampilkan bila mentor masih memegangnya (supaya tidak hilang diam-diam).
          const options = subtests.filter((s) => s.isActive || mine.has(s.id));
          return (
            <ActionForm
              key={profile.id}
              action={saveCompetenciesAction}
              submitLabel="Simpan"
              className="flex flex-col gap-3 rounded border border-current/20 p-4"
            >
              <input type="hidden" name="tutorId" value={profile.id} />
              <div>
                <p className="font-medium">{name}</p>
                {mine.size === 0 ? <p className="text-xs text-amber-600">Belum ada kompetensi</p> : null}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {options.map((subtest) => (
                  <label key={subtest.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="subtestIds"
                      value={subtest.id}
                      defaultChecked={mine.has(subtest.id)}
                    />
                    {subtest.code}
                    {subtest.isActive ? "" : " (nonaktif)"}
                  </label>
                ))}
              </div>
            </ActionForm>
          );
        })}
      </section>
    </main>
  );
}
