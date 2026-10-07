import Link from "next/link";

type Props = {
  page: number;
  totalPages: number;
  /** Membuat href untuk halaman tertentu, mempertahankan filter lain. */
  hrefFor: (page: number) => string;
};

const linkClass = "rounded-lg border border-line bg-surface px-3 py-1 text-sm font-medium hover:bg-neutral-soft";
const disabledClass = "rounded-lg border border-line bg-neutral-soft px-3 py-1 text-sm text-disabled";

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
      <span className="text-sm text-muted">
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
