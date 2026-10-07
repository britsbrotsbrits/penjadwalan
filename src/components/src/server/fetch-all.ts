// PostgREST membatasi satu respons (default 1000 baris) TANPA error. Untuk tabel yang bisa lebih
// besar dari itu, baca per halaman sampai habis supaya data tidak terpotong diam-diam.
// Pemanggil WAJIB memberi urutan yang stabil pada query-nya.
const PAGE = 1000;

export async function fetchAll<T>(
  what: string,
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(`Gagal memuat ${what}.`);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE) return rows;
  }
}
