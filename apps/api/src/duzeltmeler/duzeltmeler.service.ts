import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { DuzeltmeDurumu, DuzeltmeOnemi, DuzeltmeTuru, Prisma } from "@prisma/client";
import type { z } from "zod";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { takiliRezervasyonKosulu } from "../ebelge/takili-rezervasyon";
import { yerlesmisHataKosulu } from "../ebelge/yerlesmis-hata";
import { VARSAYILAN_TOLERANS_YUZDE, farkAciklamasi, ucluEslestir } from "../satin-alma/uclu-eslestirme";
import type { duzeltmeListeSemasi } from "./duzeltmeler.semalar";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { degisenStokKartlari, stokTutarlilikHesapla } from "../stok/stok-tutarlilik.service";
import { kartBazinda, tutarlilikOzeti } from "../stok/stok-tutarlilik";
import { kurFarkiKalemleri } from "../fatura/kur-farki-kalem";
import { degisimKaydet } from "../core/degisim-izi";

type ListeGirdisi = z.infer<typeof duzeltmeListeSemasi>;
type Tespit = {
  tur: DuzeltmeTuru;
  onem: DuzeltmeOnemi;
  kaynakTur: string;
  kaynakRef: string;
  nedenKodu: string;
  aciklama: string;
  onerilenEylem: string;
};


/**
 * BLD-13: dedektör sorgularının üst sınırı (yük gerekçesiyle) ve her kaynağın
 * beslediği neden kodları. Sıra `tara()` içindeki Promise.all sırasıdır.
 * Sorun listeleri en eski önce, fatura denetimleri en yeni önce okunur; sıra
 * kararlıdır ki kesik taramada aynı kayıtlar turdan tura gidip gelmesin.
 */
export const TARAMA_SINIRI = 2_000;
/** BLD-16: aynı firmada aynı anda en çok bu kadar okuma işlemi; işlem başına süre; yazma parçası. */
export const OKUMA_ESZAMANLI = 4;
const ISLEM_SURESI_MS = 30_000;
export const YAZMA_PARCASI = 500;
/** Taramanın otomatik çözdüğü neden kodları (elle açılan kayıtlar bu listede değildir). */
const OTOMATIK_COZULEN_KODLAR = ["ESLESMEMIS_EKSTRE", "ODEME_BAGLANTISI_YOK", "BELGESIZ_KART_HARCAMASI", "POS_FINANS_HAREKETI_EKSIK", "EBELGE_HATALI", "EBELGE_UZUN_BEKLIYOR", "NEGATIF_STOK", "STOK_BAKIYE_FARKI", "VARYANTSIZ_HAREKET", "SAYIM_FARKI_ONAYSIZ", "VADE_GECTI_DURUM_ACIK", "FATURA_ODEME_TOPLAMI_ASIMI", "KUR_FARKI_BEKLIYOR", "UCLU_ESLESME_FARKI"];

/** BLD-16: en çok `n` işi aynı anda yürüten sıra; sonuç türleri korunur. */
export function sinirlayici(n: number) {
  let calisan = 0;
  const bekleyen: (() => void)[] = [];
  return async <T>(is: () => Promise<T>): Promise<T> => {
    // Boşalan yer doğrudan bekleyene devredilir; arada gelen iş sınırı aşamaz.
    if (calisan >= n) await new Promise<void>((r) => bekleyen.push(r));
    else calisan++;
    try { return await is(); } finally { const sonraki = bekleyen.shift(); if (sonraki) sonraki(); else calisan--; }
  };
}
const parcala = <T>(dizi: readonly T[], boy: number): T[][] => Array.from({ length: Math.ceil(dizi.length / boy) }, (_, i) => dizi.slice(i * boy, (i + 1) * boy));
const KAYNAK_KODLARI: { kaynak: string; kodlar: string[] }[] = [
  { kaynak: "banka_ekstre", kodlar: ["ESLESMEMIS_EKSTRE"] },
  { kaynak: "masraf", kodlar: ["ODEME_BAGLANTISI_YOK"] },
  { kaynak: "kredi_karti", kodlar: ["BELGESIZ_KART_HARCAMASI"] },
  { kaynak: "pos", kodlar: ["POS_FINANS_HAREKETI_EKSIK"] },
  { kaynak: "ebelge", kodlar: ["EBELGE_HATALI", "EBELGE_UZUN_BEKLIYOR"] },
  { kaynak: "negatif_stok", kodlar: ["NEGATIF_STOK"] },
  { kaynak: "sayim", kodlar: ["SAYIM_FARKI_ONAYSIZ"] },
  { kaynak: "cek_senet", kodlar: ["VADE_GECTI_DURUM_ACIK"] },
  { kaynak: "fatura_odeme", kodlar: ["FATURA_ODEME_TOPLAMI_ASIMI"] },
  { kaynak: "uclu_eslesme", kodlar: ["UCLU_ESLESME_FARKI"] },
];
@Injectable()
export class DuzeltmelerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ayarlar: AyarlarService,
  ) {}

  async listele(girdi: ListeGirdisi) {
    const { tenantId, rol } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const where: Prisma.DuzeltmeKaydiWhereInput = {
        ...this.rolKapsami(rol),
        ...(girdi.tur ? { tur: girdi.tur } : {}),
        ...(girdi.onem ? { onem: girdi.onem } : {}),
        ...(girdi.durum ? { durum: girdi.durum } : {}),
        ...(girdi.atananUserId ? { atananUserId: girdi.atananUserId } : {}),
        ...(girdi.kaynak ? { OR: [{ kaynakTur: { contains: girdi.kaynak, mode: "insensitive" } }, { kaynakRef: { contains: girdi.kaynak, mode: "insensitive" } }] } : {}),
        ...(girdi.baslangic || girdi.bitis ? { createdAt: { ...(girdi.baslangic ? { gte: girdi.baslangic } : {}), ...(girdi.bitis ? { lte: girdi.bitis } : {}) } } : {}),
      };
      const [toplam, kayitlar] = await Promise.all([
        tx.duzeltmeKaydi.count({ where }),
        tx.duzeltmeKaydi.findMany({
          where,
          include: { atanan: { select: { id: true, adSoyad: true } } },
          orderBy: [{ onem: "desc" }, { createdAt: "asc" }],
          skip: (girdi.sayfa - 1) * girdi.limit,
          take: girdi.limit,
        }),
      ]);
      return { kayitlar, toplam, sayfa: girdi.sayfa, limit: girdi.limit, toplamSayfa: Math.ceil(toplam / girdi.limit) };
    });
  }

  async ozet() {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kapsam = this.rolKapsami(rol); const gunBaslangici = new Date(); gunBaslangici.setHours(0, 0, 0, 0);
      const [gruplar, banaAtanan, slaAsan, bugunOlusan] = await Promise.all([
        tx.duzeltmeKaydi.groupBy({ by: ["durum", "onem"], where: kapsam, _count: { _all: true } }),
        tx.duzeltmeKaydi.count({ where: { ...kapsam, atananUserId: userId, durum: { in: ["acik", "incelemede", "beklemede"] } } }),
        tx.duzeltmeKaydi.count({ where: { ...kapsam, sonTarih: { lt: new Date() }, durum: { in: ["acik", "incelemede", "beklemede"] } } }),
        tx.duzeltmeKaydi.count({ where: { ...kapsam, createdAt: { gte: gunBaslangici } } }),
      ]);
      const say = (durumlar: DuzeltmeDurumu[], onem?: DuzeltmeOnemi) => gruplar.filter((g) => durumlar.includes(g.durum) && (!onem || g.onem === onem)).reduce((n, g) => n + g._count._all, 0);
      return { acik: say(["acik", "incelemede", "beklemede"]), kritik: say(["acik", "incelemede", "beklemede"], "kritik"), bugunOlusan, banaAtanan, slaAsan };
    });
  }

  async secenekler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.user.findMany({
      where: { aktif: true, rol: { in: ["yonetici", "muhasebe"] } },
      select: { id: true, adSoyad: true, eposta: true },
      orderBy: { adSoyad: "asc" },
    }));
  }

  async getir(id: string) {
    const { tenantId, rol } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.duzeltmeKaydi.findFirst({
      where: { id, ...this.rolKapsami(rol) },
      include: {
        atanan: { select: { id: true, adSoyad: true, eposta: true } },
        cozen: { select: { id: true, adSoyad: true } },
        olaylar: { orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, adSoyad: true } } } },
      },
    }));
    if (!kayit) throw new NotFoundException("Düzeltme kaydı bulunamadı");
    return kayit;
  }

  /**
   * BLD-15: `stokDegisimSonrasi` verilirse stok tutarlılığı yalnız o andan beri
   * değişen kartlarda ve açık tutarlılık kaydı olan kartlarda denetlenir
   * (artımlı); verilmezse bütün kartlar (tam). Açık kayıtlı kartlar her zaman
   * denetlendiği için otomatik çözüm kuralı değişmez.
   */
  async tara(secenek: { stokDegisimSonrasi?: Date } = {}) {
    const { tenantId } = aktifBaglam();
    // BLD-16: her dedektör kendi kısa okuma işleminde, en çok OKUMA_ESZAMANLI tanesi aynı anda; yazma
    // ayrı kısa işlemlerle parça parça. (Varsayılan READ COMMITTED'da tek işlem de her sorguya ayrı
    // anlık görüntü veriyordu; tutarlılık değişmez.)
    const sira = sinirlayici(OKUMA_ESZAMANLI);
    const oku = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => sira(() => this.prisma.tenantIslem(tenantId, fn, { timeout: ISLEM_SURESI_MS }));
    const yaz = (fn: (tx: Prisma.TransactionClient) => Promise<void>) => this.prisma.tenantIslem(tenantId, fn, { timeout: ISLEM_SURESI_MS });
    const sonuc = await (async () => {
      const bugun = new Date(); bugun.setUTCHours(0, 0, 0, 0);
      const [ekstreler, masraflar, kartHarcamalari, posTahsilatlari, ebelgeler, negatifStoklar, sayimlar, vadesiGecenEvraklar, faturalar, alisFaturalari, { stokKartlari, tutarlilik }, tolerans, kurKalemleri] = await Promise.all([
        oku((tx) => tx.bankaEkstreSatir.findMany({ where: { durum: "beklemede" }, select: { id: true, aciklama: true, tutar: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: TARAMA_SINIRI })),
        oku((tx) => tx.masraf.findMany({ where: { durum: "onaylandi", odemeDurumu: { not: "odendi" }, odemeler: { none: {} }, kaynakTur: { not: "pazaryeri_kesinti" } }, select: { id: true, belgeNo: true, saticiUnvan: true, toplam: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: TARAMA_SINIRI })),
        oku((tx) => tx.krediKartiHareket.findMany({ where: { tenantId, tip: "harcama", masrafOdemesi: null, faturaId: null }, select: { id: true, aciklama: true, tutar: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: TARAMA_SINIRI })),
        oku((tx) => tx.posTahsilat.findMany({ where: { durum: "odendi", hareketId: null }, select: { id: true, tutar: true, saglayiciOdemeId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: TARAMA_SINIRI })),
        oku((tx) => tx.ebelgeKayit.findMany({ where: { OR: [yerlesmisHataKosulu(), takiliRezervasyonKosulu()] }, select: { id: true, faturaId: true, durum: true, hataMesaji: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: TARAMA_SINIRI })),
        oku((tx) => tx.stokDepoBakiye.findMany({ where: { mevcutMiktar: { lt: 0 } }, select: { id: true, mevcutMiktar: true, stok: { select: { kod: true, ad: true } }, depo: { select: { ad: true } } }, orderBy: [{ mevcutMiktar: "asc" }, { id: "asc" }], take: TARAMA_SINIRI })),
        oku((tx) => tx.sayim.findMany({ where: { durum: "taslak" }, select: { id: true, tarih: true, aciklama: true, depo: { select: { ad: true } }, kalemler: { select: { sistemMiktar: true, fiiliMiktar: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: TARAMA_SINIRI })),
        oku((tx) => tx.cekSenet.findMany({ where: { vadeTarihi: { lt: bugun }, durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi", "ciro_edildi", "verildi"] } }, select: { id: true, portfoyNo: true, vadeTarihi: true, tutar: true, durum: true }, orderBy: [{ vadeTarihi: "asc" }, { id: "asc" }], take: TARAMA_SINIRI })),
        oku((tx) => tx.fatura.findMany({ where: { durum: "kesin" }, select: { id: true, no: true, durum: true, genelToplam: true, ...FATURA_ODEME_SECIMI }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: TARAMA_SINIRI })),
        // SAT-11: kaynağı olan kesin alış faturaları üçlü eşleştirmeye girer.
        oku((tx) => tx.fatura.findMany({
          where: { tip: "alis", durum: "kesin", zincirBelgeleri: { some: { durum: { not: "iptal" } } } },
          select: {
            id: true,
            no: true,
            satirlar: { select: { stokId: true, miktar: true, birimFiyat: true, stok: { select: { kod: true } } } },
            zincirBelgeleri: {
              where: { durum: { not: "iptal" } },
              select: {
                tur: true,
                satirlar: { select: { stokId: true, miktar: true, birimFiyat: true, stok: { select: { kod: true } }, kaynakSatir: { select: { birimFiyat: true } } } },
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: TARAMA_SINIRI,
        })),
        // STK-39: bakiye–hareket uyumu (tutarlılık denetiminin otomatik hâli), kart başına tek kayıt.
        oku(async (tx) => {
          let stokKartlari: string[] | undefined;
          if (secenek.stokDegisimSonrasi) {
            const acikTutarlilik = await tx.duzeltmeKaydi.findMany({
              where: { nedenKodu: { in: ["STOK_BAKIYE_FARKI", "VARYANTSIZ_HAREKET"] }, durum: { in: ["acik", "incelemede", "beklemede"] }, tekillikAnahtari: { not: null } },
              select: { kaynakRef: true },
            });
            stokKartlari = [...new Set([...(await degisenStokKartlari(tx, secenek.stokDegisimSonrasi)), ...acikTutarlilik.map((k) => k.kaynakRef)])];
          }
          return { stokKartlari, tutarlilik: await stokTutarlilikHesapla(tx, stokKartlari) };
        }),
        oku((tx) => this.ayarlar.getir("satin_alma", tx)),
        oku((tx) => kurFarkiKalemleri(tx, tenantId, { durum: "bekleyen" })),
      ]);
      // BLD-13: sınıra ulaşan kaynağın fazlası görülmedi; o kaynağın neden kodları bu turda otomatik çözülmez.
      const kesikKaynaklar = KAYNAK_KODLARI.filter((_, i) => [ekstreler, masraflar, kartHarcamalari, posTahsilatlari, ebelgeler, negatifStoklar, sayimlar, vadesiGecenEvraklar, faturalar, alisFaturalari][i].length >= TARAMA_SINIRI);
      const kesikKodlar = new Set(kesikKaynaklar.flatMap((k) => k.kodlar));
      const farkliKartlar = kartBazinda(tutarlilik.farklar);
      const eslesmeFarklari = alisFaturalari.flatMap((fatura) => {
        const farklar = ucluEslestir({
          faturaSatirlari: fatura.satirlar.map((s) => ({ stokId: s.stokId, stokKod: s.stok.kod, miktar: Number(s.miktar), birimFiyat: Number(s.birimFiyat) })),
          belgeler: fatura.zincirBelgeleri.map((b) => ({
            tur: b.tur as "siparis" | "irsaliye",
            satirlar: b.satirlar.map((s) => ({
              stokId: s.stokId,
              stokKod: s.stok.kod,
              miktar: Number(s.miktar),
              birimFiyat: Number(s.birimFiyat),
              siparisBirimFiyati: s.kaynakSatir ? Number(s.kaynakSatir.birimFiyat) : null,
            })),
          })),
          miktarToleransYuzde: Number(tolerans.miktarToleransYuzde ?? VARSAYILAN_TOLERANS_YUZDE),
          fiyatToleransYuzde: Number(tolerans.fiyatToleransYuzde ?? VARSAYILAN_TOLERANS_YUZDE),
        });
        return farklar.length > 0 ? [{ fatura, farklar }] : [];
      });
      const odemesiAsanFaturalar = faturalar.flatMap((fatura) => {
        // Yeni ödemeler kalan kadar mahsup edilir; aşım yalnız eski kayıtlarda kalabilir.
        const odenen = Number(faturaOdemeDurumu(fatura).odenen);
        return odenen > Number(fatura.genelToplam) + 0.01 ? [{ ...fatura, odenen }] : [];
      });
      // KSB-30: faturalanmamış/kapatılmamış kur farkları, cari başına tek kayıt.
      const kurFarklari = new Map<string, { unvan: string; adet: number; toplam: number }>();
      for (const k of kurKalemleri) {
        const c = kurFarklari.get(k.cari.id) ?? { unvan: k.cari.unvan, adet: 0, toplam: 0 };
        c.adet++; c.toplam += Math.abs(Number(k.kurFarkiTry));
        kurFarklari.set(k.cari.id, c);
      }
      const farkliTaslakSayimlar = sayimlar.flatMap((sayim) => {
        const farkliKalem = sayim.kalemler.filter((kalem) => !kalem.fiiliMiktar.equals(kalem.sistemMiktar));
        return farkliKalem.length ? [{ ...sayim, farkliKalem: farkliKalem.length }] : [];
      });
      const tespitler: Tespit[] = [
        ...ekstreler.map((satir) => ({ tur: "banka_ekstre" as const, onem: "uyari" as const, kaynakTur: "banka_ekstre_satiri", kaynakRef: satir.id, nedenKodu: "ESLESMEMIS_EKSTRE", aciklama: `${satir.aciklama} (${satir.tutar.toString()} TRY) eşleştirme bekliyor.`, onerilenEylem: "Satırı cari veya faturayla eşleştirin ya da güvenle yoksayın." })),
        ...masraflar.map((masraf) => ({ tur: "masraf" as const, onem: "uyari" as const, kaynakTur: "masraf", kaynakRef: masraf.id, nedenKodu: "ODEME_BAGLANTISI_YOK", aciklama: `${masraf.belgeNo || masraf.saticiUnvan || "Onaylı masraf"} için ${masraf.toplam.toString()} tutarında ödeme bağlantısı yok.`, onerilenEylem: "Masrafa kasa, banka veya kredi kartı ödemesi bağlayın." })),
        ...kartHarcamalari.map((hareket) => ({ tur: "kredi_karti" as const, onem: "uyari" as const, kaynakTur: "kredi_karti_hareketi", kaynakRef: hareket.id, nedenKodu: "BELGESIZ_KART_HARCAMASI", aciklama: `${hareket.aciklama} kart harcamasının ${hareket.tutar.toString()} tutarı bir masraf veya faturaya bağlı değil.`, onerilenEylem: "Kart harcamasını masraf belgesiyle ilişkilendirin." })),
        ...posTahsilatlari.map((tahsilat) => ({ tur: "pos" as const, onem: "kritik" as const, kaynakTur: "pos_tahsilat", kaynakRef: tahsilat.id, nedenKodu: "POS_FINANS_HAREKETI_EKSIK", aciklama: `${tahsilat.saglayiciOdemeId || tahsilat.id} referanslı ${tahsilat.tutar.toString()} POS tahsilatının finans hareketi yok.`, onerilenEylem: "Sağlayıcı sonucunu doğrulayın ve tahsilat hareketini idempotent olarak yeniden oluşturun." })),
        ...ebelgeler.map((belge) => ({ tur: "ebelge" as const, onem: belge.durum === "hata" ? "kritik" as const : "uyari" as const, kaynakTur: "ebelge", kaynakRef: belge.faturaId, nedenKodu: belge.durum === "hata" ? "EBELGE_HATALI" : "EBELGE_UZUN_BEKLIYOR", aciklama: belge.hataMesaji || "e-Belge gönderimi yarım kalmış: 15 dakikadır kuyrukta ve entegratöre ulaşmamış.", onerilenEylem: belge.durum === "hata" ? "e-Belge operasyon kuyruğundan hata ayrıntısını inceleyip güvenli yeniden deneme başlatın." : "Faturanın e-Belge panelinden yeniden gönderin; belge entegratörde oluşmuşsa yeniden gönderilmez, benimsenir." })),
        ...negatifStoklar.map((bakiye) => ({ tur: "stok" as const, onem: "kritik" as const, kaynakTur: "stok_depo_bakiyesi", kaynakRef: bakiye.id, nedenKodu: "NEGATIF_STOK", aciklama: `${bakiye.stok.kod} · ${bakiye.stok.ad}, ${bakiye.depo.ad} deposunda ${bakiye.mevcutMiktar.toString()} bakiyeye düştü.`, onerilenEylem: "Eksik giriş/transfer hareketini düzeltin veya kontrollü sayım farkı onayı oluşturun." })),
        ...farkliKartlar.map(({ stokId, satirlar }) => ({ tur: "stok" as const, onem: "kritik" as const, kaynakTur: "stok_tutarlilik", kaynakRef: stokId, nedenKodu: "STOK_BAKIYE_FARKI", aciklama: `${satirlar[0].kod} · ${satirlar[0].ad}: ${tutarlilikOzeti(satirlar)} hareket toplamıyla uyuşmuyor.`, onerilenEylem: "Stok tutarlılık denetiminde farkları inceleyip onarın; onarım bakiyeyi hareket toplamına eşitler." })),
        ...tutarlilik.dagitilmamis.map((d) => ({ tur: "stok" as const, onem: "uyari" as const, kaynakTur: "stok_tutarlilik", kaynakRef: d.stokId, nedenKodu: "VARYANTSIZ_HAREKET", aciklama: `${d.kod} · ${d.ad}: varyantlı kartta toplam ${Number(d.miktar).toLocaleString("tr-TR")} birimlik hareket bir varyanta bağlı değil; kart toplamı varyant toplamından ayrışıyor.`, onerilenEylem: "Varyantsız hareketi ilgili varyanta elle düzeltme fişiyle taşıyın." })),
        ...farkliTaslakSayimlar.map((sayim) => ({ tur: "stok" as const, onem: "uyari" as const, kaynakTur: "stok_sayim", kaynakRef: sayim.id, nedenKodu: "SAYIM_FARKI_ONAYSIZ", aciklama: `${sayim.depo.ad} deposundaki ${sayim.farkliKalem} sayım farkı henüz onaylanmadı.`, onerilenEylem: "Sayım farklarını inceleyip sayımı onaylayın veya taslağı düzeltin." })),
        ...vadesiGecenEvraklar.map((evrak) => ({ tur: "cek_senet" as const, onem: "uyari" as const, kaynakTur: "cek_senet", kaynakRef: evrak.id, nedenKodu: "VADE_GECTI_DURUM_ACIK", aciklama: `${evrak.portfoyNo} portföy numaralı ${evrak.tutar.toString()} tutarlı evrakın vadesi ${evrak.vadeTarihi.toLocaleDateString("tr-TR")} tarihinde geçti; durumu ${evrak.durum}.`, onerilenEylem: "Tahsilat/ödeme sonucunu kaydedin veya evrak durumunu güncelleyin." })),
        ...eslesmeFarklari.map(({ fatura, farklar }) => ({ tur: "satin_alma" as const, onem: "uyari" as const, kaynakTur: "fatura", kaynakRef: fatura.id, nedenKodu: "UCLU_ESLESME_FARKI", aciklama: `${fatura.no || fatura.id} numaralı alış faturası sipariş ve mal kabulle örtüşmüyor — ${farkAciklamasi(farklar)}.`, onerilenEylem: "Faturayı sipariş ve irsaliyeyle karşılaştırın; fark gerçekse tedarikçiden düzeltme isteyin, kabul ediyorsanız kaydı kapatın." })),
        ...[...kurFarklari].map(([cariId, c]) => ({ tur: "fatura_cari" as const, onem: "uyari" as const, kaynakTur: "cari", kaynakRef: cariId, nedenKodu: "KUR_FARKI_BEKLIYOR", aciklama: `${c.unvan} için ${c.adet} kur farkı (${c.toplam.toFixed(2)} TL) faturalanmadı ya da kapatılmadı.`, onerilenEylem: "Kur Farkları ekranında lehimize farkın faturasını kesin, gelen faturayı eşleştirin ya da yurt dışı/önemsiz farkı kapatın." })),
        ...odemesiAsanFaturalar.map((fatura) => ({ tur: "fatura_cari" as const, onem: "kritik" as const, kaynakTur: "fatura", kaynakRef: fatura.id, nedenKodu: "FATURA_ODEME_TOPLAMI_ASIMI", aciklama: `${fatura.no || fatura.id} numaralı faturada ödeme toplamı ${fatura.odenen.toFixed(2)}, fatura toplamı ${fatura.genelToplam.toString()}.`, onerilenEylem: "Faturaya bağlı tahsilat/ödeme hareketlerini inceleyip fazla veya yinelenen kaydı geri alın." })),
      ];

      const aktifAnahtarlar = new Set(tespitler.map((t) => `${t.nedenKodu}:${t.kaynakTur}:${t.kaynakRef}`));
      // BLD-14: yeni kayıt açılıyor mu? (bildirim taraması kritik düzeltmeyi okur; yalnız yeni/çözülen kayıt firmayı "değişmiş" yapar)
      const bilinenAnahtarlar = new Set<string>();
      const anahtarListesi = [...aktifAnahtarlar];
      for (const parca of parcala(anahtarListesi, 5_000)) {
        for (const k of await oku((tx) => tx.duzeltmeKaydi.findMany({ where: { tekillikAnahtari: { in: parca } }, select: { tekillikAnahtari: true } }))) {
          if (k.tekillikAnahtari) bilinenAnahtarlar.add(k.tekillikAnahtari);
        }
      }
      const yeniKayit = anahtarListesi.filter((a) => !bilinenAnahtarlar.has(a)).length;
      // BLD-16: yazma YAZMA_PARCASI'lık kısa işlemlerle; upsert tekrarlanabilir, yarıda kalan tur sonraki turda tamamlanır.
      for (const parca of parcala(tespitler, YAZMA_PARCASI)) {
        await yaz(async (tx) => {
          for (const tespit of parca) {
            const anahtar = `${tespit.nedenKodu}:${tespit.kaynakTur}:${tespit.kaynakRef}`;
            await tx.duzeltmeKaydi.upsert({
              where: { tenantId_tekillikAnahtari: { tenantId, tekillikAnahtari: anahtar } },
              create: { tenantId, ...tespit, tekillikAnahtari: anahtar, sonTarih: new Date(Date.now() + 24 * 60 * 60 * 1000) },
              update: { ...tespit, sonTespitTarihi: new Date() },
            });
          }
        });
      }

      const mevcutlar = await oku((tx) => tx.duzeltmeKaydi.findMany({ where: { nedenKodu: { in: OTOMATIK_COZULEN_KODLAR }, durum: { in: ["acik", "incelemede", "beklemede"] }, tekillikAnahtari: { not: null } }, select: { id: true, tekillikAnahtari: true, durum: true, nedenKodu: true } }));
      const cozulecek = mevcutlar.filter((kayit) => !(kayit.tekillikAnahtari && aktifAnahtarlar.has(kayit.tekillikAnahtari)) && !kesikKodlar.has(kayit.nedenKodu));
      let otomatikCozulen = 0;
      for (const parca of parcala(cozulecek, YAZMA_PARCASI)) {
        await yaz(async (tx) => {
          for (const kayit of parca) {
            // BLD-16: okuma ile yazma artık ayrı işlem; arada kullanıcı kaydı değiştirdiyse dokunulmaz.
            const { count } = await tx.duzeltmeKaydi.updateMany({ where: { id: kayit.id, durum: kayit.durum, tekillikAnahtari: kayit.tekillikAnahtari }, data: { durum: "cozuldu", cozulmeTarihi: new Date(), tekillikAnahtari: null } });
            if (!count) continue;
            await tx.duzeltmeOlayi.create({ data: { tenantId, duzeltmeKaydiId: kayit.id, oncekiDurum: kayit.durum, yeniDurum: "cozuldu", olayTuru: "otomatik_cozum", aciklama: "Kaynak sorun yeniden taramada bulunamadı." } });
            otomatikCozulen++;
          }
        });
      }
      return { taranan: ekstreler.length + masraflar.length + kartHarcamalari.length + posTahsilatlari.length + ebelgeler.length + negatifStoklar.length + sayimlar.length + vadesiGecenEvraklar.length + faturalar.length + alisFaturalari.length, bulunan: tespitler.length, otomatikCozulen, yeniKayit, kesikKaynaklar: kesikKaynaklar.map((k) => k.kaynak), stokDenetimi: stokKartlari ? { tur: "artimli" as const, kart: stokKartlari.length } : { tur: "tam" as const, kart: tutarlilik.kartSayisi } };
    })();
    // BLD-14: tarama yazımı iz bırakmaz; yeni açılan ya da çözülen kayıt bildirim taraması için gerçek değişimdir.
    if (sonuc.yeniKayit || sonuc.otomatikCozulen) degisimKaydet(tenantId);
    return sonuc;
  }

  async ata(id: string, userId: string | null) {
    const { tenantId, userId: yapan } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.kayitDogrula(tx, id);
      if (userId && !(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new NotFoundException("Atanacak kullanıcı bulunamadı");
      const kayit = await tx.duzeltmeKaydi.update({ where: { id }, data: { atananUserId: userId } });
      await tx.duzeltmeOlayi.create({ data: { tenantId, duzeltmeKaydiId: id, userId: yapan, olayTuru: "atama", aciklama: userId ? "Kayıt kullanıcıya atandı." : "Kayıt ataması kaldırıldı." } });
      return kayit;
    });
  }

  async topluAta(ids: string[], userId: string | null) {
    const { tenantId, userId: yapan } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (userId && !(await tx.user.findFirst({ where: { id: userId, aktif: true, rol: { in: ["yonetici", "muhasebe"] } }, select: { id: true } }))) throw new NotFoundException("Atanacak aktif kullanıcı bulunamadı");
      const kayitlar = await tx.duzeltmeKaydi.findMany({ where: { id: { in: ids }, durum: { in: ["acik", "incelemede", "beklemede"] } }, select: { id: true } });
      if (kayitlar.length !== ids.length) throw new BadRequestException("Seçimde bulunamayan veya kapanmış düzeltme kaydı var");
      await tx.duzeltmeKaydi.updateMany({ where: { id: { in: ids } }, data: { atananUserId: userId } });
      await tx.duzeltmeOlayi.createMany({ data: kayitlar.map((kayit) => ({ tenantId, duzeltmeKaydiId: kayit.id, userId: yapan, olayTuru: "toplu_atama", aciklama: userId ? "Kayıt toplu olarak kullanıcıya atandı." : "Kayıt ataması toplu olarak kaldırıldı." })) });
      return { guncellenen: kayitlar.length };
    });
  }

  async topluYoksay(ids: string[], aciklama: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.duzeltmeKaydi.findMany({ where: { id: { in: ids }, durum: { in: ["acik", "incelemede", "beklemede"] } }, select: { id: true, tur: true, durum: true } });
      if (kayitlar.length !== ids.length) throw new BadRequestException("Seçimde bulunamayan veya kapanmış düzeltme kaydı var");
      if (kayitlar.some((kayit) => kayit.tur !== "banka_ekstre")) throw new BadRequestException("Toplu yoksayma yalnız banka ekstresi bulgularında kullanılabilir");
      const cozulmeTarihi = new Date();
      await tx.duzeltmeKaydi.updateMany({ where: { id: { in: ids } }, data: { durum: "yoksayildi", cozenUserId: userId, cozulmeTarihi, tekillikAnahtari: null } });
      await tx.duzeltmeOlayi.createMany({ data: kayitlar.map((kayit) => ({ tenantId, duzeltmeKaydiId: kayit.id, userId, oncekiDurum: kayit.durum, yeniDurum: "yoksayildi", olayTuru: "toplu_yoksayma", aciklama })) });
      return { guncellenen: kayitlar.length };
    });
  }

  async notEkle(id: string, aciklama: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.kayitDogrula(tx, id);
      return tx.duzeltmeOlayi.create({ data: { tenantId, duzeltmeKaydiId: id, userId, olayTuru: "not", aciklama } });
    });
  }

  async durumDegistir(id: string, durum: Exclude<DuzeltmeDurumu, "acik" | "cozuldu">, aciklama?: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const onceki = await this.kayitDogrula(tx, id);
      if (onceki.durum === "cozuldu" || onceki.durum === "yoksayildi") throw new BadRequestException("Kapanmış düzeltme kaydının durumu değiştirilemez");
      const kapali = durum === "yoksayildi";
      const kayit = await tx.duzeltmeKaydi.update({ where: { id }, data: { durum, ...(kapali ? { cozenUserId: userId, cozulmeTarihi: new Date(), tekillikAnahtari: null } : {}) } });
      await tx.duzeltmeOlayi.create({ data: { tenantId, duzeltmeKaydiId: id, userId, oncekiDurum: onceki.durum, yeniDurum: durum, olayTuru: "durum", aciklama } });
      return kayit;
    });
  }

  private async kayitDogrula(tx: Prisma.TransactionClient, id: string) {
    const kayit = await tx.duzeltmeKaydi.findUnique({ where: { id }, select: { id: true, durum: true } });
    if (!kayit) throw new NotFoundException("Düzeltme kaydı bulunamadı");
    return kayit;
  }

  private rolKapsami(rol: string): Prisma.DuzeltmeKaydiWhereInput {
    if (rol === "mali_musavir") return { tur: "fatura_cari" };
    if (rol === "salt_okunur") return { tur: { in: ["banka_ekstre", "kredi_karti", "pos", "stok", "cek_senet", "fatura_cari"] } };
    return {};
  }
}
