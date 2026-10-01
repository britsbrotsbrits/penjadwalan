/**
 * Role aplikasi. Harus sama dengan enum `public.user_role` di database
 * (supabase/migrations/20261001150000_create_profiles_and_roles.sql).
 * Modul ini murni: tanpa Supabase/React/Next, mudah dites.
 */
export const USER_ROLES = ["admin", "tutor"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/** Halaman beranda tiap role setelah login. */
export function homePathForRole(role: UserRole): string {
  return role === "admin" ? "/admin" : "/tutor";
}

const AREA_BY_PREFIX: ReadonlyArray<{ prefix: string; role: UserRole }> = [
  { prefix: "/admin", role: "admin" },
  { prefix: "/tutor", role: "tutor" },
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Role yang dibutuhkan untuk sebuah path, atau null bila path publik. */
export function requiredRoleForPath(pathname: string): UserRole | null {
  for (const { prefix, role } of AREA_BY_PREFIX) {
    if (matchesPrefix(pathname, prefix)) return role;
  }
  return null;
}

export function isProtectedPath(pathname: string): boolean {
  return requiredRoleForPath(pathname) !== null;
}
