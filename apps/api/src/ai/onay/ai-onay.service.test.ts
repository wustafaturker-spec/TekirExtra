import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../../core/istek-baglami";
import { icerikOzeti, kayitIcerigi } from "../ajan/araclar/arac";
import { ASKIDA_KALAN_TALEP_HATASI, ASKIDA_KALMA_SURESI_MS, AiOnayService } from "./ai-onay.service";

const TENANT = "11111111-1111-1111-1111-111111111111";
const KULLANICI = "22222222-2222-2222-2222-222222222222";
const BELGE_ID = "7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d";

function talep(ek: Record<string, unknown> = {}) {
  return {
    id: "talep-1", tenantId: TENANT, userId: KULLANICI, oturumId: null, kaynak: "asistan", arac: "belge_onayla",
    parametreler: { belgeId: BELGE_ID }, ozet: "Onaylanacak: Teklif", onizleme: null, durum: "bekliyor",
    gecerlilikSonu: new Date(Date.now() + 3_600_000), kararAt: null, sonuc: null, hata: null, createdAt: new Date(), ...ek,
  };
}

const BELGE = { id: BELGE_ID, tur: "teklif", durum: "taslak", no: null, cariId: "cari-1", genelToplam: "1200.00", satirlar: [{ stokId: "s1", miktar: "2.000", birimFiyat: "500.0000" }] };

function kur(kayit: ReturnType<typeof talep>, secenek: { alinan?: number; ucHatasi?: Error; belge?: Record<string, unknown> } = {}) {
  const tx = {
    aiOnayTalebi: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...talep(), ...data })),
      findUnique: vi.fn().mockResolvedValue(kayit),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: secenek.alinan ?? 1 }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...kayit, ...data })),
    },
    // AI-106: bildirim yerine aynı işlemde olay yazılır.
    aiOlay: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data) },
    // AI-107: talep başına tek karar kaydı.
    aiOnayKarari: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data) },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const uc = {
    cagir: vi.fn(async (u: { yol: string }) => {
      if (secenek.ucHatasi) throw secenek.ucHatasi;
      if (u.yol === "GET /belgeler/:id") return secenek.belge ?? BELGE;
      return u.yol === "POST /belgeler/:id/onayla" ? { id: BELGE_ID, no: "TKF2026000001", durum: "onaylandi" } : {};
    }),
  };
  const bildirimler = { uret: vi.fn().mockResolvedValue({}), kapatEksikleri: vi.fn().mockResolvedValue(0) };
  const service = new AiOnayService(prisma as never, uc as never, bildirimler as never);
  const olarak = <T>(fn: () => Promise<T>, userId = KULLANICI, rol = "satis") => istekBaglami.run({ deger: { tenantId: TENANT, userId, rol: rol as never } }, fn);
  return { service, tx, uc, bildirimler, olarak };
}

describe("onay talepleri (AI-04)", () => {
  it("talep 24 saat geçerli açılır; yalnız isteyen kullanıcıya bildirilecek olay aynı işlemde yazılır", async () => {
    const k = kur(talep());
    await k.olarak(() => k.service.olustur({ arac: "belge_onayla", parametreler: { belgeId: BELGE_ID }, ozet: "Onaylanacak", kaynak: "mcp" }));
    const data = k.tx.aiOnayTalebi.create.mock.calls[0][0].data;
    expect(data.userId).toBe(KULLANICI);
    expect((data.gecerlilikSonu as Date).getTime() - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
    expect(k.tx.aiOlay.create).toHaveBeenCalledWith({ data: expect.objectContaining({ topluTur: "ai_onay", tur: "ai_onay.acildi", teslimDurumu: "bekliyor", yuk: expect.objectContaining({ userId: KULLANICI, kaynak: "mcp" }) }) });
    expect(k.bildirimler.uret).not.toHaveBeenCalled();
  });

  it("yapılandırılmış işlem önizlemesini talep anında sabitler", async () => {
    const k = kur(talep());
    const onizleme = { eylem: "Cari kartını güncelle", hedef: "Kaya Ltd (120.01)", degisiklikler: [{ alan: "telefon", once: "111", sonra: "222" }] };
    const sonuc = await k.olarak(() => k.service.olustur({ arac: "cari_guncelle", parametreler: {}, ozet: "Cari güncellenecek", onizleme, kaynak: "asistan" }));
    expect(k.tx.aiOnayTalebi.create.mock.calls[0][0].data.onizleme).toEqual(onizleme);
    expect(sonuc.onizleme).toEqual(onizleme);
  });

  it("onayda araç talepteki parametrelerle, talep kimliği iziyle çalışır", async () => {
    const k = kur(talep());
    const sonuc = await k.olarak(() => k.service.onayla("talep-1"));
    expect(k.uc.cagir).toHaveBeenCalledWith(expect.objectContaining({ yol: "POST /belgeler/:id/onayla" }), [BELGE_ID, { riskOnayGerekcesi: null }], expect.objectContaining({ talepId: "talep-1", arac: "belge_onayla" }));
    expect(sonuc.durum).toBe("onaylandi");
    expect(k.tx.aiOnayTalebi.updateMany).toHaveBeenCalledWith({ where: { id: "talep-1", durum: "bekliyor" }, data: expect.objectContaining({ durum: "isleniyor" }) });
    expect(k.tx.aiOlay.create).toHaveBeenCalledWith({ data: expect.objectContaining({ topluId: "talep-1", tur: "ai_onay.sonuclandi", yuk: expect.objectContaining({ durum: "onaylandi" }) }) });
  });

  it("başka kullanıcı (yönetici dahil) talebi onaylayamaz", async () => {
    const k = kur(talep());
    await expect(k.olarak(() => k.service.onayla("talep-1"), "99999999-9999-9999-9999-999999999999", "yonetici")).rejects.toBeInstanceOf(ForbiddenException);
    expect(k.uc.cagir).not.toHaveBeenCalled();
  });

  it("süresi dolmuş talep çalışmaz (409 SURESI_DOLDU)", async () => {
    const k = kur(talep({ gecerlilikSonu: new Date(Date.now() - 1000) }));
    await expect(k.olarak(() => k.service.onayla("talep-1"))).rejects.toMatchObject({ response: { kod: "SURESI_DOLDU" } });
    expect(k.uc.cagir).not.toHaveBeenCalled();
  });

  it("karara bağlanmış talep ikinci kez çalışmaz", async () => {
    const k = kur(talep(), { alinan: 0 });
    await expect(k.olarak(() => k.service.onayla("talep-1"))).rejects.toBeInstanceOf(ConflictException);
    expect(k.uc.cagir).not.toHaveBeenCalled();
  });

  it("işlem hata verirse talep 'hata' olur ve neden saklanır", async () => {
    const k = kur(talep(), { ucHatasi: new ForbiddenException("Bu işlem için yetkiniz yok") });
    const sonuc = await k.olarak(() => k.service.onayla("talep-1"));
    expect(sonuc.durum).toBe("hata");
    expect(sonuc.hata).toBe("Bu işlem için yetkiniz yok");
  });

  it("AI-27: talepten sonra belge değişmediyse onay işler", async () => {
    const k = kur(talep({ hedefOzeti: icerikOzeti(kayitIcerigi(BELGE)) }));
    const sonuc = await k.olarak(() => k.service.onayla("talep-1"));
    expect(sonuc.durum).toBe("onaylandi");
  });

  it("AI-27: talepten sonra belge değiştiyse işlem yapılmaz", async () => {
    const degismis = { ...BELGE, genelToplam: "1500.00", satirlar: [{ stokId: "s1", miktar: "3.000", birimFiyat: "500.0000" }] };
    const k = kur(talep({ hedefOzeti: icerikOzeti(kayitIcerigi(BELGE)) }), { belge: degismis });
    const sonuc = await k.olarak(() => k.service.onayla("talep-1"));
    expect(sonuc.durum).toBe("hedef_degisti");
    expect(sonuc.hata).toContain("değişti");
    expect(k.uc.cagir).not.toHaveBeenCalledWith(expect.objectContaining({ yol: "POST /belgeler/:id/onayla" }), expect.anything(), expect.anything());
  });

  it("AI-27: özet anahtar sırasından bağımsızdır; ilişkili listeler içeriğe girmez", () => {
    const ters = Object.fromEntries(Object.entries(BELGE).reverse());
    expect(icerikOzeti(kayitIcerigi(ters))).toBe(icerikOzeti(kayitIcerigi(BELGE)));
    // Ödeme, türetilen belge ya da e-Belge durumu arka planda değişebilir; onay içeriği değildir.
    const ekli = { ...BELGE, turetilenler: [{ id: "x" }], ebelge: { durum: "iletildi" }, teslimatlar: [] };
    expect(icerikOzeti(kayitIcerigi(ekli))).toBe(icerikOzeti(kayitIcerigi(BELGE)));
  });

  it("reddedilen talep çalışmaz", async () => {
    const k = kur(talep());
    await k.olarak(() => k.service.reddet("talep-1"));
    expect(k.tx.aiOnayTalebi.updateMany).toHaveBeenCalledWith({ where: { id: "talep-1", durum: "bekliyor" }, data: expect.objectContaining({ durum: "reddedildi" }) });
    expect(k.uc.cagir).not.toHaveBeenCalled();
  });
  it("uzun süre 'isleniyor' kalan talep belirsiz sonuçla kapanır, yeniden çalışmaz", async () => {
    const k = kur(talep());
    k.tx.aiOnayTalebi.findMany.mockImplementation(async ({ where }: { where: { durum?: string } }) =>
      where.durum === "isleniyor" ? [{ id: "askida-1" }] : []);
    await k.olarak(() => k.service.listele());
    const sorgu = k.tx.aiOnayTalebi.findMany.mock.calls.find(([a]: [{ where: { durum?: string } }]) => a.where.durum === "isleniyor")?.[0];
    const sinir = (sorgu.where.kararAt.lt as Date).getTime();
    expect(Date.now() - sinir).toBeGreaterThanOrEqual(ASKIDA_KALMA_SURESI_MS - 1000);
    expect(k.tx.aiOnayTalebi.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["askida-1"] }, durum: "isleniyor" },
      data: { durum: "hata", hata: ASKIDA_KALAN_TALEP_HATASI },
    });
    expect(k.tx.aiOlay.create).toHaveBeenCalledWith({ data: expect.objectContaining({ topluId: "askida-1", tur: "ai_onay.sonuclandi", yuk: expect.objectContaining({ durum: "hata" }) }) });
    expect(k.uc.cagir).not.toHaveBeenCalled();
  });

  it("askıda talep yoksa güncelleme yapılmaz", async () => {
    const k = kur(talep());
    await k.olarak(() => k.service.listele());
    expect(k.tx.aiOnayTalebi.updateMany).not.toHaveBeenCalled();
  });
});
