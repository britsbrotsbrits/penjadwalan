import { describe, expect, it } from "vitest";
import type { SchedulerFn, ScheduledSession } from "../scheduler/types";
import { runSimulation, unavailableScheduler } from "./runner";

/** Scheduler serakah SEDERHANA hanya untuk menguji runner dan metrik (bukan scheduler produksi, Phase 9). */
const naive: SchedulerFn = ({ snapshot, requirements }) => {
  const scheduled: ScheduledSession[] = [];
  const unscheduled: Array<{ requirementId: string; missing: number; reason: "NO_FREE_ROOM" }> = [];
  const busyTutor = new Set<string>();
  const busyRoom = new Set<string>();
  const busyRombel = new Set<string>();
  const perDay = new Map<string, number>();
  for (const req of requirements) {
    const rombel = snapshot.rombels.find((r) => r.id === req.rombelId)!;
    let missing = req.sessions;
    for (let n = 0; n < req.sessions; n++) {
      let placed = false;
      for (const day of snapshot.days) {
        for (const slotNo of snapshot.slotNos) {
          const k = `${day}-${slotNo}`;
          if (busyRombel.has(`${rombel.id}|${k}`)) continue;
          if ((perDay.get(`${rombel.id}|${day}`) ?? 0) >= (rombel.sessionsPerDay ?? 99)) continue;
          const room = snapshot.rooms.find((r) => (rombel.fixedRoomId ? r.id === rombel.fixedRoomId : r.capacity >= rombel.studentCount) && !busyRoom.has(`${r.id}|${k}`));
          if (!room) continue;
          const tutor = snapshot.tutors.find(
            (t) => !busyTutor.has(`${t.id}|${k}`) && t.availability.some((c) => c.day === day && c.slotNo === slotNo) && t.competencies.some((c) => req.allowedSubtestIds.includes(c)),
          );
          if (!tutor) continue;
          const subtestId = tutor.competencies.find((c) => req.allowedSubtestIds.includes(c))!;
          scheduled.push({ requirementId: req.id, rombelId: rombel.id, subtestId, tutorId: tutor.id, roomId: room.id, day, slotNo });
          busyTutor.add(`${tutor.id}|${k}`); busyRoom.add(`${room.id}|${k}`); busyRombel.add(`${rombel.id}|${k}`);
          perDay.set(`${rombel.id}|${day}`, (perDay.get(`${rombel.id}|${day}`) ?? 0) + 1);
          placed = true; missing--; break;
        }
        if (placed) break;
      }
    }
    if (missing > 0) unscheduled.push({ requirementId: req.id, missing, reason: "NO_FREE_ROOM" });
  }
  return { scheduled, unscheduled };
};

describe("runSimulation", () => {
  it("scheduler kosong: 0% selesai, semua dicatat SCHEDULER_NOT_AVAILABLE, tanpa pelanggaran", () => {
    const run = runSimulation({ mode: "small", seed: 1, scheduler: unavailableScheduler });
    expect(run.schedulerAvailable).toBe(false);
    expect(run.report.scheduled).toBe(0);
    expect(run.report.completionPercent).toBe(0);
    expect(run.report.violations).toEqual([]);
    expect(run.report.unscheduledByReason).toEqual({ SCHEDULER_NOT_AVAILABLE: run.scenario.requiredSessions });
    expect(run.scenario.requiredSessions).toBeGreaterThan(0);
  });

  it("tanpa argumen scheduler memakai scheduler sungguhan", () => {
    const run = runSimulation({ mode: "small", seed: 1 });
    expect(run.schedulerAvailable).toBe(true);
    expect(run.report.scheduled).toBeGreaterThan(0);
    expect(run.report.violations).toEqual([]);
  });

  it("deterministik: seed sama = hasil sama", () => {
    expect(runSimulation({ mode: "realistic", seed: 7 })).toEqual(runSimulation({ mode: "realistic", seed: 7 }));
  });

  it("ringkasan skenario konsisten dengan snapshot", () => {
    const run = runSimulation({ mode: "realistic", seed: 2 });
    expect(run.scenario.rombels).toBe(run.snapshot.rombels.length);
    expect(run.scenario.rooms).toBe(15);
    expect(run.scenario.requirements).toBe(run.requirements.length);
    expect(run.scenario.students).toBe(run.snapshot.rombels.reduce((n, r) => n + r.studentCount, 0));
  });

  it("scheduler sederhana pada small: tanpa pelanggaran apa pun dan sebagian besar terjadwal", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const run = runSimulation({ mode: "small", seed, scheduler: naive });
      expect(run.schedulerAvailable).toBe(true);
      expect(run.report.violations).toEqual([]);
      expect(run.report.completionPercent).toBeGreaterThan(50);
      expect(run.report.scheduled + run.report.unscheduledSessions).toBe(run.report.required);
    }
  });

  it("scheduler yang melanggar aturan DITANGKAP oleh metrik", () => {
    const cheating: SchedulerFn = ({ snapshot, requirements }) => ({
      // semua sesi ditaruh pada tutor pertama, ruangan pertama, hari 1 sesi 1
      scheduled: requirements.flatMap((r) =>
        Array.from({ length: r.sessions }, () => ({
          requirementId: r.id, rombelId: r.rombelId, subtestId: r.allowedSubtestIds[0]!,
          tutorId: snapshot.tutors[0]!.id, roomId: snapshot.rooms[snapshot.rooms.length - 1]!.id, day: 1, slotNo: 1,
        })),
      ),
      unscheduled: [],
    });
    const run = runSimulation({ mode: "small", seed: 1, scheduler: cheating });
    expect(run.report.violationCounts.TUTOR_CONFLICT).toBeGreaterThan(0);
    expect(run.report.violationCounts.ROOM_CONFLICT).toBeGreaterThan(0);
    expect(run.report.violationCounts.ROMBEL_CONFLICT).toBeGreaterThan(0);
  });

  it("scheduler yang tidak melaporkan sesi hilang ditangkap sebagai ACCOUNTING_MISMATCH", () => {
    const lazy: SchedulerFn = () => ({ scheduled: [], unscheduled: [] });
    const run = runSimulation({ mode: "small", seed: 1, scheduler: lazy });
    expect(run.report.violationCounts.ACCOUNTING_MISMATCH).toBe(run.requirements.length);
  });

  it("small: kelayakan lolos; realistic/stress dilaporkan apa adanya dengan alasan", () => {
    expect(runSimulation({ mode: "small", seed: 1 }).feasibility.feasible).toBe(true);
    for (const mode of ["realistic", "stress"] as const) {
      const run = runSimulation({ mode, seed: 1 });
      for (const issue of run.feasibility.issues) expect(issue.message.length).toBeGreaterThan(0);
      expect(run.feasibility.subtestSupply).toHaveLength(7);
      expect(run.feasibility.feasible).toBe(run.feasibility.issues.every((i) => i.severity !== "error"));
    }
  });

  it("small dan realistic layak secara dasar (untuk beberapa seed); stress menunjukkan alasan tidak layak", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(runSimulation({ mode: "small", seed }).feasibility.feasible).toBe(true);
      expect(runSimulation({ mode: "realistic", seed }).feasibility.feasible).toBe(true);
    }
    const stress = runSimulation({ mode: "stress", seed: 1 }).feasibility;
    expect(stress.feasible).toBe(false);
    expect(stress.issues.some((i) => i.code === "ROOM_CAPACITY_BOTTLENECK" || i.code === "NO_ROOM_CAPACITY")).toBe(true);
  });

  it("stress tetap cepat dan bisa dijalankan (batas serverless)", () => {
    const t0 = Date.now();
    const run = runSimulation({ mode: "stress", seed: 3 });
    expect(Date.now() - t0).toBeLessThan(10000);
    expect(run.scenario.rombels).toBeGreaterThan(100);
  });

  it("unavailableScheduler menyebut alasannya", () => {
    const r = unavailableScheduler({ snapshot: runSimulation({ mode: "small", seed: 1 }).snapshot, requirements: [{ id: "a", rombelId: "r", allowedSubtestIds: ["x"], label: "L", sessions: 2 }], seed: 1 });
    expect(r.unscheduled).toEqual([{ requirementId: "a", missing: 2, reason: "SCHEDULER_NOT_AVAILABLE", detail: "Scheduler tidak dijalankan." }]);
  });
});
