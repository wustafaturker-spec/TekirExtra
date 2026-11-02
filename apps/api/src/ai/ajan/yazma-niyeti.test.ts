import { describe, expect, it } from "vitest";
import { acikYazmaIstegiVar } from "./yazma-niyeti";

describe("acikYazmaIstegiVar", () => {
  it.each([
    "fatura oluştur",
    "bu maile teklif oluşturur musun",
    "teklif hazırlar mısın",
    "teklif hazırla lütfen",
    "taslağı kaydedelim",
    "kaydet",
    "müşteriye gönderir misin",
    "bunu onaylayalım",
    "siparişe dönüştürelim",
    "cariyi güncelleyin",
    "siparişi iptal edelim",
    "iptal et",
    "teklif oluşturmak istiyorum",
    "bunu onaylamalısın",
    "TEKLİF HAZIRLA",
    "Teklif Oluştur.",
    "teklif olusturur musun",
    "gelen faturayı işle",
    "faturayı işleyelim",
    "bu faturayı işler misin",
    "faturayı reddet",
    "belgeyi kabul edelim",
    "e-faturayı yanıtla",
    "xml dosyasını yükle",
  ])("istek sayılır: %s", (metin) => {
    expect(acikYazmaIstegiVar(metin)).toBe(true);
  });

  it.each([
    "bu e-postayı özetle",
    "işlem geçmişini göster",
    "işlenmemiş faturaları listele",
    "faturayı işleme",
    "reddedilen faturalar hangileri",
    "kabul edilen belgeler",
    "yüklenen dosyalar",
    "yanıtlanmamış faturalar",
    "gelen mailleri göster",
    "faturayı oluşturma",
    "müşteriye göndermeyin",
    "kaydetmeden önce bana göster",
    "iptal etme",
    "onaylamadan bekle",
    "",
  ])("istek sayılmaz: %s", (metin) => {
    expect(acikYazmaIstegiVar(metin)).toBe(false);
  });
});
