import { describe, expect, it } from "vitest";
import { kdvAdimi, takvimSatiri, vergiDurumu, type DonemEksikleri } from "./vergi-takvimi.hesap";

const eksiksiz: DonemEksikleri = { onaysizBordro: 0, izsizBordro: 0, taslakFatura: 0, taslakMasraf: 0 };
const taban = { yukumluluk: "kdv2" as const, yil: 2026, ay: 10, bugun: "2026-11-09", sonTarih: "2026-11-25", oncekiSonTarih: null, hesaplanan: 1000, beyanTutari: null, beyanDevreden: null, beyanNotu: null, odemeler: [], eksikler: eksiksiz };
const odeme = (tutar: number) => ({ id: "x", tarih: "2026-11-20", tutar, not: null, hareketId: null, hareketAciklama: null });

describe("devreden KDV zinciri", () => {
  it("net devredeni aşarsa fark ödenir, devir kalmaz", () => {
    expect(kdvAdimi(1000, 300, null)).toEqual({ hesaplanan: 700, devredenGiren: 300, devredenCikan: 0 });
  });
  it("net devredenden azsa ödeme yok, kalan devreder", () => {
    expect(kdvAdimi(200, 500, null)).toEqual({ hesaplanan: 0, devredenGiren: 500, devredenCikan: 300 });
  });
  it("indirilecek fazlası devredene eklenir", () => {
    expect(kdvAdimi(-400, 100, null)).toEqual({ hesaplanan: 0, devredenGiren: 100, devredenCikan: 500 });
  });
  it("beyandaki devreden hesaptan üstündür", () => {
    expect(kdvAdimi(-400, 100, 650).devredenCikan).toBe(650);
  });
});

describe("durum", () => {
  const d = (tutar: number, odenen: number, bugun = "2026-11-09") => vergiDurumu({ tutar, odenen, sonTarih: "2026-11-25", bugun });
  it("bekliyor, kısmi, ödendi, gecikti, yok", () => {
    expect(d(100, 0)).toBe("bekliyor");
    expect(d(100, 40)).toBe("kismi");
    expect(d(100, 100)).toBe("odendi");
    expect(d(100, 40, "2026-11-26")).toBe("gecikti");
    expect(d(0, 0, "2026-12-01")).toBe("yok");
  });
  it("son gün geçmedikçe gecikmez, tarih yayınlanmadıysa hiç gecikmez", () => {
    expect(d(100, 0, "2026-11-25")).toBe("bekliyor");
    expect(vergiDurumu({ tutar: 100, odenen: 0, sonTarih: null, bugun: "2027-06-01" })).toBe("bekliyor");
  });
});

describe("takvim satırı", () => {
  it("beyan tutarı kalanı belirler, hesaplanan görünür kalır", () => {
    const s = takvimSatiri({ ...taban, beyanTutari: 900, odemeler: [odeme(400)] });
    expect(s).toMatchObject({ hesaplanan: 1000, tutar: 900, odenen: 400, kalan: 500, durum: "kismi" });
  });
  it("fazla ödeme kalanı eksiye düşürmez", () => {
    expect(takvimSatiri({ ...taban, odemeler: [odeme(1500)] })).toMatchObject({ kalan: 0, durum: "odendi" });
  });
  it("başlangıç girilmemiş firmada geçmiş dönem gecikmiş sayılmaz", () => {
    expect(takvimSatiri({ ...taban, bugun: "2026-12-15" }).durum).toBe("gecikti");
    expect(takvimSatiri({ ...taban, bugun: "2026-12-15", takipBasladi: false }).durum).toBe("bekliyor");
  });
  it("dönem sürüyorsa işaretlenir", () => {
    expect(takvimSatiri({ ...taban, ay: 11 }).donemSuruyor).toBe(true);
    expect(takvimSatiri(taban).donemSuruyor).toBe(false);
  });
  it("eksik uyarıları yalnız ilgili kaleme yazılır", () => {
    const eksikler = { onaysizBordro: 2, izsizBordro: 0, taslakFatura: 3, taslakMasraf: 1 };
    expect(takvimSatiri({ ...taban, yukumluluk: "sgk", eksikler }).uyarilar).toEqual(["2 onaylanmamış bordro tutara girmedi"]);
    expect(takvimSatiri({ ...taban, yukumluluk: "kdv1", eksikler }).uyarilar).toEqual(["3 taslak fatura tutara girmedi"]);
    expect(takvimSatiri({ ...taban, yukumluluk: "muhtasar", eksikler }).uyarilar).toHaveLength(3);
  });
});
