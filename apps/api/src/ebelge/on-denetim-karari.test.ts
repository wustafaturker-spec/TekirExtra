import { describe, expect, it, vi } from "vitest";
import type { OnDenetimBulgusu } from "@tekirextra/shared";
import { EbelgeService } from "./ebelge.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }),
  baglamAl: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }),
}));

/** EBLG-141: uyarı onayı; önceki karar yeniden gönderimi kapsar. */
function servis(oncekiKararlar: { bulgular: unknown }[] = [], sorgular: unknown[] = []) {
  const tx = { onDenetimKarari: { findMany: vi.fn(async (q: unknown) => { sorgular.push(q); return oncekiKararlar; }) } };
  const prisma = { tenantIslem: vi.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn(tx)) } as any;
  return new EbelgeService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
}

const uyari = (kod: OnDenetimBulgusu["kod"], satir?: number): OnDenetimBulgusu => ({ kod, satir, duzey: "uyari", mesaj: `${kod} mesajı` });
const bilgi: OnDenetimBulgusu = { kod: "KUR_BULUNAMADI", duzey: "bilgi", mesaj: "kur yok" };

describe("ön denetim onayı (EBLG-141)", () => {
  it("uyarı yoksa onay istemez, bilgi onay gerektirmez", async () => {
    await expect(servis().onDenetimOnayiDenetle({ faturaId: "f1" }, [bilgi])).resolves.toBeNull();
  });

  it("onaysız uyarıyla gönderimi durdurur", async () => {
    await expect(servis().onDenetimOnayiDenetle({ faturaId: "f1" }, [uyari("FIYAT_SAPMA", 2)])).rejects.toThrow(/onaylanmamış 1 uyarı/);
  });

  it("onaydan sonra çıkan yeni uyarı yeniden onay ister", async () => {
    await expect(
      servis().onDenetimOnayiDenetle({ faturaId: "f1" }, [uyari("FIYAT_SAPMA", 2), uyari("MUKERRER_SUPHESI")], { anahtarlar: ["FIYAT_SAPMA:2"] }),
    ).rejects.toThrow(/MUKERRER_SUPHESI mesajı/);
    // Aynı kural başka satırda da ayrı onaydır.
    await expect(servis().onDenetimOnayiDenetle({ faturaId: "f1" }, [uyari("FIYAT_SAPMA", 3)], { anahtarlar: ["FIYAT_SAPMA:2"] })).rejects.toThrow();
  });

  it("onaylanan uyarılar ve gerekçe kaydedilecek kararı oluşturur", async () => {
    const karar = await servis().onDenetimOnayiDenetle({ faturaId: "f1" }, [uyari("FIYAT_SAPMA", 2), uyari("MUKERRER_SUPHESI"), bilgi], {
      anahtarlar: ["FIYAT_SAPMA:2", "MUKERRER_SUPHESI:0"],
      gerekce: "  kampanya fiyatı ",
    });
    expect(karar).toEqual({
      bulgular: [
        { kod: "FIYAT_SAPMA", satir: 2, mesaj: "FIYAT_SAPMA mesajı" },
        { kod: "MUKERRER_SUPHESI", satir: null, mesaj: "MUKERRER_SUPHESI mesajı" },
      ],
      gerekce: "kampanya fiyatı",
    });
  });

  it("yeniden gönderimde önceki karar aynı uyarıları kapsar, yeni kayıt açılmaz", async () => {
    const onceki = [{ bulgular: [{ kod: "FIYAT_SAPMA", satir: 2, mesaj: "x" }, { kod: "MUKERRER_SUPHESI", satir: null, mesaj: "y" }] }];
    await expect(servis(onceki).onDenetimOnayiDenetle({ faturaId: "f1" }, [uyari("FIYAT_SAPMA", 2), uyari("MUKERRER_SUPHESI")])).resolves.toBeNull();
    await expect(servis(onceki).onDenetimOnayiDenetle({ faturaId: "f1" }, [uyari("KUR_SAPMA")])).rejects.toThrow();
  });

  it("EBLG-150: gelen belgede önceki karar belgeye göre aranır, mesaj işlemeyi anlatır", async () => {
    const sorgular: unknown[] = [];
    await expect(servis([], sorgular).onDenetimOnayiDenetle({ gelenEbelgeId: "g1" }, [uyari("GELEN_IBAN_DEGISTI")])).rejects.toThrow(/Gelen alış denetiminde onaylanmamış 1 uyarı/);
    expect(sorgular[0]).toEqual({ where: { tenantId: "t1", gelenEbelgeId: "g1" }, select: { bulgular: true } });
    const onceki = [{ bulgular: [{ kod: "GELEN_IBAN_DEGISTI", satir: null, mesaj: "x" }] }];
    await expect(servis(onceki).onDenetimOnayiDenetle({ gelenEbelgeId: "g1" }, [uyari("GELEN_IBAN_DEGISTI")])).resolves.toBeNull();
  });
});

describe("ön denetim ölçümü (EBLG-143)", () => {
  it("aylık sorunlu oranı, öncesi/sonrası ve kural başına geçilen uyarılar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    const kayit = (faturaId: string, createdAt: string, durum = "iletildi", aliciYaniti: string | null = null, faturaDurum = "kesin") =>
      ({ faturaId, createdAt: new Date(createdAt), durum, aliciYaniti, fatura: { durum: faturaDurum } });
    const kayitlar = [
      kayit("a", "2026-09-10T09:00:00Z", "iletildi", "ret"),
      kayit("b", "2026-09-11T09:00:00Z"),
      kayit("c", "2026-09-30T22:30:00Z"), // İstanbul'da 1 Ekim
      kayit("d", "2026-10-21T09:00:00Z", "kabul"),
      kayit("e", "2026-10-22T09:00:00Z", "iletildi", null, "iptal"),
      kayit("f", "2026-10-23T09:00:00Z", "hata"), // gönderilmemiş sayılmaz
    ];
    const kararlar = [
      { faturaId: "e", gelenEbelgeId: null, bulgular: [{ kod: "FIYAT_SAPMA" }, { kod: "MUKERRER_SUPHESI" }] },
      { faturaId: "d", gelenEbelgeId: null, bulgular: [{ kod: "FIYAT_SAPMA" }] },
      // EBLG-150: gelen yönün kararı gidenin sayılarına karışmaz.
      { faturaId: null, gelenEbelgeId: "g1", bulgular: [{ kod: "GELEN_IBAN_DEGISTI" }, { kod: "GELEN_FIYAT_SAPMA" }] },
      { faturaId: null, gelenEbelgeId: "g2", bulgular: [{ kod: "GELEN_FIYAT_SAPMA" }] },
    ];
    const tx = {
      ebelgeKayit: { findMany: vi.fn(async () => kayitlar) },
      onDenetimKarari: { findMany: vi.fn(async () => kararlar) },
      gelenEbelge: { findMany: vi.fn(async () => [{ denetimUyariSayisi: 2 }, { denetimUyariSayisi: 0 }, { denetimUyariSayisi: 1 }]) },
    };
    const prisma = { tenantIslem: vi.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn(tx)) } as any;
    const servis = new EbelgeService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const o = await servis.onDenetimOlcumu(2);
    vi.useRealTimers();

    expect(o.aylar).toEqual([
      { ay: "2026-09", gonderilen: 2, sorunlu: 1, uyariIleGonderilen: 0, sorunluOrani: 50 },
      { ay: "2026-10", gonderilen: 3, sorunlu: 1, uyariIleGonderilen: 2, sorunluOrani: 33.3 },
    ]);
    expect(o.once).toEqual({ gonderilen: 3, sorunlu: 1, oran: 33.3 });
    expect(o.sonra).toEqual({ gonderilen: 2, sorunlu: 1, oran: 50 });
    expect(o.kurallar).toEqual([
      { kod: "FIYAT_SAPMA", kural: "Fiyat sapması", gecilen: 2, sonradanSorunlu: 1 },
      { kod: "MUKERRER_SUPHESI", kural: "Mükerrer fatura şüphesi", gecilen: 1, sonradanSorunlu: 1 },
    ]);
    expect(o.gelen).toEqual({
      denetlenen: 3, uyarili: 2, uyariylaIslenen: 2,
      kurallar: [
        { kod: "GELEN_FIYAT_SAPMA", kural: "Gelen: fiyat sapması", gecilen: 2 },
        { kod: "GELEN_IBAN_DEGISTI", kural: "Gelen: ödeme hesabı değişmiş", gecilen: 1 },
      ],
    });
  });
});
