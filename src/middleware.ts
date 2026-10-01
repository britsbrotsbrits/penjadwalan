import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

// Hanya rute yang membutuhkan sesi. Beranda dan /api/health tetap berjalan tanpa env Supabase.
export const config = {
  matcher: ["/admin/:path*", "/tutor/:path*", "/login"],
};
