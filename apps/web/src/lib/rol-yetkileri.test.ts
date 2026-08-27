import { describe, expect, it } from "vitest";
import { rolMenuYoluGorebilir } from "./rol-yetkileri";

describe("panel rol erişim matrisi", () => {
  it("rol yüklenmeden panel içeriğini açmaz", () => {
    expect(rolMenuYoluGorebilir(null, "/panel/ayarlar/kullanicilar")).toBe(false);
  });

  it("yöneticinin tüm panel yollarını görmesine izin verir", () => {
    expect(rolMenuYoluGorebilir("yonetici", "/panel/ayarlar/kullanicilar")).toBe(true);
  });

  it("satış rolünü satış ve proje alanlarıyla sınırlar", () => {
    expect(rolMenuYoluGorebilir("satis", "/panel/crm")).toBe(true);
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
});
