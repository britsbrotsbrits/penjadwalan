import { z } from "zod";
import { fetchAll } from "@/server/fetch-all";
import { createClient } from "@/lib/supabase/server";
import { distributionRowSchema, patternRowSchema, settingRowSchema } from "@/lib/config/schemas";
import type { DistributionItem } from "@/lib/config/distribution";
import type { PatternItem } from "@/lib/config/pattern";
import type { SettingRow } from "@/lib/config/resolver";

// Hanya untuk kode server; RLS membatasi pembacaan ke admin (hasil kosong = bukan admin).

export async function listSettings(): Promise<SettingRow[]> {
  const supabase = await createClient();
  const rows = await fetchAll("konfigurasi", (from, to) =>
    supabase
      .from("scheduling_settings")
      .select("key, scope_type, scope_id, day_of_week, value")
      .order("id", { ascending: true })
      .range(from, to),
  );
  return z.array(settingRowSchema).parse(rows);
}

export async function listDistributionItems(): Promise<DistributionItem[]> {
  const supabase = await createClient();
  const rows = await fetchAll("distribusi subtes", (from, to) =>
    supabase
      .from("subtest_distribution_items")
      .select("scope_type, scope_id, subtest_id, flexible_subtest_ids, label, sessions_per_week, sort_order")
      .order("id", { ascending: true })
      .range(from, to),
  );
  return z.array(distributionRowSchema).parse(rows);
}

export async function listSessionPatterns(): Promise<PatternItem[]> {
  const supabase = await createClient();
  const rows = await fetchAll("pola sesi", (from, to) =>
    supabase
      .from("session_pattern_items")
      .select("scope_type, scope_id, slot_no, kind")
      .order("id", { ascending: true })
      .range(from, to),
  );
  return z.array(patternRowSchema).parse(rows);
}
