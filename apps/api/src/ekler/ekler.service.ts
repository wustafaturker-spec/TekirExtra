import { yetkiAnahtari, type YetkiIslemi } from "@tekirextra/shared";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { EkSahipTur, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DepoService } from "./depo.service";
import { dosyaIceriginiDogrula } from "../core/guvenlik/dosya-dogrulama";

/** Belge/dosya ekleri ortak altyapısı (4. aşama S-01). */

const MAKS_BOYUT = 10 * 1024 * 1024; // 10 MB

export interface YuklenenDosya {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const FATURA_EK_ROLLERI = ["muhasebe", "satis", "salt_okunur", "mali_musavir"];
const MASRAF_EK_ROLLERI = ["muhasebe", "depo", "salt_okunur", "mali_musavir"];
const KASA_EK_ROLLERI = ["muhasebe", "salt_okunur"];

/** `roller: null` ortak veridir (firma logosu) ya da kendi denetimi vardır (özlük, sohbet); yönetici her zaman geçer. */
export const EK_ERISIMI: Record<EkSahipTur, { roller: readonly string[] | null; modul: string | null }> = {
  cari: { roller: FATURA_EK_ROLLERI, modul: "cari" },
  stok: { roller: ["muhasebe", "salt_okunur", "uretim_planlama", "depo", "maliyet_muhasebesi"], modul: "stok" },
  fatura: { roller: FATURA_EK_ROLLERI, modul: "fatura" },
  belge: { roller: ["muhasebe", "satis", "salt_okunur"], modul: "satis" },
  kasa_banka: { roller: KASA_EK_ROLLERI, modul: "kasa_banka" },
  cek_senet: { roller: KASA_EK_ROLLERI, modul: "kasa_banka" },
  masraf: { roller: MASRAF_EK_ROLLERI, modul: "masraf_gelir" },
  kira_sozlesme: { roller: MASRAF_EK_ROLLERI, modul: "masraf_gelir" },
  satin_alma_teklif: { roller: ["muhasebe", "satis", "uretim_planlama", "uretim_operatoru", "depo", "kalite", "maliyet_muhasebesi"], modul: "satin_alma" },
  demirbas: { roller: KASA_EK_ROLLERI, modul: "demirbas_arac" },
  personel: { roller: null, modul: "personel" },
  firma: { roller: null, modul: null },
  firma_kase: { roller: null, modul: null },
  ai_sohbet: { roller: null, modul: null },
};

@Injectable()
export class EklerService {
  private readonly logger = new Logger(EklerService.name);
  private yuklemeHatasi(hata: unknown): never {
    const m = (hata as { meta?: { message?: string }; message?: string }).meta?.message ?? (hata as Error).message ?? "";
    if (m.includes("ek_depolama_kota_dolu")) throw new BadRequestException("Depolama kotası dolu. Dosya silin veya depolama sınırını artırın.");
    if (m.includes("ek_rezervasyon_suresi_doldu")) throw new BadRequestException("Yükleme süresi doldu. Dosyayı yeniden yükleyin.");
    throw hata;
  }
  constructor(
    private readonly prisma: PrismaService,
    private readonly depo: DepoService,
  ) {}

  /**
   * Ek, sahibinin ekranını kullanan rollere açıktır; özel rolde sahibin modül kutusu da
   * uygulanır. Yalnız /ekler uçları denetler: iç çağıranlar (çek, özlük, sohbet) kendi
   * uçlarında yetkilidir.
   */
  ekErisiminiDenetle(sahipTur: EkSahipTur, islem: YetkiIslemi): void {
    const { rol, ozelRol, paketModulleri } = aktifBaglam();
    const kural = EK_ERISIMI[sahipTur];
    const paketModulu = kural.modul ?? (sahipTur === "ai_sohbet" ? "yapay_zeka" : null);
    if (paketModulu && paketModulleri && !paketModulleri.includes(paketModulu)) throw new ForbiddenException("Bu ekin modülü abonelik paketinizde kapalı.");
    if (kural.roller && rol !== "yonetici" && !kural.roller.includes(rol)) throw new ForbiddenException("Bu eke erişim yetkiniz yok");
    if (kural.modul && ozelRol?.kapali.includes(yetkiAnahtari(kural.modul, islem))) throw new ForbiddenException("Rolünüzde bu işlem kapalı");
  }

  /** /ekler/:id/indir: sahibine göre yetki denetimli indirme. */
  async denetimliIndir(id: string) {
    const { tenantId } = aktifBaglam();
    const ek = await this.prisma.tenantIslem(tenantId, (tx) => tx.ek.findUnique({ where: { id }, select: { sahipTur: true } }));
    if (!ek) throw new NotFoundException("Ek bulunamadı");
    this.ekErisiminiDenetle(ek.sahipTur, "goruntule");
    return this.indir(id);
  }

  /** /ekler/:id silme: sahibine göre özel rol kutusu. */
  async denetimliSil(id: string): Promise<void> {
    const { tenantId } = aktifBaglam();
    const ek = await this.prisma.tenantIslem(tenantId, (tx) => tx.ek.findUnique({ where: { id }, select: { sahipTur: true } }));
    if (!ek) throw new NotFoundException("Ek bulunamadı");
    this.ekErisiminiDenetle(ek.sahipTur, "sil");
    await this.sil(id);
  }

  /** AI-79: sohbet eki başka kullanıcıya (yöneticiye de) açılmaz. */
  private async sohbetEkiYetkisiDogrula(sahipTur: EkSahipTur, sahipId: string): Promise<void> {
    if (sahipTur !== "ai_sohbet") return;
    const { tenantId, userId } = aktifBaglam();
    const oturum = await this.prisma.tenantIslem(tenantId, (tx) => tx.ajanOturumu.findFirst({ where: { id: sahipId, userId }, select: { id: true } }));
    if (!oturum) throw new NotFoundException("Ek bulunamadı");
  }

  private personelBelgesiYetkisiDogrula(sahipTur: EkSahipTur): void {
    const { rol } = aktifBaglam();
    if (sahipTur === "personel" && rol !== "muhasebe" && rol !== "ik" && rol !== "yonetici") {
      throw new ForbiddenException("Özlük belgelerine erişim yetkiniz bulunmuyor");
    }
  }

  /** Sahip kaydın bu kiracıda var olduğunu doğrular (RLS kapsamında). */
  private async sahipDogrula(
    tx: Prisma.TransactionClient,
    sahipTur: EkSahipTur,
    sahipId: string,
  ): Promise<void> {
    const sorgu = {
      cari: () => tx.cariHesap.findUnique({ where: { id: sahipId } }),
      stok: () => tx.stokKart.findUnique({ where: { id: sahipId } }),
      fatura: () => tx.fatura.findUnique({ where: { id: sahipId } }),
      belge: () => tx.belge.findUnique({ where: { id: sahipId } }),
      kasa_banka: () =>
        tx.kasaBankaHareket.findUnique({ where: { id: sahipId } }),
      firma: () => tx.tenant.findUnique({ where: { id: sahipId } }),
      firma_kase: () => tx.tenant.findUnique({ where: { id: sahipId } }),
      masraf: () => tx.masraf.findUnique({ where: { id: sahipId } }),
      kira_sozlesme: () => tx.kiraSozlesme.findUnique({ where: { id: sahipId } }),
      personel: () => tx.personel.findUnique({ where: { id: sahipId } }),
      satin_alma_teklif: () => tx.satinAlmaTeklifi.findUnique({ where: { id: sahipId } }),
      cek_senet: () => tx.cekSenet.findUnique({ where: { id: sahipId } }),
      demirbas: () => tx.demirbas.findUnique({ where: { id: sahipId } }),
      // AI-79: sohbet eki yalnız kendi sohbetine bağlanır.
      ai_sohbet: () => tx.ajanOturumu.findFirst({ where: { id: sahipId, userId: aktifBaglam().userId } }),
    }[sahipTur];
    if (!(await sorgu())) {
      throw new NotFoundException("Ekin bağlanacağı kayıt bulunamadı");
    }
  }

  /**
   * `sohbetCiktisi`: AI-118 — asistanın ürettiği PDF/Excel sohbet ekine yazılır; kullanıcı yüklemesi
   * değildir, bu nedenle yalnız `ai_sohbet` sahibinde ve `sohbet_cikti` profiliyle kabul edilir.
   */
  async yukle(sahipTur: EkSahipTur, sahipId: string, dosya: YuklenenDosya, secenek: { sohbetCiktisi?: boolean } = {}) {
    if (secenek.sohbetCiktisi && sahipTur !== "ai_sohbet") throw new BadRequestException("Sohbet çıktısı yalnız sohbet ekine yazılır");
    if (!Number.isSafeInteger(dosya.size) || dosya.size < 1 || dosya.size !== dosya.buffer.length) {
      throw new BadRequestException("Dosya boyutu içerikle eşleşmiyor");
    }
    if (dosya.size > MAKS_BOYUT) {
      throw new BadRequestException("Dosya 10 MB sınırını aşıyor");
    }
    // Çek/senet görüntüsü yalnız görüntü ya da PDF olabilir; saklanan MIME içerikten gelir.
    const mime = await dosyaIceriginiDogrula(dosya, sahipTur === "cek_senet" ? "goruntu" : sahipTur === "ai_sohbet" ? (secenek.sohbetCiktisi ? "sohbet_cikti" : "sohbet") : "belge");
    const { tenantId, userId } = aktifBaglam();
    const guvenliAd = dosya.originalname.replace(/[^\w.\-çğıöşüÇĞİÖŞÜ ]/g, "_");
    const depoAnahtari = `${tenantId}/${sahipTur}/${sahipId}/${randomUUID()}-${guvenliAd}`;

    const rezervasyonId = randomUUID();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.sahipDogrula(tx, sahipTur, sahipId);
      await tx.$queryRaw`SELECT ek_yukleme_ayir(${rezervasyonId}::uuid,${dosya.size}::bigint,${depoAnahtari})`;
    }).catch((hata: unknown) => this.yuklemeHatasi(hata));
    try {
      // Network I/O does not keep a database transaction open.
      await this.depo.yukle(depoAnahtari, dosya.buffer, mime);
      return await this.prisma.tenantIslem(tenantId, async (tx) => {
        await this.sahipDogrula(tx, sahipTur, sahipId);
        const ek = await tx.ek.create({
        data: {
          tenantId,
          sahipTur,
          sahipId,
          dosyaAdi: dosya.originalname,
          mimeTip: mime,
          boyut: dosya.size,
          depoAnahtari,
          yukleyenUserId: userId,
        },
        });
        await tx.$queryRaw`SELECT ek_yukleme_kapat(${rezervasyonId}::uuid,true)`;
        return ek;
      });
    } catch (hata) {
      // A lost commit response must never delete an object whose metadata did commit.
      let kayit;
      try {
        kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
          await tx.$queryRaw`SELECT id FROM tenant_abonelikleri WHERE tenant_id=${tenantId}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ek-hacmi:${tenantId}`},0))::text`;
          return tx.ek.findUnique({ where: { depoAnahtari } });
        });
      }
      catch {
        this.logger.warn(`Ek yükleme sonucu doğrulanamadı; nesne korundu, rezervasyon ${rezervasyonId}`);
        throw hata;
      }
      if (kayit) return kayit;
      const temizlik = await Promise.allSettled([
        this.prisma.tenantIslem(tenantId, (tx) => tx.$queryRaw`SELECT ek_yukleme_kapat(${rezervasyonId}::uuid,false)`),
        this.depo.sil(depoAnahtari),
      ]);
      if (temizlik.some((r) => r.status === "rejected")) this.logger.warn(`Ek yükleme temizliği tamamlanamadı; rezervasyon ${rezervasyonId}`);
      this.yuklemeHatasi(hata);
    }
  }

  async listele(sahipTur: EkSahipTur, sahipId: string) {
    this.personelBelgesiYetkisiDogrula(sahipTur);
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ek.findMany({
        where: { sahipTur, sahipId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          dosyaAdi: true,
          mimeTip: true,
          boyut: true,
          yukleyenUserId: true,
          createdAt: true,
        },
      }),
    );
  }

  async indir(id: string) {
    const { tenantId } = aktifBaglam();
    const ek = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ek.findUnique({ where: { id } }),
    );
    if (!ek) throw new NotFoundException("Ek bulunamadı");
    this.personelBelgesiYetkisiDogrula(ek.sahipTur);
    await this.sohbetEkiYetkisiDogrula(ek.sahipTur, ek.sahipId);
    const icerik = await this.depo.indir(ek.depoAnahtari);
    return { ek, icerik };
  }

  async sil(id: string): Promise<void> {
    const { tenantId } = aktifBaglam();
    const ek = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.ek.findUnique({ where: { id } });
      if (!kayit) throw new NotFoundException("Ek bulunamadı");
      await tx.ek.delete({ where: { id } });
      return kayit;
    });
    // Depo silimi DB işlemi dışında: başarısız olursa nesne sahipsiz kalır,
    // meta veri tutarlılığı bozulmaz.
    await this.depo.sil(ek.depoAnahtari);
  }
}
