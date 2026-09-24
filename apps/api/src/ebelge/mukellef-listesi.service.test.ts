import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MukellefListesiService } from "./mukellef-listesi.service";

const metrics = { increment: vi.fn(), set: vi.fn() } as never;

function servisKur(secenekler: {
  adapter: Record<string, unknown>;
  senkron?: { sonSenkronAt: Date | null; kayitSayisi?: number; durum?: string } | null;
  mukellefler?: { postaKutusu: string; kutuKayitZamani?: Date | null; tur?: string | null }[];
}) {
  const gibMukellef = {
    findMany: vi.fn().mockResolvedValue((secenekler.mukellefler ?? []).map((m) => ({ kutuKayitZamani: null, tur: null, ...m }))),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const gibMukellefSenkron = {
    findUnique: vi.fn().mockResolvedValue(
      secenekler.senkron === undefined
        ? null
        : secenekler.senkron && { kayitSayisi: 0, durum: "basarili", hataMesaji: null, saglayici: "sovos", ...secenekler.senkron },
    ),
    upsert: vi.fn(async ({ create, update }) => ({
      kayitSayisi: 0,
      durum: "basarili",
      hataMesaji: null,
      saglayici: "sovos",
      sonSenkronAt: new Date(),
      ...create,
      ...update,
    })),
  };
  const prisma = {
    gibMukellef,
    gibMukellefSenkron,
    $transaction: vi.fn((calistir) => calistir({ gibMukellef })),
  } as never;
  const baglantilar = { adapterCoz: () => secenekler.adapter } as never;
  return { servis: new MukellefListesiService(prisma, baglantilar, metrics), gibMukellef, gibMukellefSenkron };
}

const saatlerOnce = (saat: number) => new Date(Date.now() - saat * 3_600_000);

describe("MukellefListesiService.kanalBelirle", () => {
  it("toplu liste sunmayan sağlayıcıda tekil sorguya düşer", async () => {
    const mukellefSorgula = vi.fn().mockResolvedValue({ vknTckn: "123", eFaturaMukellefi: true, postaKutusu: "urn:mail:pk" });
    const { servis, gibMukellef } = servisKur({ adapter: { mukellefSorgula } });

    const sonuc = await servis.kanalBelirle("izibiz", { saglayici: "izibiz", kullaniciAdi: "u" }, "123");

    expect(sonuc.eFaturaMukellefi).toBe(true);
    expect(mukellefSorgula).toHaveBeenCalledOnce();
    expect(gibMukellef.findMany).not.toHaveBeenCalled();
  });

  it("taze listede kanal kararını lokalden verir; entegratöre gitmez", async () => {
    const mukellefSorgula = vi.fn();
    const { servis } = servisKur({
      adapter: { mukellefSorgula, mukellefListesiCek: vi.fn() },
      senkron: { sonSenkronAt: saatlerOnce(2) },
      mukellefler: [{ postaKutusu: "urn:mail:defaultpk@alici.test" }],
    });

    const sonuc = await servis.kanalBelirle("sovos", { saglayici: "sovos", kullaniciAdi: "u" }, "123");

    expect(sonuc).toEqual({ vknTckn: "123", eFaturaMukellefi: true, postaKutusu: "urn:mail:defaultpk@alici.test", kamu: false });
    expect(mukellefSorgula).not.toHaveBeenCalled();
  });

  it("listede olmayan VKN e-Arşiv kanalına düşer", async () => {
    const { servis } = servisKur({
      adapter: { mukellefSorgula: vi.fn(), mukellefListesiCek: vi.fn() },
      senkron: { sonSenkronAt: saatlerOnce(2) },
      mukellefler: [],
    });

    const sonuc = await servis.kanalBelirle("sovos", { saglayici: "sovos", kullaniciAdi: "u" }, "123");

    expect(sonuc).toEqual({ vknTckn: "123", eFaturaMukellefi: false, postaKutusu: undefined, kamu: false });
  });

  it("liste bayatsa gönderimi durdurur — yanlış kanal tahmini yasal hata olurdu", async () => {
    const { servis } = servisKur({
      adapter: { mukellefSorgula: vi.fn(), mukellefListesiCek: vi.fn() },
      senkron: { sonSenkronAt: saatlerOnce(72) },
      mukellefler: [{ postaKutusu: "urn:mail:pk" }],
    });

    await expect(servis.kanalBelirle("sovos", { saglayici: "sovos", kullaniciAdi: "u" }, "123")).rejects.toThrow(
      BadRequestException,
    );
  });

  it("liste hiç indirilmemişse de durdurur", async () => {
    const { servis } = servisKur({ adapter: { mukellefSorgula: vi.fn(), mukellefListesiCek: vi.fn() }, senkron: null });

    await expect(servis.kanalBelirle("sovos", { saglayici: "sovos", kullaniciAdi: "u" }, "123")).rejects.toThrow(
      /henüz indirilmedi/,
    );
  });

  it("e-İrsaliye kararını e-Fatura kaydından ayrı sorar", async () => {
    const { servis, gibMukellef } = servisKur({
      adapter: { mukellefSorgula: vi.fn(), mukellefListesiCek: vi.fn() },
      senkron: { sonSenkronAt: saatlerOnce(1) },
      mukellefler: [],
    });

    await servis.kanalBelirle("sovos", { saglayici: "sovos", kullaniciAdi: "u" }, "123", "eirsaliye");

    expect(gibMukellef.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vknTckn: "123", belgeTuru: "eirsaliye" } }),
    );
  });

  // EBLG-86: alfabetik ilk kutu (2026-09-24, GİB test VKN'si) teslim edilmeyen
  // bir entegratörün kutusuydu; seçim canlı sorgudaki kuraldan geçer.
  describe("birden çok posta kutusu (EBLG-86)", () => {
    const kutular = [
      { postaKutusu: "urn:mail:06ebfd19_pk@vadi.com.tr", kutuKayitZamani: new Date("2016-03-24T13:43:12Z") },
      { postaKutusu: "urn:mail:defaultpk@eski.com.tr", kutuKayitZamani: new Date("2018-01-01T00:00:00Z") },
      { postaKutusu: "urn:mail:defaultpk@yeni.com.tr", kutuKayitZamani: new Date("2025-07-22T12:59:26Z") },
      { postaKutusu: "urn:mail:merkezpk@nes.com.tr", kutuKayitZamani: new Date("2020-01-01T00:00:00Z") },
      { postaKutusu: "urn:mail:defaultpk@nes.com.tr", kutuKayitZamani: new Date("2021-03-25T11:30:41Z") },
    ];
    const kur = () => servisKur({ adapter: { mukellefSorgula: vi.fn(), mukellefListesiCek: vi.fn() }, senkron: { sonSenkronAt: saatlerOnce(1) }, mukellefler: kutular });

    it("kendi entegratörümüzdeki defaultpk kutusunu seçer ve adayları döner", async () => {
      const sonuc = await kur().servis.kanalBelirle("nes", { saglayici: "nes", gondericiBirimEtiketi: "urn:mail:defaultgb@nes.com.tr" }, "123");
      expect(sonuc.postaKutusu).toBe("urn:mail:defaultpk@nes.com.tr");
      expect(sonuc.postaKutulari).toHaveLength(5);
    });

    it("kendi entegratörümüzde kutu yoksa en yeni defaultpk kutusunu seçer", async () => {
      const sonuc = await kur().servis.kanalBelirle("nes", { saglayici: "nes", gondericiBirimEtiketi: "urn:mail:defaultgb@baska.com" }, "123");
      expect(sonuc.postaKutusu).toBe("urn:mail:defaultpk@yeni.com.tr");
    });

    it("cari kartında elle seçilen kutu listede durdukça kuralın önüne geçer", async () => {
      const cfg = { saglayici: "nes" as const, gondericiBirimEtiketi: "urn:mail:defaultgb@nes.com.tr" };
      expect((await kur().servis.kanalBelirle("nes", cfg, "123", "efatura", "urn:mail:06ebfd19_pk@vadi.com.tr")).postaKutusu).toBe("urn:mail:06ebfd19_pk@vadi.com.tr");
      // Listeden düşen elle seçim yok sayılır; kurala dönülür.
      expect((await kur().servis.kanalBelirle("nes", cfg, "123", "efatura", "urn:mail:silinmis@x.com")).postaKutusu).toBe("urn:mail:defaultpk@nes.com.tr");
    });
  });
});

describe("MukellefListesiService.senkronEt", () => {
  const cfg = { saglayici: "sovos" as const, kullaniciAdi: "u" };

  it("listeyi tek işlemde değiştirir ve mükerrer etiketi indirger", async () => {
    const mukellefListesiCek = vi.fn().mockResolvedValue([
      { vknTckn: "1", belgeTuru: "efatura", postaKutusu: "urn:mail:a", unvan: "Alfa", tur: "KAMU", ilkKayitZamani: "2014-07-18T13:07:05.000Z" },
      { vknTckn: "1", belgeTuru: "efatura", postaKutusu: "urn:mail:a", unvan: "Alfa", tur: "KAMU", ilkKayitZamani: "2014-07-18T13:07:05.000Z" },
      { vknTckn: "1", belgeTuru: "eirsaliye", postaKutusu: "urn:mail:a", unvan: "Alfa", kutuKayitZamani: "2019-01-02T10:38:23.000Z" },
    ]);
    const { servis, gibMukellef } = servisKur({ adapter: { mukellefListesiCek }, senkron: null });

    const sonuc = await servis.senkronEt("sovos", cfg);

    expect(gibMukellef.deleteMany).toHaveBeenCalledBefore(gibMukellef.createMany as never);
    expect(gibMukellef.createMany).toHaveBeenCalledWith({
      data: [
        // CARI-23: ilk kayıt zamanı cari kartında gösterilmek üzere saklanır.
        { vknTckn: "1", belgeTuru: "efatura", postaKutusu: "urn:mail:a", unvan: "Alfa", tur: "KAMU", ilkKayitZamani: new Date("2014-07-18T13:07:05.000Z"), kutuKayitZamani: null },
        // EBLG-86: kutunun kayıt zamanı kutu seçiminde en yeniyi ayırt eder.
        { vknTckn: "1", belgeTuru: "eirsaliye", postaKutusu: "urn:mail:a", unvan: "Alfa", tur: null, ilkKayitZamani: null, kutuKayitZamani: new Date("2019-01-02T10:38:23.000Z") },
      ],
    });
    expect(sonuc.kayitSayisi).toBe(2);
  });

  it("boş liste gelirse mevcut listeyi silmez", async () => {
    const { servis, gibMukellef } = servisKur({ adapter: { mukellefListesiCek: vi.fn().mockResolvedValue([]) }, senkron: null });

    await expect(servis.senkronEt("sovos", cfg)).rejects.toThrow(/boş mükellef listesi/);
    expect(gibMukellef.deleteMany).not.toHaveBeenCalled();
  });

  it("başarısız senkron son senkron zamanını ilerletmez; liste bayat kalır", async () => {
    const { servis, gibMukellefSenkron } = servisKur({
      adapter: { mukellefListesiCek: vi.fn().mockRejectedValue(new Error("SOAP 500")) },
      senkron: { sonSenkronAt: saatlerOnce(72) },
    });

    await expect(servis.senkronEt("sovos", cfg)).rejects.toThrow(BadRequestException);
    const [{ update }] = gibMukellefSenkron.upsert.mock.calls[0];
    expect(update).toEqual(expect.objectContaining({ durum: "hata" }));
    expect(update).not.toHaveProperty("sonSenkronAt");
  });
});
