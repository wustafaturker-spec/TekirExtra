import { paketApiYoluKapali, yolModulu } from "@tekirextra/shared";
import { describe, expect, it, vi } from "vitest";
import { ROLLER_ANAHTAR } from "../auth/roller.decorator";
import { rolUcaYetkili } from "../auth/roller.guard";
import { StokController } from "../stok/stok.controller";
import { SahaFisController } from "./saha.controller";
import { sahaUrunleri } from "./saha-urun";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "depo" }) }));

const D = (n: number) => ({ toString: () => String(n), valueOf: () => n });
function tx() {
  return {
    stokKart: { findMany: vi.fn(async () => [
      { id: "a", kod: "HM-001", ad: "Vida", anaBirim: "ADET", takipTipi: "yok", barkod: "869001", varyantlar: [] },
      { id: "b", kod: "TS-01", ad: "Tişört", anaBirim: "ADET", takipTipi: "yok", barkod: null, varyantlar: [{ id: "b1", kod: "TS-01-K", ad: "Kırmızı", barkod: "869101" }, { id: "b2", kod: "TS-01-M", ad: "Mavi", barkod: null }] },
    ]) },
    stokBarkod: { findMany: vi.fn(async () => [
      { barkod: "869012", stokId: "a", birim: "KOLI" },
      { barkod: "869001", stokId: "a", birim: null },
      { barkod: "999", stokId: "a", birim: "PALET" },
      { barkod: "777", stokId: "pasif", birim: null },
    ]) },
    stokBirim: { findMany: vi.fn(async () => [{ stokId: "a", ad: "KOLI", katsayi: D(12) }]) },
  };
}

describe("saha ürün listesi (SAH-05)", () => {
  it("fiyatsız ürünler; barkod kaydı, kart ve varyant barkodu; koli katsayısı; tanımsız birim ve pasif ürün atlanır", async () => {
    const t = tx();
    const r = await sahaUrunleri(t as never);
    expect(t.stokKart.findMany.mock.calls[0]).toEqual([expect.objectContaining({ where: { aktif: true, tip: { not: "hizmet" } } })]);
    expect(JSON.stringify(r)).not.toMatch(/fiyat|maliyet/i);
    expect(r.barkodlar).toEqual([
      { barkod: "869012", stokId: "a", varyantId: null, katsayi: 12, birim: "KOLI" },
      { barkod: "869001", stokId: "a", varyantId: null, katsayi: 1, birim: "ADET" },
      { barkod: "869101", stokId: "b", varyantId: "b1", katsayi: 1, birim: "ADET" },
    ]);
    expect(r.urunler[1].varyantlar).toEqual([{ id: "b1", kod: "TS-01-K", ad: "Kırmızı" }, { id: "b2", kod: "TS-01-M", ad: "Mavi" }]);
  });
});

describe("saha yetkileri", () => {
  it("SAH-04: depo rolü taslak sayım açabilir; onay ucu muhasebede kalır", () => {
    const roller = (fn: unknown) => Reflect.getMetadata(ROLLER_ANAHTAR, fn as object) as never;
    expect(rolUcaYetkili("depo", roller(StokController.prototype.sayimOlustur))).toBe(true);
    expect(rolUcaYetkili("depo", roller(StokController.prototype.sayimOnayla))).toBe(false);
    expect(rolUcaYetkili("satis", roller(StokController.prototype.sayimOlustur))).toBe(false);
  });

  it("uçlar yetki modülüne bağlı; fiş ucu Yapay Zekâ paketini de ister", () => {
    expect(yolModulu("/saha/urunler")?.kod).toBe("stok");
    expect(yolModulu("/saha/ai-fis")?.kod).toBe("masraf_gelir");
    expect(paketApiYoluKapali(["masraf_gelir"], "/saha/ai-fis")).toBe(true);
    expect(paketApiYoluKapali(["masraf_gelir", "yapay_zeka"], "/saha/ai-fis")).toBe(false);
    expect(paketApiYoluKapali(["cari"], "/saha/urunler")).toBe(true);
  });

  it("SAH-08: fiş ucu belgeyi panel kanalıyla masraf hattına verir; boş dosya reddedilir", async () => {
    const masrafBelge = { belgedenMasraf: vi.fn(async () => ({ sonuc: "ok" })) };
    const c = new SahaFisController(masrafBelge as never);
    await expect(c.masrafFisi(undefined, undefined)).rejects.toThrow(/gönderilmedi/);
    await c.masrafFisi({ originalname: "saha-fis.jpg", buffer: Buffer.from("x") }, "  Ankara yolu  ");
    expect(masrafBelge.belgedenMasraf).toHaveBeenCalledWith({ ad: "saha-fis.jpg", buffer: expect.any(Buffer) }, "Ankara yolu", "WEB");
  });
});
