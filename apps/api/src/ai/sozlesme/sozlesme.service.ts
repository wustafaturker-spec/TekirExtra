import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { pdfMetniniAyikla } from "../../asistan-soru/pdf-metin-ayristirici";
import { PrismaService } from "../../core/prisma.service";
import { DepoService } from "../../ekler/depo.service";
import { AiProviderFactory } from "../saglayici/ai-provider.factory";
import { kiraciSaglayicisi } from "../saglayici/kiraci-saglayici";
import {
  metniParcala,
  ragSistemIstemi,
  type KaynakAlinti,
  type SozlesmeDurumu,
  type SozlesmeSoruSonucu,
  type SozlesmeTuru,
} from "./sozlesme.kurallari";

export interface SozlesmeYukleGirdisi {
  baslik: string;
  tur?: SozlesmeTuru;
  cariId?: string;
  yetkiliRoller?: string[];
  gecerlilikBitis?: string;
}

export interface SozlesmeFiltresi {
  tur?: SozlesmeTuru;
  durum?: SozlesmeDurumu;
  cariId?: string;
  arama?: string;
}

interface SqlParcaSonucu {
  id: string;
  belgeId: string;
  belgeBaslik: string;
  surum: number;
  sayfaNo: number;
  bolumBasligi: string | null;
  icerik: string;
  skor: number;
  yetkiliRoller: unknown;
}

@Injectable()
export class SozlesmeService {
  private readonly logger = new Logger(SozlesmeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly depo: DepoService,
  ) {}

  /**
   * P-10: Sözleşme veya şartname belgesini yükler, metnini ayıklar, parçalar ve saklar.
   */
  async yukle(
    tenantId: string,
    userId: string,
    dosya: { buffer: Buffer; dosyaAdi: string; mimeTip: string },
    meta: SozlesmeYukleGirdisi,
  ) {
    if (!dosya.buffer || dosya.buffer.length === 0) {
      throw new BadRequestException("Yüklenecek dosya içeriği boş olamaz.");
    }
    if (dosya.buffer.length > 25 * 1024 * 1024) {
      throw new BadRequestException("Dosya boyutu 25 MB sınırını aşamaz.");
    }

    // 1. Metin çıkarma (PDF veya Düz Metin)
    let hamMetin: string | null = null;
    let sayfaSayisi = 1;

    if (dosya.mimeTip === "application/pdf" || dosya.dosyaAdi.toLowerCase().endsWith(".pdf")) {
      hamMetin = await pdfMetniniAyikla(dosya.buffer, 100);
      if (hamMetin) {
        const sayfaEslesmeleri = hamMetin.match(/\[Sayfa\s+(\d+)\]/g);
        if (sayfaEslesmeleri && sayfaEslesmeleri.length > 0) {
          sayfaSayisi = sayfaEslesmeleri.length;
        }
      }
    } else if (
      dosya.mimeTip.startsWith("text/") ||
      dosya.dosyaAdi.toLowerCase().endsWith(".txt") ||
      dosya.dosyaAdi.toLowerCase().endsWith(".md")
    ) {
      hamMetin = dosya.buffer.toString("utf-8");
    }

    if (!hamMetin || hamMetin.trim().length < 30) {
      throw new BadRequestException(
        "Belgeden okunabilir metin katmanı çıkarılamadı. Lütfen aranabilir (dijital) PDF veya metin dosyası yükleyin.",
      );
    }

    // 2. Parçalama (Chunking)
    const parcalar = metniParcala(hamMetin);
    if (parcalar.length === 0) {
      throw new BadRequestException("Belge parçalanamadı; yeterli metin içeriği bulunamadı.");
    }

    // 3. Dosyayı nesne deposuna (MinIO / S3) yükle
    const guvenliAd = dosya.dosyaAdi.replace(/[^a-zA-Z0-9._-]/g, "_");
    const depoAnahtari = `${tenantId}/sozlesmeler/${randomUUID()}-${guvenliAd}`;
    await this.depo.yukle(depoAnahtari, dosya.buffer, dosya.mimeTip);

    // 4. Belge ve parçalarını veritabanına yaz
    const ozet = hamMetin.slice(0, 400).replace(/\s+/g, " ").trim();
    const gecerlilik = meta.gecerlilikBitis ? new Date(meta.gecerlilikBitis) : null;

    const belge = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const b = await tx.sozlesmeBelge.create({
        data: {
          tenantId,
          baslik: meta.baslik.trim(),
          tur: meta.tur ?? "sozlesme",
          cariId: meta.cariId || null,
          dosyaAdi: dosya.dosyaAdi,
          mimeTip: dosya.mimeTip,
          boyut: dosya.buffer.length,
          depoAnahtari,
          surum: 1,
          durum: "hazir",
          ozet,
          sayfaSayisi,
          gecerlilikBitis: gecerlilik,
          yetkiliRoller: meta.yetkiliRoller ? (meta.yetkiliRoller as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          yukleyenUserId: userId,
          parcalar: {
            create: parcalar.map((p) => ({
              tenantId,
              parcaNo: p.parcaNo,
              sayfaNo: p.sayfaNo,
              bolumBasligi: p.bolumBasligi,
              icerik: p.icerik,
              karakterSayisi: p.karakterSayisi,
              kelimeSayisi: p.kelimeSayisi,
            })),
          },
        },
        include: {
          cari: { select: { id: true, unvan: true, kod: true } },
          _count: { select: { parcalar: true } },
        },
      });
      return b;
    });

    this.logger.log(`Yeni sözleşme/şartname yüklendi: ${belge.id} (${parcalar.length} parça)`);
    return belge;
  }

  /**
   * P-10: Sözleşmeleri listeler. Yetki kontrolü (P-01 & RLS) uygular.
   */
  async listele(
    tenantId: string,
    userRol: string,
    filtre: SozlesmeFiltresi = {},
  ) {
    const where: Prisma.SozlesmeBelgeWhereInput = {
      tenantId,
      ...(filtre.tur ? { tur: filtre.tur } : {}),
      ...(filtre.durum ? { durum: filtre.durum } : { durum: { not: "arsivlendi" } }),
      ...(filtre.cariId ? { cariId: filtre.cariId } : {}),
      ...(filtre.arama
        ? {
            OR: [
              { baslik: { contains: filtre.arama, mode: "insensitive" } },
              { dosyaAdi: { contains: filtre.arama, mode: "insensitive" } },
              { ozet: { contains: filtre.arama, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const belgeler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.sozlesmeBelge.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        include: {
          cari: { select: { id: true, unvan: true, kod: true } },
          yukleyen: { select: { id: true, adSoyad: true, eposta: true } },
          _count: { select: { parcalar: true, sonrakiSurumler: true } },
        },
      }),
    );

    // Rol yetki süzgeci: Eğer belgede yetkiliRoller belirtilmişse ve kullanıcı yönetici değilse filtrele
    return belgeler.filter((b) => {
      if (userRol === "yonetici") return true;
      if (!b.yetkiliRoller || !Array.isArray(b.yetkiliRoller) || b.yetkiliRoller.length === 0) {
        return true;
      }
      return (b.yetkiliRoller as string[]).includes(userRol);
    });
  }

  /**
   * P-10: Belge ayrıntısı ve parça listesi.
   */
  async detay(tenantId: string, id: string, userRol: string) {
    const belge = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.sozlesmeBelge.findUnique({
        where: { id },
        include: {
          cari: { select: { id: true, unvan: true, kod: true } },
          yukleyen: { select: { id: true, adSoyad: true, eposta: true } },
          oncekiSurum: { select: { id: true, baslik: true, surum: true, createdAt: true } },
          sonrakiSurumler: { select: { id: true, baslik: true, surum: true, createdAt: true } },
          parcalar: {
            orderBy: { parcaNo: "asc" },
            select: { id: true, parcaNo: true, sayfaNo: true, bolumBasligi: true, karakterSayisi: true, kelimeSayisi: true },
          },
        },
      }),
    );

    if (!belge || belge.tenantId !== tenantId) {
      throw new NotFoundException("Sözleşme belgesi bulunamadı.");
    }

    if (userRol !== "yonetici" && belge.yetkiliRoller && Array.isArray(belge.yetkiliRoller) && belge.yetkiliRoller.length > 0) {
      if (!(belge.yetkiliRoller as string[]).includes(userRol)) {
        throw new ForbiddenException("Bu belgeyi görüntüleme yetkiniz bulunmamaktadır.");
      }
    }

    return belge;
  }

  /**
   * P-10: PostgreSQL Full-Text Search (GIN Index) ile semantik tam metin araması.
   */
  async ara(
    tenantId: string,
    userRol: string,
    sorgu: string,
    secenek: { belgeId?: string; cariId?: string; limit?: number } = {},
  ): Promise<KaynakAlinti[]> {
    const temizSorgu = sorgu.trim();
    if (!temizSorgu) return [];

    const limit = secenek.limit && secenek.limit > 0 ? Math.min(secenek.limit, 20) : 6;

    // PostgreSQL websearch_to_tsquery ile arama; eşleşme çıkmazsa plainto_tsquery dene
    const sonuclar = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const hamSonuc = await tx.$queryRaw<SqlParcaSonucu[]>`
        SELECT p.id,
               p.belge_id AS "belgeId",
               b.baslik AS "belgeBaslik",
               b.surum,
               p.sayfa_no AS "sayfaNo",
               p.bolum_basligi AS "bolumBasligi",
               p.icerik,
               b.yetkili_roller AS "yetkiliRoller",
               ts_rank_cd(to_tsvector('turkish', p.icerik), q) AS skor
        FROM sozlesme_belge_parcalar p
        JOIN sozlesme_belgeler b ON b.id = p.belge_id
        CROSS JOIN (
          SELECT COALESCE(
            NULLIF(to_tsquery('turkish', (
              SELECT string_agg(lexeme, ' | ') FROM unnest(to_tsvector('turkish', ${temizSorgu}))
            )), ''::tsquery),
            websearch_to_tsquery('turkish', ${temizSorgu})
          ) AS q
        ) sorgu_tablosu
        WHERE p.tenant_id = ${tenantId}::uuid
          AND b.durum != 'arsivlendi'
          AND (${secenek.belgeId ?? null}::uuid IS NULL OR p.belge_id = ${secenek.belgeId ?? null}::uuid)
          AND (${secenek.cariId ?? null}::uuid IS NULL OR b.cari_id = ${secenek.cariId ?? null}::uuid)
          AND (to_tsvector('turkish', p.icerik) @@ q OR to_tsvector('turkish', COALESCE(p.bolum_basligi, '')) @@ q)
        ORDER BY skor DESC, p.sayfa_no ASC
        LIMIT ${limit};
      `;
      return hamSonuc;
    });

    // Rol yetki süzgeci
    const izinliler = sonuclar.filter((r) => {
      if (userRol === "yonetici") return true;
      if (!r.yetkiliRoller || !Array.isArray(r.yetkiliRoller) || (r.yetkiliRoller as string[]).length === 0) return true;
      return (r.yetkiliRoller as string[]).includes(userRol);
    });

    return izinliler.map((r) => ({
      belgeId: r.belgeId,
      belgeBaslik: r.belgeBaslik,
      surum: r.surum,
      sayfaNo: r.sayfaNo,
      bolumBasligi: r.bolumBasligi ?? undefined,
      alinti: r.icerik,
      skor: Number(r.skor),
    }));
  }

  /**
   * P-10: RAG Soru-Cevap Motoru.
   * PostgreSQL tam metin araması ile en alakalı parçaları derler,
   * uzun bağlam (Long Context) olarak LLM'e sunar, sayfa referanslı yanıt üretir.
   */
  async sor(
    tenantId: string,
    userId: string,
    userRol: string,
    soru: string,
    secenek: { belgeId?: string; cariId?: string } = {},
  ): Promise<SozlesmeSoruSonucu> {
    const temizSoru = soru.trim();
    if (!temizSoru) {
      throw new BadRequestException("Soru metni boş olamaz.");
    }

    // 1. İlgili parçaları getir
    let parcalar = await this.ara(tenantId, userRol, temizSoru, {
      belgeId: secenek.belgeId,
      cariId: secenek.cariId,
      limit: 6,
    });

    // Eğer tam aramayla bulunamadıysa ve tek bir belge seçildiyse, belgenin ilk birkaç parçasını genel bağlam olarak al
    if (parcalar.length === 0 && secenek.belgeId) {
      const ilkParcalar = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.sozlesmeBelgeParca.findMany({
          where: { tenantId, belgeId: secenek.belgeId },
          orderBy: { parcaNo: "asc" },
          take: 5,
          include: { belge: { select: { baslik: true, surum: true, yetkiliRoller: true } } },
        }),
      );

      parcalar = ilkParcalar
        .filter((p) => {
          if (userRol === "yonetici") return true;
          if (!p.belge.yetkiliRoller || !Array.isArray(p.belge.yetkiliRoller)) return true;
          return (p.belge.yetkiliRoller as string[]).includes(userRol);
        })
        .map((p) => ({
          belgeId: p.belgeId,
          belgeBaslik: p.belge.baslik,
          surum: p.belge.surum,
          sayfaNo: p.sayfaNo,
          bolumBasligi: p.bolumBasligi ?? undefined,
          alinti: p.icerik,
          skor: 0.1,
        }));
    }

    if (parcalar.length === 0) {
      return {
        cevap: "İncelenen sözleşme ve şartname metinlerinde bu konuya ilişkin bir hüküm veya bilgi bulunmamaktadır.",
        guvenSkoru: "yok",
        kaynaklar: [],
        toplamParcaSayisi: 0,
      };
    }

    // 2. Uzun bağlam bloklarını oluştur
    const baglamMetinleri = parcalar.map(
      (p, idx) => `[KAYNAK ${idx + 1} | Belge: "${p.belgeBaslik}" (Sürüm: ${p.surum}) | Sayfa: ${p.sayfaNo} | Bölüm/Madde: "${p.bolumBasligi ?? "Genel"}"]
${p.alinti}
`,
    ).join("\n---\n\n");

    const prompt = `KULLANICI SORUSU:
"${temizSoru}"

AŞAĞIDAKİ SÖZLEŞME VE ŞARTNAME METİN PARÇALARINI KULLANARAK CEVAPLA:
${baglamMetinleri}

Lütfen yukarıdaki kurallara ve güvenlik yönergelerine tam uyarak, hangi sayfadan ve maddeden aldığını belirterek cevap ver. Metinde yer almayan hiçbir şeyi uydurma.`;

    // 3. AI sağlayıcısını çağır
    try {
      const { saglayici } = await kiraciSaglayicisi(this.prisma, tenantId, { ozellik: "asistan" });
      const yanit = await saglayici.metinUret({
        prompt,
        sistemRol: ragSistemIstemi(),
      });

      const metinCevap = typeof yanit === "string" ? yanit : String((yanit as any)?.metin ?? "");
      const cevap = metinCevap.trim() || "Sözleşme incelendi ancak yanıt üretilemedi.";
      const guvenSkoru = cevap.includes("bulunmamaktadır") ? "yok" : "yuksek";

      return {
        cevap,
        guvenSkoru,
        kaynaklar: parcalar,
        toplamParcaSayisi: parcalar.length,
      };
    } catch (hata) {
      this.logger.error(`RAG yanıt üretim hatası: ${String(hata)}`);
      // Model hatasında bile olgu uydurmadan güvenli hata mesajı ver
      return {
        cevap: "Yapay zekâ modeli ile iletişim kurulurken bir hata oluştu. İlgili sözleşme parçaları aşağıda listelenmiştir.",
        guvenSkoru: "orta",
        kaynaklar: parcalar,
        toplamParcaSayisi: parcalar.length,
      };
    }
  }

  /**
   * P-10: Belgenin yeni bir sürümünü yükler (Örnek: Sözleşme Revize / Zeyilname).
   */
  async yeniSurum(
    tenantId: string,
    userId: string,
    oncekiBelgeId: string,
    dosya: { buffer: Buffer; dosyaAdi: string; mimeTip: string },
    meta: Partial<SozlesmeYukleGirdisi>,
  ) {
    const onceki = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.sozlesmeBelge.findUnique({ where: { id: oncekiBelgeId } }),
    );
    if (!onceki || onceki.tenantId !== tenantId) {
      throw new NotFoundException("Önceki sözleşme sürümü bulunamadı.");
    }

    // Yeni sürümü yükle
    const yeniBelge = await this.yukle(tenantId, userId, dosya, {
      baslik: meta.baslik ?? onceki.baslik,
      tur: (meta.tur ?? onceki.tur) as SozlesmeTuru,
      cariId: meta.cariId ?? onceki.cariId ?? undefined,
      yetkiliRoller: (meta.yetkiliRoller ?? (onceki.yetkiliRoller as string[])) ?? undefined,
      gecerlilikBitis: meta.gecerlilikBitis ?? (onceki.gecerlilikBitis ? onceki.gecerlilikBitis.toISOString().split("T")[0] : undefined),
    });

    // Sürüm numarasını ve zinciri bağla; önceki sürümü arşivle
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.sozlesmeBelge.update({
        where: { id: yeniBelge.id },
        data: {
          surum: onceki.surum + 1,
          oncekiSurumId: onceki.id,
        },
      });
      await tx.sozlesmeBelge.update({
        where: { id: onceki.id },
        data: { durum: "arsivlendi" },
      });
    });

    return this.detay(tenantId, yeniBelge.id, "yonetici");
  }

  /**
   * P-10: Sözleşme belgesini ve parçalarını siler.
   */
  async sil(tenantId: string, id: string, userRol: string, userId: string) {
    const belge = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.sozlesmeBelge.findUnique({ where: { id } }),
    );
    if (!belge || belge.tenantId !== tenantId) {
      throw new NotFoundException("Silinecek sözleşme belgesi bulunamadı.");
    }

    if (userRol !== "yonetici" && belge.yukleyenUserId !== userId) {
      throw new ForbiddenException("Yalnızca belgeyi yükleyen kullanıcı veya firma yöneticisi silebilir.");
    }

    // Depodan dosyayı sil
    await this.depo.sil(belge.depoAnahtari).catch((err) => {
      this.logger.warn(`Dosya depodan silinemedi: ${belge.depoAnahtari} (${String(err)})`);
    });

    // Veritabanından sil (parçalar Cascade ile silinir)
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.sozlesmeBelge.delete({ where: { id } }),
    );

    return { silindi: true, id };
  }
}
