import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Edu Ops",
  description:
    "Sistem manajemen scheduling tutor, rombel, ruangan, attendance, dan payroll.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
