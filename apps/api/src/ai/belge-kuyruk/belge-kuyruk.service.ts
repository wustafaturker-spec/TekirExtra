import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Job, Queue, QueueEvents, Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../core/prisma.service";
import { redisBaglantisi } from "../../core/redis-baglantisi";
import { baglamlaCalistir } from "../../core/istek-baglami";
import { DepoService } from "../../ekler/depo.service";
import { AiService } from "../ai.service";
import type { FisFaturaOcrSonuc } from "../ai.semalar";
import {
  AZAMI_TOPLU_ADET,
  belgeDosyasiniDogrula,
  type DogrulanmisDosya,
} from "./dosya-dogrulayici";
import {
  belgeAlanKanitlariniOlustur,
  belgeCaprazDogrula,
} from "./belge-kanit-dogrulayici";
import type {
  BelgeAktarGirdisi,
  KullaniciDuzeltmesi,
} from "./belge-kuyruk.semalar";

export const KUYRUK_ADI = "tekirextra-belge-ocr";

export interface BelgeIsVerisi {
  tenantId: string;
  userId: string;
  rol: string;
  kuyrukIsId: string;
  ocrKayitId: string;
  correlationId: string;
}

@Injectable()
export class BelgeKuyrukService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BelgeKuyrukService.name);
  private readonly kuyruk = new Queue<BelgeIsVerisi>(KUYRUK_ADI, {
    connection: redisBaglantisi(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { age: 86_400 * 7, count: 5_000 },
      removeOnFail: { age: 86_400 * 30 },
    },
  });
  private readonly kuyrukOlaylari = new QueueEvents(KUYRUK_ADI, {
    connection: redisBaglantisi(),
  });
  private worker?: Worker<BelgeIsVerisi>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly depoService: DepoService,
    private readonly aiService: AiService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.kuyruk.on("error", (h) =>
      this.logger.error(`Belge OCR kuyruğu Redis hatası: ${h.message}`),
    );
    this.kuyrukOlaylari.on("error", (h) =>
      this.logger.error(`Belge OCR kuyruk olayları hatası: ${h.message}`),
    );

    if (process.env.TEKIR_WORKER !== "1") return;

    this.worker = new Worker<BelgeIsVerisi>(
      KUYRUK_ADI,
      (is) => this.isleBelge(is),
      {
        connection: redisBaglantisi(),
        concurrency: Number(process.env.BELGE_OCR_WORKER_CONCURRENCY || 2),
        lockDuration: 180_000,
      },
    );

    this.worker.on("completed", (is) =>
      this.logger.log(
        `OCR işi tamamlandı: job=${is.id} ocrId=${is.data.ocrKayitId}`,
      ),
    );
    this.worker.on("failed", (is, err) =>
      this.logger.error(
        `OCR işi başarısız: job=${is?.id} ocrId=${is?.data.ocrKayitId} hata=${err.message}`,
      ),
    );

    await this.worker.waitUntilReady();
    this.logger.log("Belge OCR worker hazır.");
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.kuyrukOlaylari.close();
    await this.kuyruk.close();
  }

  /**
   * Toplu fiş/fatura belgelerini doğrular, MinIO'ya yükler, kuyruğa ekler.
   */
  async kuyrugaEkle(
    tenantId: string,
    userId: string,
    rol: string,
    dosyalar: Array<{ ad: string; buffer: Buffer }>,
  ): Promise<{
    kuyrukIsId: string;
    toplamBelge: number;
    belgeler: Array<{ id: string; dosyaAdi: string; durum: string; mukerrerAdayId: string | null }>;
  }> {
    if (!dosyalar || dosyalar.length === 0) {
      throw new BadRequestException("En az 1 belge yüklenmelidir.");
    }
    if (dosyalar.length > AZAMI_TOPLU_ADET) {
      throw new BadRequestException(
        `Tek seferde en fazla ${AZAMI_TOPLU_ADET} belge yüklenebilir.`,
      );
    }

    // 1. Her dosyayı doğrula ve meta verilerini çıkar
    const dogrulanmis: Array<{
      ad: string;
      buffer: Buffer;
      bilgi: DogrulanmisDosya;
    }> = [];

    for (const d of dosyalar) {
      const bilgi = await belgeDosyasiniDogrula(d.buffer);
      dogrulanmis.push({ ad: d.ad, buffer: d.buffer, bilgi });
    }

    // 2. Veritabanında Kuyruk Üst Kaydı (BelgeKuyrukIsi) ve Belgeleri oluştur
    const doksanGunOnce = new Date(Date.now() - 90 * 86_400_000);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kuyrukIsi = await tx.belgeKuyrukIsi.create({
        data: {
          tenantId,
          kullaniciId: userId,
          toplamBelge: dogrulanmis.length,
          durum: "KUYRUKTA",
        },
      });

      const eklenenBelgeler: Array<{
        id: string;
        dosyaAdi: string;
        durum: string;
        mukerrerAdayId: string | null;
      }> = [];

      for (const d of dogrulanmis) {
        // Mükerrer dosya kontrolü (son 90 günde aynı hash)
        const onceki = await tx.belgeOcrKaydi.findFirst({
          where: {
            tenantId,
            dosyaHash: d.bilgi.dosyaHash,
            createdAt: { gte: doksanGunOnce },
          },
          select: { id: true },
        });

        const ocrKaydi = await tx.belgeOcrKaydi.create({
          data: {
            tenantId,
            kullaniciId: userId,
            kuyrukIsId: kuyrukIsi.id,
            dosyaAdi: d.ad,
            dosyaBoyutu: d.bilgi.dosyaBoyutu,
            dosyaHash: d.bilgi.dosyaHash,
            sayfaSayisi: d.bilgi.sayfaSayisi,
            mimeTip: d.bilgi.mimeTip,
            belgeTuru: "FIS_FATURA",
            kanal: "WEB",
            durum: "KUYRUKTA",
            hamMetin: d.bilgi.hamMetin,
            cikarilanVeri: {},
            mukerrerAdayId: onceki?.id ?? null,
          },
        });

        // MinIO'ya yükle
        const depoAnahtari = `${tenantId}/belge-kuyruk/${ocrKaydi.id}-${d.ad}`;
        await this.depoService.yukle(depoAnahtari, d.buffer, d.bilgi.mimeTip);

        // Ek kaydı bağla
        const ek = await tx.ek.create({
          data: {
            tenantId,
            sahipTur: "belge",
            sahipId: ocrKaydi.id,
            dosyaAdi: d.ad,
            mimeTip: d.bilgi.mimeTip,
            boyut: d.bilgi.dosyaBoyutu,
            depoAnahtari,
            yukleyenUserId: userId,
          },
        });

        await tx.belgeOcrKaydi.update({
          where: { id: ocrKaydi.id },
          data: { ekId: ek.id },
        });

        // BullMQ kuyruğuna ekle
        await this.kuyruk.add(
          "belge-isle",
          {
            tenantId,
            userId,
            rol,
            kuyrukIsId: kuyrukIsi.id,
            ocrKayitId: ocrKaydi.id,
            correlationId: crypto.randomUUID(),
          },
          {
            jobId: `ocr-${ocrKaydi.id}`,
          },
        );

        eklenenBelgeler.push({
          id: ocrKaydi.id,
          dosyaAdi: d.ad,
          durum: "KUYRUKTA",
          mukerrerAdayId: onceki?.id ?? null,
        });
      }

      return {
        kuyrukIsId: kuyrukIsi.id,
        toplamBelge: dogrulanmis.length,
        belgeler: eklenenBelgeler,
      };
    });
  }

  /**
   * BullMQ worker tarafından çağrılan tek belge işleme motoru.
   */
  async isleBelge(is: Job<BelgeIsVerisi>): Promise<void> {
    const { tenantId, userId, rol, kuyrukIsId, ocrKayitId } = is.data;

    await baglamlaCalistir(
      { tenantId, userId, rol: rol as any },
      async () => {
        // Durumu ISLENIYOR yap
        await this.prisma.tenantIslem(tenantId, async (tx) => {
          await tx.belgeOcrKaydi.update({
            where: { id: ocrKayitId },
            data: { durum: "ISLENIYOR" },
          });
          await tx.belgeKuyrukIsi.update({
            where: { id: kuyrukIsId },
            data: { durum: "ISLENIYOR" },
          });
        });

        try {
          // Belgeyi ve ek bilgisini çek
          const belge = await this.prisma.tenantIslem(tenantId, (tx) =>
            tx.belgeOcrKaydi.findUnique({
              where: { id: ocrKayitId },
            }),
          );
          if (!belge || !belge.ekId) {
            throw new NotFoundException("Belge veya ek kaydı bulunamadı.");
          }

          const ek = await this.prisma.tenantIslem(tenantId, (tx) =>
            tx.ek.findUnique({ where: { id: belge.ekId! } }),
          );
          if (!ek) throw new NotFoundException("Depo eki bulunamadı.");

          const tampon = await this.depoService.indir(ek.depoAnahtari);

          // OCR Çıkarımı: PDF ise ham metin, görsel ise base64 ile çağır
          let taramaGirdisi: { gorselBase64?: string; mimeType: any; hamMetin?: string; belgeTipi: "fis_fatura" };
          if (belge.mimeTip === "application/pdf") {
            taramaGirdisi = {
              belgeTipi: "fis_fatura",
              mimeType: "application/pdf",
              hamMetin: belge.hamMetin || undefined,
            };
          } else {
            taramaGirdisi = {
              belgeTipi: "fis_fatura",
              gorselBase64: `data:${belge.mimeTip};base64,${tampon.toString("base64")}`,
              mimeType: belge.mimeTip as any,
              hamMetin: belge.hamMetin || undefined,
            };
          }

          const tarama = await this.aiService.fisFaturaOcrTara(
            tenantId,
            taramaGirdisi,
            "WEB",
          );

          const cikarilan = tarama.dogrulama.veri;

          // Alan Kanıtları ve Doğrulama
          const alanKanitlari = belgeAlanKanitlariniOlustur(
            cikarilan,
            belge.hamMetin,
          );

          // Cari eşleşme kontrolü
          let eslesmeTuru: "TAM_VKN" | "UNVAN_BENZERLIGI" | "ESLESMEDI" = "ESLESMEDI";
          let eslesenCari: { id: string; unvan: string; kod: string } | null = null;

          if (cikarilan.saticiVknTckn) {
            const vkn = cikarilan.saticiVknTckn.replace(/\D/g, "");
            const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
              tx.cariHesap.findFirst({
                where: { vknTckn: vkn, aktif: true },
                select: { id: true, unvan: true, kod: true },
              }),
            );
            if (cari) {
              eslesenCari = cari;
              eslesmeTuru = "TAM_VKN";
            }
          }

          if (!eslesenCari && cikarilan.saticiUnvan) {
            const benzer = await this.prisma.tenantIslem(tenantId, (tx) =>
              tx.cariHesap.findFirst({
                where: {
                  unvan: { contains: cikarilan.saticiUnvan.slice(0, 15), mode: "insensitive" },
                  aktif: true,
                },
                select: { id: true, unvan: true, kod: true },
              }),
            );
            if (benzer) {
              eslesenCari = benzer;
              eslesmeTuru = "UNVAN_BENZERLIGI";
            }
          }

          const caprazDogrulama = belgeCaprazDogrula(
            cikarilan,
            eslesenCari,
            eslesmeTuru,
          );

          const guvenPuani = typeof cikarilan.guvenSkoru === "number" ? cikarilan.guvenSkoru : 0.85;

          // Durum belirleme: Çelişki varsa veya güven düşükse INCELENECEK, aksi halde ONAYLANDI
          const sonDurum =
            caprazDogrulama.celiskiler.length > 0 || guvenPuani < 0.75
              ? "INCELENECEK"
              : "ONAYLANDI";

          await this.prisma.tenantIslem(tenantId, async (tx) => {
            await tx.belgeOcrKaydi.update({
              where: { id: ocrKayitId },
              data: {
                durum: sonDurum,
                cikarilanVeri: cikarilan as unknown as Prisma.InputJsonValue,
                alanKanitlari: alanKanitlari as unknown as Prisma.InputJsonValue,
                dogrulamaSonucu: caprazDogrulama as unknown as Prisma.InputJsonValue,
                guvenPuani: new Prisma.Decimal(guvenPuani),
              },
            });

            // Kuyruk sayacını atomik güncelle
            await tx.belgeKuyrukIsi.update({
              where: { id: kuyrukIsId },
              data: { tamamlananBelge: { increment: 1 } },
            });
          });
        } catch (hata) {
          const mesaj = hata instanceof Error ? hata.message : String(hata);
          await this.prisma.tenantIslem(tenantId, async (tx) => {
            await tx.belgeOcrKaydi.update({
              where: { id: ocrKayitId },
              data: {
                durum: "HATA",
                hataMesaji: mesaj,
              },
            });
            await tx.belgeKuyrukIsi.update({
              where: { id: kuyrukIsId },
              data: { hataliBelge: { increment: 1 } },
            });
          });
        } finally {
          // Kuyruk işi tamamlandı mı denetle
          await this.kuyrukDurumunuGuncelle(tenantId, kuyrukIsId);
        }
      },
    );
  }

  /**
   * Kuyruk işinin bütün belgeleri bittiğinde genel durumunu günceller.
   */
  private async kuyrukDurumunuGuncelle(tenantId: string, kuyrukIsId: string): Promise<void> {
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const is = await tx.belgeKuyrukIsi.findUnique({
        where: { id: kuyrukIsId },
      });
      if (!is) return;

      const toplam = is.toplamBelge;
      const biten = is.tamamlananBelge + is.hataliBelge;

      if (biten >= toplam) {
        const yeniDurum =
          is.hataliBelge === 0
            ? "TAMAMLANDI"
            : is.tamamlananBelge > 0
              ? "KISMI_BASARI"
              : "HATA";
        await tx.belgeKuyrukIsi.update({
          where: { id: kuyrukIsId },
          data: {
            durum: yeniDurum,
            tamamlandiAt: new Date(),
          },
        });
      }
    });
  }

  /**
   * Kuyruk işlerini listeler.
   */
  async isleriListele(tenantId: string, sayfa = 1, limit = 20) {
    const atla = (sayfa - 1) * limit;
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [toplam, kayitlar] = await Promise.all([
        tx.belgeKuyrukIsi.count({ where: { tenantId } }),
        tx.belgeKuyrukIsi.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          skip: atla,
          take: limit,
          include: {
            belgeler: {
              select: {
                id: true,
                dosyaAdi: true,
                durum: true,
                guvenPuani: true,
                mukerrerAdayId: true,
                createdAt: true,
              },
            },
          },
        }),
      ]);
      return { toplam, sayfa, limit, kayitlar };
    });
  }

  /**
   * Tek bir kuyruk işinin ayrıntısını getirir.
   */
  async isDetay(tenantId: string, isId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const is = await tx.belgeKuyrukIsi.findUnique({
        where: { id: isId },
        include: {
          belgeler: {
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!is) throw new NotFoundException("Kuyruk işi bulunamadı.");
      return is;
    });
  }

  /**
   * Tek bir belgenin ayrıntısını ve çıkarılan alanları getirir.
   */
  async belgeDetay(tenantId: string, belgeId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belgeOcrKaydi.findUnique({
        where: { id: belgeId },
      });
      if (!belge) throw new NotFoundException("Belge kaydı bulunamadı.");
      return belge;
    });
  }

  /**
   * Kullanıcı düzeltmelerini kaydeder.
   * Orijinal çıkarım (cikarilanVeri) korunur; düzeltmeler kullaniciDuzeltmesi alanına yazılır.
   * Çapraz doğrulama yeniden çalıştırılır; çelişkiler giderilmişse durum güncellenir.
   */
  async belgeDuzelt(
    tenantId: string,
    belgeId: string,
    duzeltme: KullaniciDuzeltmesi,
  ) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belgeOcrKaydi.findUnique({
        where: { id: belgeId },
      });
      if (!belge) throw new NotFoundException("Belge kaydı bulunamadı.");
      if (belge.durum === "ISLENDI") {
        throw new BadRequestException("Zaten kayda aktarılmış belge düzeltilemez.");
      }

      const orijinal = (belge.cikarilanVeri ?? {}) as FisFaturaOcrSonuc;
      const birlestirilmis: FisFaturaOcrSonuc = {
        ...orijinal,
        ...(duzeltme.saticiUnvan !== undefined ? { saticiUnvan: duzeltme.saticiUnvan } : {}),
        ...(duzeltme.saticiVknTckn !== undefined ? { saticiVknTckn: duzeltme.saticiVknTckn } : {}),
        ...(duzeltme.belgeNo !== undefined ? { belgeNo: duzeltme.belgeNo } : {}),
        ...(duzeltme.tarih !== undefined ? { tarih: duzeltme.tarih } : {}),
        ...(duzeltme.paraBirimi !== undefined ? { paraBirimi: duzeltme.paraBirimi } : {}),
        ...(duzeltme.genelToplam !== undefined ? { genelToplam: duzeltme.genelToplam } : {}),
        ...(duzeltme.toplamMatrah !== undefined ? { toplamMatrah: duzeltme.toplamMatrah } : {}),
        ...(duzeltme.toplamKdv !== undefined ? { toplamKdv: duzeltme.toplamKdv } : {}),
        ...(duzeltme.kdvKirilimi !== undefined ? { kdvKirilimi: duzeltme.kdvKirilimi } : {}),
      };

      // Cari bilgisi çöz
      let eslesenCari: { id: string; unvan: string; kod: string } | null = null;
      if (duzeltme.eslesenCariId) {
        eslesenCari = await tx.cariHesap.findUnique({
          where: { id: duzeltme.eslesenCariId },
          select: { id: true, unvan: true, kod: true },
        });
      }

      const yeniDogrulama = belgeCaprazDogrula(
        birlestirilmis,
        eslesenCari,
        duzeltme.eslesenCariId ? "TAM_VKN" : "ESLESMEDI",
      );

      const yeniDurum =
        yeniDogrulama.celiskiler.length === 0 ? "ONAYLANDI" : "INCELENECEK";

      return tx.belgeOcrKaydi.update({
        where: { id: belgeId },
        data: {
          kullaniciDuzeltmesi: duzeltme as unknown as Prisma.InputJsonValue,
          dogrulamaSonucu: yeniDogrulama as unknown as Prisma.InputJsonValue,
          durum: yeniDurum,
        },
      });
    });
  }

  /**
   * İncelenmiş belgeyi Masraf veya Alış Faturası taslağına dönüştürür.
   * P-09: Çelişkiler çözülmeden kayıt aktarımı engellenir.
   */
  async belgeAktar(
    tenantId: string,
    userId: string,
    belgeId: string,
    girdi: BelgeAktarGirdisi,
  ) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belgeOcrKaydi.findUnique({
        where: { id: belgeId },
      });
      if (!belge) throw new NotFoundException("Belge kaydı bulunamadı.");
      if (belge.durum === "ISLENDI") {
        throw new BadRequestException("Bu belge zaten bir kayda aktarılmış.");
      }

      // Çelişki kontrolü
      const dogrulama = (belge.dogrulamaSonucu ?? {}) as { celiskiler?: string[] };
      if (dogrulama.celiskiler && dogrulama.celiskiler.length > 0) {
        throw new BadRequestException(
          `Belgedeki çelişkiler giderilmeden aktarım yapılamaz: ${dogrulama.celiskiler.join("; ")}`,
        );
      }

      const orijinal = (belge.cikarilanVeri ?? {}) as FisFaturaOcrSonuc;
      const duzeltme = (belge.kullaniciDuzeltmesi ?? {}) as KullaniciDuzeltmesi;
      const veri: FisFaturaOcrSonuc = {
        ...orijinal,
        ...duzeltme,
      };

      const genelToplam = Number(veri.genelToplam || 0);
      const toplamMatrah = Number(veri.toplamMatrah || (genelToplam - (veri.toplamKdv || 0)));
      const toplamKdv = Number(veri.toplamKdv || 0);
      const tarih = veri.tarih ? new Date(veri.tarih) : new Date();

      if (girdi.hedef === "MASRAF") {
        // Varsayılan masraf kategorisi
        let kategori = await tx.masrafKategori.findFirst({
          where: { tenantId, aktif: true },
          select: { id: true },
        });
        if (!kategori) {
          kategori = await tx.masrafKategori.create({
            data: {
              tenantId,
              ad: "Genel Giderler",
              aktif: true,
            },
            select: { id: true },
          });
        }

        const masraf = await tx.masraf.create({
          data: {
            tenantId,
            kategoriId: kategori.id,
            belgeTuru: veri.belgeTuru === "FIS" ? "fis" : "fatura",
            belgeNo: veri.belgeNo ?? undefined,
            tarih,
            saticiUnvan: veri.saticiUnvan ?? "Bilinmeyen Satıcı",
            vknTckn: veri.saticiVknTckn ?? undefined,
            matrah: new Prisma.Decimal(toplamMatrah),
            kdvOrani: new Prisma.Decimal(veri.kdvKirilimi?.[0]?.oran ?? 20),
            kdvTutari: new Prisma.Decimal(toplamKdv),
            toplam: new Prisma.Decimal(genelToplam),
            dovizCinsi: "TRY",
            durum: "taslak",
            aciklama: girdi.aciklama ?? `${veri.saticiUnvan || "Belge"} masraf kaydı (OCR)`,
          },
        });

        // Ek dosyasını masrafa bağla
        if (belge.ekId) {
          await tx.ek.update({
            where: { id: belge.ekId },
            data: { sahipTur: "masraf", sahipId: masraf.id },
          });
        }

        // Belgeyi ISLENDI yap
        await tx.belgeOcrKaydi.update({
          where: { id: belgeId },
          data: {
            durum: "ISLENDI",
            islendiAt: new Date(),
            olusanKayitlar: { masrafIdler: [masraf.id] },
          },
        });

        return { basarili: true, hedef: "MASRAF", masrafId: masraf.id };
      }

      if (girdi.hedef === "ALIS_FATURASI") {
        // Cari hesap bul veya oluştur
        let cariId: string | null = null;
        if (veri.saticiVknTckn) {
          const vkn = veri.saticiVknTckn.replace(/\D/g, "");
          const cari = await tx.cariHesap.findFirst({
            where: { tenantId, vknTckn: vkn, aktif: true },
            select: { id: true },
          });
          cariId = cari?.id ?? null;
        }

        if (!cariId && veri.saticiUnvan) {
          const yeniCari = await tx.cariHesap.create({
            data: {
              tenantId,
              tip: "tedarikci",
              kod: `CAR-${Date.now().toString().slice(-6)}`,
              unvan: veri.saticiUnvan,
              vknTckn: veri.saticiVknTckn?.replace(/\D/g, "") || undefined,
              aktif: true,
            },
            select: { id: true },
          });
          cariId = yeniCari.id;
        }

        if (!cariId) {
          throw new BadRequestException("Fatura oluşturmak için satıcı cari kartı zorunludur.");
        }

        const fatura = await tx.fatura.create({
          data: {
            tenantId,
            tip: "alis",
            durum: "taslak",
            no: veri.belgeNo || `ALIS-${Date.now().toString().slice(-8)}`,
            tarih,
            cariId,
            toplamBrut: new Prisma.Decimal(toplamMatrah),
            toplamSatirIskontosu: new Prisma.Decimal(0),
            genelIskontoToplam: new Prisma.Decimal(0),
            toplamMatrah: new Prisma.Decimal(toplamMatrah),
            toplamKdv: new Prisma.Decimal(toplamKdv),
            toplamNetKdv: new Prisma.Decimal(toplamKdv),
            toplamTevkifat: new Prisma.Decimal(0),
            toplamEkVergi: new Prisma.Decimal(0),
            toplamStopaj: new Prisma.Decimal(0),
            genelToplam: new Prisma.Decimal(genelToplam),
            dovizCinsi: "TRY",
            kur: new Prisma.Decimal(1),
            aciklama: girdi.aciklama ?? `${veri.saticiUnvan} Alış Faturası (OCR)`,
          },
        });

        if (belge.ekId) {
          await tx.ek.update({
            where: { id: belge.ekId },
            data: { sahipTur: "fatura", sahipId: fatura.id },
          });
        }

        await tx.belgeOcrKaydi.update({
          where: { id: belgeId },
          data: {
            durum: "ISLENDI",
            islendiAt: new Date(),
            olusanKayitlar: { faturaId: fatura.id },
          },
        });

        return { basarili: true, hedef: "ALIS_FATURASI", faturaId: fatura.id };
      }

      throw new BadRequestException("Geçersiz hedef türü.");
    });
  }

  /**
   * Belgeyi reddeder.
   */
  async belgeReddet(tenantId: string, belgeId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belgeOcrKaydi.findUnique({
        where: { id: belgeId },
      });
      if (!belge) throw new NotFoundException("Belge kaydı bulunamadı.");
      if (belge.durum === "ISLENDI") {
        throw new BadRequestException("Kayda aktarılmış belge reddedilemez.");
      }

      return tx.belgeOcrKaydi.update({
        where: { id: belgeId },
        data: { durum: "REDDEDILDI" },
      });
    });
  }
}
