import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

/**
 * Client service-role: MELEWATI RLS dan boleh mengelola akun (auth.admin). HANYA untuk kode server,
 * dan hanya dipanggil setelah requireRole(["admin"]). Jangan diimpor dari komponen client.
 */
export function createAdminClient() {
  const env = getServerEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
