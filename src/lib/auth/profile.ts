import { z } from "zod";
import { USER_ROLES, type UserRole } from "./roles";

const profileRowSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(USER_ROLES),
  full_name: z.string(),
  is_active: z.boolean(),
});

export type CurrentProfile = {
  id: string;
  role: UserRole;
  fullName: string;
  isActive: boolean;
};

/**
 * Validasi runtime baris `profiles` dari Supabase. Mengembalikan null bila baris
 * tidak ada atau bentuknya tidak sesuai (jangan percaya data yang tidak divalidasi).
 */
export function parseProfileRow(row: unknown): CurrentProfile | null {
  const parsed = profileRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const { id, role, full_name, is_active } = parsed.data;
  return { id, role, fullName: full_name, isActive: is_active };
}
