import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";

/**
 * Supabase client untuk Server Components, Server Actions, dan Route Handlers.
 * Memakai anon key + sesi user dari cookie, sehingga RLS tetap berlaku.
 * (Client dengan service role sengaja belum dibuat; ditambah saat benar-benar dibutuhkan.)
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Dipanggil dari Server Component (read-only cookies). Aman diabaikan
            // selama refresh sesi ditangani middleware (ditambah di Phase 2).
          }
        },
      },
    },
  );
}
