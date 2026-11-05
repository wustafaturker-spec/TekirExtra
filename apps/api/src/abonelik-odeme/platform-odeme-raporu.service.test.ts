import { BadRequestException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import type { HamOdemeSatiri } from "./odeme-raporu";
import { PlatformOdemeRaporuController } from "./platform-odeme-raporu.controller";
import { PlatformOdemeRaporuService } from "./platform-odeme-raporu.service";

const odeme = (x: Partial<HamOdemeSatiri>): HamOdemeSatiri => ({
  odeme_id: "o1", tenant_id: "t1", unvan: "Firma", vkn: null, odeme_at: new Date("2026-11-01T10:00:00Z"), ay_sayisi: 1,
  tutar: "1198.80", matrah: "999.00", kdv: "199.80", kaynak: "saglayici", saglayici: "iyzico", kanal: "panel",
  onceki_donem_sonu: null, yeni_donem_sonu: new Date("2026-12-01T10:00:00Z"), odeme_notu: null, kaydeden: null, fatura_no: null, fatura_durumu: null,
  ...x,
});

/** $queryRaw şablon çağrısı: ilk parça işlev adını taşır. */
function servis(yanitlar: Record<string, unknown[] | ((degerler: unknown[]) => unknown[])>) {
  const queryRaw = vi.fn(async (parcalar: TemplateStringsArray, ...degerler: unknown[]) => {
    const metin = parcalar.join("?");
    const ad = Object.keys(yanitlar).find((k) => metin.includes(k));
    if (!ad) throw new Error(`beklenmeyen sorgu: ${metin}`);
    const y = yanitlar[ad];
    return typeof y === "function" ? y(degerler) : y;
  });
  return { s: new PlatformOdemeRaporuService({ db: { $queryRaw: queryRaw } } as never), queryRaw };
}

describe("PlatformOdemeRaporuService", () => {
  it("PLT-32/34: dönem ve önceki dönem ayrı sorgulanır, süzgeç ikisine de uygulanır, sayfalanır", async () => {
    let cagri = 0;
    const { s, queryRaw } = servis({
      platform_odeme_raporu: () =>
        cagri++ === 0
          ? [odeme({ odeme_id: "a" }), odeme({ odeme_id: "b", saglayici: "paytr", kanal: "otomatik" }), odeme({ odeme_id: "c", kaynak: "elle", saglayici: null, kanal: null, matrah: null, kdv: null, tutar: "120.00" })]
          : [odeme({ odeme_id: "eski", tutar: "100.00", matrah: "83.33", kdv: "16.67" })],
    });
    const r = await s.rapor("2026-11-01", "2026-11-30", { saglayici: "iyzico" }, 1, 50);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(r.kayitlar.map((x) => x.odemeId)).toEqual(["a"]);
    expect(r.ozet.toplam).toBe("1198.80");
    expect(r.onceki).toMatchObject({ baslangic: "2026-10-02", bitis: "2026-10-31", ozet: { adet: 1, toplam: "100.00" } });
    expect(r.saglayicilar).toEqual(["iyzico", "paytr"]);

    cagri = 0;
    const sayfali = await s.rapor("2026-11-01", "2026-11-30", {}, 9, 10);
    expect(sayfali).toMatchObject({ toplamKayit: 3, sayfa: 1, adet: 10 });
  });

  it("PLT-37: 24 aydan uzun ya da ters aralık 400 alır, sorgu yapılmaz", async () => {
    const { s, queryRaw } = servis({});
    await expect(s.rapor("2024-01-01", "2026-11-30", {}, 1, 50)).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.sorunlu("2026-11-02", "2026-11-01")).rejects.toThrow("Bitiş tarihi");
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("PLT-35: yarım deneme 'sonuclanmadi' olur; kart yalnız marka/son 4 ile döner", async () => {
    const { s } = servis({
      platform_sorunlu_odeme_kapsami: [{ veri: { sayilar: { basarisiz: 1, sonuclanmadi: 1 }, toplam: 2, sayfa: 1, sayfaBoyutu: 50, denemeler: [
        { deneme_id: "d1", tenant_id: "t1", unvan: "A ", zaman: new Date(), saglayici: "iyzico", ortam: "test", kaynak: "otomatik", ay_sayisi: 1, toplam: "1198.8", durum: "basarisiz", hata: "Yetersiz bakiye" },
        { deneme_id: "d2", tenant_id: "t2", unvan: "B", zaman: new Date(), saglayici: "paytr", ortam: "canli", kaynak: "eposta", ay_sayisi: 3, toplam: "3596.4", durum: "baslatildi", hata: null },
      ] } }],
      platform_kart_sorunlari: [
        { tenant_id: "t1", unvan: "A", saglayici: "iyzico", son4: "0006", kart_markasi: "MASTER_CARD", otomatik_yenileme: true, ay_sayisi: 1, deneme_sayisi: 2, son_deneme_at: new Date(), son_hata: "Yetersiz bakiye" },
      ],
    });
    const r = await s.sorunlu("2026-11-01", "2026-11-30");
    expect(r.denemeler.map((x) => [x.durum, x.toplam, x.unvan])).toEqual([["basarisiz", "1198.80", "A"], ["sonuclanmadi", "3596.40", "B"]]);
    expect(Object.keys(r.kartlar[0]).sort()).toEqual(["aySayisi", "denemeSayisi", "kartMarkasi", "otomatikYenileme", "saglayici", "sonDeneme", "sonHata", "son4", "tenantId", "unvan"].sort());
  });

  it("PLT-36: beklenen tutar kartın süresiyle, kart yoksa 1 ay; fiyatsız planda null", async () => {
    const simdi = new Date("2026-11-01T00:00:00Z");
    const { s, queryRaw } = servis({
      platform_yaklasan_yenilemeler: [
        { tenant_id: "t1", unvan: "Kartlı", plan_kodu: "profesyonel", durum: "aktif", donem_sonu: new Date("2026-11-11T00:00:00Z"), kart_var: true, saglayici: "iyzico", son4: "0006", kart_markasi: "VISA", otomatik_yenileme: true, kart_ay_sayisi: 3 },
        { tenant_id: "t2", unvan: "Kartsız", plan_kodu: "v1", durum: "askida", donem_sonu: new Date("2026-10-20T00:00:00Z"), kart_var: false, saglayici: null, son4: null, kart_markasi: null, otomatik_yenileme: null, kart_ay_sayisi: null },
        { tenant_id: "t3", unvan: "Kurumsal", plan_kodu: "kurumsal", durum: "aktif", donem_sonu: new Date("2026-11-20T00:00:00Z"), kart_var: false, saglayici: null, son4: null, kart_markasi: null, otomatik_yenileme: null, kart_ay_sayisi: null },
      ],
    });
    const r = await s.yaklasan(30, simdi);
    expect(queryRaw.mock.calls[0][1]).toBe(30);
    expect(r.kayitlar[0]).toMatchObject({ kalanGun: 10, planAdi: "Profesyonel", beklenen: { aySayisi: 3, matrah: "2997.00", kdv: "599.40", toplam: "3596.40" } });
    expect(r.kayitlar[1]).toMatchObject({ kalanGun: -12, kart: null, beklenen: { aySayisi: 1, toplam: "1198.80" } });
    expect(r.kayitlar[2].beklenen).toBeNull();
  });

  it("PLT-37: CSV Türkçe Excel biçiminde; xlsx toplam satırı taşır", async () => {
    const satirlar = [odeme({ unvan: 'Noktalı; "Tırnaklı" A.Ş.', kaynak: "elle", saglayici: null, kanal: null, matrah: null, kdv: null, tutar: "5500.00", kaydeden: "Admin", fatura_durumu: "tahsil_edildi", fatura_no: "ABF1" })];
    const { s } = servis({ platform_odeme_raporu: satirlar });
    const csv = await s.disariAktar("2026-11-01", "2026-11-30", {}, "csv");
    const metin = csv.icerik.toString("utf8");
    expect(metin.startsWith("﻿Tarih;Firma;")).toBe(true);
    expect(metin).toContain('"Noktalı; ""Tırnaklı"" A.Ş."');
    expect(metin).toContain(";4583,33;916,67;5500,00;0,00;Evet;Tahsil edildi;ABF1;Admin;");
    expect(csv.dosyaAdi).toBe("platform-odemeleri-2026-11-01-2026-11-30.csv");

    const xlsx = await s.disariAktar("2026-11-01", "2026-11-30", {}, "xlsx");
    const kitap = new ExcelJS.Workbook();
    await kitap.xlsx.load(xlsx.icerik as never);
    const sayfa = kitap.worksheets[0];
    expect(sayfa.getRow(2).getCell(11).value).toBe(5500);
    expect(sayfa.getRow(4).getCell(1).value).toBe("Toplam");
    expect(sayfa.getRow(4).getCell(11).value).toBe(5500);
  });
});

describe("SEC-09 CSV formül enjeksiyonu", () => {
  it("formülle başlayan firma ünvanı etkisizleşir", async () => {
    const { s } = servis({ platform_odeme_raporu: [odeme({ unvan: '=HYPERLINK("http://k.example","Tıkla")' })] });
    const metin = (await s.disariAktar("2026-11-01", "2026-11-30", {}, "csv")).icerik.toString("utf8");
    expect(metin).toContain(`;"'=HYPERLINK(""http://k.example"",""Tıkla"")";`);
    expect(metin).not.toMatch(/;=HYPERLINK/);
  });
});


describe("sorunlu ödeme filtre sözleşmesi", () => {
  it.each([{ firma: "yanlis" }, { plan: "x".repeat(41) }, { durum: "odendi" }, { sayfa: 0 }, { sayfa: 100001 }])("hatalı filtre servise ulaşmaz: %j", (filtre) => {
    const sorunlu = vi.fn(); const c = new PlatformOdemeRaporuController({ sorunlu } as never);
    expect(() => c.sorunlu({ baslangic: "2026-10-01", bitis: "2026-10-02", ...filtre })).toThrow();
    expect(sorunlu).not.toHaveBeenCalled();
  });
  it("filtreyi doğrulayarak servise taşır", () => {
    const sorunlu = vi.fn(); const c = new PlatformOdemeRaporuController({ sorunlu } as never);
    c.sorunlu({ baslangic: "2026-10-01", bitis: "2026-10-02", plan: " profesyonel ", durum: "basarisiz", sayfa: "2" });
    expect(sorunlu).toHaveBeenCalledWith("2026-10-01", "2026-10-02", { plan: "profesyonel", durum: "basarisiz", sayfa: 2 });
  });
});
