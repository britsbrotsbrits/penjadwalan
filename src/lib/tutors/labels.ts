/** Label tampilan tutor. Murni. */

/** 50000 -> "Rp50.000"; null -> "-". Format Indonesia (titik sebagai pemisah ribuan). */
export function formatRupiah(amount: number | null): string {
  if (amount === null) return "-";
  const digits = String(Math.trunc(Math.abs(amount)));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${amount < 0 ? "-" : ""}Rp${grouped}`;
}

/** Nama untuk daftar; akun yang namanya masih kosong diberi penanda, bukan string kosong. */
export function tutorDisplayName(fullName: string, email: string | null): string {
  const name = fullName.trim();
  if (name) return name;
  return email ? `(tanpa nama) ${email}` : "(tanpa nama)";
}
