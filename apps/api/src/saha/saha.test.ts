import { paketApiYoluKapali, yolModulu } from "@tekirextra/shared";
import { describe, expect, it, vi } from "vitest";
import { ROLLER_ANAHTAR } from "../auth/roller.decorator";
import { rolUcaYetkili } from "../auth/roller.guard";
import { StokController } from "../stok/stok.controller";
import { Prisma } from "@prisma/client";
import { PosController } from "../pos/pos.controller";
import { SahaFisController, SahaMalKabulController, SahaTahsilatController } from "./saha.controller";
import { eirsaliyeKabulBelgesi, partiToplamiDenetle, siparisKabulBelgesi } from "./mal-kabul";
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

describe("saha mal kabul (SAH-06)", () => {
  const roller = (fn: unknown) => Reflect.getMetadata(ROLLER_ANAHTAR, fn as object) as never;
  const Dc = (n: number) => new Prisma.Decimal(n);
  const kartTx = (belge: unknown) => ({
    belge: { findUnique: vi.fn(async () => belge) },
    stokKart: { findMany: vi.fn(async () => [{ id: "a", kod: "HM-001", ad: "Vida", anaBirim: "ADET", takipTipi: "lot" }]) },
    stokBirim: { findMany: vi.fn(async () => [{ stokId: "a", ad: "KOLI", katsayi: Dc(12) }]) },
  });

  it("depo rolü kabul edebilir; tahsilat uçları yalnız POS yetkili rollerde; modüller Stok ve Kasa-Banka", () => {
    expect(rolUcaYetkili("depo", roller(SahaMalKabulController.prototype.siparisKabul))).toBe(true);
    expect(rolUcaYetkili("depo", roller(SahaMalKabulController.prototype.eirsaliyeKabul))).toBe(true);
    expect(rolUcaYetkili("depo", roller(SahaTahsilatController.prototype.cari))).toBe(false);
    expect(rolUcaYetkili("satis", roller(SahaTahsilatController.prototype.cari))).toBe(false);
    expect(rolUcaYetkili("muhasebe", roller(SahaTahsilatController.prototype.cari))).toBe(true);
    expect(rolUcaYetkili("muhasebe", roller(PosController.prototype.karekod))).toBe(true);
    expect(yolModulu("/saha/mal-kabul/siparis/x")?.kod).toBe("stok");
    expect(yolModulu("/saha/tahsilat/cari/x")?.kod).toBe("kasa_banka");
  });

  it("siparişte yalnız kalanı olan satırlar, belge birimi katsayısıyla", async () => {
    const t = kartTx({
      id: "s1", tur: "siparis", yon: "alis", durum: "kismen_kapandi", no: "SAS1", tarih: new Date("2026-11-10"), cari: { unvan: "Tedarikçi" },
      satirlar: [
        { id: "l1", stokId: "a", varyantId: null, birim: "KOLI", miktar: Dc(5), teslimEdilenMiktar: Dc(2), varyant: null },
        { id: "l2", stokId: "a", varyantId: null, birim: "ADET", miktar: Dc(3), teslimEdilenMiktar: Dc(3), varyant: null },
      ],
    });
    const r = await siparisKabulBelgesi(t as never, "s1");
    expect(r.satirlar).toEqual([{ anahtar: "l1", stokId: "a", varyantId: null, kod: "HM-001", ad: "Vida", birim: "KOLI", katsayi: 12, beklenen: 3, takipTipi: "lot" }]);
  });

  it("satış siparişi ve kapalı sipariş kabul edilmez", async () => {
    await expect(siparisKabulBelgesi(kartTx({ id: "s", tur: "siparis", yon: "satis", durum: "onaylandi", satirlar: [] }) as never, "s")).rejects.toThrow(/bulunamadı/);
    await expect(siparisKabulBelgesi(kartTx({ id: "s", tur: "siparis", yon: "alis", durum: "kapandi", satirlar: [] }) as never, "s")).rejects.toThrow(/açık değil/);
  });

  it("e-İrsaliye: carisi yoksa engel; eşleşmeyen satır ve kartta olmayan birim katsayısız", async () => {
    const t = kartTx(null);
    const r = await eirsaliyeKabulBelgesi(t as never, {
      id: "e1", belgeNo: "ABC2026", tarih: "2026-11-12", gonderenUnvan: "Yeni Firma", yanit: "yeni", kendiSevkimiz: false, cari: null, alisIrsaliyesi: null,
      satirlar: [
        { siraNo: 1, ad: "Vida", miktar: "24", birim: "ADET", onerilenStokId: "a", onerilenVaryantId: null },
        { siraNo: 2, ad: "Somun", miktar: "1", birim: "ADET", onerilenStokId: null, onerilenVaryantId: null },
        { siraNo: 3, ad: "Vida", miktar: "1", birim: "PALET", onerilenStokId: "a", onerilenVaryantId: null },
      ],
    });
    expect(r.engel).toMatch(/cari olarak kayıtlı değil/);
    expect(r.satirlar.map((s) => [s.anahtar, s.stokId, s.katsayi, s.beklenen])).toEqual([["1", "a", 1, 24], ["2", null, null, 1], ["3", "a", null, 1]]);
  });

  it("e-İrsaliye: gönderenin VKN'si birden çok caride ise sahada kabul edilmez", async () => {
    const r = await eirsaliyeKabulBelgesi(kartTx(null) as never, {
      id: "e2", belgeNo: "ABC2027", tarih: "2026-11-14", gonderenUnvan: "Çift Kart", yanit: "yeni", kendiSevkimiz: false, cari: { id: "c1" }, cariUyarisi: "VKN … birden çok caride kayıtlı", alisIrsaliyesi: null,
      satirlar: [{ siraNo: 1, ad: "Vida", miktar: "1", birim: "ADET", onerilenStokId: null, onerilenVaryantId: null }],
    });
    expect(r.engel).toMatch(/birden çok caride kayıtlı; panelde işlenir/);
  });

  it("lot miktarları satır miktarını tutmalı", () => {
    expect(() => partiToplamiDenetle("3", [{ lotNo: "L1", miktar: "2" }, { lotNo: "L2", miktar: "1" }], "Vida")).not.toThrow();
    expect(() => partiToplamiDenetle("3", [{ lotNo: "L1", miktar: "2" }], "Vida")).toThrow(/tutmuyor/);
    expect(() => partiToplamiDenetle("3", undefined, "Vida")).not.toThrow();
  });

  it("siparişten kabul: okutulan miktar ve lotlar dönüşüme geçer", async () => {
    const t = kartTx({ id: "s1", tur: "siparis", yon: "alis", durum: "onaylandi", no: "SAS1", tarih: new Date(), cari: { unvan: "T" }, satirlar: [] });
    const prisma = { tenantIslem: vi.fn(async (_t: string, fn: (x: unknown) => unknown) => fn(t)) };
    const belgeler = { donustur: vi.fn(async () => ({ donusenTur: "irsaliye", belgeId: "air1", kaynakKapandi: false })) };
    const c = new SahaMalKabulController(prisma as never, belgeler as never);
    const id = "00000000-0000-4000-8000-000000000001";
    const satirId = "00000000-0000-4000-8000-000000000002";
    const r = await c.siparisKabul(id, { kalemler: [{ satirId, miktar: "2", partiler: [{ lotNo: "L1", miktar: "2" }] }] });
    expect(r).toEqual({ belgeId: "air1", siparisKapandi: false });
    expect(belgeler.donustur).toHaveBeenCalledWith(id, "irsaliye", { kalemler: [{ satirId, miktar: "2" }], partiler: new Map([[satirId, [{ lotNo: "L1", miktar: "2" }]]]) });
  });
});
