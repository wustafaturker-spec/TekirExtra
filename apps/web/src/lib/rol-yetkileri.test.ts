import { afterEach, describe, expect, it } from "vitest";
import { finansalOzetGorebilir, rolMenuYoluGorebilir, paketModulleriAyarla } from "./rol-yetkileri";
afterEach(() => paketModulleriAyarla(null));

describe("panel rol erişim matrisi", () => {
  it("paket yöneticiyi de sınırlar; açık paket kullanıcının rolünü genişletmez", () => {
    paketModulleriAyarla(["cari"]);
    expect(rolMenuYoluGorebilir("yonetici", "/panel/stok")).toBe(false);
    expect(rolMenuYoluGorebilir("yonetici", "/panel/cari")).toBe(true);
    expect(rolMenuYoluGorebilir("yonetici", "/panel/ayarlar/abonelik")).toBe(true);
    expect(rolMenuYoluGorebilir("depo", "/panel/cari")).toBe(false);
  });
  it("rol yüklenmeden panel içeriğini açmaz", () => {
    expect(rolMenuYoluGorebilir(null, "/panel/ayarlar/kullanicilar")).toBe(false);
  });

  it("yöneticinin tüm panel yollarını görmesine izin verir", () => {
    expect(rolMenuYoluGorebilir("yonetici", "/panel/ayarlar/kullanicilar")).toBe(true);
  });

  it("satış rolünü satış ve proje alanlarıyla sınırlar", () => {
    expect(rolMenuYoluGorebilir("satis", "/panel/crm")).toBe(true);
    expect(rolMenuYoluGorebilir("uretim_operatoru", "/panel/uretim/maliyet")).toBe(false);
    expect(rolMenuYoluGorebilir("uretim_operatoru", "/panel/uretim/emirler")).toBe(true);
    expect(rolMenuYoluGorebilir("depo", "/panel/uretim/maliyet")).toBe(false);
    expect(rolMenuYoluGorebilir("maliyet_muhasebesi", "/panel/uretim/maliyet")).toBe(true);
    expect(rolMenuYoluGorebilir("satis", "/panel/projeler/123")).toBe(true);
    expect(rolMenuYoluGorebilir("satis", "/panel/masraflar")).toBe(false);
  });

  it("B2B rolünün yönetim paneline erişmesini engeller", () => {
    expect(rolMenuYoluGorebilir("b2b_bayi", "/panel/b2b")).toBe(true);
    expect(rolMenuYoluGorebilir("b2b_bayi", "/panel/fatura")).toBe(false);
  });

  it("üretim rollerini ilgili operasyon ekranlarıyla sınırlar", () => {
    expect(rolMenuYoluGorebilir("kalite", "/panel/uretim/kalite")).toBe(true);
    expect(rolMenuYoluGorebilir("kalite", "/panel/uretim/planlama")).toBe(false);
  });

  it("dar rollü rapor sayfalarını ayırır; finansal özet yalnız finans rollerinde (RPR-11)", () => {
    expect(rolMenuYoluGorebilir("maliyet_muhasebesi", "/panel/raporlar")).toBe(true);
    expect(rolMenuYoluGorebilir("maliyet_muhasebesi", "/panel/raporlar/gelir-gider")).toBe(false);
    expect(rolMenuYoluGorebilir("maliyet_muhasebesi", "/panel/stok/smm")).toBe(true);
    expect(rolMenuYoluGorebilir("depo", "/panel/stok")).toBe(true);
    expect(rolMenuYoluGorebilir("depo", "/panel/stok/smm")).toBe(false);
    expect(rolMenuYoluGorebilir("salt_okunur", "/panel/raporlar/kdv-disi-vergiler")).toBe(false);
    expect(rolMenuYoluGorebilir("mali_musavir", "/panel/raporlar/kdv-disi-vergiler")).toBe(true);
    expect(finansalOzetGorebilir("depo")).toBe(false);
    expect(finansalOzetGorebilir("satis")).toBe(false);
    expect(finansalOzetGorebilir("salt_okunur")).toBe(true);
    expect(finansalOzetGorebilir("yonetici")).toBe(true);
  });
});

describe("araç ve şoför ayarları (ARC-01)", () => {
  it("muhasebe plaka ekleyebilsin diye Ayarlar → Araçlar'ı görür; salt okunur görmez", () => {
    expect(rolMenuYoluGorebilir("muhasebe", "/panel/ayarlar/araclar")).toBe(true);
    expect(rolMenuYoluGorebilir("salt_okunur", "/panel/ayarlar/araclar")).toBe(false);
  });
});
