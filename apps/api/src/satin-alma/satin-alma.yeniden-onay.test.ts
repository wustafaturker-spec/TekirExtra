import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../core/istek-baglami";

vi.mock("../rapor/tahakkuk", () => ({ tahakkukOku: async () => ({ kalemler: [] }) }));
vi.mock("../belgeler/belgeler.semalar", () => ({ belgeOlusturSemasi: { parse: (x: unknown) => x } }));
vi.mock("../belgeler/belgeler.service", () => ({ BelgelerService: class {} }));
vi.mock("../butce/butce.service", () => ({ ButceService: class {} }));
vi.mock("../core/ayarlar/ayarlar.service", () => ({ AyarlarService: class {} }));
vi.mock("../mevzuat/mevzuat.service", () => ({ MevzuatService: class {} }));
vi.mock("../core/prisma.service", () => ({ PrismaService: class {} }));

const { SatinAlmaService } = await import("./satin-alma.service");

const D = (v: string | number) => new Prisma.Decimal(v);
const TENANT = "11111111-1111-1111-1111-111111111111";
const TALEP_EDEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MUHASEBE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const YONETICI = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TALEP_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Teklif = { id: string; talepId: string; tedarikciCariId: string; dovizCinsi: string; kur: Prisma.Decimal; toplamTry: Prisma.Decimal; secildi: boolean; gecerlilikTarihi: Date | null; tedarikci: { unvan: string }; kalemler: { talepKalemiId: string; birimFiyat: Prisma.Decimal; kdvOrani: Prisma.Decimal }[] };

/** Bellek içi sahte veritabanı: yalnız servisin bu akışta kullandığı sorgular. */
function kur(p: { durum?: string; tahmini?: number; onaylanan?: number | null; teklifler?: Partial<Teklif>[]; olaylar?: { tur: string; userId: string }[] } = {}) {
  const talep = {
    id: TALEP_ID, tenantId: TENANT, no: "STL2026000001", talepEdenUserId: TALEP_EDEN, durum: p.durum ?? "onaylandi",
    tahminiToplam: D(p.tahmini ?? 10_000), onaylananTutar: p.onaylanan === undefined ? D(p.tahmini ?? 10_000) : p.onaylanan === null ? null : D(p.onaylanan),
    onaylayanUserId: MUHASEBE as string | null, onayZamani: new Date() as Date | null, butceAnahtari: "mal_alis", ihtiyacTarihi: new Date("2026-11-01"),
    butceAsimGerekcesi: null, teklifSecimGerekcesi: null as string | null, siparisBelgeId: null as string | null,
    kalemler: [{ id: "k1", stokId: "s1", miktar: D(1), birim: "adet", sira: 0 }],
  };
  const teklifler: Teklif[] = (p.teklifler ?? []).map((t, i) => ({
    id: `t${i + 1}`, talepId: TALEP_ID, tedarikciCariId: "cari", dovizCinsi: "TRY", kur: D(1), toplamTry: D(10_000), secildi: false, gecerlilikTarihi: null,
    tedarikci: { unvan: `Tedarikçi ${i + 1}` }, kalemler: [{ talepKalemiId: "k1", birimFiyat: D(10_000), kdvOrani: D(20) }], ...t,
  }));
  const olaylar: { tur: string; userId: string; aciklama: string | null; createdAt: Date }[] = (p.olaylar ?? []).map((o, i) => ({ ...o, aciklama: null, createdAt: new Date(2026, 0, 1, 0, i) }));
  const sonOlaylar = (arg?: { where?: { tur?: { in: string[] } } }) =>
    [...olaylar].filter((o) => !arg?.where?.tur || arg.where.tur.in.includes(o.tur)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 1);

  const tx = {
    satinAlmaTalebi: {
      findUnique: vi.fn(async ({ include }: { include?: Record<string, unknown> }) => ({
        ...talep,
        teklifler: teklifler.map((t) => ({ id: t.id, secildi: t.secildi, toplamTry: t.toplamTry })),
        ...(include?.olaylar ? { olaylar: sonOlaylar(include.olaylar as never) } : {}),
      })),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async ({ where, data }: { where: { durum?: { in: string[] } }; data: Record<string, unknown> }) => {
        if (where.durum && !where.durum.in.includes(talep.durum)) return { count: 0 };
        Object.assign(talep, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(talep, data)),
    },
    satinAlmaTeklifi: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => teklifler.find((t) => t.id === where.id) ?? null),
      findFirst: vi.fn(async () => teklifler.find((t) => t.secildi) ?? null),
      count: vi.fn(async () => teklifler.length),
      updateMany: vi.fn(async ({ data }: { data: { secildi: boolean } }) => { teklifler.forEach((t) => (t.secildi = data.secildi)); return { count: teklifler.length }; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { secildi: boolean } }) => Object.assign(teklifler.find((t) => t.id === where.id)!, data)),
    },
    satinAlmaTalepOlayi: {
      create: vi.fn(async ({ data }: { data: { tur: string; userId: string; aciklama: string | null } }) => { olaylar.push({ ...data, createdAt: new Date(Date.now() + olaylar.length) }); return data; }),
    },
    butce: { findFirst: vi.fn(async () => null) },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const ayarlar = { getir: vi.fn(async () => ({ onayEsigi: 25_000 })) };
  const belgeler = { olustur: vi.fn(async () => ({ id: "belge-1" })) };
  const service = new SatinAlmaService(prisma as never, ayarlar as never, belgeler as never, {} as never);
  const olarak = <T>(userId: string, rol: string, fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: TENANT, userId, rol: rol as never } }, fn);
  return { service, talep, teklifler, olaylar, belgeler, olarak };
}

describe("teklif seçimi ve yeniden onay (SAT-09)", () => {
  it("%10 marj içindeki teklif seçilir, talep onaylı kalır", async () => {
    const k = kur({ teklifler: [{ toplamTry: D(11_000) }] });
    const sonuc = await k.olarak(MUHASEBE, "muhasebe", () => k.service.teklifSec("t1"));
    expect(sonuc.yenidenOnay).toBeNull();
    expect(k.talep.durum).toBe("onaylandi");
  });

  it("marjı aşan teklif talebi yeniden onaya düşürür ve önceki onayı siler", async () => {
    const k = kur({ teklifler: [{ toplamTry: D(11_000.01) }] });
    const sonuc = await k.olarak(MUHASEBE, "muhasebe", () => k.service.teklifSec("t1"));
    expect(sonuc.yenidenOnay).toMatch(/marjın üstünde/);
    expect(k.talep).toMatchObject({ durum: "onay_bekliyor", onaylayanUserId: null, onayZamani: null });
    expect(k.olaylar.at(-1)).toMatchObject({ tur: "yeniden_onaya_gonderildi", userId: MUHASEBE });
  });

  it("muhasebe onayı eşik üstü teklife taşınamaz", async () => {
    const k = kur({ tahmini: 24_000, teklifler: [{ toplamTry: D(25_500) }] });
    const sonuc = await k.olarak(MUHASEBE, "muhasebe", () => k.service.teklifSec("t1"));
    expect(sonuc.yenidenOnay).toMatch(/yönetici onayı/);
  });

  it("teklifi seçen kullanıcı yeniden onayı veremez; başka yetkili verir ve yeni tutar kaydedilir", async () => {
    const k = kur({ teklifler: [{ toplamTry: D(30_000) }] });
    await k.olarak(YONETICI, "yonetici", () => k.service.teklifSec("t1"));
    await expect(k.olarak(YONETICI, "yonetici", () => k.service.onayla(TALEP_ID))).rejects.toBeInstanceOf(ForbiddenException);
    // 30.000 TL eşik üstü: muhasebe de veremez, ayrı bir yönetici gerekir.
    await expect(k.olarak(MUHASEBE, "muhasebe", () => k.service.onayla(TALEP_ID))).rejects.toThrow(/yalnız yönetici/);
    await k.olarak("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "yonetici", () => k.service.onayla(TALEP_ID));
    expect(k.talep.durum).toBe("onaylandi");
    expect(k.talep.onaylananTutar?.toFixed(2)).toBe("30000.00");
  });

  it("yeniden onaydan sonra aynı teklifle sipariş açılır", async () => {
    const k = kur({ teklifler: [{ toplamTry: D(30_000) }] });
    await k.olarak(MUHASEBE, "muhasebe", () => k.service.teklifSec("t1"));
    await k.olarak(YONETICI, "yonetici", () => k.service.onayla(TALEP_ID));
    const sonuc = await k.olarak(MUHASEBE, "muhasebe", () => k.service.siparisOlustur(TALEP_ID, {}));
    expect(sonuc).toMatchObject({ siparisBelgeId: "belge-1", yenidenOnay: null });
    expect(k.talep.durum).toBe("siparise_donustu");
  });

  it("onaylanan tutarı aşan seçili teklifle sipariş açılmaz, talep yeniden onaya düşer", async () => {
    // Örn. onaylanan tutar alanı eklenmeden önce seçilmiş teklif.
    const k = kur({ teklifler: [{ toplamTry: D(50_000), secildi: true }] });
    const sonuc = await k.olarak(MUHASEBE, "muhasebe", () => k.service.siparisOlustur(TALEP_ID, {}));
    expect(sonuc).toMatchObject({ siparisBelgeId: null });
    expect(sonuc.yenidenOnay).toMatch(/marjın üstünde/);
    expect(k.belgeler.olustur).not.toHaveBeenCalled();
    expect(k.talep.durum).toBe("onay_bekliyor");
  });

  it("onaylanan tutarı olmayan eski talepte tahmini toplam esas alınır", async () => {
    const k = kur({ onaylanan: null, tahmini: 10_000, teklifler: [{ toplamTry: D(12_000) }] });
    const sonuc = await k.olarak(MUHASEBE, "muhasebe", () => k.service.teklifSec("t1"));
    expect(sonuc.yenidenOnay).not.toBeNull();
  });

  it("süresi dolmuş teklif seçilemez", async () => {
    const k = kur({ teklifler: [{ gecerlilikTarihi: new Date("2020-01-01") }] });
    await expect(k.olarak(MUHASEBE, "muhasebe", () => k.service.teklifSec("t1"))).rejects.toThrow(/geçerlilik süresi/);
  });

  it("süresi dolmuş seçili teklifle sipariş açılmaz", async () => {
    const k = kur({ teklifler: [{ secildi: true, gecerlilikTarihi: new Date("2020-01-01") }] });
    await expect(k.olarak(MUHASEBE, "muhasebe", () => k.service.siparisOlustur(TALEP_ID, {}))).rejects.toBeInstanceOf(BadRequestException);
    expect(k.belgeler.olustur).not.toHaveBeenCalled();
  });
});

describe("talep düzenleme ve gönderme (SAT-09)", () => {
  it("0 TL tahmini toplamlı taslak onaya gönderilemez", async () => {
    const k = kur({ durum: "taslak", tahmini: 0 });
    await expect(k.olarak(TALEP_EDEN, "satis", () => k.service.gonder(TALEP_ID))).rejects.toThrow(/sıfır olamaz/);
    expect(k.talep.durum).toBe("taslak");
  });

  it("teklif girilmiş talep düzenlenemez", async () => {
    const k = kur({ durum: "taslak", teklifler: [{}] });
    const girdi = { ihtiyacTarihi: "2026-11-01", gerekce: "Deneme", butceAnahtari: "mal_alis", kalemler: [{ stokId: "s1", miktar: "1", tahminiBirimFiyat: "5" }] };
    await expect(k.olarak(TALEP_EDEN, "satis", () => k.service.guncelle(TALEP_ID, girdi))).rejects.toThrow(/Teklif girilmiş/);
  });
});
