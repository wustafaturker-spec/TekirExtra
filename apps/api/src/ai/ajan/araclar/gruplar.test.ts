import { describe, expect, it } from "vitest";
import { AJAN_ARACLARI } from ".";
import { GRUP_ARACLARI, SAYFA_YOLU, aracGrubu, grupAcmaTanimi, gruplariSec } from "./gruplar";

describe("araç grupları (AI-84)", () => {
  it("her araç bir gruba bağlıdır; grup listelerinde olmayan araç adı yoktur", () => {
    const adlar = new Set(AJAN_ARACLARI.map((a) => a.ad));
    expect(AJAN_ARACLARI.filter((a) => !aracGrubu(a.ad)).map((a) => a.ad)).toEqual([]);
    expect(Object.values(GRUP_ARACLARI).flat().filter((ad) => !adlar.has(ad))).toEqual([]);
  });

  it("bağlamsız selamlaşmada yalnız çekirdek grup seçilir", () => {
    expect([...gruplariSec({ mesaj: "Merhaba" })]).toEqual(["cekirdek"]);
  });

  it("mesajdaki sözcükler Türkçe harf farkı gözetmeden grubu açar", () => {
    expect(gruplariSec({ mesaj: "GELEN İRSALİYELERİ göster" }).has("gelen_ebelge")).toBe(true);
    expect(gruplariSec({ mesaj: "Bu ayki çekler ne durumda?" }).has("finans")).toBe(true);
    expect(gruplariSec({ mesaj: "Satın alma talebi aç" }).has("satin_alma")).toBe(true);
    expect(gruplariSec({ mesaj: "Mailleri özetle" }).has("eposta")).toBe(true);
    expect(gruplariSec({ mesaj: "KARSEL'e teklif hazırla" }).has("satis")).toBe(true);
  });

  it("ekran kaydı, sayfa ve sohbette kullanılan araçlar grubu açar", () => {
    expect(gruplariSec({ mesaj: "özetle", ekranTuru: "gelen_efatura" }).has("gelen_ebelge")).toBe(true);
    expect(gruplariSec({ mesaj: "özetle", sayfa: "/panel/fatura/gelen-kutusu" }).has("gelen_ebelge")).toBe(true);
    expect(gruplariSec({ mesaj: "özetle", sayfa: "/panel/fatura/gelen-kutusu" }).has("satis")).toBe(false);
    expect(gruplariSec({ mesaj: "özetle", sayfa: "/panel/kasa-banka/cekler" }).has("finans")).toBe(true);
    expect(gruplariSec({ mesaj: "devam et", gecmisAraclar: ["duzeltme_ata"] }).has("denetim")).toBe(true);
  });

  it("sayfa yolu yalnız panel altındaki sade yolları kabul eder", () => {
    expect(SAYFA_YOLU.test("/panel/cari/3f2b6c1e-8d4a-4c2b-9a1e-5b7c8d9e0f12")).toBe(true);
    expect(SAYFA_YOLU.test("/panel/fatura?ac=1")).toBe(false);
    expect(SAYFA_YOLU.test("/disari")).toBe(false);
  });

  it("grup açma aracı yalnız kapalı grupları seçenek olarak sunar", () => {
    const t = grupAcmaTanimi(["finans", "denetim"]);
    expect((t.girdiSemasi as { properties: { gruplar: { items: { enum: string[] } } } }).properties.gruplar.items.enum).toEqual(["finans", "denetim"]);
    expect(t.aciklama).toContain("finans:");
    expect(t.aciklama).not.toContain("satis:");
  });
});

describe("araç uçları", () => {
  it("her uç tanımı denetleyicide var olan bir metodu gösterir", async () => {
    const { UC } = await import("./uclar");
    const eksik = Object.entries(UC).filter(([, u]) => typeof (u.denetleyici.prototype as Record<string, unknown>)[u.yontem] !== "function").map(([ad, u]) => `${ad}: ${u.denetleyici.name}.${u.yontem}`);
    expect(eksik).toEqual([]);
  });
});
