import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { maliyetIzlemeOzeti, maliyetIzlemeSorgusu, maliyetIzlemesiniOku } from "./maliyet-izleme";
import type { SatisSatiri } from "../stok/satis-ozeti";

const D = (v: string | number) => new Prisma.Decimal(v);
const row = (id: string, ek: Partial<SatisSatiri> = {}): SatisSatiri => ({ faturaSatirId: id, faturaId: "f", faturaNo: "F", tarih: new Date("2026-10-01"), cariId: "c", cariKod: "C", cariUnvan: "Cari", tip: "satis", stokId: "s", kod: "S", ad: "Ürün", stokTip: "urun", mevcutMiktar: D(0), miktar: D(1), ciro: D("0.10"), maliyet: D(0), hareketPaylari: [], ...ek });
const record = (kaynakRef: string, durum: "acik" | "incelemede" | "beklemede" | "cozuldu" | "yoksayildi", ms?: number) => ({ kaynakRef, durum, createdAt: new Date("2026-10-15T10:00:00Z"), olaylar: ms === undefined ? [] : [{ createdAt: new Date(Date.parse("2026-10-15T10:00:00Z") + ms) }] });
describe("maliyet inceleme ölçümü", () => {
  it("boş kapsamı sıfır ve süreyi null döndürür", () => {
    const r = maliyetIzlemeOzeti([], []);
    expect(r.uyari).toEqual({ satir: 0, ciro: "0.00", aktifTakipliSatir: 0, aktifTakipsizSatir: 0 });
    expect(r.incelemeler).toMatchObject({ toplam: 0, medyanSureSaniye: null, sureOrnekSayisi: 0 });
  });
  it("takibi kayıt, uyarıyı kaynak satırı bazında sayar; tekrar açılmış kayıtları toplar", () => {
    const r = maliyetIzlemeOzeti([row("a"), row("b"), row("c", { maliyet: D(10) })], [record("a", "yoksayildi"), record("a", "beklemede"), record("b", "cozuldu", 60000), record("c", "incelemede")]);
    expect(r.kapsam).toMatchObject({ malSatisSatiri: 3, takipliKaynakSatiri: 3 });
    expect(r.uyari).toEqual({ satir: 2, ciro: "0.20", aktifTakipliSatir: 1, aktifTakipsizSatir: 1 });
    expect(r.incelemeler).toMatchObject({ toplam: 4, beklemede: 1, incelemede: 1, yoksayildi: 1, dogrulanmisKapanis: 1, medyanSureSaniye: "60.000" });
  });
  it.each([[1000, 2000, 9000], [1000, 9000]])("süre örneklerinin medyanını hesaplar: %j", (...ms) => {
    const values = ms as number[], rows = values.map((_, i) => row(String(i)));
    const r = maliyetIzlemeOzeti(rows, values.map((v, i) => record(String(i), "cozuldu", v)));
    expect(r.incelemeler.medyanSureSaniye).toBe(values.length === 3 ? "2.000" : "5.000");
  });
  it("genel kapanışı doğrulanmış saymaz; ters tarihli doğrulama süreye katılmaz", () => {
    const r = maliyetIzlemeOzeti([row("a"), row("b"), row("c")], [record("a", "cozuldu"), record("b", "cozuldu", -1000), record("c", "acik", 1000)]);
    expect(r.incelemeler).toMatchObject({ digerKapanis: 1, dogrulanmisKapanis: 1, acik: 1, medyanSureSaniye: null, sureDisiKayit: 1 });
  });
  it("hizmet, iade, sıfır/eksi ciro ve kapsam dışı kayıtları ölçmez", () => {
    const rows = [row("a"), row("h", { stokTip: "hizmet" }), row("i", { tip: "satis_iade" }), row("z", { ciro: D(0) }), row("n", { ciro: D(-1) })];
    const r = maliyetIzlemeOzeti(rows, ["h", "i", "z", "n", "yabanci"].map((id) => record(id, "cozuldu", 1000)));
    expect(r.kapsam).toMatchObject({ malSatisSatiri: 1, takipliKaynakSatiri: 0 }); expect(r.incelemeler.toplam).toBe(0); expect(r.uyari.satir).toBe(1);
  });
  it("kimlik özeti sıralamadan ve maliyetten bağımsızdır; aynı sayıda farklı kaynakta değişir", () => {
    const a = maliyetIzlemeOzeti([row("a"), row("b")], []).kapsam.kaynakKimlikOzeti;
    expect(maliyetIzlemeOzeti([row("b", { maliyet: D(10) }), row("a")], []).kapsam.kaynakKimlikOzeti).toBe(a);
    expect(maliyetIzlemeOzeti([row("a"), row("c")], []).kapsam.kaynakKimlikOzeti).not.toBe(a);
  });
  it.each([{ baslangic: "2026-02-30", bitis: "2026-10-15" }, { baslangic: "2026-10-01", bitis: "2026-10-15", stokId: "x" }, { baslangic: "2024-01-01", bitis: "2026-10-15" }])("belirsiz veya fazla kapsamı reddeder: %j", (q) => {
    expect(() => maliyetIzlemeSorgusu(q)).toThrow();
  });
  it("inceleme geçmişi sınırı aşılırsa kısmi medyan döndürmez", async () => {
    const tx = {
      faturaSatir: { count: async () => 1 },
      fatura: { findMany: async () => [{ id: "f", no: "F", tarih: new Date(), tip: "satis", kur: D(1), cari: null, satirlar: [{ id: "a", stokId: "s", varyantId: null, varyant: null, miktar: D(1), matrah: D(1), birim: "adet", stok: { kod: "S", ad: "Ürün", tip: "urun", mevcutMiktar: D(0) } }] }] },
      stokHareket: { findMany: async () => [] }, stokKart: { findUnique: async () => ({ anaBirim: "adet" }) },
      duzeltmeKaydi: { findMany: vi.fn(async () => Array.from({ length: 20001 }, () => record("a", "acik"))) },
    };
    await expect(maliyetIzlemesiniOku(tx as never, "t", maliyetIzlemeSorgusu({ baslangic: "2026-10-01", bitis: "2026-10-15" }))).rejects.toThrow("20.000 inceleme");
  });
});
