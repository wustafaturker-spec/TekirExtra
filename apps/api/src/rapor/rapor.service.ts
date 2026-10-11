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

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

@Injectable()
export class RaporService {
  constructor(private readonly prisma: PrismaService) {}

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

  /** Vadesi geçmiş, halen açık satış ve alış faturaları (panel özeti). */
  async vadesiGecenler() {
    const { tenantId } = aktifBaglam();
    const bugun = new Date();
    const bugunBaslangic = new Date(Date.UTC(bugun.getUTCFullYear(), bugun.getUTCMonth(), bugun.getUTCDate()));
    // RPR-17 (inceleme P2-2): eskiden en eski 200 fatura alınıp ödenmişler
    // sonradan eleniyordu; 200'den fazla vadesi geçmiş faturada toplam ve sayı
    // eksik kalıyordu. Şimdi hepsi 500'erli sayfalarla taranır; toplam ve
    // sayı tamdır, listeler en eski LISTE_SINIRI kayıtla sınırlıdır.
    const LISTE_SINIRI = 50;
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      type Satir = { faturaId: string; no: string | null; cariId: string; cariUnvan: string; vadeTarihi: string; gecikmeGun: number; kalanTry: string; tip: string };
      const alacaklar: Satir[] = [], borclar: Satir[] = [];
      let toplamAlacak = D(0), toplamBorc = D(0), alacakSayisi = 0, borcSayisi = 0;
      let imlec: string | undefined;
      for (;;) {
        const faturalar = await tx.fatura.findMany({
          where: { tenantId, durum: "kesin", tip: { in: ["satis", "alis"] }, vadeTarihi: { lt: bugunBaslangic } },
          orderBy: [{ vadeTarihi: "asc" }, { id: "asc" }], take: 500, ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
          select: { id: true, no: true, tip: true, vadeTarihi: true, genelToplam: true, kur: true, cari: { select: { id: true, unvan: true } }, durum: true, ...FATURA_ODEME_SECIMI },
        });
        for (const f of faturalar) {
          const kalanTry = faturaOdemeDurumu(f).kalan.mul(f.kur).toDecimalPlaces(2);
          if (!kalanTry.gt(0)) continue;
          const vade = f.vadeTarihi ?? bugunBaslangic;
          const gecikmeGun = Math.max(1, Math.floor((bugunBaslangic.getTime() - vade.getTime()) / 86_400_000));
          const satir = { faturaId: f.id, no: f.no, cariId: f.cari.id, cariUnvan: f.cari.unvan, vadeTarihi: vade.toISOString().slice(0, 10), gecikmeGun, kalanTry: kalanTry.toFixed(2), tip: f.tip };
          if (f.tip === "satis") { toplamAlacak = toplamAlacak.add(kalanTry); alacakSayisi++; if (alacaklar.length < LISTE_SINIRI) alacaklar.push(satir); }
          else { toplamBorc = toplamBorc.add(kalanTry); borcSayisi++; if (borclar.length < LISTE_SINIRI) borclar.push(satir); }
        }
        if (faturalar.length < 500) break;
        imlec = faturalar[faturalar.length - 1].id;
      }
      return { alacaklar, borclar, toplamAlacak: toplamAlacak.toFixed(2), toplamBorc: toplamBorc.toFixed(2), alacakSayisi, borcSayisi };
    });
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
      if (yontem === "fifo" && satirlar.length) {
        fifo = new Map();
        for (const stokId of new Set(satirlar.map((s) => s.stokId))) {
          const hareketler = await tx.stokHareket.findMany({ where: { stokId }, orderBy: [{ tarih: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true, miktar: true, maliyet: true } });
          for (const [id, deger] of fifoDegerleri(hareketler)) fifo.set(id, deger);
        }
      }
      // FIFO: satışın değeri çıkış hareketlerinin FIFO değeri; iade, aynı ürünün dönemdeki
      // FIFO birim maliyetiyle geri alınır (ortalamayla alınsa iki yöntem karışır).
      const fifoSatis = (s: (typeof satirlar)[number]) => s.hareketPaylari.reduce((t, p) => t.add((fifo!.get(p.hareketId) ?? D(0)).mul(p.oran)), D(0)).toDecimalPlaces(2);
      const fifoBirim = new Map<string, Prisma.Decimal>();
      if (fifo) for (const stokId of new Set(satirlar.map((s) => s.stokId))) {
        const satislar = satirlar.filter((s) => s.stokId === stokId && s.tip === "satis");
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
          faturaNo: s.faturaNo || "Taslak",
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
