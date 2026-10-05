import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  classTypeRowSchema,
  historyRowSchema,
  programRowSchema,
  rombelCountRowSchema,
  rombelRowSchema,
  studentRowSchema,
  type ClassType,
  type Program,
  type Rombel,
  type RombelCount,
  type RombelHistory,
  type Student,
} from "@/lib/academic/schemas";
import {
  pageRange,
  sanitizeSearchTerm,
  type StudentListParams,
} from "@/lib/academic/search";

// Hanya untuk kode server. Query berjalan dengan sesi user (anon key + cookie), jadi RLS berlaku:
// hasil kosong berarti user tidak berhak, bukan error. Halaman tetap memanggil requireRole() sendiri.
// Query sengaja datar (tanpa relasi tertanam); penggabungan nama dilakukan di aplikasi.

function loadFailed(what: string): Error {
  return new Error(`Gagal memuat ${what}.`);
}

export async function listPrograms(): Promise<Program[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programs")
    .select("id, name, sort_order, is_active")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw loadFailed("program");
  return z.array(programRowSchema).parse(data ?? []);
}

export async function listClassTypes(): Promise<ClassType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_types")
    .select("id, program_id, name, default_size, sort_order, is_active")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw loadFailed("tipe kelas");
  return z.array(classTypeRowSchema).parse(data ?? []);
}

export async function listRombels(): Promise<Rombel[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rombels")
    .select("id, class_type_id, name, start_date, end_date, is_active")
    .order("name", { ascending: true });
  if (error) throw loadFailed("rombel");
  return z.array(rombelRowSchema).parse(data ?? []);
}

export async function listRombelCounts(): Promise<RombelCount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rombel_student_counts")
    .select("rombel_id, active_students, total_students");
  if (error) throw loadFailed("jumlah siswa per rombel");
  return z.array(rombelCountRowSchema).parse(data ?? []);
}

export type StudentPage = { rows: Student[]; total: number };

export async function listStudents(params: StudentListParams): Promise<StudentPage> {
  const supabase = await createClient();
  const { from, to } = pageRange(params.page);

  let query = supabase
    .from("students")
    .select("id, student_code, full_name, rombel_id, is_active", { count: "exact" });

  if (params.status === "aktif") query = query.eq("is_active", true);
  if (params.status === "nonaktif") query = query.eq("is_active", false);
  if (params.rombelId) query = query.eq("rombel_id", params.rombelId);

  const term = sanitizeSearchTerm(params.q);
  if (term) query = query.or(`full_name.ilike.%${term}%,student_code.ilike.%${term}%`);

  const { data, error, count } = await query
    .order("full_name", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to);
  if (error) throw loadFailed("siswa");
  return { rows: z.array(studentRowSchema).parse(data ?? []), total: count ?? 0 };
}

/** Satu siswa, atau null bila tidak ada / tidak berhak (RLS). */
export async function getStudent(id: string): Promise<Student | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .select("id, student_code, full_name, rombel_id, is_active")
    .eq("id", id)
    .maybeSingle();
  if (error) throw loadFailed("siswa");
  return data ? studentRowSchema.parse(data) : null;
}

export async function listStudentHistory(studentId: string): Promise<RombelHistory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("student_rombel_history")
    .select("id, student_id, from_rombel_id, to_rombel_id, changed_by, reason, changed_at")
    .eq("student_id", studentId)
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw loadFailed("riwayat rombel");
  return z.array(historyRowSchema).parse(data ?? []);
}

/** Peta id -> nama untuk menampilkan siapa yang memindahkan siswa. Admin boleh membaca semua profile. */
export async function getProfileNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", unique);
  if (error) throw loadFailed("nama pengguna");
  const rows = z.array(z.object({ id: z.string().uuid(), full_name: z.string() })).parse(data ?? []);
  return new Map(rows.map((r) => [r.id, r.full_name]));
}
