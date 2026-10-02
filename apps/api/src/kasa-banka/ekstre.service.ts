/**
 * KSB-06: banka ekstresi içe aktarma ve hareketlerle eşleştirme.
 *
 * Akış, gelen e-Belge kutusundakiyle aynı mantığı izler (EBLG-05): dosyadaki
 * satırlar önce **muhasebeye dokunmadan** kutuya düşer, sistem cari ve fatura
 * önerir, kullanıcı onaylayınca tahsilat/tediye fişi üretilir.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EkstreSatirDurum, Prisma } from "@prisma/client";
import { kurZorunlu } from "../doviz/kur-coz";
import { createHash } from "node:crypto";
import { aktifBaglam } from "../core/istek-baglami";
import { metinNormalize } from "@tekirextra/shared";
import { PrismaService } from "../core/prisma.service";
import { KasaBankaService } from "./kasa-banka.service";
import {
  EkstreOkumaHatasi,
  type SutunEslemesi,
  ekstreSatirlariOku,
  ekstreTabloOku,
  eslemeTahminEt,
  metniNormalle,
} from "./ekstre-oku";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal =>
  new Prisma.Decimal(deger);

/** Bir satır için bulunan cari ve hangi ipucuyla bulunduğu. */
export type CariEslesmeKaynagi = "iban" | "vkn" | "unvan" | null;

@Injectable()
export class EkstreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kasaBanka: KasaBankaService,
    private readonly donemKilidi: DonemKilidiService,
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
      tablo = ekstreTabloOku(dosya);
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
      tablo = ekstreTabloOku(dosya);
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

  /** Ekstre satırları + bekleyenler için cari/fatura önerisi. */
  async satirListele(durum?: EkstreSatirDurum, bankaHesapId?: string, arama?: string, baslangic?: string, bitis?: string, yon?: "tahsilat" | "tediye") {
    const { tenantId } = aktifBaglam();

    const satirlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaEkstreSatir.findMany({
        where: {
          durum: durum ?? undefined,
          bankaHesapId: bankaHesapId || undefined,
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
        include: {
          cari: { select: { id: true, kod: true, unvan: true } },
          fatura: { select: { id: true, no: true, genelToplam: true } },
          bankaHesap: { select: { id: true, ad: true, dovizCinsi: true } },
        },
      }),
    );

    const sonuc = [];
    for (const s of satirlar) {
      const oneri =
        s.durum === "beklemede"
          ? await this.oneriHesapla(tenantId, s)
          : { cari: null, cariEslesmeKaynagi: null as CariEslesmeKaynagi, faturalar: [] };

      sonuc.push({
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
        cari: s.cari,
        fatura: s.fatura
          ? { ...s.fatura, genelToplam: s.fatura.genelToplam.toFixed(2) }
          : null,
        hareketId: s.hareketId,
        onerilenCari: oneri.cari,
        cariEslesmeKaynagi: oneri.cariEslesmeKaynagi,
        onerilenFaturalar: oneri.faturalar,
      });
    }
    return yon ? sonuc.filter((s) => s.yon === yon) : sonuc;
  }

  /**
   * Satırı cariyle (ve istenirse faturayla) eşleştirir: tahsilat/tediye fişi
   * üretilir, cari bakiyesi güncellenir.
   */
  async eslestir(id: string, girdi: { cariId: string; faturaId?: string | null }) {
    const { tenantId } = aktifBaglam();

    const satir = await this.satirTazele(tenantId, id);
    if (satir.durum === "eslesti") {
      throw new ConflictException("Bu satır zaten eşleştirilmiş");
    }

    const tutar = satir.tutar;
    const tip = tutar.isNegative() ? "tediye" : "tahsilat";
    const kur = satir.bankaHesap.dovizCinsi === "TRY" ? "1" : await this.prisma.tenantIslem(tenantId, async (tx) => (await kurZorunlu(tx, satir.bankaHesap.dovizCinsi, satir.tarih, "satis", tenantId)).toFixed(6));

    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const cari = await tx.cariHesap.findUnique({
        where: { id: girdi.cariId },
        select: { id: true },
      });
      if (!cari) throw new NotFoundException("Cari hesap bulunamadı");

      if (girdi.faturaId) {
        const fatura = await tx.fatura.findUnique({
          where: { id: girdi.faturaId },
          select: { id: true, cariId: true, durum: true },
        });
        if (!fatura) throw new NotFoundException("Fatura bulunamadı");
        if (fatura.cariId !== girdi.cariId) {
          throw new BadRequestException("Seçilen fatura bu cariye ait değil");
        }
        if (fatura.durum !== "kesin") {
          throw new BadRequestException(
            "Yalnızca kesinleşmiş faturalar ödemeyle kapatılabilir",
          );
        }
      }
    });

    // Satır önce sahiplenilir: eşzamanlı iki eşleştirme (çift tıklama, iki
    // kullanıcı) ikisi birden fiş üretemez, ikincisi burada durur.
    const sahiplenme = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaEkstreSatir.updateMany({
        where: { id, durum: { not: "eslesti" }, hareketId: null },
        data: { durum: "eslesti", cariId: girdi.cariId, faturaId: girdi.faturaId ?? null },
      }),
    );
    if (sahiplenme.count !== 1) {
      throw new ConflictException("Bu satır az önce başka bir işlemle eşleştirildi; listeyi yenileyin");
    }
    const sahiplenmeyiBirak = () =>
      this.prisma.tenantIslem(tenantId, (tx) =>
        tx.bankaEkstreSatir.update({ where: { id }, data: { durum: satir.durum, cariId: null, faturaId: null } }),
      ).catch(() => undefined);

    // Fiş üretimi mevcut KSB-02 yoluyla yapılır; cari hareketi de o üretir.
    const hareket = await this.kasaBanka.hareketEkle({
      kasaId: null,
      bankaHesapId: satir.bankaHesapId,
      tip,
      tutar: tutar.abs().toFixed(2),
      dovizCinsi: satir.bankaHesap.dovizCinsi,
      kur,
      tarih: satir.tarih.toISOString().slice(0, 10),
      aciklama: satir.aciklama.slice(0, 500),
      cariId: girdi.cariId,
      faturaId: girdi.faturaId ?? null,
    }).catch(async (hata) => {
      await sahiplenmeyiBirak();
      throw hata;
    });

    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.bankaEkstreSatir.update({ where: { id }, data: { hareketId: hareket.id } }),
      );
    } catch (hata) {
      // Bağ kurulamadıysa ortada sahipsiz fiş kalmasın.
      await this.hareketGeriAl(tenantId, hareket.id).catch(() => undefined);
      await sahiplenmeyiBirak();
      throw hata;
    }
  }

  /** Banka masrafı, faiz gibi cariyle ilgisi olmayan satırları listeden düşürür. */
  async yoksay(id: string) {
    const { tenantId } = aktifBaglam();
    const satir = await this.satirTazele(tenantId, id);
    if (satir.durum === "eslesti") {
      throw new BadRequestException(
        "Eşleştirilmiş satır yoksayılamaz; önce eşleştirmeyi geri alın",
      );
    }
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaEkstreSatir.updateMany({ where: { id, durum: { not: "eslesti" } }, data: { durum: "yoksayildi" } }),
    );
    if (sonuc.count !== 1) throw new ConflictException("Bu satır az önce eşleştirildi; listeyi yenileyin");
    return this.satirTazele(tenantId, id);
  }

  /**
   * Yanlış eşleştirmeyi bozar: üretilen fişi ve onun cari hareketini siler,
   * satırı yeniden onaya düşürür.
   */
  async geriAl(id: string) {
    const { tenantId } = aktifBaglam();
    const satir = await this.satirTazele(tenantId, id);

    if (satir.durum === "beklemede") {
      throw new BadRequestException("Bu satır zaten onay bekliyor");
    }
    if (satir.hareketId) {
      // Fişi ve cari hareketini siler; kapalı dönemin kaydı bozulamaz.
      await this.donemKilidi.tarihDogrula(tenantId, satir.tarih, "ekstre eşleşmesini geri alma");
      await this.hareketGeriAl(tenantId, satir.hareketId);
    }

    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaEkstreSatir.update({
        where: { id },
        data: { durum: "beklemede", cariId: null, faturaId: null, hareketId: null },
      }),
    );
  }

  // ─── YARDIMCILAR ───────────────────────────────────────────────────────────

  private async hesapGetir(tenantId: string, bankaHesapId: string) {
    const hesap = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaHesap.findUnique({ where: { id: bankaHesapId } }),
    );
    if (!hesap) throw new NotFoundException("Banka hesabı bulunamadı");
    return hesap;
  }

  private async satirTazele(tenantId: string, id: string) {
    const satir = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaEkstreSatir.findUnique({
        where: { id },
        include: { bankaHesap: { select: { dovizCinsi: true } } },
      }),
    );
    if (!satir) throw new NotFoundException("Ekstre satırı bulunamadı");

    // Fiş elle silinmişse satır kilitli kalmasın.
    if (satir.durum === "eslesti" && satir.hareketId) {
      const hareket = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.kasaBankaHareket.findUnique({
          where: { id: satir.hareketId as string },
          select: { id: true },
        }),
      );
      if (!hareket) {
        await this.prisma.tenantIslem(tenantId, (tx) =>
          tx.bankaEkstreSatir.update({
            where: { id },
            data: { durum: "beklemede", hareketId: null },
          }),
        );
        return { ...satir, durum: "beklemede" as EkstreSatirDurum, hareketId: null };
      }
    }
    return satir;
  }

  /** Fişi ve onun ürettiği cari hareketini birlikte siler. */
  private async hareketGeriAl(tenantId: string, hareketId: string) {
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const hareket = await tx.kasaBankaHareket.findUnique({ where: { id: hareketId }, select: { id: true, kaynakTur: true, karsiHareketId: true } });
      if (hareket?.kaynakTur === "pos_mutabakat") {
        const gidisId = hareket.karsiHareketId;
        if (gidisId) {
          const komisyonHareketleri = await tx.kasaBankaHareket.findMany({ where: { kaynakTur: "pos_mutabakat", kaynakRef: gidisId }, select: { id: true } });
          const komisyonHareketIds = komisyonHareketleri.map((kayit) => kayit.id);
          if (komisyonHareketIds.length > 0) {
            await tx.masrafOdeme.deleteMany({ where: { tenantId, hareketId: { in: komisyonHareketIds } } });
            await tx.masraf.deleteMany({ where: { hareketId: { in: komisyonHareketIds } } });
            await tx.kasaBankaHareket.deleteMany({ where: { id: { in: komisyonHareketIds } } });
          }
        }
        await tx.kasaBankaHareket.deleteMany({ where: { id: { in: [hareket.id, ...(gidisId ? [gidisId] : [])] } } });
        return;
      }
      await tx.cariHareket.deleteMany({
        where: { kaynakTur: "kasa_banka", kaynakRef: hareketId },
      });
      await tx.kasaBankaHareket.deleteMany({ where: { id: hareketId } });
    });
  }

  /**
   * Cari önerisi: karşı IBAN → açıklamadaki VKN → açıklamada geçen unvan.
   * Cari bulunursa o carinin **açık** faturalarından tutarı tutanlar önerilir.
   */
  private async oneriHesapla(
    tenantId: string,
    satir: { tutar: Prisma.Decimal; aciklama: string; karsiIban: string | null; karsiUnvan: string | null; bankaHesap?: { dovizCinsi: string } },
  ) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      let cari: { id: string; kod: string; unvan: string } | null = null;
      let kaynak: CariEslesmeKaynagi = null;

      const sec = { id: true, kod: true, unvan: true };

      if (satir.karsiIban) {
        const iban = satir.karsiIban.replace(/\s/g, "").toUpperCase();
        const bankaKaydi = await tx.cariBankaHesap.findFirst({
          where: { tenantId, iban },
          select: { cari: { select: sec } },
        });
        if (bankaKaydi) {
          cari = bankaKaydi.cari;
          kaynak = "iban";
        } else {
          const c = await tx.cariHesap.findFirst({ where: { tenantId, iban }, select: sec });
          if (c) {
            cari = c;
            kaynak = "iban";
          }
        }
      }

      // Açıklamada VKN/TCKN geçiyorsa en güvenilir ikinci ipucudur.
      if (!cari) {
        const adaylar = satir.aciklama.match(/\d{10,11}/g) ?? [];
        for (const aday of adaylar) {
          const c = await tx.cariHesap.findFirst({
            where: { tenantId, vknTckn: aday },
            select: sec,
          });
          if (c) {
            cari = c;
            kaynak = "vkn";
            break;
          }
        }
      }

      // Son çare: açıklama ya da karşı unvan alanında cari unvanı geçiyor mu?
      // Karşılaştırma ASCII'ye indirgenerek yapılır — bankalar açıklamayı
      // aksansız yazıyor ("TEDARIK MALZEME AS"), kayıt aksanlı olabiliyor.
      if (!cari) {
        const metin = metniNormalle(`${satir.aciklama} ${satir.karsiUnvan ?? ""}`);
        const cariler = await tx.cariHesap.findMany({
          where: { tenantId, aktif: true },
          select: sec,
        });
        // En uzun eşleşen unvan kazanır ("ABC" ile "ABC Ltd." ikisi de geçerse).
        let enIyi: { id: string; kod: string; unvan: string } | null = null;
        let enIyiUzunluk = 0;
        for (const c of cariler) {
          const unvan = metniNormalle(c.unvan);
          if (unvan.length >= 4 && metin.includes(unvan) && unvan.length > enIyiUzunluk) {
            enIyi = c;
            enIyiUzunluk = unvan.length;
          }
        }
        if (enIyi) {
          cari = enIyi;
          kaynak = "unvan";
        }
      }

      if (!cari) return { cari: null, cariEslesmeKaynagi: null, faturalar: [] };

      const faturalar = await this.acikFaturalar(tx, tenantId, cari.id, satir.tutar, satir.bankaHesap?.dovizCinsi);
      return { cari, cariEslesmeKaynagi: kaynak, faturalar };
    });
  }

  /**
   * Carinin ödenmemiş kesin faturaları; tutarı ekstre satırıyla birebir tutan
   * fatura başa alınır. Para girişi satış, çıkış alış faturasını kapatır.
   */
  private async acikFaturalar(
    tx: Prisma.TransactionClient,
    tenantId: string,
    cariId: string,
    tutar: Prisma.Decimal,
    hesapDovizi?: string,
  ) {
    const girisMi = !tutar.isNegative();
    const tipler = girisMi
      ? (["satis", "alis_iade"] as const)
      : (["alis", "satis_iade"] as const);

    const faturalar = await tx.fatura.findMany({
      where: { tenantId, cariId, durum: "kesin", tip: { in: [...tipler] } },
      orderBy: { tarih: "desc" },
      take: 50,
      select: { id: true, no: true, tarih: true, durum: true, dovizCinsi: true, genelToplam: true, ...FATURA_ODEME_SECIMI },
    });
    if (faturalar.length === 0) return [];

    // KSB-07: kalan, faturanın dövizinde ortak ödeme durumundan gelir.
    const mutlak = tutar.abs();
    const acik = faturalar
      .map((f) => ({ ...f, ...faturaOdemeDurumu(f) }))
      .filter((f) => f.kalan.greaterThan(0));

    return acik
      .map((f) => ({
        id: f.id,
        no: f.no,
        tarih: f.tarih.toISOString().slice(0, 10),
        dovizCinsi: f.dovizCinsi,
        genelToplam: f.genelToplam.toFixed(2),
        odenen: f.odenen.toFixed(2),
        kalan: f.kalan.toFixed(2),
        /** Kalan tutar ekstre satırıyla aynı dövizde birebir aynıysa güçlü öneri. */
        tamEslesme: (!hesapDovizi || f.dovizCinsi === hesapDovizi) && f.kalan.equals(mutlak),
      }))
      .sort((a, b) => Number(b.tamEslesme) - Number(a.tamEslesme))
      .slice(0, 10);
  }
}
