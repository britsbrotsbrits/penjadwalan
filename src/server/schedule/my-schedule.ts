import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Jadwal mentor yang sedang login, lewat my_schedule (hanya sesi sendiri dari periode Approved/Locked).

const rowSchema = z
  .object({
    session_date: z.string(),
    slot_no: z.number().int(),
    rombel_name: z.string(),
    subtest_code: z.string(),
    subtest_name: z.string(),
    room_name: z.string(),
    period_name: z.string(),
  })
  .transform((r) => ({
    sessionDate: r.session_date,
    slotNo: r.slot_no,
    rombelName: r.rombel_name,
    subtestCode: r.subtest_code,
    subtestName: r.subtest_name,
    roomName: r.room_name,
    periodName: r.period_name,
  }));
export type MySession = z.output<typeof rowSchema>;

export async function listMySchedule(from: string, to: string): Promise<MySession[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_schedule", { p_from: from, p_to: to });
  if (error) {
    console.error("[my_schedule]", error.code, error.message);
    throw new Error("Gagal memuat jadwal Anda.");
  }
  return z.array(rowSchema).parse(data ?? []);
}
