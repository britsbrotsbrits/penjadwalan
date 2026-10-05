import Link from "next/link";

type Props = {
  page: number;
  totalPages: number;
  /** Membuat href untuk halaman tertentu, mempertahankan filter lain. */
  hrefFor: (page: number) => string;
};

const linkClass = "rounded border border-current/30 px-3 py-1 text-sm hover:border-current/60";
const disabledClass = "rounded border border-current/10 px-3 py-1 text-sm opacity-40";

export function Pagination({ page, totalPages, hrefFor }: Props) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Halaman" className="flex items-center gap-3">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={linkClass}>
          Sebelumnya
        </Link>
      ) : (
        <span className={disabledClass}>Sebelumnya</span>
      )}
      <span className="text-sm">
        Halaman {page} dari {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className={linkClass}>
          Berikutnya
        </Link>
      ) : (
        <span className={disabledClass}>Berikutnya</span>
      )}
    </nav>
  );
}
