import { describe, expect, it, vi } from "vitest";
import type { AracBaglami } from "./arac";
import { kisalt } from "./arac";
import { MODUL_ARACLARI } from "./moduller";

const bul = (ad: string) => {
  const a = MODUL_ARACLARI.find((x) => x.ad === ad);
  if (!a) throw new Error(ad);
  return a;
};

/** Uç çağrılarını metot adına göre yanıtlayan sahte bağlam. */
function baglam(yanitlar: Record<string, (...a: any[]) => unknown>) {
  const cagir = vi.fn(async (uc: { yontem: string }, argumanlar: unknown[]) => {
    const f = yanitlar[uc.yontem];
    if (!f) throw new Error(`beklenmeyen uç ${uc.yontem}`);
    return f(...argumanlar);
  });
  return { b: { uc: { cagir }, kaynak: "asistan", arac: "deneme" } as unknown as AracBaglami, cagir };
}

const gelen = (ek: Record<string, unknown> = {}) => ({
  id: "g1", belgeNo: "ABC2026000000001", gonderenUnvan: "Kaya Makina", durum: "beklemede", dovizCinsi: "TRY",
  belgeToplamlari: { genelToplam: "1200.00" }, engeller: [], tutarDenetimi: { gecerli: true }, cari: { id: "c1", kod: "TED-1", unvan: "Kaya" },
  satirlar: [
    { siraNo: 1, ad: "Vana", onerilenStokId: "s1", onerilenVaryantId: null, onerilenStok: { kod: "V1", ad: "Vana" } },
    { siraNo: 2, ad: "Conta", onerilenStokId: "s2", onerilenVaryantId: null, onerilenStok: { kod: "C1", ad: "Conta" } },
  ],
  onDenetim: { bulgular: [{ kod: "GELEN_IBAN_DEGISTI", duzey: "uyari", mesaj: "IBAN değişmiş" }, { kod: "GELEN_VADE_YOK", duzey: "bilgi", mesaj: "vade yok" }], susturulan: 0 },
  ...ek,
});

describe("AI-73 gelen e-Fatura araçları", () => {
  it("işlemede önerilen eşleşmeyi kullanır, uyarıları onay anahtarı olarak geçer", async () => {
    const isle = vi.fn(async () => ({ faturaId: "f1", faturaTipi: "alis", irsaliyeBagi: null }));
    const { b } = baglam({ gelenGetir: () => gelen(), gelenOnayla: isle });
    const a = bul("gelen_efatura_isle");
    const ozet = await a.ozetle!(b, { gelenId: "g1" });
    expect(ozet).toContain("1. Vana → V1 Vana");
    expect(ozet).toContain("IBAN değişmiş");
    await a.calistir(b, { gelenId: "g1" });
    expect(isle).toHaveBeenCalledWith("g1", expect.objectContaining({
      satirEslesmeleri: [{ siraNo: 1, stokId: "s1", varyantId: null }, { siraNo: 2, stokId: "s2", varyantId: null }],
      yeniCariOnay: false,
      onDenetimOnayi: { anahtarlar: ["GELEN_IBAN_DEGISTI:0"], gerekce: "Asistan onay talebiyle" },
    }));
  });

  it("eşleşmeyen satır, engel ve işlenmiş belgede talep açılmaz", async () => {
    const a = bul("gelen_efatura_isle");
    const eksik = gelen({ satirlar: [{ siraNo: 1, ad: "Vana", onerilenStokId: null }] });
    await expect(a.ozetle!(baglam({ gelenGetir: () => eksik }).b, { gelenId: "g1" })).rejects.toThrow(/1\. Vana/);
    await expect(a.ozetle!(baglam({ gelenGetir: () => gelen({ engeller: ["kur yok"] }) }).b, { gelenId: "g1" })).rejects.toThrow(/kur yok/);
    await expect(a.ozetle!(baglam({ gelenGetir: () => gelen({ durum: "islendi" }) }).b, { gelenId: "g1" })).rejects.toThrow(/islendi/);
  });

  it("verilen eşleşmede denetim o eşleşmeyle yeniden hesaplanır; yeni cari onayı cari yoksa verilir", async () => {
    const denetim = vi.fn(async () => ({ bulgular: [] }));
    const isle = vi.fn(async () => ({ faturaId: "f1" }));
    const { b } = baglam({ gelenGetir: () => gelen({ cari: null }), gelenDenetim: denetim, gelenOnayla: isle });
    const eslesme = [{ siraNo: 1, stokId: "s9" }, { siraNo: 2, stokId: "s2" }];
    await bul("gelen_efatura_isle").calistir(b, { gelenId: "g1", satirEslesmeleri: eslesme });
    expect(denetim).toHaveBeenCalledWith("g1", { satirEslesmeleri: eslesme });
    expect(isle).toHaveBeenCalledWith("g1", { satirEslesmeleri: eslesme, yeniCariOnay: true });
  });

  it("liste aramayı, tarihi ve uyarı süzgecini uygular", async () => {
    const { b } = baglam({ gelenListele: () => [
      { id: "1", belgeNo: "A1", gonderenUnvan: "Kaya", gonderenVkn: "1", tarih: "2026-10-01", denetimUyari: 2 },
      { id: "2", belgeNo: "A2", gonderenUnvan: "Deniz", gonderenVkn: "2", tarih: "2026-10-05", denetimUyari: 0 },
      { id: "3", belgeNo: "A3", gonderenUnvan: "Kaya", gonderenVkn: "1", tarih: "2026-09-01", denetimUyari: null },
    ] });
    const r: any = await bul("gelen_efatura_ara").calistir(b, { arama: "kaya", baslangic: "2026-09-15" });
    expect(r.kayitlar.map((k: any) => k.id)).toEqual(["1"]);
    const u: any = await bul("gelen_efatura_ara").calistir(b, { yalnizUyarili: true });
    expect(u.kayitlar.map((k: any) => k.adres)).toEqual(["/panel/fatura/gelen-kutusu?ac=1"]);
  });

  it("ret yanıtı gerekçesiz çalışmaz", async () => {
    const { b } = baglam({ gelenGetir: () => gelen(), gelenYanit: () => ({}) });
    await expect(bul("gelen_efatura_yanit").calistir(b, { gelenId: "g1", yanit: "ret" })).rejects.toThrow(/gerekçe/);
  });
});

describe("AI-73…77 araç kuralları", () => {
  it("yazan araçlar onaya tabi; dönem kapatma, ödeme talimatı ve kredi yazma aracı yok", () => {
    const onayli = new Set(MODUL_ARACLARI.filter((a) => a.sinif === "onay").map((a) => a.ad));
    for (const ad of ["gelen_efatura_isle", "gelen_efatura_yanit", "gelen_eirsaliye_yanit", "satin_alma_talebini_onaya_sun", "satin_alma_talebini_onayla", "satin_alma_talebini_reddet", "satin_alma_teklif_sec", "satin_alma_siparise_donustur", "duzeltme_ata", "duzeltme_durum_degistir"]) {
      expect(onayli.has(ad), ad).toBe(true);
    }
    for (const a of MODUL_ARACLARI) {
      expect(a.uc.yol, a.ad).not.toMatch(/^(POST|PATCH|PUT) \/kasa-banka\/(krediler|odeme-talimatlari|kredi-kartlari|cek)|donem-kapatma\/(kapat|.*yeniden-ac)|^(POST|PATCH|PUT) \/butce/);
    }
  });

  it("kısaltma ağır alanları atar, dizileri keser", () => {
    const { veri, kisaltildi } = kisalt({ xmlIcerik: "<x/>", gorselBase64: "aaa", satirlar: Array.from({ length: 30 }, (_, i) => ({ i })), ad: "x" }, 5);
    expect(veri).toEqual({ satirlar: [{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }], ad: "x" });
    expect(kisaltildi).toBe(true);
    expect(kisalt({ a: [1, 2] }).kisaltildi).toBe(false);
  });
});
