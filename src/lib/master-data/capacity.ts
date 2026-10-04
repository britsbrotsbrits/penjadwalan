/**
 * Ringkasan kapasitas ruangan. Murni: tanpa Supabase/React/Next.
 * Berguna untuk melihat bottleneck (mis. berapa ruangan yang muat 20 siswa).
 */

export type RoomLike = { capacity: number; isActive: boolean };

export type CapacityGroup = { capacity: number; count: number };

/** Kelompokkan ruangan AKTIF menurut kapasitas, dari terbesar ke terkecil. */
export function summarizeCapacity(rooms: readonly RoomLike[]): CapacityGroup[] {
  const counts = new Map<number, number>();
  for (const room of rooms) {
    if (!room.isActive) continue;
    counts.set(room.capacity, (counts.get(room.capacity) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([capacity, count]) => ({ capacity, count }))
    .sort((a, b) => b.capacity - a.capacity);
}

/** Jumlah ruangan AKTIF yang muat `studentCount` siswa (capacity >= studentCount). */
export function countRoomsFitting(rooms: readonly RoomLike[], studentCount: number): number {
  return rooms.filter((room) => room.isActive && room.capacity >= studentCount).length;
}
