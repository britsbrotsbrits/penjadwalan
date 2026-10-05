/**
 * Parsing parameter daftar siswa (query string) dan helper paginasi. Murni.
 * Semua input dari URL tidak dipercaya: nilai tidak valid jatuh ke default, bukan error.
 */

export const STUDENT_PAGE_SIZE = 25;
export const SEARCH_MAX_LENGTH = 100;

export type StudentStatusFilter = "aktif" | "nonaktif" | "semua";

export type StudentListParams = {
  q: string;
  rombelId: string;
  status: StudentStatusFilter;
  page: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function single(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function parseStudentListParams(
  raw: Record<string, string | string[] | undefined>,
): StudentListParams {
  const q = single(raw.q).trim().slice(0, SEARCH_MAX_LENGTH);

  const rombelRaw = single(raw.rombel).trim();
  const rombelId = isUuid(rombelRaw) ? rombelRaw : "";

  const statusRaw = single(raw.status).trim();
  const status: StudentStatusFilter =
    statusRaw === "nonaktif" || statusRaw === "semua" ? statusRaw : "aktif";

  const pageRaw = Number(single(raw.page));
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 100000 ? pageRaw : 1;

  return { q, rombelId, status, page };
}

/**
 * Siapkan teks pencarian untuk pola ilike di filter PostgREST `.or(...)`.
 * Membuang karakter yang bermakna di sintaks filter (koma, kurung, tanda kutip, backslash)
 * dan meng-escape wildcard LIKE (% dan _) supaya dicari sebagai teks biasa.
 */
export function sanitizeSearchTerm(term: string): string {
  return term
    .replace(/[,()"'\\]/g, " ")
    .replace(/[%_]/g, (c) => `\\${c}`)
    .replace(/\s+/g, " ")
    .trim();
}

/** Rentang baris (inklusif) untuk Supabase `.range(from, to)`. */
export function pageRange(page: number, pageSize = STUDENT_PAGE_SIZE): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function totalPages(totalRows: number, pageSize = STUDENT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

/** Query string daftar siswa; nilai default tidak ditulis supaya URL tetap pendek. */
export function buildStudentListQuery(params: StudentListParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.rombelId) search.set("rombel", params.rombelId);
  if (params.status !== "aktif") search.set("status", params.status);
  if (params.page > 1) search.set("page", String(params.page));
  const text = search.toString();
  return text ? `?${text}` : "";
}
