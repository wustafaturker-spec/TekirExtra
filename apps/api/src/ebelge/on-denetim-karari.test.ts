import { describe, expect, it, vi } from "vitest";
import type { OnDenetimBulgusu } from "@tekirextra/shared";
import { EbelgeService } from "./ebelge.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }),
  baglamAl: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }),
}));

/** EBLG-141: uyarı onayı; önceki karar yeniden gönderimi kapsar. */
function servis(oncekiKararlar: { bulgular: unknown }[] = []) {
  const tx = { onDenetimKarari: { findMany: vi.fn(async () => oncekiKararlar) } };
  const prisma = { tenantIslem: vi.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn(tx)) } as any;
  return new EbelgeService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
}

const uyari = (kod: OnDenetimBulgusu["kod"], satir?: number): OnDenetimBulgusu => ({ kod, satir, duzey: "uyari", mesaj: `${kod} mesajı` });
const bilgi: OnDenetimBulgusu = { kod: "KUR_BULUNAMADI", duzey: "bilgi", mesaj: "kur yok" };

describe("ön denetim onayı (EBLG-141)", () => {
  it("uyarı yoksa onay istemez, bilgi onay gerektirmez", async () => {
    await expect(servis().onDenetimOnayiDenetle("f1", [bilgi])).resolves.toBeNull();
  });

  it("onaysız uyarıyla gönderimi durdurur", async () => {
    await expect(servis().onDenetimOnayiDenetle("f1", [uyari("FIYAT_SAPMA", 2)])).rejects.toThrow(/onaylanmamış 1 uyarı/);
  });

  it("onaydan sonra çıkan yeni uyarı yeniden onay ister", async () => {
    await expect(
      servis().onDenetimOnayiDenetle("f1", [uyari("FIYAT_SAPMA", 2), uyari("MUKERRER_SUPHESI")], { anahtarlar: ["FIYAT_SAPMA:2"] }),
    ).rejects.toThrow(/MUKERRER_SUPHESI mesajı/);
    // Aynı kural başka satırda da ayrı onaydır.
    await expect(servis().onDenetimOnayiDenetle("f1", [uyari("FIYAT_SAPMA", 3)], { anahtarlar: ["FIYAT_SAPMA:2"] })).rejects.toThrow();
  });

  it("onaylanan uyarılar ve gerekçe kaydedilecek kararı oluşturur", async () => {
    const karar = await servis().onDenetimOnayiDenetle("f1", [uyari("FIYAT_SAPMA", 2), uyari("MUKERRER_SUPHESI"), bilgi], {
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
    await expect(servis(onceki).onDenetimOnayiDenetle("f1", [uyari("FIYAT_SAPMA", 2), uyari("MUKERRER_SUPHESI")])).resolves.toBeNull();
    await expect(servis(onceki).onDenetimOnayiDenetle("f1", [uyari("KUR_SAPMA")])).rejects.toThrow();
  });
});
