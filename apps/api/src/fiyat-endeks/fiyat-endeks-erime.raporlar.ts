import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { registerRapor, type RaporSatiri } from "../core/raporlar/rapor-kayit";
import { aktifBaglam } from "../core/istek-baglami";
import { FIYAT_ENDEKS_ROLLERI, fiyatEndeksErisimi, tarafDenetle } from "./fiyat-endeks-erisim";
import { ayAraligi, ayBasiMetni, ayKaydir } from "./fiyat-endeks-hesap";
import { birimKirilmalariniOku } from "./birim-kirilmasi";
import { endeksVerisi } from "./fiyat-endeks-veri";
import { cariUrunToplamlari } from "./fiyat-endeks-makas.raporlar";

type D = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const YUZ = D(100);
const RAPOR_EN_UZUN_AY = 60;
/** Ay ortalaması bundan az oynadıysa fiyat değişmemiş sayılır (iskonto/yuvarlama kırıntısı). */
const DEGISIM_ESIGI = D("0.005");
const VARSAYILAN_ESIK_AY = 6;

const yuzde = (o: D) => o.mul(YUZ).toDecimalPlaces(2).toFixed(2);
const ay7 = (a: string) => a.slice(0, 7);
const ayFarki = (bas: string, son: string) => { const [y1, a1] = bas.split("-").map(Number), [y2, a2] = son.split("-").map(Number); return (y2 - y1) * 12 + (a2 - a1); };

/**
 * END-15: belge dövizindeki aylık birim fiyatlardan son fiyat değişikliğinin
 * ayı. Ardışık verili iki ay arasında %0,5'ten fazla oynama değişiklik
 * sayılır; hiç değişmediyse ilk satış ayı döner.
 */
export function sonFiyatDegisikligi(fiyatlar: { ay: string; fiyat: D }[]): string | null {
  if (!fiyatlar.length) return null;
  let son = fiyatlar[0].ay;
  for (let i = 1; i < fiyatlar.length; i++) {
    if (fiyatlar[i].fiyat.div(fiyatlar[i - 1].fiyat).sub(1).abs().gt(DEGISIM_ESIGI)) son = fiyatlar[i].ay;
  }
  return son;
}

/**
 * END-15: müşteri bazında fiyat erimesi. Müşteriye uygulanan gerçekleşen
 * satış fiyatının dönemin ilk ve son satış ayı arasında TÜFE/Yİ-ÜFE
 * karşısında reel değişimi ve fiyatın en son ne zaman değiştiği. Fiyatı uzun
 * süredir aynı kalan müşteri–ürün satırları önce gelir. Satış erişimi ister.
 */
registerRapor({
  kod: "stok.musteri_fiyat_erimesi",
  modul: "stok",
  ad: "Müşteri Fiyat Erimesi",
  aciklama: "Müşteri ve ürün bazında gerçekleşen satış fiyatının enflasyon karşısındaki reel değişimi; fiyatı uzun süredir güncellenmeyen satırlar önce gelir.",
  roller: FIYAT_ENDEKS_ROLLERI,
  filtreler: [
    { alan: "baslangic", ad: "Başlangıç", tip: "tarih", zorunlu: true },
    { alan: "bitis", ad: "Bitiş", tip: "tarih", zorunlu: true },
    { alan: "endeks", ad: "Endeks (boşsa TÜFE)", tip: "secim", secenekler: [{ deger: "TUFE", ad: "TÜFE" }, { deger: "YIUFE", ad: "Yİ-ÜFE" }] },
    { alan: "esikAy", ad: "Güncellenmeme eşiği, ay (boşsa 6)", tip: "sayi" },
    { alan: "yalnizGuncellenmeyen", ad: "Yalnız eşiği aşanlar", tip: "onay" },
    { alan: "cari", ad: "Müşteri", tip: "cari" },
    { alan: "stok", ad: "Ürün", tip: "stok" },
  ],
  kolonlar: [
    { alan: "musteri", baslik: "Müşteri", tip: "metin", kayit: { tur: "cari", idAlani: "cariId" } },
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "birim", baslik: "Birim", tip: "metin" },
    { alan: "dovizCinsi", baslik: "Belge dövizi", tip: "metin" },
    { alan: "bazAy", baslik: "İlk satış ayı", tip: "metin" },
    { alan: "sonAy", baslik: "Son satış ayı", tip: "metin" },
    { alan: "bazFiyat", baslik: "İlk fiyat (TL)", tip: "para" },
    { alan: "sonFiyat", baslik: "Son fiyat (TL)", tip: "para" },
    { alan: "fiyatDegisim", baslik: "Fiyat değişimi", tip: "yuzde" },
    { alan: "endeksDegisim", baslik: "Endeks değişimi", tip: "yuzde" },
    { alan: "reelDegisim", baslik: "Reel değişim", tip: "yuzde" },
    { alan: "sonDegisiklik", baslik: "Son fiyat değişikliği", tip: "metin" },
    { alan: "ayniFiyatAy", baslik: "Aynı fiyatla (ay)", tip: "sayi" },
    { alan: "durum", baslik: "Durum", tip: "metin" },
  ],
  async calistir(girdi, { tenantId, tx }) {
    const f = girdi.filtreler ?? {};
    const baslangic = ayBasiMetni(String(f.baslangic ?? "")), bitis = ayBasiMetni(String(f.bitis ?? ""));
    if (!baslangic || !bitis) throw new BadRequestException("Başlangıç ve bitiş zorunludur.");
    const aylar = ayAraligi(baslangic, bitis);
    if (aylar.length < 2) throw new BadRequestException("Bitiş, başlangıç ayından sonraki bir ay olmalıdır.");
    if (aylar.length > RAPOR_EN_UZUN_AY) throw new BadRequestException(`Dönem en çok ${RAPOR_EN_UZUN_AY} ay olabilir.`);
    const esikAy = f.esikAy === undefined || f.esikAy === "" ? VARSAYILAN_ESIK_AY : Number(f.esikAy);
    if (!Number.isInteger(esikAy) || esikAy < 1 || esikAy > 60) throw new BadRequestException("Güncellenmeme eşiği 1–60 ay olmalıdır.");
    const erisim = await fiyatEndeksErisimi(tx, tenantId, aktifBaglam().rol);
    tarafDenetle(erisim, "satis");
    const endeksKodu = f.endeks === "YIUFE" ? "YIUFE" : "TUFE";
    const [toplamlar, endeks] = await Promise.all([
      cariUrunToplamlari(tx, { baslangic, bitisHaric: ayKaydir(bitis, 1), cariId: typeof f.cari === "string" && f.cari ? f.cari : null, stokId: typeof f.stok === "string" && f.stok ? f.stok : null, tip: "satis" }),
      endeksVerisi(tx, endeksKodu, baslangic, bitis),
    ]);
    const gruplar = new Map<string, (typeof toplamlar)[number][]>();
    for (const t of toplamlar) {
      const anahtar = `${t.cariId}|${t.stokId}|${t.doviz}`;
      gruplar.set(anahtar, [...(gruplar.get(anahtar) ?? []), t]);
    }
    const [kartlar, cariler] = await Promise.all([
      tx.stokKart.findMany({ where: { id: { in: [...new Set(toplamlar.map((t) => t.stokId))] } }, select: { id: true, kod: true, ad: true, anaBirim: true } }),
      tx.cariHesap.findMany({ where: { id: { in: [...new Set(toplamlar.map((t) => t.cariId))] } }, select: { id: true, unvan: true } }),
    ]);
    const kart = new Map(kartlar.map((k) => [k.id, k])), cari = new Map(cariler.map((c) => [c.id, c]));

    const satirlar: (RaporSatiri & { _gecen: number; _reel: number })[] = [];
    const kirik = new Set((await birimKirilmalariniOku(tx, [...new Set(toplamlar.map((t) => t.stokId))], baslangic, bitis)).map((k) => k.stokId));
    for (const [anahtar, liste] of gruplar) {
      const [cariId, stokId, doviz] = anahtar.split("|");
      const k = kart.get(stokId), c = cari.get(cariId);
      if (!k || !c) continue;
      if (kirik.has(stokId)) { satirlar.push({ stokId, cariId, kod: k.kod, ad: k.ad, musteri: c.unvan, dovizCinsi: doviz, durum: "Birim değişikliği: dönemi kırılmanın tek tarafında seçin.", _gecen: -Infinity, _reel: 0 }); continue; }
      const aylik = liste.filter((t) => t.miktar.gt(0)).sort((a, b) => a.ay.localeCompare(b.ay));
      if (!aylik.length) continue;
      const sonDegisiklik = sonFiyatDegisikligi(aylik.map((t) => ({ ay: t.ay, fiyat: t.dvz.div(t.miktar) })))!;
      const gecen = ayFarki(sonDegisiklik, bitis);
      // Fiyat: dönemin ilk ve son satış ayı. Reel değişim yalnız iki ayın da endeksi açıklanmışsa.
      const t0 = aylik[0], t1 = aylik[aylik.length - 1];
      const bazAy = t0.ay, sonAy = t1.ay;
      const bazFiyat = t0.tl.div(t0.miktar), sonFiyat = t1.tl.div(t1.miktar);
      const ikiAy = aylik.length >= 2;
      const fd = ikiAy ? sonFiyat.div(bazFiyat).sub(1) : null;
      const e0 = endeks.degerler.get(bazAy), e1 = endeks.degerler.get(sonAy);
      const ed = ikiAy && e0 && e1 ? e1.div(e0).sub(1) : null;
      const reel = fd && ed ? fd.add(1).div(ed.add(1)).sub(1) : null;
      const guncellenmedi = gecen >= esikAy;
      if (f.yalnizGuncellenmeyen === true && !guncellenmedi) continue;
      satirlar.push({
        cariId, stokId, musteri: c.unvan, kod: k.kod, ad: k.ad, birim: k.anaBirim, dovizCinsi: doviz,
        bazAy: ay7(bazAy), sonAy: ay7(sonAy),
        bazFiyat: bazFiyat.toDecimalPlaces(4).toFixed(4), sonFiyat: sonFiyat.toDecimalPlaces(4).toFixed(4),
        fiyatDegisim: fd ? yuzde(fd) : null, endeksDegisim: ed ? yuzde(ed) : null, reelDegisim: reel ? yuzde(reel) : null,
        sonDegisiklik: ay7(sonDegisiklik), ayniFiyatAy: gecen,
        durum: guncellenmedi ? `${gecen} aydır aynı fiyat` : !ikiAy ? "Dönemde tek satış ayı" : reel === null ? `${ay7(e0 ? sonAy : bazAy)} endeksi açıklanmadı; reel değişim hesaplanamadı` : reel.lt(0) ? "Endeksin gerisinde" : "Endeksin üzerinde ya da eşit",
        _gecen: gecen, _reel: reel ? reel.toNumber() : Number.POSITIVE_INFINITY,
      });
    }
    return satirlar.sort((a, b) => b._gecen - a._gecen || a._reel - b._reel || String(a.musteri).localeCompare(String(b.musteri), "tr")).map(({ _gecen, _reel, ...r }) => r);
  },
});
