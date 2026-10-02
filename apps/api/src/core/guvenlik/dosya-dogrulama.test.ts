import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { dosyaIceriginiDogrula, ekstreDosyasiniDogrula, excelDosyasiniDogrula } from "./dosya-dogrulama";

describe("dosyaIceriginiDogrula", () => {
  it("geçerli PDF imzasını kabul eder", () => {
    expect(() => dosyaIceriginiDogrula({ mimetype: "application/pdf", buffer: Buffer.from("%PDF-1.7 veri") })).not.toThrow();
  });

  it("MIME sahteciliğini reddeder", () => {
    expect(() => dosyaIceriginiDogrula({ mimetype: "application/pdf", buffer: Buffer.from("çalıştırılabilir içerik") })).toThrow(BadRequestException);
  });

  it("ikili içeriği metin olarak kabul etmez", () => {
    expect(() => dosyaIceriginiDogrula({ mimetype: "text/plain", buffer: Buffer.from([0x41, 0, 0x42]) })).toThrow("uyuşmuyor");
  });

  it("XLSX uzantısı ve ZIP imzasını birlikte doğrular", () => {
    const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]);
    expect(() => excelDosyasiniDogrula({ originalname: "aktarim.xlsx", buffer: xlsx })).not.toThrow();
    expect(() => excelDosyasiniDogrula({ originalname: "aktarim.xls", buffer: xlsx })).toThrow(".xlsx");
    expect(() => excelDosyasiniDogrula({ originalname: "aktarim.xlsx", buffer: Buffer.from("sahte") })).toThrow("geçerli");
  });

  it("ekstrede metin tabanlı CSV/TXT ve imzası doğru Excel (.xlsx) kabul eder", () => {
    expect(() => ekstreDosyasiniDogrula({ originalname: "ekstre.csv", buffer: Buffer.from("Tarih;Tutar\n01.01.2026;10") })).not.toThrow();
    expect(() => ekstreDosyasiniDogrula({ originalname: "ekstre.xlsx", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]) })).not.toThrow();
    expect(() => ekstreDosyasiniDogrula({ originalname: "ekstre.xlsx", buffer: Buffer.from("metin") })).toThrow("Excel");
    expect(() => ekstreDosyasiniDogrula({ originalname: "ekstre.xls", buffer: Buffer.from("metin") })).toThrow(".xlsx");
    expect(() => ekstreDosyasiniDogrula({ originalname: "ekstre.csv", buffer: Buffer.from([1, 0, 2]) })).toThrow("geçerli");
  });
});
