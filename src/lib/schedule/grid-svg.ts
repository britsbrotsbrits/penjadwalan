import type { WeekGrid } from "./grid";

/**
 * Menggambar WeekGrid sebagai SVG mandiri (tanpa dependensi). Satu sumber untuk ekspor PNG dan PDF
 * supaya keduanya identik. Murni: hanya menghasilkan teks.
 */

const PAD = 24;
const TIME_W = 130;
const DAY_W = 180;
const HEAD_H = 56;
const LINE_H = 18;
const MAX_CHARS = 26;
const FONT = "Arial, Helvetica, sans-serif";

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function clip(s: string, max = MAX_CHARS): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function gridSvgSize(grid: WeekGrid): { width: number; height: number; rowHeights: number[] } {
  const rowHeights = grid.rows.map((r) => {
    const maxLines = Math.max(1, ...r.cells.map((c) => (c.kind === "session" ? c.lines.length : 1)));
    return Math.max(56, maxLines * LINE_H + 20);
  });
  const width = PAD * 2 + TIME_W + DAY_W * grid.columns.length;
  const height = PAD + 64 + HEAD_H + rowHeights.reduce((a, b) => a + b, 0) + PAD;
  return { width, height, rowHeights };
}

export function renderGridSvg(grid: WeekGrid): string {
  const { width, height, rowHeights } = gridSvgSize(grid);
  const top = PAD + 64;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`);
  out.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  out.push(`<text x="${PAD}" y="${PAD + 16}" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(clip(grid.title, 90))}</text>`);
  out.push(`<text x="${PAD}" y="${PAD + 42}" font-size="14" fill="#475569">${escapeXml(clip(grid.subtitle, 120))}</text>`);

  // header
  out.push(`<rect x="${PAD}" y="${top}" width="${TIME_W}" height="${HEAD_H}" fill="#14213d" stroke="#0f172a"/>`);
  out.push(`<text x="${PAD + TIME_W / 2}" y="${top + 24}" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">SESI</text>`);
  out.push(`<text x="${PAD + TIME_W / 2}" y="${top + 42}" font-size="12" fill="#cbd5e1" text-anchor="middle">Jam</text>`);
  grid.columns.forEach((c, i) => {
    const x = PAD + TIME_W + i * DAY_W;
    out.push(`<rect x="${x}" y="${top}" width="${DAY_W}" height="${HEAD_H}" fill="#14213d" stroke="#0f172a"/>`);
    out.push(`<text x="${x + DAY_W / 2}" y="${top + 24}" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">${escapeXml(c.name.toUpperCase())}</text>`);
    out.push(`<text x="${x + DAY_W / 2}" y="${top + 42}" font-size="12" fill="#cbd5e1" text-anchor="middle">${escapeXml(formatDate(c.date))}</text>`);
  });

  let y = top + HEAD_H;
  grid.rows.forEach((row, r) => {
    const h = rowHeights[r]!;
    out.push(`<rect x="${PAD}" y="${y}" width="${TIME_W}" height="${h}" fill="#f1f5f9" stroke="#0f172a"/>`);
    out.push(`<text x="${PAD + TIME_W / 2}" y="${y + h / 2 - 2}" font-size="15" font-weight="700" fill="#0f172a" text-anchor="middle">${row.slotNo}</text>`);
    out.push(`<text x="${PAD + TIME_W / 2}" y="${y + h / 2 + 16}" font-size="12" fill="#334155" text-anchor="middle">${escapeXml(row.label)}</text>`);
    row.cells.forEach((cell, i) => {
      const x = PAD + TIME_W + i * DAY_W;
      const fill = cell.kind === "session" ? "#dbeafe" : cell.kind === "outside" ? "#e2e8f0" : "#ffffff";
      out.push(`<rect x="${x}" y="${y}" width="${DAY_W}" height="${h}" fill="${fill}" stroke="#0f172a"/>`);
      if (cell.kind === "free") {
        out.push(`<text x="${x + DAY_W / 2}" y="${y + h / 2 + 8}" font-size="24" font-weight="700" fill="#15803d" text-anchor="middle">√</text>`);
      } else if (cell.kind === "session") {
        const startY = y + h / 2 - ((cell.lines.length - 1) * LINE_H) / 2 + 5;
        cell.lines.forEach((line, k) => {
          const bold = k === 0;
          out.push(`<text x="${x + DAY_W / 2}" y="${startY + k * LINE_H}" font-size="13" ${bold ? 'font-weight="700"' : ""} fill="#0f172a" text-anchor="middle">${escapeXml(clip(line))}</text>`);
        });
      }
    });
    y += h;
  });
  out.push("</svg>");
  return out.join("\n");
}
