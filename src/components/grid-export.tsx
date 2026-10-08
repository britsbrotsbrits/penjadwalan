"use client";

import { useState } from "react";
import { buttonClass, secondaryButtonClass } from "./form-styles";

/**
 * Pratinjau tabel jadwal (SVG yang dibuat server dari data sendiri) dan tombol ekspor.
 * PNG: SVG digambar ke canvas lalu diunduh. PDF: dialog cetak browser (pilih "Simpan sebagai PDF").
 * Tanpa dependensi tambahan.
 */
export function GridExport({ svg, fileName, width, height }: { svg: string; fileName: string; width: number; height: number }) {
  const [error, setError] = useState<string | null>(null);

  function downloadPng() {
    setError(null);
    const scale = 2;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas");
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((png) => {
          URL.revokeObjectURL(url);
          if (!png) {
            setError("Gagal membuat gambar. Coba lagi.");
            return;
          }
          const a = document.createElement("a");
          a.href = URL.createObjectURL(png);
          a.download = `${fileName}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }, "image/png");
      } catch {
        URL.revokeObjectURL(url);
        setError("Gagal membuat gambar. Coba lagi.");
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("Gagal membuat gambar. Coba lagi.");
    };
    img.src = url;
  }

  function printPdf() {
    setError(null);
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      frame.remove();
      setError("Browser menolak membuka dialog cetak.");
      return;
    }
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${fileName}</title>` +
        `<style>@page{size:A4 landscape;margin:10mm}html,body{margin:0}svg{width:100%;height:auto}</style></head><body>${svg}</body></html>`,
    );
    doc.close();
    setTimeout(() => {
      win.focus();
      win.print();
      setTimeout(() => frame.remove(), 2000);
    }, 200);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={downloadPng} className={buttonClass}>
          Unduh gambar (PNG)
        </button>
        <button type="button" onClick={printPdf} className={secondaryButtonClass}>
          Cetak / simpan PDF
        </button>
        {error ? (
          <span role="alert" className="text-sm text-red-600">
            {error}
          </span>
        ) : null}
      </div>
      {/* svg dibuat oleh renderGridSvg dari data sendiri dengan semua teks di-escape */}
      <div className="overflow-x-auto rounded-lg border border-line bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
