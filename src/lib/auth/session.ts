import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { parseProfileRow, type CurrentProfile } from "./profile";
import { homePathForRole, type UserRole } from "./roles";

// Hanya untuk kode server (Server Component, Server Action, Route Handler).

export type ActiveSession = {
  status: "active";
  user: { id: string; email: string | null };
  profile: CurrentProfile;
};

export type SessionState =
  | { status: "anonymous" }
  | { status: "inactive"; email: string | null }
  | ActiveSession;

/**
 * Menentukan status sesi. Memakai auth.getUser() (memverifikasi token ke server Auth),
 * BUKAN getSession() yang hanya membaca cookie dan tidak boleh dipercaya untuk otorisasi.
 * Profile dibaca lewat client ber-RLS: user hanya bisa membaca barisnya sendiri.
 */
export async function loadSessionState(supabase: SupabaseClient): Promise<SessionState> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return { status: "anonymous" };

  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, full_name, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error("Gagal membaca profile pengguna.");

  const profile = parseProfileRow(data);
  if (!profile || !profile.isActive) {
    return { status: "inactive", email: user.email ?? null };
  }
  return { status: "active", user: { id: user.id, email: user.email ?? null }, profile };
}

/** Dibungkus cache() agar layout dan page dalam satu request tidak mengulang query. */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();
  return loadSessionState(supabase);
});

/**
 * Guard otorisasi sisi server. WAJIB dipanggil di setiap page, route handler, dan server action
 * yang membaca/mengubah data: layout tidak dijalankan ulang pada navigasi sisi client,
 * jadi pengecekan di layout saja tidak cukup.
 */
export async function requireRole(allowed: readonly UserRole[]): Promise<ActiveSession> {
  const state = await getSessionState();
  if (state.status === "anonymous") redirect("/login");
  if (state.status === "inactive") redirect("/login?reason=inactive");
  if (!allowed.includes(state.profile.role)) redirect(homePathForRole(state.profile.role));
  return state;
}
