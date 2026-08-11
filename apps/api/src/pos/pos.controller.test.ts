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
});
