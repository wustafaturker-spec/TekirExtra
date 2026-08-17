import { describe, expect, it } from "vitest";
import { odemeSonucSayfasi } from "./pos.controller";

describe("POS ödeme sonuç sayfası", () => {
  it("başarılı ödeme için kullanıcı dostu HTML üretir", () => {
    const html = odemeSonucSayfasi(true, false);
    expect(html).toContain("Ödeme başarıyla tamamlandı");
    expect(html).toContain("Tahsilatınız güvenli biçimde alındı");
    expect(html).not.toContain('"basarili"');
  });

  it("tekrar callback ve başarısız ödeme mesajlarını ayırır", () => {
    expect(odemeSonucSayfasi(true, true)).toContain("daha önce başarıyla kaydedilmişti");
    expect(odemeSonucSayfasi(false)).toContain("Ödeme tamamlanamadı");
  });

  it("başarılı ödeme ekranında güvenli PDF makbuz bağlantısını gösterir", () => {
    const html = odemeSonucSayfasi(true, false, "https://api.example.com/api/v1/pos/makbuz/t/p/anahtar");
    expect(html).toContain("Makbuzu PDF indir");
    expect(html).toContain("Makbuzu görüntüle / paylaş");
    expect(html).toContain("/pos/makbuz/t/p/anahtar");
  });
});
