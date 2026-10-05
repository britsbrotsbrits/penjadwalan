import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  availabilityRowSchema,
  competencyRowSchema,
  emailRowSchema,
  tutorAccountRowSchema,
  tutorProfileRowSchema,
  type Competency,
  type TutorAccount,
  type TutorAvailabilityRow,
  type TutorProfile,
} from "@/lib/tutors/schemas";

// Hanya untuk kode server. Query berjalan dengan sesi user (anon key + cookie), jadi RLS berlaku:
// hasil kosong berarti user tidak berhak, bukan error. Halaman tetap memanggil requireRole() sendiri.

function loadFailed(what: string): Error {
  return new Error(`Gagal memuat ${what}.`);
}

// PostgREST membatasi satu respons (default 1000 baris) TANPA error. Untuk tabel yang bisa lebih
// besar dari itu, baca per halaman sampai habis supaya data tidak terpotong diam-diam.
const PAGE = 1000;

async function fetchAll<T>(
  what: string,
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw loadFailed(what);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE) return rows;
  }
}

/** Akun ber-role tutor (admin membaca semua profile; RLS menyaring untuk selain admin). */
export async function listTutorAccounts(): Promise<TutorAccount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, full_name, is_active")
    .eq("role", "tutor")
    .order("full_name", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw loadFailed("akun tutor");
  return z.array(tutorAccountRowSchema).parse(data ?? []);
}

export async function listTutorProfiles(): Promise<TutorProfile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tutor_profiles")
    .select("id, profile_id, level, rate_per_session, is_active, availability_updated_at");
  if (error) throw loadFailed("data tutor");
  return z.array(tutorProfileRowSchema).parse(data ?? []);
}

/** Tutor milik user yang sedang login, atau null (bukan tutor aktif / belum ada baris). */
export async function getMyTutorProfile(): Promise<TutorProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tutor_profiles")
    .select("id, profile_id, level, rate_per_session, is_active, availability_updated_at")
    .maybeSingle();
  if (error) throw loadFailed("data tutor");
  return data ? tutorProfileRowSchema.parse(data) : null;
}

export async function listCompetencies(): Promise<Competency[]> {
  const supabase = await createClient();
  const rows = await fetchAll("kompetensi", (from, to) =>
    supabase
      .from("tutor_competencies")
      .select("tutor_id, subtest_id")
      .order("tutor_id", { ascending: true })
      .order("subtest_id", { ascending: true })
      .range(from, to),
  );
  return z.array(competencyRowSchema).parse(rows);
}

/** Semua availability tersimpan (admin), atau satu tutor bila tutorId diberikan. */
export async function listAvailability(tutorId?: string): Promise<TutorAvailabilityRow[]> {
  const supabase = await createClient();
  const rows = await fetchAll("availability", (from, to) => {
    let query = supabase
      .from("tutor_availability")
      .select("tutor_id, day_of_week, slot_no, available");
    if (tutorId) query = query.eq("tutor_id", tutorId);
    return query
      .order("tutor_id", { ascending: true })
      .order("day_of_week", { ascending: true })
      .order("slot_no", { ascending: true })
      .range(from, to);
  });
  return z.array(availabilityRowSchema).parse(rows);
}

/** Peta id akun -> email (hanya admin; fungsi database menolak selain admin). */
export async function getAccountEmails(profileIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(profileIds)];
  const result = new Map<string, string>();
  // Fungsi database menerima maksimal 500 id per panggilan.
  for (let i = 0; i < unique.length; i += 500) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_profile_emails", {
      p_ids: unique.slice(i, i + 500),
    });
    if (error) throw loadFailed("email akun");
    for (const row of z.array(emailRowSchema).parse(data ?? [])) {
      if (row.email) result.set(row.id, row.email);
    }
  }
  return result;
}
