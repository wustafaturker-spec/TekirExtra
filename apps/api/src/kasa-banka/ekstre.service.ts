/**
 * KSB-06: banka ekstresi içe aktarma ve hareketlerle eşleştirme.
 *
 * Akış, gelen e-Belge kutusundakiyle aynı mantığı izler (EBLG-05): dosyadaki
 * satırlar önce **muhasebeye dokunmadan** kutuya düşer, sistem cari ve fatura
 * önerir, kullanıcı onaylayınca tahsilat/tediye fişi üretilir.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EkstreSatirDurum, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { aktifBaglam } from "../core/istek-baglami";
import { metinNormalize } from "@tekirextra/shared";
import { PrismaService } from "../core/prisma.service";
import { kuralBul } from "./ekstre-kural";
import { mutabakatHesapla } from "./ekstre-mutabakat";
import {
  EkstreOkumaHatasi,
  type SutunEslemesi,
  ekstreSatirlariOku,
  ekstreDosyasiOku,
  eslemeTahminEt,
} from "./ekstre-oku";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal =>
  new Prisma.Decimal(deger);


@Injectable()
export class EkstreService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async webhookHareketleriniAl(tenantId: string, bankaHesapId: string, baglantiId: string, hareketler: Array<{ id: string; tarih: string; tutar: number; aciklama: string; dekontNo?: string; karsiIban?: string; karsiUnvan?: string; bakiye?: number }>) {
    await this.hesapGetir(tenantId, bankaHesapId);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const satirlar = hareketler.map((h) => ({ ...h, satirOzeti: createHash("sha256").update(`webhook:${baglantiId}:${h.id}`).digest("hex") }));
      const mevcut = new Set((await tx.bankaEkstreSatir.findMany({ where: { bankaHesapId, satirOzeti: { in: satirlar.map((s) => s.satirOzeti) } }, select: { satirOzeti: true } })).map((s) => s.satirOzeti));
      const yeniler = satirlar.filter((s) => !mevcut.has(s.satirOzeti));
      const ekstre = await tx.bankaEkstre.create({ data: { tenantId, bankaHesapId, dosyaAdi: `API · ${baglantiId}`, satirSayisi: satirlar.length, yeniSatirSayisi: yeniler.length } });
      for (const s of yeniler) await tx.bankaEkstreSatir.create({ data: { tenantId, ekstreId: ekstre.id, bankaHesapId, tarih: new Date(`${s.tarih}T00:00:00.000Z`), tutar: D(s.tutar), aciklama: s.aciklama, dekontNo: s.dekontNo, karsiIban: s.karsiIban, karsiUnvan: s.karsiUnvan, bakiye: s.bakiye === undefined ? null : D(s.bakiye), satirOzeti: s.satirOzeti } });
      return { alinanSatir: satirlar.length, yeniSatir: yeniler.length, yinelenenSatir: satirlar.length - yeniler.length };
    });
  }

  // ─── YÜKLEME ───────────────────────────────────────────────────────────────

  /**
   * Dosyayı ayrıştırıp ilk satırlarını ve sütun eşlemesi tahminini döner —
   * hiçbir şey kaydedilmez. Hesapta kayıtlı eşleme varsa tahmin yerine o
   * kullanılır (kullanıcı ikinci yüklemede eşleme ekranıyla uğraşmasın).
   */
  async onizle(bankaHesapId: string, dosya: Buffer) {
    const { tenantId } = aktifBaglam();

    const hesap = await this.hesapGetir(tenantId, bankaHesapId);

    let tablo: string[][];
    try {
      tablo = await ekstreDosyasiOku(dosya);
    } catch (hata) {
      throw new BadRequestException(
        hata instanceof EkstreOkumaHatasi ? hata.message : "Dosya okunamadı",
      );
    }

    const kayitli = hesap.ekstreEslemesi as SutunEslemesi | null;
    const esleme = kayitli ?? eslemeTahminEt(tablo[0] ?? []);

    return {
      bankaHesapId,
      bankaHesapAdi: hesap.ad,
      basliklar: tablo[esleme.baslikSatiri] ?? tablo[0] ?? [],
      ornekSatirlar: tablo.slice(esleme.baslikSatiri + 1, esleme.baslikSatiri + 6),
      toplamSatir: tablo.length,
      esleme,
      /** true ise eşleme hesapta kayıtlıydı, tahmin edilmedi. */
      eslemeKayitli: kayitli !== null,
    };
  }

  /**
   * Satırları kutuya yazar. Aynı satır (tarih+tutar+açıklama+dekont özeti)
   * daha önce yüklendiyse atlanır — aynı dosya iki kez yüklenirse çift kayıt
   * oluşmaz.
   */
  async yukle(
    bankaHesapId: string,
    dosya: Buffer,
    dosyaAdi: string,
    esleme: SutunEslemesi,
    eslemeyiKaydet: boolean,
  ) {
    const { tenantId } = aktifBaglam();
    await this.hesapGetir(tenantId, bankaHesapId);

    let tablo: string[][];
    try {
      tablo = await ekstreDosyasiOku(dosya);
    } catch (hata) {
      throw new BadRequestException(
        hata instanceof EkstreOkumaHatasi ? hata.message : "Dosya okunamadı",
      );
    }

    const { satirlar, atlanan } = ekstreSatirlariOku(tablo, esleme);
    if (satirlar.length === 0) {
      throw new BadRequestException(
        "Dosyadan hiç hareket okunamadı. Sütun eşlemesini (özellikle tarih ve tutar) kontrol edin.",
      );
    }

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Hangileri yeni? Tek sorguda mevcut özetleri çekip ayıklıyoruz.
      const ozetler = satirlar.map((s) => s.satirOzeti);
      const mevcutlar = await tx.bankaEkstreSatir.findMany({
        where: { bankaHesapId, satirOzeti: { in: ozetler } },
        select: { satirOzeti: true },
      });
      const mevcutKume = new Set(mevcutlar.map((m) => m.satirOzeti));
      const yeniler = satirlar.filter((s) => !mevcutKume.has(s.satirOzeti));

      const ekstre = await tx.bankaEkstre.create({
        data: {
          tenantId,
          bankaHesapId,
          dosyaAdi: dosyaAdi.slice(0, 255),
          satirSayisi: satirlar.length,
          yeniSatirSayisi: yeniler.length,
        },
      });

      for (const s of yeniler) {
        await tx.bankaEkstreSatir.create({
          data: {
            tenantId,
            ekstreId: ekstre.id,
            bankaHesapId,
            tarih: s.tarih,
            tutar: D(s.tutar.toFixed(2)),
            aciklama: s.aciklama,
            dekontNo: s.dekontNo ?? null,
            karsiIban: s.karsiIban ?? null,
            karsiUnvan: s.karsiUnvan ?? null,
            bakiye: s.bakiye !== undefined ? D(s.bakiye.toFixed(2)) : null,
            satirOzeti: s.satirOzeti,
          },
        });
      }

      if (eslemeyiKaydet) {
        await tx.bankaHesap.update({
          where: { id: bankaHesapId },
          data: { ekstreEslemesi: esleme as unknown as Prisma.InputJsonValue },
        });
      }

      return {
        ekstreId: ekstre.id,
        okunanSatir: satirlar.length,
        yeniSatir: yeniler.length,
        yinelenenSatir: satirlar.length - yeniler.length,
        /** Tarihi/tutarı çözülemeyip atlanan satırlar (başlık, toplam vb.). */
        atlananSatir: atlanan,
      };
    });
  }

  // ─── KUTU ──────────────────────────────────────────────────────────────────

  /**
   * Ekstre satırları ve bağlı hareketlerin özeti. Liste hafiftir: ayrıntılı
   * öneriler (cari, fatura, mevcut fiş, çek…) seçilen satır için
   * `EkstreEslestirmeService.oneriler` ile alınır. Bekleyen satıra uyan
   * kayıtlı kural varsa önerisi burada döner.
   */
  async satirListele(durum?: EkstreSatirDurum, bankaHesapId?: string, arama?: string, baslangic?: string, bitis?: string, yon?: "tahsilat" | "tediye") {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const satirlar = await tx.bankaEkstreSatir.findMany({
        where: {
          durum: durum ?? undefined,
          bankaHesapId: bankaHesapId || undefined,
          ...(yon ? { tutar: yon === "tediye" ? { lt: 0 } : { gte: 0 } } : {}),
          ...(baslangic || bitis ? { tarih: { ...(baslangic ? { gte: new Date(baslangic) } : {}), ...(bitis ? { lte: new Date(bitis) } : {}) } } : {}),
          ...(arama ? { OR: [
            { aciklama: { contains: arama, mode: "insensitive" } },
            { dekontNo: { contains: arama, mode: "insensitive" } },
            { karsiIban: { contains: arama, mode: "insensitive" } },
            { karsiUnvan: { contains: arama, mode: "insensitive" } },
            { cari: { aramaNormal: { contains: metinNormalize(arama) } } },
          ] } : {}),
        },
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        take: 1000,
        include: {
          cari: { select: { id: true, kod: true, unvan: true } },
          fatura: { select: { id: true, no: true, genelToplam: true } },
          bankaHesap: { select: { id: true, ad: true, dovizCinsi: true } },
          hareketler: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true, tip: true, tutar: true, dovizCinsi: true, kaynakTur: true, aciklama: true,
              cari: { select: { id: true, unvan: true } }, fatura: { select: { id: true, no: true } },
              kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true } },
              masraf: { select: { kategori: { select: { ad: true } } } },
              gelirKaydi: { select: { kategori: { select: { ad: true } } } },
            },
          },
        },
      });
      const kurallar = satirlar.some((s) => s.durum === "beklemede")
        ? await tx.ekstreKurali.findMany({ where: { aktif: true }, orderBy: [{ kullanimSayisi: "desc" }, { createdAt: "asc" }] })
        : [];
      return satirlar.map((s) => ({
        id: s.id,
        bankaHesap: s.bankaHesap,
        tarih: s.tarih.toISOString().slice(0, 10),
        tutar: s.tutar.toFixed(2),
        /** Ekstredeki işaretten türer: giriş → tahsilat, çıkış → tediye. */
        yon: s.tutar.isNegative() ? "tediye" : "tahsilat",
        aciklama: s.aciklama,
        dekontNo: s.dekontNo,
        karsiIban: s.karsiIban,
        karsiUnvan: s.karsiUnvan,
        bakiye: s.bakiye?.toFixed(2) ?? null,
        durum: s.durum,
        eslesmeTuru: s.eslesmeTuru,
        cari: s.cari,
        fatura: s.fatura ? { ...s.fatura, genelToplam: s.fatura.genelToplam.toFixed(2) } : null,
        hareketler: s.hareketler.map((h) => ({
          id: h.id, tip: h.tip, tutar: h.tutar.toFixed(2), dovizCinsi: h.dovizCinsi, kaynakTur: h.kaynakTur, aciklama: h.aciklama,
          cari: h.cari, fatura: h.fatura, hesap: h.kasa?.ad ?? h.bankaHesap?.ad ?? null,
          kategori: h.masraf?.kategori.ad ?? h.gelirKaydi?.kategori.ad ?? null,
        })),
        kuralOnerisi: s.durum === "beklemede" ? kuralBul(kurallar, s) : null,
      }));
    });
  }

  /**
   * KSB-06: ekstredeki bakiye ile sistemdeki hesap bakiyesinin gün gün
   * karşılaştırması; farkın başladığı gün ve açıklanan/açıklanamayan kısmı.
   */
  async mutabakat(bankaHesapId: string) {
    const { tenantId } = aktifBaglam();
    const hesap = await this.hesapGetir(tenantId, bankaHesapId);
    const [satirlar, hareketler] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.bankaEkstreSatir.findMany({ where: { bankaHesapId }, orderBy: [{ tarih: "asc" }, { createdAt: "asc" }], select: { tarih: true, tutar: true, bakiye: true, durum: true } }),
      tx.kasaBankaHareket.findMany({ where: { bankaHesapId }, select: { tarih: true, tip: true, tutar: true } }),
    ]));
    return {
      bankaHesap: { id: hesap.id, ad: hesap.ad, dovizCinsi: hesap.dovizCinsi },
      bakiyeSutunuVar: satirlar.some((s) => s.bakiye !== null),
      ...mutabakatHesapla(satirlar, hareketler),
    };
  }

  // ─── YARDIMCILAR ───────────────────────────────────────────────────────────

  private async hesapGetir(tenantId: string, bankaHesapId: string) {
    const hesap = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaHesap.findUnique({ where: { id: bankaHesapId } }),
    );
    if (!hesap) throw new NotFoundException("Banka hesabı bulunamadı");
    return hesap;
  }
}
