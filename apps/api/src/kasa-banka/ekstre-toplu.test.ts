import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { EkstreEslestirmeService } from "./ekstre-eslestirme.service";
import { EkstreService } from "./ekstre.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }) }));

const D = (v: string | number) => new Prisma.Decimal(v);
const K = "11111111-1111-4111-8111-111111111111", F = "22222222-2222-4222-8222-222222222222", T = "33333333-3333-4333-8333-333333333333", M = "44444444-4444-4444-8444-444444444444";

/** Öneri motorunun çıktısı; her test yalnız ilgili alanı doldurur. */
const bosOneri = { kural: null, onerilenCari: null, cariEslesmeKaynagi: null, faturalar: [], odemeTalimatlari: [], masrafKategorileri: [], gelirKategorileri: [], virmanHesaplari: [] };

function kur(oneri: Record<string, unknown>, tutar = -1500) {
  const service = new EkstreEslestirmeService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  (service as any).satirGetir = vi.fn(async () => ({ id: "s1", durum: "beklemede", tutar: D(tutar), bankaHesap: { dovizCinsi: "TRY" } }));
  (service as any).temelOneriler = vi.fn(async () => ({ ...bosOneri, ...oneri }));
  const eslestir = vi.fn(async () => ({}));
  (service as any).eslestir = eslestir;
  return { service, eslestir };
}

describe("kesin öneri (KSB-33)", () => {
  it("numarası açıklamada geçen tek talimat kesindir", async () => {
    const { service } = kur({ odemeTalimatlari: [{ id: T, no: "ODM2026000017", aliciUnvan: "XYZ", aciklamadaGeciyor: true }, { id: "x", no: "ODM2026000018", aciklamadaGeciyor: false }] });
    expect(await service.kesinOneri("s1")).toEqual({ girdi: { tur: "odeme_talimati", talimatId: T }, ozet: "ODM2026000017 ödeme talimatı (XYZ)" });
  });

  it("açıklamada geçmeyen, yalnız tutarı tutan talimat kesin değildir", async () => {
    const { service } = kur({ odemeTalimatlari: [{ id: T, no: "ODM1", aciklamadaGeciyor: false }] });
    expect(await service.kesinOneri("s1")).toBeNull();
  });

  it("masraf kuralı kategorinin varsayılan KDV'siyle kesindir ve kural sayacına yazılır", async () => {
    const { service } = kur({ kural: { id: "k1", anahtar: "eft ucreti", eslesmeTuru: "masraf", masrafKategoriId: M }, masrafKategorileri: [{ id: M, ad: "Banka masrafı", varsayilanKdvOrani: "0.00" }] }, -12.5);
    expect((await service.kesinOneri("s1"))?.girdi).toEqual({ tur: "masraf", kategoriId: M, kdvOrani: "0", kuralId: "k1" });
  });

  it("IBAN'la bulunan cari ve tutarı tutan tek açık fatura kesindir; fatura kapanır", async () => {
    const { service } = kur({ onerilenCari: { id: K, unvan: "ABC LTD" }, cariEslesmeKaynagi: "iban", faturalar: [{ id: F, no: "SF2026-145", tamEslesme: true }, { id: "f2", tamEslesme: false }] }, 1500);
    expect(await service.kesinOneri("s1")).toEqual({ girdi: { tur: "cari", cariId: K, dagitim: [{ faturaId: F, tutar: "1500.00" }] }, ozet: "ABC LTD, SF2026-145 kapanır" });
  });

  it("ad benzerliği ya da yapay zekâyla bulunan cari kesin değildir", async () => {
    for (const kaynak of ["unvan", "yapay_zeka", "tutar", "aciklama"]) {
      const { service } = kur({ onerilenCari: { id: K, unvan: "ABC" }, cariEslesmeKaynagi: kaynak, faturalar: [{ id: F, tamEslesme: true }] }, 1500);
      expect(await service.kesinOneri("s1")).toBeNull();
    }
  });

  it("tutarı tutan iki fatura varsa kesin değildir", async () => {
    const { service } = kur({ onerilenCari: { id: K, unvan: "ABC" }, cariEslesmeKaynagi: "vkn", faturalar: [{ id: F, tamEslesme: true }, { id: "f2", tamEslesme: true }] }, 1500);
    expect(await service.kesinOneri("s1")).toBeNull();
  });
});

describe("toplu eşleştirme (KSB-33)", () => {
  it("öneriyi sunucuda yeniden hesaplar; kesin olmayanı atlar, hatalı satır diğerlerini durdurmaz", async () => {
    const { service, eslestir } = kur({ odemeTalimatlari: [{ id: T, no: "ODM1", aliciUnvan: "XYZ", aciklamadaGeciyor: true }] });
    const kesin = vi.spyOn(service, "kesinOneri");
    kesin.mockResolvedValueOnce({ girdi: { tur: "odeme_talimati", talimatId: T }, ozet: "ODM1" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ girdi: { tur: "odeme_talimati", talimatId: T }, ozet: "ODM2" });
    eslestir.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Dönem kapalı"));
    const sonuc = await service.topluEslestir(["a", "b", "c"]);
    expect(sonuc).toMatchObject({ eslesen: 1, atlanan: 1, hatali: 1 });
    expect(sonuc.sonuclar.map((s) => s.durum)).toEqual(["eslesti", "atlandi", "hata"]);
    expect(sonuc.sonuclar[2].mesaj).toBe("Dönem kapalı");
  });
});

describe("standart dosya yüklemesi hesap denetimi (KSB-32)", () => {
  const MT940 = ":20:S1\n:25:TR330006100519786457841326\n:60F:C261022TRY100,00\n:61:2610231023C50,00NTRFNONREF\n:86:EFT\n:62F:C261023TRY150,00\n";
  function ekstreServis(hesap: Record<string, unknown>) {
    const prisma = { tenantIslem: vi.fn(async (_t: string, cb: (tx: unknown) => unknown) => cb({ bankaHesap: { findUnique: vi.fn(async () => ({ id: "h1", ad: "Ziraat TL", iban: "TR330006100519786457841326", dovizCinsi: "TRY", ekstreEslemesi: null, ...hesap })) } })) };
    return new EkstreService(prisma as any);
  }

  it("dosyanın hesabı seçilen hesabın IBAN'ı değilse yüklemez", async () => {
    await expect(ekstreServis({ iban: "TR000000000000000000000001" }).onizle("h1", Buffer.from(MT940))).rejects.toThrow(/TR330006100519786457841326 hesabına ait/);
  });

  it("döviz uyuşmazsa yüklemez", async () => {
    await expect(ekstreServis({ dovizCinsi: "USD" }).onizle("h1", Buffer.from(MT940))).rejects.toThrow(/dövizi TRY, seçilen hesabın USD/);
  });

  it("önizleme sütun eşlemesi sormadan özet döner", async () => {
    const o = await ekstreServis({}).onizle("h1", Buffer.from(MT940)) as any;
    expect(o.standart).toMatchObject({ bicim: "mt940", satirSayisi: 1, acilis: "100.00", kapanis: "150.00", uyarilar: [] });
    expect(o.esleme).toBeUndefined();
  });
});
