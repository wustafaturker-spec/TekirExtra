import { describe, expect, it, vi } from "vitest";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";
import { PlatformGorevService, type GorevFiltresi, type GorevGirdisi } from "./platform-gorev.service";
import { PlatformGorevController } from "./platform-gorev.controller";

const filtre: GorevFiltresi = { arama: "", durum: "acik_isler", benim: false, geciken: false, sorumluPasif: false, sayfa: 1 };
const girdi: GorevGirdisi = { baslik: "Dönem kaydını hazırla", aciklama: null, kapsam: "mevzuat", oncelik: "normal", sonTarih: "2027-01-01", sorumluId: null, degisiklikId: null };
const olarak = <T>(rol: "yonetici" | "mevzuat_editoru", is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: "p1", eposta: "test@example.invalid", rol }, is);
function kur(kapsam = "mevzuat") {
  let row = { id: "g1", ...girdi, kapsam, durum: "acik", sonTarih: new Date("2027-01-01T00:00:00Z"), surum: 1, olusturanId: "p1", kapanisAt: null as Date | null, createdAt: new Date(), updatedAt: new Date(), sorumlu: null, olusturan: { id: "p1", adSoyad: "Test" }, degisiklik: null };
  const tx = {
    platformGorev: {
      findFirst: vi.fn(async ({ where }) => (!where.kapsam || where.kapsam === row.kapsam) ? { ...row } : null),
      findMany: vi.fn(async (_q: unknown) => []), count: vi.fn(async (_q: unknown) => 0), groupBy: vi.fn(async (_q: unknown) => []),
      create: vi.fn(async ({ data }) => ({ ...row, ...data })),
      updateMany: vi.fn(async ({ where, data }) => { if (where.surum !== row.surum) return { count: 0 }; row = { ...row, ...data, surum: row.surum + 1 }; return { count: 1 }; }),
      findUniqueOrThrow: vi.fn(async () => row),
    },
    platformKullanici: { findFirst: vi.fn(async (_q: unknown) => ({ rol: "yonetici" })), findMany: vi.fn(async (_q: unknown) => []) },
    mevzuatDegisiklik: { findUnique: vi.fn(async () => ({ id: "d1" })) },
    mevzuatOlay: { create: vi.fn(async ({ data }) => data) },
    $queryRaw: vi.fn(async (..._a: unknown[]) => []),
  };
  const db = { ...tx, $transaction: vi.fn(async (fn) => fn(tx)) };
  return { servis: new PlatformGorevService({ db } as never), db, tx };
}

describe("platform görevleri", () => {
  it("editörün liste, sayım ve detay sorguları yalnız mevzuat kapsamındadır", async () => {
    const t = kur("platform");
    await olarak("mevzuat_editoru", () => t.servis.listele({ ...filtre, benim: true, geciken: true }));
    expect(t.tx.platformGorev.findMany.mock.calls[0][0]).toMatchObject({ where: { kapsam: "mevzuat", sorumluId: "p1" } });
    for (const c of t.tx.platformGorev.count.mock.calls) expect(c[0]).toMatchObject({ where: { kapsam: "mevzuat" } });
    expect(t.tx.platformGorev.groupBy.mock.calls[0][0]).toMatchObject({ where: { kapsam: "mevzuat" } });
    await expect(olarak("mevzuat_editoru", () => t.servis.getir("g1"))).rejects.toThrow("Görev bulunamadı");
    await expect(olarak("mevzuat_editoru", () => t.servis.guncelle("g1", { surum: 1, durum: "tamamlandi" }))).rejects.toThrow("Görev bulunamadı");
    expect(t.tx.platformGorev.updateMany).not.toHaveBeenCalled();
  });
  it("editör platform görevi açamaz; platform görevi editöre atanamaz", async () => {
    const t = kur();
    await expect(olarak("mevzuat_editoru", () => t.servis.olustur({ ...girdi, kapsam: "platform" }))).rejects.toThrow("yalnız mevzuat");
    t.tx.platformKullanici.findFirst.mockResolvedValue({ rol: "mevzuat_editoru" });
    await expect(olarak("yonetici", () => t.servis.olustur({ ...girdi, kapsam: "platform", sorumluId: "p2" }))).rejects.toThrow("yalnız platform yöneticisi");
    expect(t.tx.platformGorev.create).not.toHaveBeenCalled();
  });
  it("platform görevine mevzuat bağı ve geçersiz sorumlu eklenemez", async () => {
    const t = kur();
    await expect(olarak("yonetici", () => t.servis.olustur({ ...girdi, kapsam: "platform", degisiklikId: "d1" }))).rejects.toThrow("yalnız mevzuat");
    t.tx.platformKullanici.findFirst.mockResolvedValue(null as never);
    await expect(olarak("yonetici", () => t.servis.olustur({ ...girdi, sorumluId: "p2" }))).rejects.toThrow("aktif bir platform kullanıcısı");
    expect(t.tx.mevzuatOlay.create).not.toHaveBeenCalled();
  });
  it("eski sürüm ve yarışta kaybedilen güncelleme yazılamaz", async () => {
    const t = kur();
    await expect(olarak("yonetici", () => t.servis.guncelle("g1", { surum: 2, durum: "tamamlandi" }))).rejects.toThrow("başka biri tarafından");
    expect(t.tx.platformGorev.updateMany).not.toHaveBeenCalled();
    t.tx.platformGorev.updateMany.mockResolvedValue({ count: 0 });
    await expect(olarak("yonetici", () => t.servis.guncelle("g1", { surum: 1, durum: "tamamlandi" }))).rejects.toThrow("başka biri tarafından");
    expect(t.tx.mevzuatOlay.create).not.toHaveBeenCalled();
  });
  it("tamamlama sürümü artırır, yeniden açma kapanışı temizler ve olay kaydedilir", async () => {
    const t = kur("platform");
    const tamam = await olarak("yonetici", () => t.servis.guncelle("g1", { surum: 1, durum: "tamamlandi" }));
    expect(tamam).toMatchObject({ durum: "tamamlandi", surum: 2, kapanisAt: expect.any(Date) });
    const acik = await olarak("yonetici", () => t.servis.guncelle("g1", { surum: 2, durum: "acik" }));
    expect(acik).toMatchObject({ durum: "acik", surum: 3, kapanisAt: null });
    expect(t.tx.mevzuatOlay.create.mock.calls[0][0].data).toMatchObject({ degisiklikId: null, olay: "platform_gorevi_guncellendi", kullaniciId: "p1" });
  });
  it("katılımcılar yalnız aktif hesap adları ve rollerinden oluşur", async () => {
    const t = kur(); await t.servis.katilimcilar();
    expect(t.tx.platformKullanici.findMany.mock.calls[0][0]).toMatchObject({ where: { aktif: true, davetTuru: null }, select: { id: true, adSoyad: true, rol: true } });
  });
  it("API geçersiz tarihi ve kapsam değiştirmeyi reddeder", () => {
    const t = kur(); const c = new PlatformGorevController(t.servis);
    expect(() => c.olustur({ ...girdi, sonTarih: "2027-02-30" })).toThrow("geçerli bir takvim tarihi");
    expect(() => c.guncelle("g1", { surum: 1, kapsam: "platform" })).toThrow();
    expect(() => c.guncelle("g1", { surum: 1 })).toThrow("en az bir alan");
  });
  it("PLT-31: platform görevine atama rol düşürmeyle aynı yetki kilidini alır; mevzuat ataması almaz", async () => {
    const t = kur();
    await olarak("yonetici", () => t.servis.olustur({ ...girdi, kapsam: "platform", sorumluId: "p2" }));
    expect(t.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect((t.tx.$queryRaw.mock.calls[0][0] as unknown as string[]).join("")).toContain("platform-kullanici-yetki");
    await olarak("yonetici", () => t.servis.olustur({ ...girdi, sorumluId: "p2" }));
    expect(t.tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it("PLT-31: kapanmış platform görevi, sorumlusu artık yönetici değilse yeniden atanmadan açılamaz", async () => {
    const t = kur("platform");
    await olarak("yonetici", () => t.servis.guncelle("g1", { surum: 1, sorumluId: "p2" }));
    await olarak("yonetici", () => t.servis.guncelle("g1", { surum: 2, durum: "tamamlandi" }));
    t.tx.platformKullanici.findFirst.mockResolvedValue({ rol: "mevzuat_editoru" });
    await expect(olarak("yonetici", () => t.servis.guncelle("g1", { surum: 3, durum: "acik" }))).rejects.toThrow("yalnız platform yöneticisi");
    expect(t.tx.platformKullanici.findFirst.mock.calls.at(-1)?.[0]).toMatchObject({ where: { id: "p2" } });
    t.tx.platformKullanici.findFirst.mockResolvedValue({ rol: "yonetici" });
    const acik = await olarak("yonetici", () => t.servis.guncelle("g1", { surum: 3, durum: "acik", sorumluId: "p3" }));
    expect(acik).toMatchObject({ durum: "acik", sorumluId: "p3", surum: 4 });
  });
  it("PLT-31: sorumlusu pasif açık görevler ayrı sayılır ve süzülebilir", async () => {
    const t = kur();
    const sonuc = await olarak("yonetici", () => t.servis.listele({ ...filtre, sorumluPasif: true }));
    expect(sonuc.sayilar).toHaveProperty("sorumluPasif", 0);
    expect(t.tx.platformGorev.findMany.mock.calls[0][0]).toMatchObject({ where: { AND: [{ durum: { in: ["acik", "devam_ediyor"] }, sorumlu: { aktif: false } }] } });
  });
});
