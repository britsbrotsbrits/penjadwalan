"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadSessionState } from "@/lib/auth/session";
import { homePathForRole } from "@/lib/auth/roles";

export type LoginState = { error: string | null };

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

export async function signInAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Email atau password tidak valid." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Pesan generik: jangan membocorkan apakah email terdaftar.
  if (error) return { error: "Email atau password salah." };

  const state = await loadSessionState(supabase);
  if (state.status !== "active") {
    await supabase.auth.signOut();
    return { error: "Akun Anda belum aktif. Hubungi admin." };
  }

  // Tujuan selalu ditentukan server dari role; parameter ?next sengaja tidak dipakai (open redirect).
  redirect(homePathForRole(state.profile.role));
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
