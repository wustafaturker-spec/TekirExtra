import { describe, expect, it } from "vitest";
import { ocrDosyasiniDogrula, ocrGirdisiOlustur } from "./ai.semalar";

// Gerçek 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

describe("saklanan dosyadan OCR girdisi (e-posta eki)", () => {
  it("türü imzadan belirler ve OCR doğrulamasından geçen data URL üretir", () => {
    const g = ocrGirdisiOlustur(PNG)!;
    expect(g.mimeType).toBe("image/png");
    expect(g.gorselBase64.startsWith("data:image/png;base64,")).toBe(true);
    expect(ocrDosyasiniDogrula(g as never)).toMatchObject({ mimeType: "image/png", genislik: 1, yukseklik: 1 });
  });

  it("PDF'i tanır; desteklenmeyen dosyada null döner", () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF");
    expect(ocrGirdisiOlustur(pdf)?.mimeType).toBe("application/pdf");
    expect(ocrDosyasiniDogrula(ocrGirdisiOlustur(pdf) as never)?.mimeType).toBe("application/pdf");
    expect(ocrGirdisiOlustur(Buffer.from("merhaba dünya"))).toBeNull();
  });
});
