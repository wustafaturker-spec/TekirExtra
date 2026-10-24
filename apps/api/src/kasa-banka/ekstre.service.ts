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
import { StandartEkstreHatasi, standartEkstreOku, type StandartEkstre } from "./ekstre-standart";
import {
  EkstreOkumaHatasi,
  type EkstreSatiri,
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

    // KSB-32: MT940/camt dosyasında sütun eşlemesi sorulmaz; özet ve ilk satırlar döner.
    const standart = this.standartOku(dosya, hesap);
    if (standart) {
      const tarihler = standart.satirlar.map((s) => s.tarih.toISOString().slice(0, 10)).sort();
      return {
        bankaHesapId,
        bankaHesapAdi: hesap.ad,
        standart: {
          bicim: standart.bicim,
          hesap: standart.hesaplar[0]?.hesap ?? null,
          dovizCinsi: standart.hesaplar[0]?.dovizCinsi ?? null,
          satirSayisi: standart.satirlar.length,
          ilkTarih: tarihler[0] ?? null,
          sonTarih: tarihler.at(-1) ?? null,
          acilis: standart.acilis?.toFixed(2) ?? null,
          kapanis: standart.kapanis?.toFixed(2) ?? null,
          uyarilar: standart.uyarilar,
          ornekSatirlar: standart.satirlar.slice(0, 5).map((s) => ({ tarih: s.tarih.toISOString().slice(0, 10), tutar: s.tutar.toFixed(2), aciklama: s.aciklama, karsiUnvan: s.karsiUnvan ?? null, bakiye: s.bakiye?.toFixed(2) ?? null })),
        },
      };
    }

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
    esleme: SutunEslemesi | undefined,
    eslemeyiKaydet: boolean,
  ) {
    const { tenantId } = aktifBaglam();
    const hesap = await this.hesapGetir(tenantId, bankaHesapId);

    const standart = this.standartOku(dosya, hesap);
    let satirlar: EkstreSatiri[];
    let atlanan = 0;
    if (standart) {
      satirlar = standart.satirlar;
      // Sütun eşlemesi standart dosyaya ait değildir; hesaba yazılmaz.
      eslemeyiKaydet = false;
    } else {
      if (!esleme) throw new BadRequestException("Sütun eşlemesi gerekli");
      let tablo: string[][];
      try {
        tablo = await ekstreDosyasiOku(dosya);
      } catch (hata) {
        throw new BadRequestException(
          hata instanceof EkstreOkumaHatasi ? hata.message : "Dosya okunamadı",
        );
      }
      ({ satirlar, atlanan } = ekstreSatirlariOku(tablo, esleme));
    }
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
        ...(standart ? { bicim: standart.bicim, uyarilar: standart.uyarilar } : {}),
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

  /**
   * KSB-31: bankanın bildirdiği son gün sonu bakiyesi sistemle tutuyor mu?
   * Bekleyen ve yok sayılan satırlarla açıklanan fark sayılmaz; kalan fark
   * eksik ya da mükerrer hareket demektir. Bakiye bilgisi gelmemişse null.
   */
  async bakiyeDurumu(tenantId: string, bankaHesapId: string) {
    const [satirlar, hareketler] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.bankaEkstreSatir.findMany({ where: { bankaHesapId }, orderBy: [{ tarih: "asc" }, { createdAt: "asc" }], select: { tarih: true, tutar: true, bakiye: true, durum: true } }),
      tx.kasaBankaHareket.findMany({ where: { bankaHesapId }, select: { tarih: true, tip: true, tutar: true } }),
    ]));
    const sonuc = mutabakatHesapla(satirlar, hareketler);
    if (!sonuc.son) return null;
    return {
      tarih: sonuc.son.tarih,
      banka: sonuc.son.banka,
      sistem: sonuc.son.sistem,
      aciklanmayanFark: sonuc.aciklanmayanFark,
      tutarli: D(sonuc.aciklanmayanFark).isZero(),
      farkBaslangici: sonuc.farkBaslangici,
      acilisBakiyesiEksikOlabilir: sonuc.acilisBakiyesiEksikOlabilir,
    };
  }

  // ─── YARDIMCILAR ───────────────────────────────────────────────────────────

  /**
   * KSB-32: MT940/camt dosyasını okur; tablo dosyasıysa null. Dosyadaki hesap
   * seçilen hesaba ait olmalı (IBAN ve döviz): yanlış hesabın dosyası yanlış
   * hesaba yazılıp bakiyeyi bozmasın.
   */
  private standartOku(dosya: Buffer, hesap: { ad: string; iban: string | null; dovizCinsi: string }): StandartEkstre | null {
    let standart: StandartEkstre | null;
    try {
      standart = standartEkstreOku(dosya);
    } catch (hata) {
      throw new BadRequestException(hata instanceof StandartEkstreHatasi ? hata.message : "Ekstre dosyası okunamadı");
    }
    if (!standart) return null;
    if (standart.hesaplar.length > 1) throw new BadRequestException(`Dosyada ${standart.hesaplar.length} ayrı hesabın ekstresi var (${standart.hesaplar.map((h) => h.hesap).join(", ")}); her hesabı ayrı yükleyin`);
    const dosyaHesabi = standart.hesaplar[0];
    const iban = (v: string | null | undefined) => (v ?? "").replace(/\s/g, "").toUpperCase();
    if (dosyaHesabi?.hesap.startsWith("TR") && iban(hesap.iban) && iban(dosyaHesabi.hesap) !== iban(hesap.iban)) {
      throw new BadRequestException(`Dosya ${dosyaHesabi.hesap} hesabına ait; seçilen hesap ${hesap.ad} (${hesap.iban})`);
    }
    if (dosyaHesabi?.dovizCinsi && dosyaHesabi.dovizCinsi !== hesap.dovizCinsi) {
      throw new BadRequestException(`Dosyanın dövizi ${dosyaHesabi.dovizCinsi}, seçilen hesabın ${hesap.dovizCinsi}`);
    }
    return standart;
  }

  private async hesapGetir(tenantId: string, bankaHesapId: string) {
    const hesap = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaHesap.findUnique({ where: { id: bankaHesapId } }),
    );
    if (!hesap) throw new NotFoundException("Banka hesabı bulunamadı");
    return hesap;
  }
}
