import { describe, expect, it } from "vitest";
import { anlikTahmin, faturaNetHareketleri, gerceklesenGecikmeler, isabetOzeti, type IsabetSatiri, type KaynakliHareket } from "./tahmin-isabeti";

const gun = (iso: string) => new Date(`${iso}T00:00:00Z`);
const h = (tip: "borc" | "alacak", tutar: number, tarih: string, kaynakTur = "kasa_banka", kaynakRef: string | null = null, vade: string | null = null): KaynakliHareket =>
  ({ tip, tutarTry: tutar, tarih: gun(tarih), vadeTarihi: vade ? gun(vade) : null, kaynakTur, kaynakRef });

describe("CARI-49 faturaNetHareketleri", () => {
  it("iptal edilmiş faturanın kayıtları düşer; ters kaydı başka faturayı kapatmaz", () => {
    const net = faturaNetHareketleri([
      h("borc", 100, "2026-01-01", "fatura", "f1", "2026-01-31"),
      h("borc", 50, "2026-01-05", "fatura", "f-iptal", "2026-02-04"),
      h("alacak", 50, "2026-01-06", "fatura_iptal", "f-iptal"),
    ], new Set(["f-iptal"]));
    expect(net).toEqual([{ tip: "borc", tutarTry: 100, tarih: gun("2026-01-01"), vadeTarihi: gun("2026-01-31"), ref: "f1" }]);
  });

  it("taslağa geri alınıp yeniden kesinleşen fatura tek net borç olur, son asıl kaydın vadesiyle", () => {
    const net = faturaNetHareketleri([
      h("borc", 100, "2026-01-01", "fatura", "f1", "2026-01-31"),
      h("alacak", 100, "2026-01-02", "fatura_geri_alma", "f1"),
      h("borc", 120, "2026-01-03", "fatura", "f1", "2026-02-02"),
    ], new Set());
    expect(net).toEqual([{ tip: "borc", tutarTry: 120, tarih: gun("2026-01-03"), vadeTarihi: gun("2026-02-02"), ref: "f1" }]);
  });
});

describe("CARI-49 gerceklesenGecikmeler", () => {
  it("FIFO ile kapanır; kısmi ödemede tutar ağırlıklı, erken ödeme 0 gün", () => {
    const net = faturaNetHareketleri([
      h("borc", 100, "2026-01-01", "fatura", "f1", "2026-01-10"),
      h("borc", 100, "2026-01-02", "fatura", "f2", "2026-01-20"),
      h("alacak", 50, "2026-01-05"), // f1'in yarısı erken: 0 gün
      h("alacak", 50, "2026-01-30"), // f1'in kalanı 20 gün geç → ağırlıklı 10
      h("alacak", 40, "2026-01-31"), // f2 kısmi, kapanmadı
    ], new Set());
    const g = gerceklesenGecikmeler(net);
    expect(g.get("f1")).toEqual({ kapandi: true, gecikmeGun: 10, kapanisTarihi: gun("2026-01-30") });
    expect(g.get("f2")).toEqual({ kapandi: false, gecikmeGun: null, kapanisTarihi: null });
  });
});

describe("CARI-49 anlikTahmin", () => {
  it("faturanın kendi kaydını ve o andan sonraki hareketleri kullanmaz", () => {
    const hareketler = [
      h("borc", 100, "2026-01-01", "fatura", "a", "2026-01-01"), h("alacak", 100, "2026-01-11"), // 10 gün
      h("borc", 100, "2026-02-01", "fatura", "b", "2026-02-01"), h("alacak", 100, "2026-02-21"), // 20 gün
      h("borc", 100, "2026-03-01", "fatura", "yeni", "2026-03-01"),
      h("borc", 100, "2026-04-01", "fatura", "sonra", "2026-04-01"), h("alacak", 100, "2026-05-30"),
    ];
    const t = anlikTahmin(hareketler, "yeni", gun("2026-03-01"), null);
    expect(t).toEqual({ tahminGun: 15, guven: "dusuk", kapananBorcSayisi: 2 });
  });
});

describe("CARI-49 isabetOzeti", () => {
  const satir = (id: string, tahmin: number | null, gercek: number | null, kapanis: string | null, guven: "dusuk" | "orta" | "yuksek" | null = "orta", kaynak: "kesinlesme" | "geriye_donuk" = "kesinlesme"): IsabetSatiri => ({
    faturaId: id, cariId: "c", tahminGun: tahmin, guven, kaynak,
    gerceklesen: kapanis ? { kapandi: true, gecikmeGun: gercek, kapanisTarihi: gun(kapanis) } : { kapandi: false, gecikmeGun: null, kapanisTarihi: null },
  });

  it("sapma = gerçekleşen − tahmin; ortalama ve mutlak ortalama; kırılımlar", () => {
    const o = isabetOzeti([
      satir("1", 10, 14, "2026-09-10", "yuksek"),
      satir("2", 10, 4, "2026-10-01", "orta", "geriye_donuk"),
      satir("3", null, 7, "2026-10-02", null),
      satir("4", 5, null, null),
    ]);
    expect(o).toMatchObject({ ornek: 2, ortalamaSapma: -1, ortalamaMutlakSapma: 5, tahminsiz: 1, acik: 1 });
    expect(o.guven.yuksek).toEqual({ ornek: 1, ortalamaSapma: 4, ortalamaMutlakSapma: 4 });
    expect(o.kaynak.geriye_donuk).toEqual({ ornek: 1, ortalamaSapma: -6, ortalamaMutlakSapma: 6 });
    expect(o.aylik.map((a) => a.ay)).toEqual(["2026-09", "2026-10"]);
  });

  it("başlangıçtan önce kapanan ölçüme girmez; ölçüm yoksa değerler null", () => {
    const o = isabetOzeti([satir("1", 10, 14, "2025-01-10")], gun("2025-10-17"));
    expect(o).toMatchObject({ ornek: 0, ortalamaSapma: null, ortalamaMutlakSapma: null });
  });
});
