import { describe, expect, it, vi } from "vitest";
import { DOSYA_ARACLARI, dosyaAdiCoz, guvenliDosyaAdi, yanitYakalayici } from "./dosya";
import { telegramAraclari } from "../telegram-veri-kapisi";
import { GRUP_ARACLARI } from "./gruplar";

const BELGE_ID = "7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d";
const arac = (ad: string) => DOSYA_ARACLARI.find((a) => a.ad === ad)!;

/** Ekran ucunu taklit eder: son argüman yanıt nesnesidir, uç `res.send` ile yazar. */
function baglam(yaz: (yol: string, arg: unknown[], res: { setHeader(a: string, d: string): unknown; send(v: unknown): unknown }) => void) {
  const cagir = vi.fn(async (uc: { yol: string }, arg: unknown[]) => {
    const res = arg[arg.length - 1] as { setHeader(a: string, d: string): unknown; send(v: unknown): unknown };
    yaz(uc.yol, arg.slice(0, -1), res);
    return undefined;
  });
  return { b: { uc: { cagir } as never, kaynak: "asistan" as const, arac: "x" }, cagir };
}

describe("dosya araçları (AI-118)", () => {
  it("yanıt yakalayıcı gövdeyi, türü ve adı toplar; boş gövde hata verir", () => {
    const y = yanitYakalayici();
    y.res.setHeader("Content-Type", "application/pdf");
    y.res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent("Fatura FTR2026 ç.pdf")}"`);
    y.res.send(Buffer.from("%PDF-1"));
    expect(y.sonuc()).toEqual({ tampon: Buffer.from("%PDF-1"), mimeType: "application/pdf", dosyaAdi: "Fatura FTR2026 ç.pdf" });
    expect(() => yanitYakalayici().sonuc()).toThrow("Dosya üretilemedi");
  });

  it("dosya adı başlıktan çözülür ve güvenli hâle gelir", () => {
    expect(dosyaAdiCoz("attachment; filename=rapor-cari-yaslandirma.xlsx")).toBe("rapor-cari-yaslandirma.xlsx");
    expect(dosyaAdiCoz("inline")).toBeNull();
    expect(guvenliDosyaAdi("../../etc/İç Rapor:2026.xlsx", "xlsx")).toBe("İç_Rapor_2026.xlsx");
    expect(guvenliDosyaAdi("", "pdf")).toBe("dosya.pdf");
  });

  it("rapor_dosyasi ekranın Excel/PDF ucunu süzgeçlerle çağırır; içerik modele gitmez", async () => {
    const { b, cagir } = baglam((yol, _arg, res) => {
      res.setHeader("Content-Type", "x"); res.setHeader("Content-Disposition", "attachment; filename=rapor-cari-yaslandirma.xlsx");
      res.send(Buffer.from(yol.endsWith("excel") ? "PK-excel" : "%PDF"));
    });
    const r = (await arac("rapor_dosyasi").calistir(b, { kod: "cari.yaslandirma", format: "excel", suzgecler: [{ alan: "bitis", deger: "2026-11-20" }, { alan: "acik", deger: "true" }] })) as Record<string, any>;
    expect(cagir.mock.calls[0]![0].yol).toBe("POST /raporlar/:kod/excel");
    expect(cagir.mock.calls[0]![1].slice(0, 2)).toEqual(["cari.yaslandirma", { filtreler: { bitis: "2026-11-20", acik: true } }]);
    expect(r._dosya).toMatchObject({ dosyaAdi: "rapor-cari-yaslandirma.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    expect(r._dosya.tampon.toString()).toBe("PK-excel");
    expect(JSON.stringify({ ...r, _dosya: undefined })).not.toContain("PK-excel");

    const pdf = (await arac("rapor_dosyasi").calistir(b, { kod: "cari.yaslandirma", format: "pdf" })) as Record<string, any>;
    expect(cagir.mock.calls[1]![0].yol).toBe("POST /raporlar/:kod/pdf");
    expect(pdf._dosya).toMatchObject({ dosyaAdi: "rapor-cari-yaslandirma.pdf", mimeType: "application/pdf" });
  });

  it("belge_pdf fatura ve belge ucunu ayırır, kopya damgasını iletir", async () => {
    const { b, cagir } = baglam((_yol, _arg, res) => { res.setHeader("Content-Disposition", 'inline; filename="FTR2026000000001.pdf"'); res.send(Buffer.from("%PDF")); });
    const f = (await arac("belge_pdf").calistir(b, { tur: "fatura", id: BELGE_ID, kopya: true })) as Record<string, any>;
    expect(cagir.mock.calls[0]![0].yol).toBe("GET /fatura/:id/pdf");
    expect(cagir.mock.calls[0]![1].slice(0, 2)).toEqual([BELGE_ID, "1"]);
    expect(f._dosya.dosyaAdi).toBe("FTR2026000000001.pdf");
    await arac("belge_pdf").calistir(b, { tur: "belge", id: BELGE_ID });
    expect(cagir.mock.calls[1]![0].yol).toBe("GET /belgeler/:id/pdf");
    expect(cagir.mock.calls[1]![1].slice(0, 2)).toEqual([BELGE_ID, undefined]);
    expect(() => arac("belge_pdf").girdi.parse({ tur: "fatura", id: "FTR1" })).toThrow();
  });

  it("Telegram'da kapalı rapor dosya olarak da üretilmez", async () => {
    const [rapor] = telegramAraclari([{ ...arac("rapor_dosyasi"), calistir: async () => ({ basarili: true }) }]);
    await expect(rapor!.calistir({} as never, { kod: "kasa_banka.nakit_akisi", format: "excel" })).rejects.toThrow(/Telegram'da çalıştırılmaz/);
    await expect(rapor!.calistir({} as never, { kod: "cari.yaslandirma", format: "excel" })).resolves.toEqual({ basarili: true });
  });

  it("dosya araçları çekirdek grupta sunulur", () => {
    expect(GRUP_ARACLARI.cekirdek).toEqual(expect.arrayContaining(["rapor_dosyasi", "belge_pdf", "cari_ekstre_dosyasi"]));
  });
});
