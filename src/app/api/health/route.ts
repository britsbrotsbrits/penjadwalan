import { NextResponse } from "next/server";

// Endpoint sederhana untuk cek deployment. Tidak menyentuh database atau secret.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", phase: 12 });
}
