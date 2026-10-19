import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../../core/istek-baglami";
import { HafizaService } from "./hafiza.service";

type Kayit = Record<string, any>;

function kur(o: { mevcut?: Kayit | null; kayit?: Kayit | null; hafizalar?: Kayit[]; aktifStoklar?: string[]; aktifVaryantlar?: Array<{ id: string; stokId: string }>; islemler?: Kayit[]; belge?: Kayit | null } = {}) {
  const tx = {
    aiHafiza: {
      findFirst: vi.fn(async () => o.kayit ?? o.mevcut ?? null),
      findMany: vi.fn(async () => o.hafizalar ?? []),
      create: vi.fn(async ({ data }: { data: Kayit }) => ({ id: "yeni", ...data })),
      update: vi.fn(async ({ data }: { data: Kayit }) => ({ ...o.mevcut, ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      delete: vi.fn(async () => ({})),
      count: vi.fn(async () => 0),
    },
    stokKart: { findMany: vi.fn(async () => (o.aktifStoklar ?? []).map((id) => ({ id }))) },
    stokVaryant: { findMany: vi.fn(async () => o.aktifVaryantlar ?? []) },
    epostaTeklifIslemi: { findMany: vi.fn(async () => o.islemler ?? []), update: vi.fn(async () => ({})) },
    belge: { findFirst: vi.fn(async () => o.belge ?? null) },
    cariHesap: { findFirst: vi.fn(async () => ({ id: "c1" })), findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (x: typeof tx) => unknown) => fn(tx)) };
  const service = new HafizaService(prisma as never);
  const calistir = <T>(fn: () => Promise<T>, rol = "muhasebe", userId = "u1") => istekBaglami.run({ deger: { tenantId: "t1", userId, rol: rol as never } }, fn);
  return { service, tx, calistir };
}

describe("hafıza yazımı (AI-58)", () => {
  it("yeni kayıt kiracı, tür, cari ve anahtarla açılır; otomatik kaydın oluşturanı yoktur", async () => {
    const k = kur();
    await k.calistir(() => k.service.urunOgret({ cariId: "c1", ifade: "SİL-FIX bez", stokId: "s1", varyantId: "v1", kaynak: "otomatik", kaynakEpostaId: "e1" }));
    expect(k.tx.aiHafiza.findFirst).toHaveBeenCalledWith({ where: { tenantId: "t1", tur: "urun_eslesme", cariId: "c1", anahtar: "sil fix bez" } });
    expect(k.tx.aiHafiza.create.mock.calls[0][0].data).toMatchObject({ tenantId: "t1", tur: "urun_eslesme", cariId: "c1", stokId: "s1", varyantId: "v1", kaynak: "otomatik", durum: "aktif", olusturanUserId: null, metin: "SİL-FIX bez" });
  });

  it("AI önerisi var olan kaydı değiştirmez; otomatik öğrenme kullanıcı kararını ve pasifi ezmez", async () => {
    const onayli = kur({ mevcut: { id: "h1", kaynak: "ai_onerisi", durum: "aktif" } });
    await onayli.calistir(() => onayli.service.tercihOnerileri("c1", ["Fiyatlar KDV hariç"], "e1").catch(() => 0));
    expect(onayli.tx.aiHafiza.update).not.toHaveBeenCalled();

    for (const mevcut of [{ id: "h1", kaynak: "kullanici", durum: "aktif" }, { id: "h1", kaynak: "otomatik", durum: "pasif" }]) {
      const k = kur({ mevcut });
      await k.calistir(() => k.service.urunOgret({ cariId: "c1", ifade: "bez", stokId: "s2", varyantId: null, kaynak: "otomatik" }));
      expect(k.tx.aiHafiza.update).not.toHaveBeenCalled();
    }
    // Kullanıcının yeni seçimi pasif kaydı yeniden açar.
    const k = kur({ mevcut: { id: "h1", kaynak: "otomatik", durum: "pasif" } });
    await k.calistir(() => k.service.urunOgret({ cariId: "c1", ifade: "bez", stokId: "s2", varyantId: null, kaynak: "kullanici" }));
    expect(k.tx.aiHafiza.update.mock.calls[0][0].data).toMatchObject({ stokId: "s2", durum: "aktif", kaynak: "kullanici", olusturanUserId: "u1" });
  });

  it("AI önerisi 'oneri' durumunda yazılır, kullanıcı tercihi doğrudan aktif", async () => {
    const k = kur({ kayit: null });
    await k.calistir(() => k.service.tercihEkle("c1", "  Teslimat   hep depoya ", "ai_onerisi", "e1"));
    expect(k.tx.aiHafiza.create.mock.calls[0][0].data).toMatchObject({ tur: "musteri_tercihi", durum: "oneri", metin: "Teslimat hep depoya", anahtar: "teslimat hep depoya" });
  });
});

describe("hafızadan okuma (AI-61)", () => {
  it("aynı cari kesin, başka cari aday; pasif kart ve karta ait olmayan varyant düşer", async () => {
    const k = kur({
      hafizalar: [
        { id: "h1", anahtar: "bez", cariId: "c1", stokId: "s1", varyantId: "v1" },
        { id: "h2", anahtar: "bez", cariId: "c2", stokId: "s2", varyantId: null },
        { id: "h3", anahtar: "kalem", cariId: "c1", stokId: "s-pasif", varyantId: null },
        { id: "h4", anahtar: "kagit", cariId: "c1", stokId: "s1", varyantId: "v-baska" },
      ],
      aktifStoklar: ["s1", "s2"],
      aktifVaryantlar: [{ id: "v1", stokId: "s1" }, { id: "v-baska", stokId: "s9" }],
    });
    const r = await k.calistir(() => k.service.urunleriHatirla("c1", ["Bez", "kalem", "kağıt"]));
    expect([...r.kesin.entries()]).toEqual([["bez", { id: "h1", stokId: "s1", varyantId: "v1" }]]);
    expect([...r.aday.entries()]).toEqual([["bez", [{ id: "h2", stokId: "s2", varyantId: null }]]]);
    expect(k.tx.aiHafiza.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "t1", tur: "urun_eslesme", durum: "aktif" });
  });

  it("yalnız aktif tercihler ve aktif susturma okunur", async () => {
    const k = kur({ hafizalar: [{ id: "h1", metin: "KDV hariç" }] });
    expect(await k.calistir(() => k.service.aktifTercihler("c1"))).toEqual(["KDV hariç"]);
    expect(k.tx.aiHafiza.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", tur: "musteri_tercihi", durum: "aktif", cariId: "c1" });
    await k.calistir(() => k.service.susturulduMu(" Bilgi@Banka.com "));
    expect(k.tx.aiHafiza.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", tur: "susturma", durum: "aktif", anahtar: "bilgi@banka.com" });
  });
});

describe("onaylanan tekliften öğrenme (AI-61)", () => {
  const islem = { id: "i1", belgeId: "b1", cariId: "c1", gelenEpostaId: "e1", kalemler: [{ ifade: "bez", stokId: null, varyantId: null, belirsizKart: { stokId: "sf" } }] };

  it("taslaktaki teklif beklenir; onaylıdan öğrenilir ve işaretlenir", async () => {
    const taslak = kur({ islemler: [islem], belge: { durum: "taslak", cariId: "c1", satirlar: [] } });
    expect(await taslak.calistir(() => taslak.service.tekliftenOgren())).toBe(0);
    expect(taslak.tx.epostaTeklifIslemi.update).not.toHaveBeenCalled();

    const onayli = kur({ islemler: [islem], belge: { durum: "onaylandi", cariId: "c1", satirlar: [{ stokId: "sf", varyantId: "v45" }] } });
    expect(await onayli.calistir(() => onayli.service.tekliftenOgren())).toBe(1);
    expect(onayli.tx.aiHafiza.create.mock.calls[0][0].data).toMatchObject({ tur: "urun_eslesme", cariId: "c1", anahtar: "bez", stokId: "sf", varyantId: "v45", kaynak: "otomatik" });
    expect(onayli.tx.epostaTeklifIslemi.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { hafizaIslendiAt: expect.any(Date) } });
  });

  it("iptal edilen ya da carisi değişen teklif öğretmez ama işaretlenir", async () => {
    for (const belge of [{ durum: "iptal", cariId: "c1", satirlar: [{ stokId: "sf", varyantId: "v45" }] }, { durum: "onaylandi", cariId: "c-baska", satirlar: [{ stokId: "sf", varyantId: "v45" }] }]) {
      const k = kur({ islemler: [islem], belge });
      expect(await k.calistir(() => k.service.tekliftenOgren())).toBe(0);
      expect(k.tx.aiHafiza.create).not.toHaveBeenCalled();
      expect(k.tx.epostaTeklifIslemi.update).toHaveBeenCalled();
    }
  });
});

describe("hafıza ekranı yetkisi (AI-59)", () => {
  it("satış yalnız kendi kayıtlarını listeler ve başkasınınkini yönetemez", async () => {
    const k = kur({ kayit: { id: "h1", tenantId: "t1", olusturanUserId: "baska" } });
    await k.calistir(() => k.service.liste({ sayfa: 1, adet: 50 }), "satis");
    expect(k.tx.aiHafiza.count.mock.calls[0][0].where).toEqual({ tenantId: "t1", olusturanUserId: "u1" });
    await expect(k.calistir(() => k.service.sil("h1"), "satis")).rejects.toThrow(ForbiddenException);
    expect(k.tx.aiHafiza.delete).not.toHaveBeenCalled();
    await k.calistir(() => k.service.sil("h1"), "yonetici");
    expect(k.tx.aiHafiza.delete).toHaveBeenCalledWith({ where: { id: "h1" } });
  });
});
