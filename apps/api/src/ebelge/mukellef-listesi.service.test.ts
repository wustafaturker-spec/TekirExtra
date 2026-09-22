import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MukellefListesiService } from "./mukellef-listesi.service";

const metrics = { increment: vi.fn(), set: vi.fn() } as never;

function servisKur(secenekler: {
  adapter: Record<string, unknown>;
  senkron?: { sonSenkronAt: Date | null; kayitSayisi?: number; durum?: string } | null;
  mukellef?: { postaKutusu: string } | null;
}) {
  const gibMukellef = {
    findFirst: vi.fn().mockResolvedValue(secenekler.mukellef ?? null),
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
    expect(gibMukellef.findFirst).not.toHaveBeenCalled();
  });

  it("taze listede kanal kararını lokalden verir; entegratöre gitmez", async () => {
    const mukellefSorgula = vi.fn();
    const { servis } = servisKur({
      adapter: { mukellefSorgula, mukellefListesiCek: vi.fn() },
      senkron: { sonSenkronAt: saatlerOnce(2) },
      mukellef: { postaKutusu: "urn:mail:defaultpk@alici.test" },
    });

    const sonuc = await servis.kanalBelirle("sovos", { saglayici: "sovos", kullaniciAdi: "u" }, "123");

    expect(sonuc).toEqual({ vknTckn: "123", eFaturaMukellefi: true, postaKutusu: "urn:mail:defaultpk@alici.test", kamu: false });
    expect(mukellefSorgula).not.toHaveBeenCalled();
  });

  it("listede olmayan VKN e-Arşiv kanalına düşer", async () => {
    const { servis } = servisKur({
      adapter: { mukellefSorgula: vi.fn(), mukellefListesiCek: vi.fn() },
      senkron: { sonSenkronAt: saatlerOnce(2) },
      mukellef: null,
    });

    const sonuc = await servis.kanalBelirle("sovos", { saglayici: "sovos", kullaniciAdi: "u" }, "123");

    expect(sonuc).toEqual({ vknTckn: "123", eFaturaMukellefi: false, postaKutusu: undefined, kamu: false });
  });

  it("liste bayatsa gönderimi durdurur — yanlış kanal tahmini yasal hata olurdu", async () => {
    const { servis } = servisKur({
      adapter: { mukellefSorgula: vi.fn(), mukellefListesiCek: vi.fn() },
      senkron: { sonSenkronAt: saatlerOnce(72) },
      mukellef: { postaKutusu: "urn:mail:pk" },
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
      mukellef: null,
    });

    await servis.kanalBelirle("sovos", { saglayici: "sovos", kullaniciAdi: "u" }, "123", "eirsaliye");

    expect(gibMukellef.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vknTckn: "123", belgeTuru: "eirsaliye" } }),
    );
  });
});

describe("MukellefListesiService.senkronEt", () => {
  const cfg = { saglayici: "sovos" as const, kullaniciAdi: "u" };

  it("listeyi tek işlemde değiştirir ve mükerrer etiketi indirger", async () => {
    const mukellefListesiCek = vi.fn().mockResolvedValue([
      { vknTckn: "1", belgeTuru: "efatura", postaKutusu: "urn:mail:a", unvan: "Alfa", tur: "KAMU", ilkKayitZamani: "2014-07-18T13:07:05.000Z" },
      { vknTckn: "1", belgeTuru: "efatura", postaKutusu: "urn:mail:a", unvan: "Alfa", tur: "KAMU", ilkKayitZamani: "2014-07-18T13:07:05.000Z" },
      { vknTckn: "1", belgeTuru: "eirsaliye", postaKutusu: "urn:mail:a", unvan: "Alfa" },
    ]);
    const { servis, gibMukellef } = servisKur({ adapter: { mukellefListesiCek }, senkron: null });

    const sonuc = await servis.senkronEt("sovos", cfg);

    expect(gibMukellef.deleteMany).toHaveBeenCalledBefore(gibMukellef.createMany as never);
    expect(gibMukellef.createMany).toHaveBeenCalledWith({
      data: [
        // CARI-23: ilk kayıt zamanı cari kartında gösterilmek üzere saklanır.
        { vknTckn: "1", belgeTuru: "efatura", postaKutusu: "urn:mail:a", unvan: "Alfa", tur: "KAMU", ilkKayitZamani: new Date("2014-07-18T13:07:05.000Z") },
        { vknTckn: "1", belgeTuru: "eirsaliye", postaKutusu: "urn:mail:a", unvan: "Alfa", tur: null, ilkKayitZamani: null },
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
