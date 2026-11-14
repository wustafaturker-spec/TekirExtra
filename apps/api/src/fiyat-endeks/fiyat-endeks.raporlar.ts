import { BadRequestException } from "@nestjs/common";
import { registerRapor, type RaporSatiri } from "../core/raporlar/rapor-kayit";
import { aktifBaglam } from "../core/istek-baglami";
import { FIYAT_ENDEKS_ROLLERI, fiyatEndeksErisimi, tarafDenetle, type FiyatTarafi } from "./fiyat-endeks-erisim";
import { ayAraligi, ayBasiMetni, ayKaydir, fiyatSerisiHesapla } from "./fiyat-endeks-hesap";
import { aylikToplamlar, endeksVerisi } from "./fiyat-endeks-veri";

/** Toplu raporun en uzun dönemi (ay). */
const RAPOR_EN_UZUN_AY = 60;

/**
 * END-12: rapor kataloğunda toplu fiyat–endeks karşılaştırması. Excel, PDF,
 * kayıtlı görünüm ve rapor aboneliği ortak rapor altyapısından gelir.
 * Rol listesi yöneticinin açabileceği rollerdir; asıl erişim (plan özelliği
 * ve yöneticinin seçtiği roller) çalıştırmada denetlenir.
 */
registerRapor({
  kod: "stok.fiyat_endeks",
  modul: "stok",
  ad: "Fiyat–Endeks Karşılaştırması",
  aciklama: "Ürünlerin gerçekleşen satış ya da alış fiyatı değişiminin TÜFE, Yİ-ÜFE veya döviz kuruyla karşılaştırması (baz: başlangıç ayı)",
  roller: FIYAT_ENDEKS_ROLLERI,
  filtreler: [
    { alan: "baslangic", ad: "Başlangıç (baz ay)", tip: "tarih", zorunlu: true },
    { alan: "bitis", ad: "Bitiş", tip: "tarih", zorunlu: true },
    { alan: "endeks", ad: "Endeks", tip: "secim", zorunlu: true, secenekler: [
      { deger: "TUFE", ad: "TÜFE" }, { deger: "YIUFE", ad: "Yİ-ÜFE" }, { deger: "USD", ad: "ABD doları" }, { deger: "EUR", ad: "Euro" },
    ] },
    { alan: "taraf", ad: "Fiyat tarafı", tip: "secim", secenekler: [{ deger: "satis", ad: "Satış fiyatı" }, { deger: "alis", ad: "Alış fiyatı" }] },
    { alan: "fiyatListesi", ad: "Fiyat listesi adı (yalnız satış)", tip: "metin" },
    { alan: "stok", ad: "Ürün", tip: "stok" },
  ],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "birim", baslik: "Birim", tip: "metin" },
    { alan: "bazFiyat", baslik: "Baz fiyat", tip: "para" },
    { alan: "sonAy", baslik: "Son ay", tip: "metin" },
    { alan: "sonFiyat", baslik: "Son fiyat", tip: "para" },
    { alan: "fiyatDegisim", baslik: "Fiyat değişimi", tip: "yuzde" },
    { alan: "endeksDegisim", baslik: "Endeks değişimi", tip: "yuzde" },
    { alan: "reelDegisim", baslik: "Reel değişim", tip: "yuzde" },
    { alan: "olmasiGereken", baslik: "Endekse göre fiyat", tip: "para" },
    { alan: "fark", baslik: "Fark", tip: "para" },
    { alan: "durum", baslik: "Durum", tip: "metin" },
  ],
  async calistir(girdi, { tenantId, tx }) {
    const f = girdi.filtreler ?? {};
    const baslangic = ayBasiMetni(String(f.baslangic ?? "")), bitis = ayBasiMetni(String(f.bitis ?? ""));
    if (!baslangic || !bitis) throw new BadRequestException("Başlangıç ve bitiş zorunludur.");
    const aylar = ayAraligi(baslangic, bitis);
    if (aylar.length < 2) throw new BadRequestException("Bitiş, başlangıç ayından sonraki bir ay olmalıdır.");
    if (aylar.length > RAPOR_EN_UZUN_AY) throw new BadRequestException(`Dönem en çok ${RAPOR_EN_UZUN_AY} ay olabilir.`);
    const taraf: FiyatTarafi = f.taraf === "alis" ? "alis" : "satis";
    const erisim = await fiyatEndeksErisimi(tx, tenantId, aktifBaglam().rol);
    tarafDenetle(erisim, taraf);

    let listeler: string[] | null = null;
    const listeAdi = typeof f.fiyatListesi === "string" ? f.fiyatListesi.trim() : "";
    if (listeAdi) {
      if (taraf !== "satis") throw new BadRequestException("Fiyat listesi süzgeci yalnız satış tarafında kullanılır.");
      const liste = await tx.fiyatListesi.findFirst({ where: { ad: { equals: listeAdi, mode: "insensitive" } }, select: { id: true } });
      if (!liste) throw new BadRequestException(`'${listeAdi}' adlı fiyat listesi bulunamadı.`);
      listeler = [liste.id];
    }

    const endeks = await endeksVerisi(tx, String(f.endeks), baslangic, bitis);
    const toplamlar = await aylikToplamlar(tx, {
      taraf, baslangic, bitisHaric: ayKaydir(bitis, 1),
      stokIdler: typeof f.stok === "string" && f.stok ? [f.stok] : null,
      listeler,
    });
    const urunler = new Map<string, Map<string, (typeof toplamlar)[number]["toplam"]>>();
    for (const r of toplamlar) {
      const m = urunler.get(r.stokId) ?? new Map();
      m.set(r.ay, r.toplam);
      urunler.set(r.stokId, m);
    }
    const kartlar = new Map((await tx.stokKart.findMany({ where: { id: { in: [...urunler.keys()] } }, select: { id: true, kod: true, ad: true, anaBirim: true } })).map((k) => [k.id, k]));
    const endeksler = new Map([[endeks.kod, endeks.degerler]]);

    const satirlar: (RaporSatiri & { _sira: number })[] = [];
    for (const [stokId, ayToplamlari] of urunler) {
      const kart = kartlar.get(stokId);
      if (!kart) continue;
      const k = fiyatSerisiHesapla(ayToplamlari, aylar, baslangic, endeksler).karsilastirmalar[0];
      satirlar.push({
        stokId, kod: kart.kod, ad: kart.ad, birim: kart.anaBirim,
        bazFiyat: k.bazFiyat, sonAy: k.sonAy ? k.sonAy.slice(0, 7) : null, sonFiyat: k.sonFiyat,
        fiyatDegisim: k.fiyatDegisim, endeksDegisim: k.endeksDegisim, reelDegisim: k.reelDegisim,
        olmasiGereken: k.olmasiGerekenFiyat, fark: k.fark,
        durum: k.neden ?? (Number(k.reelDegisim) < 0 ? "Endeksin gerisinde" : "Endeksin üzerinde ya da eşit"),
        _sira: k.reelDegisim === null ? Number.POSITIVE_INFINITY : Number(k.reelDegisim),
      });
    }
    // Varsayılan sıra: endeksin en çok gerisinde kalan önce; karşılaştırılamayanlar sonda.
    return satirlar.sort((a, b) => a._sira - b._sira || String(a.kod).localeCompare(String(b.kod), "tr")).map(({ _sira, ...r }) => r);
  },
});

