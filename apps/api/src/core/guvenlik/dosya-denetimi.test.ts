import { afterEach, describe, expect, it } from "vitest";
import { createServer, type AddressInfo } from "node:net";
import { deflateRawSync, deflateSync } from "node:zlib";
import * as ExcelJS from "exceljs";
import { icerikDenetle, svgRiskli, yuklemeDenetle } from "./dosya-denetimi";

/** Bağımlılıksız küçük ZIP üretici (yalnız merkezi dizin denetimi için yeterli). */
function zip(girdiler: { ad: string; icerik: Buffer }[]): Buffer {
  const yerel: Buffer[] = [], dizin: Buffer[] = [];
  let kayma = 0;
  for (const g of girdiler) {
    const sikistirilmis = deflateRawSync(g.icerik), ad = Buffer.from(g.ad);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(sikistirilmis.length, 18); lh.writeUInt32LE(g.icerik.length, 22); lh.writeUInt16LE(ad.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(sikistirilmis.length, 20); ch.writeUInt32LE(g.icerik.length, 24); ch.writeUInt16LE(ad.length, 28); ch.writeUInt32LE(kayma, 42);
    yerel.push(lh, ad, sikistirilmis); dizin.push(ch, ad);
    kayma += 30 + ad.length + sikistirilmis.length;
  }
  const d = Buffer.concat(dizin);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(girdiler.length, 8); eocd.writeUInt16LE(girdiler.length, 10); eocd.writeUInt32LE(d.length, 12); eocd.writeUInt32LE(kayma, 16);
  return Buffer.concat([...yerel, d, eocd]);
}
const ofis = (ekGirdiler: { ad: string; icerik: Buffer }[] = []) => zip([{ ad: "[Content_Types].xml", icerik: Buffer.from("<Types/>") }, { ad: "xl/workbook.xml", icerik: Buffer.from("<workbook/>") }, ...ekGirdiler]);
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const pdf = (govde = "") => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog ${govde} >> endobj\n%%EOF`, "latin1");
const red = (f: () => unknown, metin: RegExp) => expect(f).toThrow(metin);

describe("dosya içerik denetimi", () => {
  it("türü bildirilen MIME'dan değil içerikten belirler; saklanacak MIME içerikten gelir", async () => {
    const kitap = new ExcelJS.Workbook(); kitap.addWorksheet("A").addRow(["x"]);
    const xlsx = Buffer.from(await kitap.xlsx.writeBuffer());
    expect(icerikDenetle({ buffer: xlsx, originalname: "cari.xlsx" }, "excel").tur).toBe("xlsx");
    expect(icerikDenetle({ buffer: PNG, originalname: "logo.PNG" }, "belge").mime).toBe("image/png");
    expect(icerikDenetle({ buffer: Buffer.from("Tarih;Tutar\n01.10.2026;150,00\n", "latin1"), originalname: "ekstre.csv" }, "ekstre")).toEqual({ tur: "metin", mime: "text/csv" });
    // Windows-1254 CSV (ş = 0xFE) metin sayılır.
    expect(icerikDenetle({ buffer: Buffer.from([0x41, 0x3b, 0xfe, 0x0a]), originalname: "e.csv" }, "ekstre").tur).toBe("metin");
  });

  it("çalıştırılabilir, HTML ve tanınmayan ikili dosyayı reddeder", () => {
    red(() => icerikDenetle({ buffer: Buffer.from("MZ\x90\x00", "latin1"), originalname: "fatura.pdf" }, "belge"), /çalıştırılabilir/);
    red(() => icerikDenetle({ buffer: Buffer.from("#!/bin/sh\nrm -rf /"), originalname: "a.txt" }, "belge"), /çalıştırılabilir/);
    red(() => icerikDenetle({ buffer: Buffer.from("<!DOCTYPE html><script>alert(1)</script>"), originalname: "cek.png" }, "belge"), /HTML/);
    red(() => icerikDenetle({ buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]), originalname: "x.bin" }, "belge"), /tanınmadı/);
  });

  it("profil dışı türü ve içerikle uyuşmayan uzantıyı reddeder", () => {
    red(() => icerikDenetle({ buffer: pdf(), originalname: "a.pdf" }, "excel"), /bu alana yüklenemez/);
    red(() => icerikDenetle({ buffer: PNG, originalname: "fatura.pdf" }, "belge"), /\.pdf ama içeriği PNG/);
  });

  it("arşivde sıkıştırma bombası, makro, çalıştırılabilir ve güvensiz yol yakalanır; Office olmayan ZIP reddedilir", () => {
    red(() => icerikDenetle({ buffer: ofis([{ ad: "xl/bomba.bin", icerik: Buffer.alloc(30 * 1024 * 1024) }]), originalname: "a.xlsx" }, "excel"), /sıkıştırma bombası/);
    red(() => icerikDenetle({ buffer: ofis([{ ad: "xl/vbaProject.bin", icerik: Buffer.from("x") }]), originalname: "a.xlsx" }, "excel"), /makro/);
    red(() => icerikDenetle({ buffer: ofis([{ ad: "xl/media/a.exe", icerik: Buffer.from("MZ") }]), originalname: "a.xlsx" }, "excel"), /çalıştırılabilir/);
    red(() => icerikDenetle({ buffer: ofis([{ ad: "../../etc/passwd", icerik: Buffer.from("x") }]), originalname: "a.xlsx" }, "excel"), /güvensiz dosya yolu/);
    red(() => icerikDenetle({ buffer: zip([{ ad: "a.txt", icerik: Buffer.from("x") }]), originalname: "a.zip" }, "belge"), /Office belgesi olmayan/);
  });

  it("PDF'te açık ya da sıkıştırılmış akışa gizlenmiş JavaScript/Launch reddedilir; düz PDF geçer", () => {
    expect(icerikDenetle({ buffer: pdf(), originalname: "a.pdf" }, "goruntu").tur).toBe("pdf");
    red(() => icerikDenetle({ buffer: pdf("/OpenAction << /S /JavaScript /JS (app.alert(1)) >>"), originalname: "a.pdf" }, "goruntu"), /otomatik çalışan/);
    const gizli = Buffer.concat([Buffer.from("%PDF-1.5\n2 0 obj << /Type /ObjStm /Filter /FlateDecode >> stream\n", "latin1"), deflateSync(Buffer.from("<< /S /Launch /F (cmd.exe) >>")), Buffer.from("\nendstream endobj\n%%EOF", "latin1")]);
    red(() => icerikDenetle({ buffer: gizli, originalname: "a.pdf" }, "goruntu"), /otomatik çalışan/);
  });

  it("SVG belge ekine yüklenemez (temiz olsa da); SVG risk kuralı betik ve dış bağlantıyı tanır", () => {
    red(() => icerikDenetle({ buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'), originalname: "logo.svg" }, "belge"), /SVG bu alana yüklenemez/);
    expect(svgRiskli(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'))).toBe(false);
    expect(svgRiskli(Buffer.from('<svg onload="alert(1)"></svg>'))).toBe(true);
    expect(svgRiskli(Buffer.from('<svg><image href="https://kotu.example/x.png"/></svg>'))).toBe(true);
  });

  it("eski Office belgesinde makro akışı reddedilir", () => {
    const ole = Buffer.concat([Buffer.from("d0cf11e0a1b11ae1", "hex"), Buffer.alloc(64), Buffer.from("_VBA_PROJECT", "utf16le")]);
    red(() => icerikDenetle({ buffer: ole, originalname: "a.xls" }, "mutabakat"), /makro/);
  });
});

describe("ClamAV taraması", () => {
  const eski = { ...process.env };
  afterEach(() => { process.env = { ...eski }; });
  const sunucu = (yanit: string) => new Promise<number>((r) => {
    const s = createServer((soket) => { soket.on("data", () => undefined); soket.on("end", () => undefined); setTimeout(() => soket.end(`stream: ${yanit}\0`), 20); });
    s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port));
  });

  it("tanımlı değilse atlanır; temizse geçer, bulursa ve tarayamazsa reddeder", async () => {
    delete process.env.CLAMAV_HOST;
    await expect(yuklemeDenetle({ buffer: PNG, originalname: "a.png" }, "belge")).resolves.toMatchObject({ mimetype: "image/png" });
    process.env.CLAMAV_HOST = "127.0.0.1";
    process.env.CLAMAV_PORT = String(await sunucu("OK"));
    await expect(yuklemeDenetle({ buffer: PNG, originalname: "a.png" }, "belge")).resolves.toMatchObject({ mimetype: "image/png" });
    process.env.CLAMAV_PORT = String(await sunucu("Eicar-Test-Signature FOUND"));
    await expect(yuklemeDenetle({ buffer: PNG, originalname: "a.png" }, "belge")).rejects.toThrow(/zararlı yazılım bulundu \(Eicar-Test-Signature\)/);
    process.env.CLAMAV_PORT = "1";
    await expect(yuklemeDenetle({ buffer: PNG, originalname: "a.png" }, "belge")).rejects.toThrow(/virüs taraması yapılamadı/);
  });
});
