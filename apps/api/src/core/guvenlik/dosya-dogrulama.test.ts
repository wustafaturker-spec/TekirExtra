import { BadRequestException } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dosyaIceriginiDogrula, ekstreDosyasiniDogrula, excelDosyasiniDogrula } from "./dosya-dogrulama";

async function xlsx(): Promise<Buffer> {
  const kitap = new ExcelJS.Workbook();
  kitap.addWorksheet("A").addRow(["x"]);
  return Buffer.from(await kitap.xlsx.writeBuffer());
}

describe("yükleme kapısı (dosya-dogrulama)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("geçerli PDF'i kabul eder; saklanacak MIME içerikten gelir", async () => {
    expect(await dosyaIceriginiDogrula({ mimetype: "application/octet-stream", originalname: "a.pdf", buffer: Buffer.from("%PDF-1.7 veri") })).toBe("application/pdf");
  });

  it("MIME sahteciliğini ve çalıştırılabilir dosyayı reddeder", async () => {
    await expect(dosyaIceriginiDogrula({ mimetype: "application/pdf", originalname: "a.pdf", buffer: Buffer.from("MZ\u0090\u0000çalıştırılabilir") })).rejects.toThrow(BadRequestException);
    await expect(dosyaIceriginiDogrula({ mimetype: "text/plain", originalname: "a.txt", buffer: Buffer.from([0x41, 0, 0x42]) })).rejects.toThrow("tanınmadı");
  });

  it("çek görüntüsü profilinde Excel kabul edilmez", async () => {
    await expect(dosyaIceriginiDogrula({ originalname: "a.xlsx", buffer: await xlsx() }, "goruntu")).rejects.toThrow("bu alana yüklenemez");
  });

  it("Excel içe aktarma: .xlsx uzantısı ve geçerli Office içeriği birlikte", async () => {
    const b = await xlsx();
    await expect(excelDosyasiniDogrula({ originalname: "aktarim.xlsx", buffer: b })).resolves.toBeUndefined();
    await expect(excelDosyasiniDogrula({ originalname: "aktarim.xls", buffer: b })).rejects.toThrow(".xlsx");
    await expect(excelDosyasiniDogrula({ originalname: "aktarim.xlsx", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]) })).rejects.toThrow("arşiv");
  });

  it("ekstrede CSV/TXT ve geçerli .xlsx kabul edilir; .xls ve ikili içerik reddedilir", async () => {
    await expect(ekstreDosyasiniDogrula({ originalname: "ekstre.csv", buffer: Buffer.from("Tarih;Tutar\n01.01.2026;10") })).resolves.toBeUndefined();
    // Windows-1254 (Türkçe) CSV de metin sayılır.
    await expect(ekstreDosyasiniDogrula({ originalname: "ekstre.csv", buffer: Buffer.from([0x54, 0xfd, 0x6b, 0x3b, 0x31, 0x0a]) })).resolves.toBeUndefined();
    await expect(ekstreDosyasiniDogrula({ originalname: "ekstre.xlsx", buffer: await xlsx() })).resolves.toBeUndefined();
    await expect(ekstreDosyasiniDogrula({ originalname: "ekstre.xls", buffer: Buffer.from("metin") })).rejects.toThrow(".xlsx");
    await expect(ekstreDosyasiniDogrula({ originalname: "ekstre.csv", buffer: Buffer.from([1, 0, 2]) })).rejects.toThrow("tanınmadı");
  });

  it("ClamAV tanımlı ama ulaşılamıyorsa yükleme reddedilir (kapalı varsayılmaz)", async () => {
    vi.stubEnv("CLAMAV_HOST", "127.0.0.1");
    vi.stubEnv("CLAMAV_PORT", "1");
    vi.stubEnv("CLAMAV_ZAMAN_ASIMI_MS", "2000");
    await expect(dosyaIceriginiDogrula({ originalname: "a.pdf", buffer: Buffer.from("%PDF-1.7 veri") })).rejects.toThrow("virüs taraması yapılamadı");
  });
});
