"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { CONFIG_DEFS, type ConfigKey } from "@/lib/config/keys";
import {
  MAX_DISTRIBUTION_ROWS,
  parseDistributionRows,
  parseOptionalValue,
  scopeConfigFormSchema,
  type DistributionFormRow,
} from "@/lib/config/schemas";
import { mapDbError, type DbErrorLike, type MasterEntity } from "@/lib/master-data/db-errors";
import { fail, ok, type FormState } from "@/lib/master-data/form-state";
import { firstIssueMessage } from "@/lib/master-data/schemas";

// Setiap mutasi: requireRole -> Zod -> RPC (admin dicek lagi di database) -> mapDbError -> revalidate.
// Penulisan tabel konfigurasi hanya lewat RPC. TODO Phase 17: audit log perubahan konfigurasi.

const PATHS = ["/admin/sesi-kurikulum", "/admin/distribusi"];

function dbFailure(error: DbErrorLike, entity: MasterEntity): FormState {
  console.error(`[config:${entity}]`, error.code, error.message);
  return fail(mapDbError(error, entity));
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

const FIELDS: ReadonlyArray<{ key: ConfigKey; field: string }> = [
  { key: "sessions_per_day", field: "sessionsPerDay" },
  { key: "weekly_sessions", field: "weeklySessions" },
];

/**
 * Simpan sesi/hari dan sesi/minggu pada satu scope. Kolom kosong = hapus override di scope itu
 * (kembali mewarisi parent). Semua isian divalidasi dulu; baru kemudian ditulis.
 */
export async function saveScopeConfigAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const scope = scopeConfigFormSchema.safeParse({
    scopeType: text(formData, "scopeType"),
    scopeId: text(formData, "scopeId"),
  });
  if (!scope.success) return fail(firstIssueMessage(scope.error));

  const ops: Array<{ key: ConfigKey; value: number | null }> = [];
  for (const { key, field } of FIELDS) {
    const parsed = parseOptionalValue(key, text(formData, field));
    if (!parsed.ok) return fail(parsed.message);
    ops.push({ key, value: parsed.value });
  }

  const supabase = await createClient();
  const done: string[] = [];
  for (const { key, value } of ops) {
    const { error } =
      value === null
        ? await supabase.rpc("clear_scheduling_setting", {
            p_key: key,
            p_scope_type: scope.data.scopeType,
            p_scope_id: scope.data.scopeId,
            p_day: null,
          })
        : await supabase.rpc("set_scheduling_setting", {
            p_key: key,
            p_scope_type: scope.data.scopeType,
            p_scope_id: scope.data.scopeId,
            p_day: null,
            p_value: value,
          });
    if (error) {
      const failed = dbFailure(error, "konfigurasi");
      const prefix = `${CONFIG_DEFS[key].label}: ${failed.message}`;
      return fail(done.length > 0 ? `${prefix} (${done.join(", ")} sudah tersimpan.)` : prefix);
    }
    done.push(CONFIG_DEFS[key].label);
  }

  for (const path of PATHS) revalidatePath(path);
  return ok("Tersimpan.");
}

function readDistributionRows(formData: FormData): DistributionFormRow[] | null {
  const count = Number(text(formData, "rowCount"));
  if (!Number.isInteger(count) || count < 0 || count > MAX_DISTRIBUTION_ROWS) return null;
  const rows: DistributionFormRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      subtest: text(formData, `subtest_${i}`),
      label: text(formData, `label_${i}`),
      flexible: formData.getAll(`flex_${i}`).filter((v): v is string => typeof v === "string"),
      sessions: text(formData, `sessions_${i}`),
    });
  }
  return rows;
}

export async function saveDistributionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const scope = scopeConfigFormSchema.safeParse({
    scopeType: text(formData, "scopeType"),
    scopeId: text(formData, "scopeId"),
  });
  if (!scope.success) return fail(firstIssueMessage(scope.error));

  const rows = readDistributionRows(formData);
  if (!rows) return fail("Data formulir tidak valid. Muat ulang halaman.");
  const parsed = parseDistributionRows(rows);
  if (!parsed.ok) return fail(parsed.message);

  const supabase = await createClient();
  // Satu RPC = satu transaksi: distribusi lama diganti seluruhnya atau tidak berubah sama sekali.
  const { error } = await supabase.rpc("set_subtest_distribution", {
    p_scope_type: scope.data.scopeType,
    p_scope_id: scope.data.scopeId,
    p_items: parsed.items,
  });
  if (error) return dbFailure(error, "distribusi");

  for (const path of PATHS) revalidatePath(path);
  return ok("Distribusi tersimpan.");
}

export async function clearDistributionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const scope = scopeConfigFormSchema.safeParse({
    scopeType: text(formData, "scopeType"),
    scopeId: text(formData, "scopeId"),
  });
  if (!scope.success) return fail(firstIssueMessage(scope.error));

  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_subtest_distribution", {
    p_scope_type: scope.data.scopeType,
    p_scope_id: scope.data.scopeId,
  });
  if (error) return dbFailure(error, "distribusi");

  for (const path of PATHS) revalidatePath(path);
  return ok("Distribusi di level ini dihapus; sekarang mewarisi level di atasnya.");
}
