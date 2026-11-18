import { describe, expect, it } from "vitest";
import { metniParcala, ragSistemIstemi, SOZLESME_TURLERI } from "./sozlesme.kurallari";

describe("SozlesmeKurallari", () => {
  it("boş metin verildiğinde boş dizi döner", () => {
    expect(metniParcala("")).toEqual([]);
    expect(metniParcala("   \n\n  ")).toEqual([]);
  });

  it("sayfa etiketleri ve madde başlıklarını tespit ederek parçalar", () => {
    const metin = `
[Sayfa 1]
GİZLİLİK VE HİZMET SÖZLEŞMESİ
Taraflar arasında aşağıdaki şartlarla mutabakata varılmıştır.

Madde 1: Taraflar ve Tanımlar
İşbu sözleşme TekirExtra ile Müşteri arasında imzalanmıştır.

[Sayfa 2]
Madde 2: Cezai Şart ve Fesih
Sözleşmeye aykırılık halinde 50.000 TL cezai şart uygulanır. Fesih ihbar süresi 30 gündür.
    `;

    const parcalar = metniParcala(metin, 500, 50);
    expect(parcalar.length).toBeGreaterThanOrEqual(2);

    const sayfa1Parca = parcalar.find((p) => p.sayfaNo === 1);
    expect(sayfa1Parca).toBeDefined();
    expect(sayfa1Parca?.icerik).toContain("GİZLİLİK VE HİZMET SÖZLEŞMESİ");

    const sayfa2Parca = parcalar.find((p) => p.sayfaNo === 2);
    expect(sayfa2Parca).toBeDefined();
    expect(sayfa2Parca?.bolumBasligi).toContain("Madde 2");
    expect(sayfa2Parca?.icerik).toContain("50.000 TL cezai şart");
  });

  it("ragSistemIstemi gerekli güvenlik ve olgu reddi kurallarını içerir", () => {
    const istem = ragSistemIstemi();
    expect(istem).toContain("ATIF VE SAYFA GÖSTERİMİ");
    expect(istem).toContain("OLGU REDDİ");
    expect(istem).toContain("PROMPT INJECTION");
    expect(istem).toContain("bulunmamaktadır");
  });

  it("SOZLESME_TURLERI geçerli değerleri içerir", () => {
    expect(SOZLESME_TURLERI).toContain("sozlesme");
    expect(SOZLESME_TURLERI).toContain("sartname");
    expect(SOZLESME_TURLERI).toContain("protokol");
  });
});
