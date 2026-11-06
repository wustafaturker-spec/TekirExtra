import { describe, expect, it, vi } from "vitest";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";
import { PlatformDuyuruController } from "./platform-duyuru.controller";
import { PlatformDuyuruService } from "./platform-duyuru.service";
import { duyuruIcerikSemasi, duyuruYayinOnizlemeSemasi, tenantDuyuruListeSemasi, duyuruOlaySemasi } from "./platform-duyuru.semalar";

const girdi = { baslik: "Bakım duyurusu", icerik: "Planlı bakım yapılacak.", butonMetni: null, butonUrl: null };
describe("duyuru giriş güvenliği", () => {
  it.each(["javascript:alert(1)", "data:text/html,x", "//evil.invalid", "/\\evil.invalid", "https://user:pass@example.com", "http://example.com", "https://example.com\n/x", "/panel\\evil", "/platform/firmalar", "/panel/../platform", "/panel/%2e%2e/platform"])("zararlı veya kapsam dışı URL reddedilir: %s", (butonUrl) => {
    expect(duyuruIcerikSemasi.safeParse({ ...girdi, butonMetni: "Aç", butonUrl }).success).toBe(false);
  });
  it.each(["https://example.com/bilgi?a=1", "/panel", "/panel/ayarlar", "/panel?sekme=profil"])("geçerli bağlantı kabul edilir: %s", (butonUrl) => {
    expect(duyuruIcerikSemasi.safeParse({ ...girdi, butonMetni: "Aç", butonUrl }).success).toBe(true);
  });
  it.each([{ ...girdi, icerik: "<script>alert(1)</script>" }, { ...girdi, baslik: "<img src=x>" }, { ...girdi, icerik: " " }, { ...girdi, butonMetni: "Aç" }, { ...girdi, butonUrl: "https://example.com" }, { ...girdi, durum: "yayinlandi" }, { ...girdi, tenantId: "x" }])("geçersiz içerik servise iletilmez: %j", (g) => {
    const servis = { olustur: vi.fn() };
    expect(() => new PlatformDuyuruController(servis as never).olustur(g)).toThrow();
    expect(servis.olustur).not.toHaveBeenCalled();
  });
  it("önizleme aynı doğrulamayı uygular", () => {
    const servis = { onizle: vi.fn((v: typeof girdi) => ({ ...v, icerikHtml: "<p>Planlı bakım yapılacak.</p>" })) };
    const c = new PlatformDuyuruController(servis as never);
    expect(c.onizleme(girdi)).toEqual({ ...girdi, icerikHtml: "<p>Planlı bakım yapılacak.</p>" });
    expect(() => c.onizleme({ ...girdi, icerik: "<b>test</b>" })).toThrow();
  });
});
describe("duyuru hedef ve yayın doğrulaması", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const hedef = { kapsam: "tum", firmaIds: [], haricFirmaIds: [], paketIds: [], durumlar: [], roller: ["yonetici"], yeniUygunlar: "katilmaz", gosterimYerleri: ["merkez"], modulYollari: [], tekrarPolitikasi:"her_zaman" as const, popupOnceligi:50,popupTuru:"normal",ertelemeDakika:1440 as const };
  const g = { surum: 1, hedef, baslangic: "2099-01-01T10:00:00+03:00", bitis: "2099-01-02T10:00:00+03:00" };
  it.each([
    { ...g, surum: 0 }, { ...g, bitis: g.baslangic }, { ...g, baslangic: "2099-01-01T10:00" },
    { ...g, hedef: { ...hedef, roller: [] } }, { ...g, hedef: { ...hedef, roller: ["platform_yonetici"] } },
    { ...g, hedef: { ...hedef, kapsam: "secili" } }, { ...g, hedef: { ...hedef, firmaIds: [id] } },
    { ...g, hedef: { ...hedef, kapsam: "secili", firmaIds: [id], haricFirmaIds: [id] } },
    { ...g, hedef: { ...hedef, yeniUygunlar: "otomatik" } }, { ...g, hedef: { ...hedef, paketIds: [id,id] } },
    { ...g, hedef: { ...hedef, firmaSayisi: 1 } }, { ...g, kullaniciSayisi: 1 },
  ])("geçersiz hedef/yayın servise geçmez: %j", (veri) => {
    const servis = { hedefOnizle: vi.fn() };
    expect(() => new PlatformDuyuruController(servis as never).hedefOnizle(id,veri)).toThrow();
    expect(servis.hedefOnizle).not.toHaveBeenCalled();
  });
  it("Türkiye saat dilimi ve açık katılım politikası kabul edilir", () => {
    expect(duyuruYayinOnizlemeSemasi.parse(g)).toEqual(g);
  });
  it("tenant kimliği, kullanıcı kimliği ve olay zamanı istemciden alınmaz", () => {
    expect(tenantDuyuruListeSemasi.safeParse({ tenantId:id }).success).toBe(false);
    expect(duyuruOlaySemasi.safeParse({ tur:"okudum",userId:id }).success).toBe(false);
    expect(duyuruOlaySemasi.safeParse({ tur:"gosterim",zaman:"2099-01-01" }).success).toBe(false);
  });
});
describe("duyuru yetki ve sürüm koruması", () => {
  const kimlik = { kullaniciId: "00000000-0000-4000-8000-000000000001", eposta: "test@example.invalid" };
  it("editör veritabanına ulaşamaz", async () => {
    const db = vi.fn(); const servis = new PlatformDuyuruService({ get db() { db(); throw new Error("DB erişimi"); } } as never, {} as never);
    await platformBaglamiylaCalistir({ ...kimlik, rol: "mevzuat_editoru" }, async () => {
      await expect(servis.listele({ sayfa: 1 })).rejects.toThrow("yöneticisi");
      await expect(servis.olustur(girdi)).rejects.toThrow("yöneticisi");
    });
    expect(db).not.toHaveBeenCalled();
  });
  it.each([{ durum: "taslak", surum: 2 }, { durum: "arsiv", surum: 1 }])("eski sürüm veya arşiv yazılamaz: %j", async (eski) => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ ...girdi, id: kimlik.kullaniciId, ...eski }]), $executeRaw: vi.fn() };
    const servis = new PlatformDuyuruService({ db: { $transaction: (is: (t: typeof tx) => unknown) => is(tx) } } as never, {} as never);
    await platformBaglamiylaCalistir(kimlik, async () => {
      await expect(servis.guncelle(kimlik.kullaniciId, { ...girdi, surum: 1 })).rejects.toThrow();
      await expect(servis.arsivle(kimlik.kullaniciId, 1)).rejects.toThrow();
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
