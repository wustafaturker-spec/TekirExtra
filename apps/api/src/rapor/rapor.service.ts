import { fifoDegerleri, satisSatirlari } from "../stok/satis-ozeti";
import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { kategoriOzeti, toplam } from "./tahakkuk";
import { karZararHesapla, karZararVerisi } from "./kar-zarar";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { cariBakiyeToplamlari, envanterDegerlemesi } from "./varlik-ozeti";
import { faturaPivotDetayi, faturaPivotu, pivotSorgusuCoz } from "./fatura-pivot";
import { maliyetEksigiSorgusu, maliyetEksikleriniOku } from "./maliyet-eksikleri";
import { maliyetEksikleriExcelYaz } from "./maliyet-eksikleri-excel";
import { maliyetTakibiBaslat, maliyetTakibiGuncelle, maliyetTakibiniOku, maliyetTakipGirdisi, maliyetTakipId } from "./maliyet-takibi";
import { maliyetDogrulamasiniOku, maliyetIncelemesiniKapat, maliyetKapatmaGirdisi } from "./maliyet-dogrulama";
import { maliyetErisiminiDogrula } from "./maliyet-erisim";
import { maliyetIzlemeSorgusu, maliyetIzlemesiniOku } from "./maliyet-izleme";
import { eksikTahminleriTamamla, isabetSatirlari } from "../cari/tahmin-isabeti-kaynak";
import { isabetOzeti } from "../cari/tahmin-isabeti";
import { baglanmamisOdemeler } from "../kasa-banka/baglanmamis-odeme";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

@Injectable()
export class RaporService {
  constructor(private readonly prisma: PrismaService) {}

  async maliyetIzleme(sorgu: Record<string, unknown>) {
    const { tenantId } = aktifBaglam(), q = maliyetIzlemeSorgusu(sorgu);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const { mod } = await maliyetErisiminiDogrula(tx);
      const [olcum] = await tx.$queryRaw<{ zaman: Date }[]>`SELECT transaction_timestamp() AS zaman`;
      const veri = await maliyetIzlemesiniOku(tx, tenantId, q);
      const firma = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { id: true, unvan: true } });
      return { surum: 1, olcumTuru: "anlik", firma, baslangic: q.baslangic, bitis: q.bitis,
        kullanimModu: mod, alindigiZaman: olcum.zaman.toISOString(), ...veri };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async maliyetDogrulamasi(id: string) {
    const { tenantId } = aktifBaglam(); maliyetTakipId(id);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await maliyetErisiminiDogrula(tx);
      return maliyetDogrulamasiniOku(tx, tenantId, id);
    });
  }
  async maliyetIncelemesiniKapat(id: string, govde: unknown) {
    const { tenantId, userId } = aktifBaglam(); maliyetTakipId(id);
    const g = maliyetKapatmaGirdisi(govde);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await maliyetErisiminiDogrula(tx, true);
      return maliyetIncelemesiniKapat(tx, tenantId, userId, id, g);
    });
  }

  async maliyetTakibi(id: string) {
    const { tenantId } = aktifBaglam();
    maliyetTakipId(id);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await maliyetErisiminiDogrula(tx);
      return { kayit: await maliyetTakibiniOku(tx, tenantId, id) };
    });
  }
  async maliyetTakibiKaydet(id: string, govde: unknown, guncelle = false) {
    const { tenantId, userId } = aktifBaglam();
    maliyetTakipId(id);
    const girdi = maliyetTakipGirdisi(govde, guncelle);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await maliyetErisiminiDogrula(tx, true);
      return guncelle
        ? maliyetTakibiGuncelle(tx, tenantId, userId, id, girdi)
        : maliyetTakibiBaslat(tx, tenantId, userId, id, girdi.aciklama);
    });
  }

  async maliyetEksikleriExcel(sorgu: Record<string, unknown>) {
    const { tenantId } = aktifBaglam();
    const q = maliyetEksigiSorgusu(sorgu);
    const { veri, firma } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      await maliyetErisiminiDogrula(tx);
      return {
        veri: await maliyetEksikleriniOku(tx, tenantId, q, "tum"),
        firma: (await tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }))?.unvan ?? "",
      };
    });
    return { dosya: await maliyetEksikleriExcelYaz(veri, q, firma), dosyaAdi: `maliyet-kontrolu_${q.baslangic}_${q.bitis}.xlsx` };
  }

  async maliyetEksikleri(sorgu: Record<string, unknown>) {
    const { tenantId, rol } = aktifBaglam();
    const q = maliyetEksigiSorgusu(sorgu);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const erisim = await maliyetErisiminiDogrula(tx);
      const veri = await maliyetEksikleriniOku(tx, tenantId, q);
      return { ...veri, kullanimModu: erisim.mod, izinler: { fatura: rol !== "maliyet_muhasebesi", stok: rol !== "mali_musavir", onizleme: rol === "yonetici" && erisim.takipYazma, takipYazma: erisim.takipYazma } };
    });
  }

  // Kar-zarar analizi RPR-06 araç setine taşındı: fatura.kar-marji (FTR-15).

  // ─── FATURA PİVOTU (RPR-14) ───────────────────────────────────────────────

  async faturaPivotu(sorgu: Record<string, string | undefined>) {
    const { tenantId } = aktifBaglam();
    const q = pivotSorgusuCoz(sorgu);
    return this.prisma.tenantIslem(tenantId, (tx) => faturaPivotu(tx, tenantId, q));
  }

  async faturaPivotDetayi(sorgu: Record<string, string | undefined>) {
    const { tenantId } = aktifBaglam();
    const q = pivotSorgusuCoz(sorgu);
    if (sorgu.satirAnahtari === undefined) throw new BadRequestException("satirAnahtari zorunlu");
    return this.prisma.tenantIslem(tenantId, (tx) => faturaPivotDetayi(tx, tenantId, q, sorgu.satirAnahtari!, sorgu.sutunAnahtari));
  }

  // ─── FİNANSAL DURUM ÖZETİ (RPR-01/04) ─────────────────────────────────────

  async finansalOzet() {
    const { tenantId } = aktifBaglam();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // 1. Kasa ve Banka Toplam Bakiyesi (TRY Karşılığı)
      const hareketler = await tx.kasaBankaHareket.groupBy({
        by: ["tip"],
        where: { tenantId },
        _sum: { tutarTry: true },
      });

      let kasaBankaBorc = D(0);
      let kasaBankaAlacak = D(0);

      hareketler.forEach((h) => {
        const sumVal = D(h._sum.tutarTry ?? 0);
        if (h.tip === "tahsilat" || h.tip === "virman_gelis") {
          kasaBankaBorc = kasaBankaBorc.add(sumVal);
        } else {
          kasaBankaAlacak = kasaBankaAlacak.add(sumVal);
        }
      });

      const nakitVarliklar = kasaBankaBorc.sub(kasaBankaAlacak);

      // 2–3. RPR-15: stok değeri ve cari bakiyeleri veritabanında toplanır.
      const envanter = await envanterDegerlemesi(tx, tenantId);
      const cari = await cariBakiyeToplamlari(tx, tenantId);
      const envanterDegeri = envanter.deger;
      const toplamAlacaklar = cari.alacaklar;
      const toplamBorclar = cari.borclar;

      return {
        nakitVarliklar: nakitVarliklar.toFixed(2),
        envanterDegeri: envanterDegeri.toFixed(2),
        toplamAlacaklar: toplamAlacaklar.toFixed(2),
        toplamBorclar: toplamBorclar.toFixed(2),
        netVarlikDegeri: nakitVarliklar
          .add(envanterDegeri)
          .add(toplamAlacaklar)
          .sub(toplamBorclar)
          .toFixed(2),
        eksiStokSayisi: envanter.eksiStokSayisi,
        kurEksik: cari.kurEksik,
      };
    });
  }

  async gunlukOzet(tarihMetni?: string) {
    const tarih = tarihMetni && /^\d{4}-\d{2}-\d{2}$/.test(tarihMetni)
      ? new Date(`${tarihMetni}T00:00:00.000Z`)
      : new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
    const tarihIso = tarih.toISOString().slice(0, 10);
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [satislar, hareketler, cekler] = await Promise.all([
        tx.fatura.findMany({
          where: { tenantId, tarih, durum: "kesin", tip: { in: ["satis", "satis_iade"] } },
          select: { id: true, no: true, tarih: true, tip: true, genelToplam: true, dovizCinsi: true, kur: true, cari: { select: { unvan: true } } },
          orderBy: { createdAt: "desc" },
        }),
        tx.kasaBankaHareket.findMany({
          // P1-9: açılış fişi bakiye devridir, günün tahsilatı değildir.
          where: { tenantId, tarih, tip: "tahsilat", kaynakTur: { not: "acilis" } },
          select: { id: true, tarih: true, tutar: true, tutarTry: true, dovizCinsi: true, aciklama: true, kaynakTur: true, kaynakRef: true, kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true } }, posHesap: { select: { ad: true } }, cari: { select: { unvan: true } }, fatura: { select: { id: true, no: true } } },
          orderBy: { createdAt: "desc" },
        }),
        tx.cekSenet.findMany({
          where: { tenantId, islemTarihi: tarih, yon: "alinan", durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi", "tahsil_edildi"] } },
          select: { id: true, tur: true, portfoyNo: true, tutar: true, tutarTry: true, dovizCinsi: true, borclu: true, cari: { select: { unvan: true } } },
        }),
      ]);
      const satisTry = satislar.reduce((toplam, fatura) => toplam.add(fatura.genelToplam.mul(fatura.kur)), D(0));
      const hareketKaynaklari = new Set(hareketler.map((h) => h.kaynakRef).filter(Boolean));
      const yeniCekler = cekler.filter((cek) => !hareketKaynaklari.has(cek.id));
      const tahsilatTry = hareketler.reduce((toplam, hareket) => toplam.add(hareket.tutarTry), D(0)).add(yeniCekler.reduce((toplam, cek) => toplam.add(cek.tutarTry), D(0)));
      return {
        tarih: tarihIso,
        satis: { toplam: satisTry.toFixed(2), adet: satislar.length },
        tahsilat: { toplam: tahsilatTry.toFixed(2), adet: hareketler.length + yeniCekler.length },
        tahsilatlar: [...hareketler.map((h) => ({ ...h, hesap: h.kasa?.ad ?? h.bankaHesap?.ad ?? h.posHesap?.ad ?? "Diğer", tutar: h.tutar.toFixed(2), tutarTry: h.tutarTry.toFixed(2) })), ...yeniCekler.map((cek) => ({ id: cek.id, tarih, tutar: cek.tutar.toFixed(2), tutarTry: cek.tutarTry.toFixed(2), dovizCinsi: cek.dovizCinsi, aciklama: `${cek.tur.toUpperCase()} tahsilatı · ${cek.portfoyNo}`, kaynakTur: "cek_senet", hesap: "Çek / Senet", cari: cek.cari, fatura: null }))],
      };
    });
  }

  /**
   * CARI-49: tahmini gecikmenin isabeti. Kaydı olmayan geçmiş faturaların
   * tahmini önce geriye dönük üretilir; ölçüm son 12 ayda kapanan faturalardır.
   */
  async tahminIsabeti() {
    const { tenantId } = aktifBaglam();
    const bugun = new Date();
    const baslangic = new Date(Date.UTC(bugun.getUTCFullYear() - 1, bugun.getUTCMonth(), bugun.getUTCDate()));
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await eksikTahminleriTamamla(tx, tenantId);
      const satirlar = await isabetSatirlari(tx);
      const ozet = isabetOzeti(satirlar, baslangic);
      const cariGruplari = new Map<string, typeof satirlar>();
      for (const s of satirlar) cariGruplari.set(s.cariId, [...(cariGruplari.get(s.cariId) ?? []), s]);
      const adaylar = [...cariGruplari].map(([cariId, l]) => ({ cariId, ...isabetOzeti(l, baslangic) })).filter((c) => c.ornek >= 3);
      adaylar.sort((a, b) => (b.ortalamaMutlakSapma ?? 0) - (a.ortalamaMutlakSapma ?? 0));
      const enCokSapan = adaylar.slice(0, 10);
      const unvanlar = new Map((await tx.cariHesap.findMany({ where: { id: { in: enCokSapan.map((c) => c.cariId) } }, select: { id: true, unvan: true } })).map((c) => [c.id, c.unvan]));
      return {
        baslangic: baslangic.toISOString().slice(0, 10),
        ozet,
        enCokSapan: enCokSapan.map((c) => ({ cariId: c.cariId, unvan: unvanlar.get(c.cariId) ?? "", ornek: c.ornek, ortalamaSapma: c.ortalamaSapma, ortalamaMutlakSapma: c.ortalamaMutlakSapma })),
      };
    });
  }

  /** Vadesi geçmiş, halen açık satış ve alış faturaları (panel özeti). */
  async vadesiGecenler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => vadesiGecenleriHesapla(tx, tenantId));
  }

  /**
   * Satılan Malın Maliyeti (SMM - COGS) ve Brüt Kar Analizi.
   * Metotlar: 'agirlikli_ortalama' veya 'fifo'.
   */
  /**
   * STK-32: satılan malın maliyeti ve brüt kâr. Ciro satır matrahı × kurdan,
   * miktar ve maliyet faturanın stok hareketlerinden; satış iadeleri eksi.
   * FIFO, ürünün bütün hareketlerinden kurulan kuyrukla değerlenir.
   */
  async smmAnalizi(yontem: "agirlikli_ortalama" | "fifo" = "agirlikli_ortalama", baslangic?: string, bitis?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const satirlar = await satisSatirlari(tx, { ...(baslangic && { gte: new Date(baslangic) }), ...(bitis && { lte: new Date(bitis) }) });
      let fifo: Map<string, Prisma.Decimal> | null = null;
      const urunSatirlari = new Map<string, typeof satirlar>();
      for (const s of satirlar) { const l = urunSatirlari.get(s.stokId); if (l) l.push(s); else urunSatirlari.set(s.stokId, [s]); }
      if (yontem === "fifo" && satirlar.length) {
        // RPR-30 (inceleme P2-2): ürün başına ayrı sorgu yerine 200'lük parçalar;
        // bitişten sonraki hareketler dönemdeki çıkışların FIFO değerini etkilemez.
        fifo = new Map();
        const urunler = [...urunSatirlari.keys()];
        for (let i = 0; i < urunler.length; i += 200) {
          const hareketler = await tx.stokHareket.findMany({
            where: { stokId: { in: urunler.slice(i, i + 200) }, ...(bitis && { tarih: { lte: new Date(bitis) } }) },
            orderBy: [{ stokId: "asc" }, { tarih: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            select: { id: true, stokId: true, miktar: true, maliyet: true },
          });
          const urunHareketleri = new Map<string, typeof hareketler>();
          for (const h of hareketler) { const l = urunHareketleri.get(h.stokId); if (l) l.push(h); else urunHareketleri.set(h.stokId, [h]); }
          for (const liste of urunHareketleri.values()) for (const [id, deger] of fifoDegerleri(liste)) fifo.set(id, deger);
        }
      }
      // FIFO: satışın değeri çıkış hareketlerinin FIFO değeri; iade, aynı ürünün dönemdeki
      // FIFO birim maliyetiyle geri alınır (ortalamayla alınsa iki yöntem karışır).
      const fifoSatis = (s: (typeof satirlar)[number]) => s.hareketPaylari.reduce((t, p) => t.add((fifo!.get(p.hareketId) ?? D(0)).mul(p.oran)), D(0)).toDecimalPlaces(2);
      const fifoBirim = new Map<string, Prisma.Decimal>();
      if (fifo) for (const [stokId, urunun] of urunSatirlari) {
        const satislar = urunun.filter((s) => s.tip === "satis");
        const adet = satislar.reduce((t, s) => t.add(s.miktar), D(0));
        if (adet.gt(0)) fifoBirim.set(stokId, satislar.reduce((t, s) => t.add(fifoSatis(s)), D(0)).div(adet));
      }
      let toplamSatisCirosu = D(0), toplamSmmMaliyeti = D(0);
      const detaylar = satirlar.map((s) => {
        const maliyet = !fifo ? s.maliyet
          : s.tip === "satis" ? fifoSatis(s)
          : fifoBirim.has(s.stokId) ? s.miktar.mul(fifoBirim.get(s.stokId)!).toDecimalPlaces(2) : s.maliyet;
        toplamSatisCirosu = toplamSatisCirosu.add(s.ciro);
        toplamSmmMaliyeti = toplamSmmMaliyeti.add(maliyet);
        const kar = s.ciro.sub(maliyet);
        return {
          faturaId: s.faturaId,
          faturaNo: s.faturaNo || "Numarasız", // RPR-20: yalnız kesin faturalar gelir; numarasız = e-Belge gönderilmemiş, taslak değil
          tarih: s.tarih.toISOString().slice(0, 10),
          tip: s.tip,
          stokKod: s.kod,
          stokAd: s.ad,
          cariUnvan: s.cariUnvan,
          satilanMiktar: s.miktar.toNumber(),
          satisNetTutar: s.ciro.toNumber(),
          birimMaliyet: s.miktar.isZero() ? 0 : maliyet.div(s.miktar).toDecimalPlaces(4).toNumber(),
          toplamMaliyet: maliyet.toNumber(),
          karTutar: kar.toNumber(),
          karMarjiYuzde: s.ciro.isZero() ? 0 : kar.div(s.ciro).mul(100).toDecimalPlaces(2).toNumber(),
        };
      });
      const brutKar = toplamSatisCirosu.sub(toplamSmmMaliyeti);
      return {
        yontem, baslangic: baslangic ?? null, bitis: bitis ?? null,
        toplamSatisCirosu: toplamSatisCirosu.toFixed(2),
        toplamSmmMaliyeti: toplamSmmMaliyeti.toFixed(2),
        brutKar: brutKar.toFixed(2),
        genelKarMarjiYuzde: toplamSatisCirosu.gt(0) ? brutKar.div(toplamSatisCirosu).mul(100).toDecimalPlaces(2).toNumber() : 0,
        detaylar,
      };
    });
  }

  /**
   * Tarihler arası gelir-gider raporu (BUT-01…BUT-04): tahakkuk esaslı, KDV
   * hariç ve yalnız belgelerden. Hesap `tahakkuk.ts`'te; bütçenin gerçekleşeni
   * de aynı fonksiyonu kullanır. Mevcut stok değeri bilgi olarak döner, gelire
   * ve net farka katılmaz.
   */
  async gelirGiderRaporu(baslangicMetni?: string, bitisMetni?: string) {
    const { tenantId } = aktifBaglam();

    const simdi = new Date();
    const baslangic = baslangicMetni && /^\d{4}-\d{2}-\d{2}$/.test(baslangicMetni)
      ? new Date(`${baslangicMetni}T00:00:00.000Z`)
      : new Date(Date.UTC(simdi.getFullYear(), simdi.getMonth(), 1));
    const bitis = bitisMetni && /^\d{4}-\d{2}-\d{2}$/.test(bitisMetni)
      ? new Date(`${bitisMetni}T23:59:59.999Z`)
      : new Date(Date.UTC(simdi.getFullYear(), simdi.getMonth() + 1, 0, 23, 59, 59, 999));

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const { kalemler, satirlar, uyarilar } = await karZararVerisi(tx, tenantId, baslangic, bitis);
      // RPR-12: net kâr SMM bazlı (tek tanım); netFark alış bazlı gelir − gider farkıdır.
      const karZarar = karZararHesapla(kalemler, satirlar);

      // Yalnız bilgi: stok bir varlıktır, dönem geliri değildir (BUT-04).
      const envanter = await envanterDegerlemesi(tx, tenantId);

      const kalem = (kosul: (anahtar: string) => boolean) => toplam(kalemler, (k) => kosul(k.anahtar)).toFixed(2);
      const toplamGelir = toplam(kalemler, (k) => k.tur === "gelir");
      const toplamGider = toplam(kalemler, (k) => k.tur === "gider");
      const netFark = Math.round((toplamGelir - toplamGider) * 100) / 100;

      return {
        baslangicTarihi: baslangic.toISOString().slice(0, 10),
        bitisTarihi: bitis.toISOString().slice(0, 10),
        ozet: {
          satisHasilati: kalem((a) => a === "satis:ticari_satis"),
          faaliyetDisiGelirler: kalem((a) => (a.startsWith("satis:") && a !== "satis:ticari_satis") || a.startsWith("gelir_kategori:")),
          alisIadeleri: kalem((a) => a === "alis_iadesi"),
          toplamGelir: toplamGelir.toFixed(2),
          alisMaliyeti: kalem((a) => a === "mal_alis"),
          hizmetAlislari: kalem((a) => a === "hizmet_alis"),
          masrafGiderleri: kalem((a) => a.startsWith("masraf_kategori:")),
          personelGiderleri: kalem((a) => a === "personel"),
          satisIadeleri: kalem((a) => a === "satis_iadesi"),
          toplamGider: toplamGider.toFixed(2),
          netFark: netFark.toFixed(2),
          karMarjiYuzde: toplamGelir > 0 ? Number(((netFark / toplamGelir) * 100).toFixed(2)) : 0,
          mevcutStokDegeri: envanter.deger.toFixed(2),
          eksiStokSayisi: envanter.eksiStokSayisi,
        },
        karZarar,
        gelirKategorileri: kategoriOzeti(kalemler, "gelir"),
        giderKategorileri: kategoriOzeti(kalemler, "gider"),
        kalemler: kalemler.map((k) => ({ ...k, tutarTry: k.tutarTry.toFixed(2), tutar: k.tutar.toFixed(2) })),
        uyarilar: [
          ...uyarilar,
          ...(karZarar.maliyetsizSatis.satir
            ? [`${karZarar.maliyetsizSatis.satir} mal satış satırının maliyeti kayıtlı değil (${karZarar.maliyetsizSatis.ciro.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL ciro); brüt kâr bu tutar kadar yüksek görünebilir.`]
            : []),
        ],
      };
    });
  }
}

/**
 * RPR-17: vadesi geçmiş satış/alış faturaları (kalan TL karşılığıyla). Rapor ve
 * bildirim taraması aynı tanımı kullanır; taramada çağıran kendi işlemini verir.
 */
export async function vadesiGecenleriHesapla(tx: Prisma.TransactionClient, tenantId: string, secenek: { yalnizOzet?: boolean } = {}) {
  const bugun = new Date();
  const bugunBaslangic = new Date(Date.UTC(bugun.getUTCFullYear(), bugun.getUTCMonth(), bugun.getUTCDate()));
  // RPR-17 (inceleme P2-2): eskiden en eski 200 fatura alınıp ödenmişler
  // sonradan eleniyordu; 200'den fazla vadesi geçmiş faturada toplam ve sayı
  // eksik kalıyordu. Şimdi hepsi 500'erli sayfalarla taranır; toplam ve
  // sayı tamdır, listeler en eski LISTE_SINIRI kayıtla sınırlıdır.
  const LISTE_SINIRI = 50;
  type Satir = { faturaId: string; no: string | null; cariId: string; cariUnvan: string; vadeTarihi: string; gecikmeGun: number; kalanTry: string; tip: string };
  const alacaklar: Satir[] = [], borclar: Satir[] = [];
  let toplamAlacak = D(0), toplamBorc = D(0), alacakSayisi = 0, borcSayisi = 0;
  let imlec: string | undefined;
  for (;;) {
    const faturalar = await tx.fatura.findMany({
      // Vadesiz fatura fatura tarihinde vadesi gelmiş sayılır (yaşlandırma, vade hatırlatma ve tahsilat riskiyle aynı kural).
      where: { tenantId, durum: "kesin", tip: { in: ["satis", "alis"] }, OR: [{ vadeTarihi: { lt: bugunBaslangic } }, { vadeTarihi: null, tarih: { lt: bugunBaslangic } }] },
      orderBy: { id: "asc" }, take: 500, ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
      select: { id: true, no: true, tip: true, tarih: true, vadeTarihi: true, genelToplam: true, kur: true, cari: { select: { id: true, unvan: true } }, durum: true, ...FATURA_ODEME_SECIMI },
    });
    for (const f of faturalar) {
      const kalanTry = faturaOdemeDurumu(f).kalan.mul(f.kur).toDecimalPlaces(2);
      if (!kalanTry.gt(0)) continue;
      const vade = f.vadeTarihi ?? f.tarih;
      const gecikmeGun = Math.max(1, Math.floor((bugunBaslangic.getTime() - vade.getTime()) / 86_400_000));
      const satir = { faturaId: f.id, no: f.no, cariId: f.cari.id, cariUnvan: f.cari.unvan, vadeTarihi: vade.toISOString().slice(0, 10), gecikmeGun, kalanTry: kalanTry.toFixed(2), tip: f.tip };
      if (f.tip === "satis") { toplamAlacak = toplamAlacak.add(kalanTry); alacakSayisi++; alacaklar.push(satir); }
      else { toplamBorc = toplamBorc.add(kalanTry); borcSayisi++; borclar.push(satir); }
    }
    if (faturalar.length < 500) break;
    imlec = faturalar[faturalar.length - 1].id;
  }
  // Vade veritabanında boş olabildiği için en eskiler hesaplanan vadeyle seçilir.
  const enEskiler = (l: Satir[]) => l.sort((a, b) => a.vadeTarihi.localeCompare(b.vadeTarihi) || a.faturaId.localeCompare(b.faturaId)).slice(0, LISTE_SINIRI);
  // KSB-23: faturası vadesi geçmiş görünen cari aslında faturaya bağlanmamış bir ödemeyle ödemiş olabilir.
  const baglanmamisEkle = async (l: Satir[], tip: "tahsilat" | "tediye") => {
    const harita = await baglanmamisOdemeler(tx, [...new Set(l.map((s) => s.cariId))], tip);
    return l.map((s) => ({ ...s, baglanmamisOdemeTry: harita.get(s.cariId)?.toFixed(2) ?? null }));
  };
  const ozet = { toplamAlacak: toplamAlacak.toFixed(2), toplamBorc: toplamBorc.toFixed(2), alacakSayisi, borcSayisi };
  // Bildirim taraması yalnız sayı ve toplamı kullanır; liste ve bağlanmamış ödeme sorgusu atlanır.
  if (secenek.yalnizOzet) return { alacaklar: [], borclar: [], ...ozet };
  return { alacaklar: await baglanmamisEkle(enEskiler(alacaklar), "tahsilat"), borclar: await baglanmamisEkle(enEskiler(borclar), "tediye"), ...ozet };
}
