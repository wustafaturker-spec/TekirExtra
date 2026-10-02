import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { asgariOran, ekstreleriHesapla, ekstreOzeti, kalemleriAyir, kesimTarihi, sonOdemeTarihi, type KartHareketiGirdisi } from "./kart-ekstre";

const D = (v: string | number) => new Prisma.Decimal(v);
const T = (gun: string) => new Date(`${gun}T00:00:00Z`);
const kart = { hesapKesimGunu: 23, sonOdemeGunu: 3, limit: "100000", asgariOdemeOrani: null };
const tatilsiz = new Set<string>();

let sayac = 0;
function hareket(tip: KartHareketiGirdisi["tip"], tarih: string, tutar: string, ek: Partial<KartHareketiGirdisi> = {}): KartHareketiGirdisi {
  const id = `h${++sayac}`;
  return { id, tip, tarih: T(tarih), tutar, aciklama: `${tip} ${tarih}`, taksitSayisi: 1, geriAlinanHareketId: null, ekstreId: null, taksitler: [], ...ek };
}
function taksitli(tarih: string, tutar: string, adet: number): KartHareketiGirdisi {
  const h = hareket("harcama", tarih, tutar, { taksitSayisi: adet });
  const pay = D(tutar).div(adet).toDecimalPlaces(2);
  const [y, a, g] = tarih.split("-").map(Number);
  h.taksitler = Array.from({ length: adet }, (_, i) => ({ id: `${h.id}-t${i + 1}`, sira: i + 1, vadeTarihi: new Date(Date.UTC(y, a - 1 + i, g)), tutar: pay, ekstreId: null }));
  return h;
}
const hesapla = (hareketler: KartHareketiGirdisi[], bugun: string, kesinler = [] as Parameters<typeof ekstreleriHesapla>[0]["kesinler"], tatiller = tatilsiz) =>
  ekstreleriHesapla({ kart, kesinler, ...kalemleriAyir(hareketler), bugun, tatiller });
const donem = (liste: ReturnType<typeof hesapla>, kesim: string) => liste.find((d) => d.kesimTarihi === kesim)!;

describe("kesim ve son ödeme tarihi", () => {
  it("kesim günü kısa ayda ayın son gününe çekilir", () => {
    expect(kesimTarihi(2026, 1, 31)).toBe("2026-02-28");
    expect(kesimTarihi(2026, 3, 31)).toBe("2026-04-30");
  });

  it("son ödeme günü kesimden küçükse sonraki aya düşer, hafta sonu ve tatilde ilk iş gününe kayar", () => {
    // 2026-10-03 cumartesi → pazartesi 2026-10-05
    expect(sonOdemeTarihi("2026-09-23", 23, 3, tatilsiz)).toBe("2026-10-05");
    // Aynı ay: kesim 5, son ödeme 15 → 2026-10-15 perşembe
    expect(sonOdemeTarihi("2026-10-05", 5, 15, tatilsiz)).toBe("2026-10-15");
    expect(sonOdemeTarihi("2026-10-05", 5, 15, new Set(["2026-10-15", "2026-10-16"]))).toBe("2026-10-19");
  });

  it("asgari oran limite göre %20/%40, kartta tanımlıysa o oran", () => {
    expect(asgariOran(kart).toNumber()).toBe(40);
    expect(asgariOran({ ...kart, limit: "50000" }).toNumber()).toBe(20);
    expect(asgariOran({ ...kart, asgariOdemeOrani: "25" }).toNumber()).toBe(25);
  });
});

describe("dönem ekstresi", () => {
  it("taksitler kendi dönemine düşer, borç dönemden döneme devreder", () => {
    const liste = hesapla([taksitli("2026-08-10", "3000", 3), hareket("aidat", "2026-09-01", "100")], "2026-10-01");
    expect(donem(liste, "2026-08-23").harcamalar.toFixed(2)).toBe("1000.00");
    expect(donem(liste, "2026-09-23").harcamalar.toFixed(2)).toBe("1100.00");
    expect(donem(liste, "2026-09-23").donemBorcu.toFixed(2)).toBe("2100.00");
    expect(donem(liste, "2026-10-23").tur).toBe("acik");
    expect(donem(liste, "2026-10-23").harcamalar.toFixed(2)).toBe("1000.00");
  });

  it("ödeme en eski ekstreyi kapatır; son ödeme günü geçip asgari ödenmediyse gecikir", () => {
    const harcama = hareket("harcama", "2026-09-10", "1000");
    const tamOdeme = hesapla([harcama, hareket("odeme", "2026-10-02", "1000")], "2026-10-10");
    expect(donem(tamOdeme, "2026-09-23").durum).toBe("odendi");

    const asgariOdeme = hesapla([harcama, hareket("odeme", "2026-10-02", "400")], "2026-10-10");
    const d = donem(asgariOdeme, "2026-09-23");
    expect(d.asgari.toFixed(2)).toBe("400.00");
    expect(d.kalan.toFixed(2)).toBe("600.00");
    expect(d.durum).toBe("asgari_odendi");
    // Ekstre borcu devreder, kesimden sonraki ödeme yeni dönemde düşülür: kalan 600.
    const ekim = donem(asgariOdeme, "2026-10-23");
    expect([ekim.devreden.toFixed(2), ekim.donemIciOdeme.toFixed(2), ekim.donemBorcu.toFixed(2)]).toEqual(["1000.00", "400.00", "600.00"]);

    expect(donem(hesapla([harcama], "2026-10-10"), "2026-09-23").durum).toBe("gecikti");
    expect(donem(hesapla([harcama, hareket("odeme", "2026-09-30", "100")], "2026-10-01"), "2026-09-23").durum).toBe("kismi");
  });

  it("kesinleşmiş ekstrede borç bankanın tutarıdır; geç girilen kalem sonraki açık döneme düşer", () => {
    const harcama = hareket("harcama", "2026-09-10", "1000");
    const gecGirilen = hareket("faiz", "2026-09-15", "50");
    const kesin = { id: "e1", kesimTarihi: "2026-09-23", sonOdemeTarihi: "2026-10-05", hesaplananTutar: "1000", bankaTutari: "1012.40", bankaAsgariTutari: "404.96" };
    harcama.ekstreId = "e1";
    const liste = hesapla([harcama, gecGirilen], "2026-10-01", [kesin]);
    const eylul = donem(liste, "2026-09-23");
    expect(eylul.donemBorcu.toFixed(2)).toBe("1012.40");
    expect(eylul.asgari.toFixed(2)).toBe("404.96");
    expect(eylul.kalemler.map((k) => k.hareketId)).toEqual([harcama.id]);
    expect(donem(liste, "2026-10-23").kalemler.map((k) => k.hareketId)).toEqual([gecGirilen.id]);
    expect(donem(liste, "2026-10-23").devreden.toFixed(2)).toBe("1012.40");
  });

  it("harcamanın ters kaydı yalnız plandan düşmeyen taksitler kadar alacak yazar; ödemenin tersi eksi ödemedir", () => {
    const asil = taksitli("2026-08-10", "3000", 3);
    asil.taksitler = asil.taksitler.slice(0, 1); // vadesi gelmemiş iki taksit plandan düştü
    const ters = hareket("iade", "2026-09-05", "3000", { geriAlinanHareketId: asil.id });
    const odeme = hareket("odeme", "2026-09-01", "1000");
    const odemeTersi = hareket("harcama", "2026-09-02", "1000", { geriAlinanHareketId: odeme.id });
    const { kalemler, odemeler } = kalemleriAyir([asil, ters, odeme, odemeTersi]);
    expect(kalemler.find((k) => k.hareketId === ters.id)?.tutar.toFixed(2)).toBe("-1000.00");
    expect(odemeler.map((o) => o.tutar.toFixed(2))).toEqual(["1000.00", "-1000.00"]);
    const liste = hesapla([asil, ters, odeme, odemeTersi], "2026-10-01");
    expect(donem(liste, "2026-09-23").donemBorcu.toFixed(2)).toBe("0.00");
  });

  it("özet son kesilen ekstreyi, açık dönemi ve taksit yükü olan gelecek dönemleri verir", () => {
    const ozet = ekstreOzeti(hesapla([taksitli("2026-09-10", "1200", 4)], "2026-10-01"));
    expect(ozet.sonKesilen?.kesimTarihi).toBe("2026-09-23");
    expect(ozet.acik?.kesimTarihi).toBe("2026-10-23");
    expect(ozet.gelecek.map((d) => d.kesimTarihi)).toEqual(["2026-11-23", "2026-12-23"]);
  });
});
