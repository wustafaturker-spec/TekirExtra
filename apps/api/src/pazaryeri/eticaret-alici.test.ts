import { describe, expect, it, vi } from "vitest";
import { eticaretCarisi, magazaWebAdresi, nihaiAlici } from "./eticaret-alici";

function tx(mevcut: Array<{ id: string; kod: string; unvan: string; tip: string; karaListe: boolean }> = []) {
  return {
    cariHesap: {
      findMany: vi.fn(async () => mevcut),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "yeni", ...data })),
      update: vi.fn(async () => ({})),
    },
    cariAdres: { create: vi.fn(async () => ({})) },
  };
}
const siparis = (ek: Record<string, unknown> = {}) => ({ musteriUnvani: "Ak Ltd", musteriEposta: "a@example.com", vknTckn: null as string | null, teslimatAdresi: { fatura: { ad: "Elif Ak", firma: "Ak Ltd", adres: "Gül Sk. 3", il: "İzmir", ilce: "Bornova", postaKodu: "35000", ulke: "TR", vergiDairesi: "Bornova" } }, ...ek });

describe("e-ticaret alıcı carisi (ETC-05)", () => {
  it("pazaryerinde kural uygulanmaz", async () => {
    expect(await eticaretCarisi(tx() as never, "t", { saglayici: "trendyol", varsayilanAliciCariId: "v" }, siparis())).toBeNull();
  });

  it("bireysel ya da TCKN'li alıcı varsayılan cariye", async () => {
    const b = { saglayici: "woocommerce", varsayilanAliciCariId: "perakende" };
    expect(await eticaretCarisi(tx() as never, "t", b, siparis())).toBe("perakende");
    expect(await eticaretCarisi(tx() as never, "t", b, siparis({ vknTckn: "12345678901" }))).toBe("perakende");
    expect(await eticaretCarisi(tx() as never, "t", { saglayici: "shopify", varsayilanAliciCariId: null }, siparis())).toBeNull();
  });

  it("VKN'li alıcı mevcut müşteri carisiyle eşleşir; yoksa adresiyle açılır", async () => {
    const b = { saglayici: "ikas", varsayilanAliciCariId: "perakende" };
    const t1 = tx([{ id: "c1", kod: "C1", unvan: "Ak", tip: "musteri", karaListe: false }]);
    expect(await eticaretCarisi(t1 as never, "t", b, siparis({ vknTckn: "1234567890" }))).toBe("c1");
    expect(t1.cariHesap.create).not.toHaveBeenCalled();
    const t2 = tx();
    expect(await eticaretCarisi(t2 as never, "t", b, siparis({ vknTckn: "1234567890" }))).toBe("yeni");
    expect(t2.cariHesap.create).toHaveBeenCalledWith({ data: { tenantId: "t", kod: "MUS-1234567890", unvan: "Ak Ltd", vknTckn: "1234567890", tip: "musteri" } });
    expect(t2.cariHesap.update).toHaveBeenCalledWith({ where: { id: "yeni" }, data: { vergiDairesi: "Bornova", eposta: "a@example.com" } });
    expect(t2.cariAdres.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cariId: "yeni", tip: "fatura", adres: "Gül Sk. 3", il: "İzmir", ilce: "Bornova", ulke: "TR" }) });
  });

  it("nihai tüketici: fatura adındaki kişi, TCKN yalnız 11 hane", () => {
    expect(nihaiAlici(siparis({ vknTckn: "12345678901" }))).toEqual({ nihaiAliciAdSoyad: "Elif Ak", nihaiAliciTckn: "12345678901", nihaiAliciAdres: "Gül Sk. 3", nihaiAliciIl: "İzmir", nihaiAliciIlce: "Bornova", nihaiAliciPostaKodu: "35000", nihaiAliciEposta: "a@example.com" });
    expect(nihaiAlici(siparis({ vknTckn: "1234567890" })).nihaiAliciTckn).toBeNull();
  });

  it("mağaza web adresi", () => {
    expect(magazaWebAdresi("shopify", { kullaniciAdi: "magazam.myshopify.com" })).toBe("https://magazam.myshopify.com");
    expect(magazaWebAdresi("ikas", { kullaniciAdi: "magazam" })).toBe("https://magazam.myikas.com");
    expect(magazaWebAdresi("woocommerce", { servisAdresi: "https://site.com/" })).toBe("https://site.com");
  });
});
