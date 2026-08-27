import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

@Injectable()
export class RaporService {
  constructor(private readonly prisma: PrismaService) {}

  // Kar-zarar analizi RPR-06 araç setine taşındı: fatura.kar-marji (FTR-15).

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

      // 2. Toplam Stok Envanter Değeri
      const stoklar = await tx.stokKart.findMany({
        where: { tenantId, aktif: true },
        select: { mevcutMiktar: true, ortalamaMaliyet: true },
      });

      let envanterDegeri = D(0);
      stoklar.forEach((s) => {
        envanterDegeri = envanterDegeri.add(s.mevcutMiktar.mul(s.ortalamaMaliyet));
      });

      // 3. Cari Borç ve Alacak Toplamları (Alacaklar & Borçlar)
      const cariler = await tx.cariHesap.findMany({
        where: { tenantId, aktif: true },
        include: {
          hareketler: { select: { tip: true, tutarTry: true } },
        },
      });

      let toplamAlacaklar = D(0); // Müşterilerden alacağımız (pozitif bakiye)
      let toplamBorclar = D(0);    // Satıcılara borcumuz (negatif bakiye)

      cariler.forEach((c) => {
        let borcSum = D(0);
        let alacakSum = D(0);

        c.hareketler.forEach((h) => {
          if (h.tip === "borc") {
            borcSum = borcSum.add(h.tutarTry);
          } else {
            alacakSum = alacakSum.add(h.tutarTry);
          }
        });

        const cariBakiye = borcSum.sub(alacakSum); // borç > alacak ise müşteri borçludur (bizim alacağımız)
        if (cariBakiye.greaterThan(0)) {
          toplamAlacaklar = toplamAlacaklar.add(cariBakiye);
        } else if (cariBakiye.lessThan(0)) {
          toplamBorclar = toplamBorclar.add(cariBakiye.abs());
        }
      });

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
          where: { tenantId, tarih, tip: "tahsilat" },
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
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const faturalar = await tx.fatura.findMany({
        where: { tenantId, durum: "kesin", tip: { in: ["satis", "alis"] }, vadeTarihi: { lt: bugunBaslangic } },
        orderBy: { vadeTarihi: "asc" }, take: 200,
        select: { id: true, no: true, tip: true, vadeTarihi: true, genelToplam: true, kur: true, cari: { select: { id: true, unvan: true } }, kasaBankaHarekets: { select: { tutarTry: true } }, krediKartiHareketleri: { select: { cariOdemeTutari: true } } },
      });
      const satirlar = faturalar.map((f) => {
        const odenenTry = f.kasaBankaHarekets.reduce((t, h) => t.add(h.tutarTry), D(0)).add(f.krediKartiHareketleri.reduce((t, h) => t.add(D(h.cariOdemeTutari ?? 0).mul(f.kur)), D(0)));
        const toplamTry = f.genelToplam.mul(f.kur).toDecimalPlaces(2);
        const kalanTry = Prisma.Decimal.max(toplamTry.sub(odenenTry), 0).toDecimalPlaces(2);
        const vade = f.vadeTarihi ?? bugunBaslangic;
        const gecikmeGun = Math.max(1, Math.floor((bugunBaslangic.getTime() - vade.getTime()) / 86_400_000));
        return { faturaId: f.id, no: f.no, cariId: f.cari.id, cariUnvan: f.cari.unvan, vadeTarihi: vade.toISOString().slice(0, 10), gecikmeGun, kalanTry: kalanTry.toFixed(2), tip: f.tip };
      }).filter((f) => Number(f.kalanTry) > 0);
      const alacaklar = satirlar.filter((f) => f.tip === "satis");
      const borclar = satirlar.filter((f) => f.tip === "alis");
      const toplam = (liste: typeof satirlar) => liste.reduce((t, f) => t.add(f.kalanTry), D(0)).toFixed(2);
      return { alacaklar, borclar, toplamAlacak: toplam(alacaklar), toplamBorc: toplam(borclar) };
    });
  }

  /**
   * Satılan Malın Maliyeti (SMM - COGS) ve Brüt Kar Analizi.
   * Metotlar: 'agirlikli_ortalama' veya 'fifo'.
   */
  async smmAnalizi(yontem: "agirlikli_ortalama" | "fifo" = "agirlikli_ortalama") {
    const { tenantId } = aktifBaglam();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // 1. Kesinleşmiş tüm satış faturası satırlarını çek
      const satisSatirlari = await tx.faturaSatir.findMany({
        where: {
          tenantId,
          fatura: { durum: "kesin", tip: "satis" },
        },
        include: {
          stok: { select: { id: true, kod: true, ad: true, ortalamaMaliyet: true } },
          fatura: { select: { id: true, no: true, tarih: true, cari: { select: { unvan: true } } } },
        },
        orderBy: { fatura: { tarih: "asc" } },
      });

      // 2. FIFO hesabı için tüm kesinleşmiş alış satırlarını al
      const alisSatirlari = await tx.faturaSatir.findMany({
        where: {
          tenantId,
          fatura: { durum: "kesin", tip: "alis" },
        },
        select: {
          stokId: true,
          miktar: true,
          birimFiyat: true,
          iskontoOrani: true,
          fatura: { select: { tarih: true } },
        },
        orderBy: { fatura: { tarih: "asc" } },
      });

      let toplamSatisCirosu = D(0);
      let toplamSmmMaliyeti = D(0);

      // FIFO için stok bazlı stok havuzu kopyası
      const fifoKuyruklari: Record<string, Array<{ kalanMiktar: number; birimMaliyet: number }>> = {};
      alisSatirlari.forEach((a) => {
        if (!fifoKuyruklari[a.stokId]) fifoKuyruklari[a.stokId] = [];
        const miktar = D(a.miktar).toNumber();
        const brut = miktar * D(a.birimFiyat).toNumber();
        const iskonto = (brut * D(a.iskontoOrani).toNumber()) / 100;
        const netTutar = brut - iskonto;
        const birimMaliyet = miktar > 0 ? netTutar / miktar : D(a.birimFiyat).toNumber();
        fifoKuyruklari[a.stokId].push({ kalanMiktar: miktar, birimMaliyet });
      });

      const detaylar = satisSatirlari.map((satir) => {
        const satilanMiktar = D(satir.miktar).toNumber();
        const brut = satilanMiktar * D(satir.birimFiyat).toNumber();
        const iskonto = (brut * D(satir.iskontoOrani).toNumber()) / 100;
        const satisNetTutar = brut - iskonto;
        toplamSatisCirosu = toplamSatisCirosu.add(satisNetTutar);

        let birimMaliyet = 0;
        let toplamMaliyet = 0;

        if (yontem === "fifo" && fifoKuyruklari[satir.stokId] && fifoKuyruklari[satir.stokId].length > 0) {
          // FIFO Mantığı: İlk giren ilk çıkar (Oldest Batch First)
          let erimesiGereken = satilanMiktar;
          const kuyruk = fifoKuyruklari[satir.stokId];

          while (erimesiGereken > 0 && kuyruk.length > 0) {
            const parti = kuyruk[0];
            if (parti.kalanMiktar <= erimesiGereken) {
              toplamMaliyet += parti.kalanMiktar * parti.birimMaliyet;
              erimesiGereken -= parti.kalanMiktar;
              kuyruk.shift(); // Parti tükendi
            } else {
              toplamMaliyet += erimesiGereken * parti.birimMaliyet;
              parti.kalanMiktar -= erimesiGereken;
              erimesiGereken = 0;
            }
          }
          // Eğer FIFO stoğu bittiyse kalan miktar için ortalama maliyet kullan
          if (erimesiGereken > 0) {
            const varsayilanBirim = D(satir.stok.ortalamaMaliyet).toNumber();
            toplamMaliyet += erimesiGereken * varsayilanBirim;
          }
          birimMaliyet = satilanMiktar > 0 ? toplamMaliyet / satilanMiktar : 0;
        } else {
          // Ağırlıklı Ortalama Maliyet Metodu (Stok Kartındaki Ortalama Maliyet)
          birimMaliyet = D(satir.stok.ortalamaMaliyet).toNumber();
          toplamMaliyet = satilanMiktar * birimMaliyet;
        }

        toplamSmmMaliyeti = toplamSmmMaliyeti.add(toplamMaliyet);
        const karTutar = satisNetTutar - toplamMaliyet;
        const karMarjiYuzde = satisNetTutar > 0 ? (karTutar / satisNetTutar) * 100 : 0;

        return {
          faturaId: satir.fatura.id,
          faturaNo: satir.fatura.no || "Taslak",
          tarih: satir.fatura.tarih.toISOString().slice(0, 10),
          stokKod: satir.stok.kod,
          stokAd: satir.stok.ad,
          cariUnvan: satir.fatura.cari.unvan,
          satilanMiktar,
          satisNetTutar,
          birimMaliyet,
          toplamMaliyet,
          karTutar,
          karMarjiYuzde: Number(karMarjiYuzde.toFixed(2)),
        };
      });

      const brutKar = toplamSatisCirosu.sub(toplamSmmMaliyeti);
      const genelKarMarjiYuzde = toplamSatisCirosu.greaterThan(0)
        ? brutKar.div(toplamSatisCirosu).mul(100).toNumber()
        : 0;

      return {
        yontem,
        toplamSatisCirosu: toplamSatisCirosu.toFixed(2),
        toplamSmmMaliyeti: toplamSmmMaliyeti.toFixed(2),
        brutKar: brutKar.toFixed(2),
        genelKarMarjiYuzde: Number(genelKarMarjiYuzde.toFixed(2)),
        detaylar,
      };
    });
  }

  /**
   * Tarihler arası Gelir - Gider Raporu.
   * Genel özet (kategori bazlı) ve ayrıntılı kalemler versiyonu.
   */
  async gelirGiderRaporu(baslangicMetni?: string, bitisMetni?: string) {
    const { tenantId } = aktifBaglam();

    const simdi = new Date();
    const varsayilanBaslangic = new Date(Date.UTC(simdi.getFullYear(), simdi.getMonth(), 1));
    const varsayilanBitis = new Date(Date.UTC(simdi.getFullYear(), simdi.getMonth() + 1, 0, 23, 59, 59, 999));

    const baslangic = baslangicMetni && /^\d{4}-\d{2}-\d{2}$/.test(baslangicMetni)
      ? new Date(`${baslangicMetni}T00:00:00.000Z`)
      : varsayilanBaslangic;

    const bitis = bitisMetni && /^\d{4}-\d{2}-\d{2}$/.test(bitisMetni)
      ? new Date(`${bitisMetni}T23:59:59.999Z`)
      : varsayilanBitis;

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // 1. Kesinleşmiş Faturalar
      const faturalar = await tx.fatura.findMany({
        where: {
          tenantId,
          durum: "kesin",
          tarih: { gte: baslangic, lte: bitis },
        },
        select: {
          id: true,
          no: true,
          tip: true,
          tarih: true,
          toplamMatrah: true,
          genelToplam: true,
          kur: true,
          dovizCinsi: true,
          aciklama: true,
          gelirTuru: true,
          cari: { select: { unvan: true } },
          satirlar: {
            select: {
              matrah: true,
              stok: { select: { tip: true } },
            },
          },
        },
        orderBy: { tarih: "desc" },
      });

      // 2. Kasa/Banka Hareketleri (Faturaya bağlı olmayan doğrudan işlemler)
      const hareketler = await tx.kasaBankaHareket.findMany({
        where: {
          tenantId,
          tarih: { gte: baslangic, lte: bitis },
          faturaId: null,
          cariId: null,
          kaynakTur: { notIn: ["masraf_odeme", "masraf", "fatura", "fatura_kapama"] },
        },
        select: {
          id: true,
          tip: true,
          tarih: true,
          tutar: true,
          tutarTry: true,
          dovizCinsi: true,
          aciklama: true,
          kaynakTur: true,
          cari: { select: { unvan: true } },
          kasa: { select: { ad: true } },
          bankaHesap: { select: { ad: true } },
          posHesap: { select: { ad: true } },
        },
        orderBy: { tarih: "desc" },
      });

      // 3. Masraf Kayıtları (Ana ve Alt Kategori İlişkisiyle)
      const masraflar = await tx.masraf.findMany({
        where: {
          tenantId,
          durum: { not: "iptal" },
          tarih: { gte: baslangic, lte: bitis },
        },
        select: {
          id: true,
          belgeNo: true,
          tarih: true,
          toplam: true,
          dovizCinsi: true,
          aciklama: true,
          saticiUnvan: true,
          kategori: {
            select: {
              ad: true,
              ust: { select: { ad: true } },
            },
          },
          cari: { select: { unvan: true } },
        },
        orderBy: { tarih: "desc" },
      });

      // 4. Mevcut Stok / Envanter Değeri (İşletme Aktif Varlığı - Sadece fiziki stoklanan ürün/sarf malzemeleri)
      const stoklar = await tx.stokKart.findMany({
        where: { tenantId, aktif: true, tip: { in: ["urun", "sarf"] } },
        select: { mevcutMiktar: true, ortalamaMaliyet: true },
      });
      let envanterDegeri = D(0);
      stoklar.forEach((s) => {
        envanterDegeri = envanterDegeri.add(s.mevcutMiktar.mul(s.ortalamaMaliyet));
      });

      // 5. Personel Bordro / Maaş Kayıtları
      const bordrolar = await tx.personelBordro.findMany({
        where: { tenantId },
        select: {
          id: true,
          donemYil: true,
          donemAy: true,
          odenecekTutar: true,
          odemeTarihi: true,
          personel: { select: { ad: true, soyad: true } },
        },
      });

      // Sınıflandırma ve Kalem Dizisi
      let satisHasilati = D(0);
      let satisIadeleri = D(0);
      let alisMaliyeti = D(0);
      let alisIadeleri = D(0);
      let digerGelirler = D(0);
      let digerGiderler = D(0);
      let masrafGiderleri = D(0);
      let personelGiderleri = D(0);

      const masrafHaritasi = new Map<string, { anaKategori: string; altKategori: string; tutar: Prisma.Decimal }>();

      const kalemler: Array<{
        id: string;
        tarih: string;
        tur: "gelir" | "gider";
        anaKategori: string;
        altKategori: string;
        belgeNo: string;
        cariUnvan: string;
        aciklama: string;
        tutarTry: string;
        dovizCinsi: string;
        tutar: string;
      }> = [];

      // Faturaları işle
      faturalar.forEach((f) => {
        const matrahTry = f.toplamMatrah.mul(f.kur);
        const tarihStr = f.tarih.toISOString().slice(0, 10);
        const belgeNo = f.no || "(Taslak)";
        const cari = f.cari.unvan;

        if (f.tip === "satis") {
          const isFaaliyetDisi = f.gelirTuru && f.gelirTuru !== "ticari_satis";
          let anaKategori = "Esas Faaliyet Gelirleri";
          let altKategori = "Satış Hasılatı";

          if (isFaaliyetDisi) {
            digerGelirler = digerGelirler.add(matrahTry);
            anaKategori = "Faaliyet Dışı Gelirler";
            if (f.gelirTuru === "kira_geliri") altKategori = "Kira Geliri";
            else if (f.gelirTuru === "varlik_satisi") altKategori = "Varlık / Demirbaş Satışı";
            else if (f.gelirTuru === "yansitma") altKategori = "Yansıtma Gelirleri";
            else altKategori = "Diğer Faaliyet Dışı Gelirler";
          } else {
            satisHasilati = satisHasilati.add(matrahTry);
          }

          kalemler.push({
            id: f.id,
            tarih: tarihStr,
            tur: "gelir",
            anaKategori,
            altKategori,
            belgeNo,
            cariUnvan: cari,
            aciklama: f.aciklama || (isFaaliyetDisi ? "Faaliyet Dışı Satış Faturası" : "Satış Faturası"),
            tutarTry: matrahTry.toFixed(2),
            dovizCinsi: f.dovizCinsi,
            tutar: f.toplamMatrah.toFixed(2),
          });
        } else if (f.tip === "satis_iade") {
          satisIadeleri = satisIadeleri.add(matrahTry);
          kalemler.push({
            id: f.id,
            tarih: tarihStr,
            tur: "gider",
            anaKategori: "Satış İadeleri",
            altKategori: "Satış İadesi",
            belgeNo,
            cariUnvan: cari,
            aciklama: f.aciklama || "Satış İade Faturası",
            tutarTry: matrahTry.toFixed(2),
            dovizCinsi: f.dovizCinsi,
            tutar: f.toplamMatrah.toFixed(2),
          });
        } else if (f.tip === "alis") {
          // Hizmet alışları ile stok/mal alışlarını ayıralım
          let faturaHizmetMatrah = D(0);
          let faturaMalMatrah = D(0);

          if (f.satirlar && f.satirlar.length > 0) {
            f.satirlar.forEach((satir) => {
              if (satir.stok?.tip === "hizmet") {
                faturaHizmetMatrah = faturaHizmetMatrah.add(satir.matrah);
              } else {
                faturaMalMatrah = faturaMalMatrah.add(satir.matrah);
              }
            });
          } else {
            faturaMalMatrah = f.toplamMatrah;
          }

          if (faturaHizmetMatrah.greaterThan(0)) {
            const hizmetMatrahTry = faturaHizmetMatrah.mul(f.kur);
            masrafGiderleri = masrafGiderleri.add(hizmetMatrahTry);

            const grupAnahtari = "Hizmet Alış Giderleri::Hizmet Alışları";
            const mevcutGrup = masrafHaritasi.get(grupAnahtari);
            if (mevcutGrup) {
              mevcutGrup.tutar = mevcutGrup.tutar.add(hizmetMatrahTry);
            } else {
              masrafHaritasi.set(grupAnahtari, {
                anaKategori: "Hizmet Alış Giderleri",
                altKategori: "Hizmet Alışları",
                tutar: hizmetMatrahTry,
              });
            }

            kalemler.push({
              id: `${f.id}-hizmet`,
              tarih: tarihStr,
              tur: "gider",
              anaKategori: "Hizmet Alış Giderleri",
              altKategori: "Hizmet Alışları",
              belgeNo,
              cariUnvan: cari,
              aciklama: f.aciklama ? `${f.aciklama} (Hizmet)` : "Alış Faturası (Hizmet Kalemi)",
              tutarTry: hizmetMatrahTry.toFixed(2),
              dovizCinsi: f.dovizCinsi,
              tutar: faturaHizmetMatrah.toFixed(2),
            });
          }

          if (faturaMalMatrah.greaterThan(0)) {
            const malMatrahTry = faturaMalMatrah.mul(f.kur);
            alisMaliyeti = alisMaliyeti.add(malMatrahTry);

            kalemler.push({
              id: f.id,
              tarih: tarihStr,
              tur: "gider",
              anaKategori: "Mal Alış Maliyetleri",
              altKategori: "Mal Alış Maliyeti",
              belgeNo,
              cariUnvan: cari,
              aciklama: f.aciklama || "Alış Faturası (Ürün/Sarf)",
              tutarTry: malMatrahTry.toFixed(2),
              dovizCinsi: f.dovizCinsi,
              tutar: faturaMalMatrah.toFixed(2),
            });
          }
        } else if (f.tip === "alis_iade") {
          alisIadeleri = alisIadeleri.add(matrahTry);
          kalemler.push({
            id: f.id,
            tarih: tarihStr,
            tur: "gelir",
            anaKategori: "Faaliyet Gelirleri",
            altKategori: "Alış İadesi Geliri",
            belgeNo,
            cariUnvan: cari,
            aciklama: f.aciklama || "Alış İade Faturası",
            tutarTry: matrahTry.toFixed(2),
            dovizCinsi: f.dovizCinsi,
            tutar: f.toplamMatrah.toFixed(2),
          });
        }
      });

      // Doğrudan Kasa/Banka hareketlerini akıllı kategorileme ile işle
      hareketler.forEach((h) => {
        const tarihStr = h.tarih.toISOString().slice(0, 10);
        const hesapAd = h.kasa?.ad ?? h.bankaHesap?.ad ?? h.posHesap?.ad ?? "Kasa/Banka";
        const cari = h.cari?.unvan ?? "Cari Belirtilmemiş";
        const aciklamaMetin = h.aciklama || "";

        if (h.tip === "tahsilat" || h.tip === "virman_gelis") {
          digerGelirler = digerGelirler.add(h.tutarTry);
          kalemler.push({
            id: h.id,
            tarih: tarihStr,
            tur: "gelir",
            anaKategori: "Faaliyet Dışı / Diğer Gelirler",
            altKategori: "Doğrudan Tahsilat / Faiz / Diğer",
            belgeNo: h.kaynakTur,
            cariUnvan: cari,
            aciklama: `${aciklamaMetin || "Faaliyet Dışı Tahsilat"} (${hesapAd})`,
            tutarTry: h.tutarTry.toFixed(2),
            dovizCinsi: h.dovizCinsi,
            tutar: h.tutar.toFixed(2),
          });
        } else if (h.tip === "tediye" || h.tip === "virman_gidis") {
          let anaKategori = "Diğer İşletme Ödemeleri";
          let altKategori = "Genel Ödeme / Tediye";

          if (/kira/i.test(aciklamaMetin)) {
            anaKategori = "Kira ve Konut Giderleri";
            altKategori = "İşyeri / Depo Kirası";
          } else if (/maaş|personel|bordro|avans/i.test(aciklamaMetin)) {
            anaKategori = "Personel Giderleri";
            altKategori = "Doğrudan Maaş / Avans Ödemesi";
          }

          digerGiderler = digerGiderler.add(h.tutarTry);
          kalemler.push({
            id: h.id,
            tarih: tarihStr,
            tur: "gider",
            anaKategori,
            altKategori,
            belgeNo: h.kaynakTur,
            cariUnvan: cari,
            aciklama: `${aciklamaMetin || "Tediye"} (${hesapAd})`,
            tutarTry: h.tutarTry.toFixed(2),
            dovizCinsi: h.dovizCinsi,
            tutar: h.tutar.toFixed(2),
          });
        }
      });

      // Masrafları ana ve alt kategori kırılımı ile işle
      masraflar.forEach((m) => {
        const tarihStr = m.tarih.toISOString().slice(0, 10);
        const aciklamaMetin = m.aciklama || "";

        let anaKategori = m.kategori?.ust?.ad ?? m.kategori?.ad;
        let altKategori = m.kategori?.ust ? m.kategori.ad : "Genel Masraf";

        if (!anaKategori) {
          if (/kira/i.test(aciklamaMetin) || /kira/i.test(m.saticiUnvan || "")) {
            anaKategori = "Kira ve Konut Giderleri";
            altKategori = "İşyeri / Depo Kirası";
          } else {
            anaKategori = "Masraflar ve Giderler";
          }
        }

        const tutarTry = m.toplam;
        masrafGiderleri = masrafGiderleri.add(tutarTry);

        // Kategori grup toplamı
        const grupAnahtari = `${anaKategori}::${altKategori}`;
        const mevcutGrup = masrafHaritasi.get(grupAnahtari);
        if (mevcutGrup) {
          mevcutGrup.tutar = mevcutGrup.tutar.add(tutarTry);
        } else {
          masrafHaritasi.set(grupAnahtari, { anaKategori, altKategori, tutar: tutarTry });
        }

        kalemler.push({
          id: m.id,
          tarih: tarihStr,
          tur: "gider",
          anaKategori,
          altKategori,
          belgeNo: m.belgeNo || "Masraf",
          cariUnvan: m.cari?.unvan ?? m.saticiUnvan ?? "İşletme Masrafı",
          aciklama: aciklamaMetin || `${anaKategori} > ${altKategori}`,
          tutarTry: tutarTry.toFixed(2),
          dovizCinsi: m.dovizCinsi,
          tutar: m.toplam.toFixed(2),
        });
      });

      // Personel Bordro / Maaş Kayıtlarını işle
      bordrolar.forEach((b) => {
        const bTarih = b.odemeTarihi ?? new Date(Date.UTC(b.donemYil, b.donemAy - 1, 15));
        if (bTarih >= baslangic && bTarih <= bitis) {
          const tutarTry = b.odenecekTutar;
          personelGiderleri = personelGiderleri.add(tutarTry);
          const anaKategori = "Personel Giderleri";
          const altKategori = "Maaş & Bordro Ödemeleri";

          const grupAnahtari = `${anaKategori}::${altKategori}`;
          const mevcutGrup = masrafHaritasi.get(grupAnahtari);
          if (mevcutGrup) {
            mevcutGrup.tutar = mevcutGrup.tutar.add(tutarTry);
          } else {
            masrafHaritasi.set(grupAnahtari, { anaKategori, altKategori, tutar: tutarTry });
          }

          kalemler.push({
            id: b.id,
            tarih: bTarih.toISOString().slice(0, 10),
            tur: "gider",
            anaKategori,
            altKategori,
            belgeNo: `BRD-${b.donemYil}-${b.donemAy}`,
            cariUnvan: `${b.personel.ad} ${b.personel.soyad}`,
            aciklama: `${b.donemYil}/${b.donemAy} Personel Bordrosu`,
            tutarTry: tutarTry.toFixed(2),
            dovizCinsi: "TRY",
            tutar: tutarTry.toFixed(2),
          });
        }
      });

      // Kalemleri tarihe göre azalan sırala
      kalemler.sort((a, b) => (a.tarih < b.tarih ? 1 : a.tarih > b.tarih ? -1 : 0));

      const toplamGelir = satisHasilati.add(alisIadeleri).add(digerGelirler).add(envanterDegeri);
      const toplamGider = alisMaliyeti.add(satisIadeleri).add(digerGiderler).add(masrafGiderleri).add(personelGiderleri);
      const netFark = toplamGelir.sub(toplamGider);
      const karMarjiYuzde = toplamGelir.greaterThan(0)
        ? netFark.div(toplamGelir).mul(100).toNumber()
        : 0;

      // Gelir Kategori Dağılımı
      const gelirKategorileri = [
        { anaKategori: "Esas Faaliyet Gelirleri", altKategori: "Satış Hasılatı", tutar: satisHasilati.toFixed(2) },
        { anaKategori: "Faaliyet Gelirleri", altKategori: "Alış İadeleri Geliri", tutar: alisIadeleri.toFixed(2) },
        { anaKategori: "Faaliyet Dışı Gelirler", altKategori: "Doğrudan Tahsilat / Faiz / Diğer", tutar: digerGelirler.toFixed(2) },
        { anaKategori: "İşletme Aktif Varlıkları", altKategori: "Mevcut Stok Değeri", tutar: envanterDegeri.toFixed(2) },
      ].filter((k) => Number(k.tutar) > 0);

      // Gider Kategori Dağılımı (Ana & Alt Kırılımlı Masraflar dahil)
      const masrafKategoriGruplari = Array.from(masrafHaritasi.values()).map((g) => ({
        anaKategori: g.anaKategori,
        altKategori: g.altKategori,
        tutar: g.tutar.toFixed(2),
      }));

      const giderKategorileri = [
        { anaKategori: "Mal Alış Maliyetleri", altKategori: "Mal Alış Maliyeti", tutar: alisMaliyeti.toFixed(2) },
        { anaKategori: "Satış İadeleri", altKategori: "Satış İadeleri İskontoları", tutar: satisIadeleri.toFixed(2) },
        ...masrafKategoriGruplari,
        { anaKategori: "Diğer İşletme Ödemeleri", altKategori: "Doğrudan Tediye Ödemeleri", tutar: digerGiderler.toFixed(2) },
      ].filter((k) => Number(k.tutar) > 0);

      return {
        baslangicTarihi: baslangic.toISOString().slice(0, 10),
        bitisTarihi: bitis.toISOString().slice(0, 10),
        ozet: {
          satisHasilati: satisHasilati.toFixed(2),
          faaliyetDisiGelirler: digerGelirler.toFixed(2),
          mevcutStokDegeri: envanterDegeri.toFixed(2),
          toplamGelir: toplamGelir.toFixed(2),
          alisMaliyeti: alisMaliyeti.toFixed(2),
          masrafGiderleri: masrafGiderleri.toFixed(2),
          digerGiderler: digerGiderler.toFixed(2),
          personelGiderleri: personelGiderleri.toFixed(2),
          toplamGider: toplamGider.toFixed(2),
          netFark: netFark.toFixed(2),
          karMarjiYuzde: Number(karMarjiYuzde.toFixed(2)),
        },
        gelirKategorileri,
        giderKategorileri,
        kalemler,
      };
    });
  }
}
