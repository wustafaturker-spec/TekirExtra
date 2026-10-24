import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

export interface AbonelikErisimi {
  /** Platform P0-1: true ise firma salt okunurdur (yazma istekleri reddedilir). */
  kisitli: boolean;
  neden: string | null;
}

const ERISIM_ONBELLEK_MS = 30_000;

/**
 * Askıdaki ya da iptal dönemi bitmiş abonelik salt okunurdur. Dönem sonu
 * bilinmiyorsa (eski kayıtlar) iptal tarihinden bir ay sonrası esas alınır.
 */
export function abonelikErisimiHesapla(
  a: { durum: string; donemSonu: Date | null; iptalTarihi: Date | null } | null,
  simdi = new Date(),
): AbonelikErisimi {
  if (!a) return { kisitli: false, neden: null };
  if (a.durum === "askida") {
    return { kisitli: true, neden: "Aboneliğiniz askıya alındı. Kayıtlarınızı görüntüleyip dışa aktarabilirsiniz; yeni kayıt ve değişiklik için bizimle iletişime geçin." };
  }
  if (a.durum === "iptal") {
    let bitis = a.donemSonu;
    if (!bitis && a.iptalTarihi) {
      bitis = new Date(a.iptalTarihi);
      bitis.setMonth(bitis.getMonth() + 1);
    }
    if (bitis && bitis <= simdi) {
      return { kisitli: true, neden: `Aboneliğiniz ${bitis.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })} tarihinde sona erdi. Kayıtlarınızı görüntüleyip dışa aktarabilirsiniz; devam etmek için Abonelik ekranından yeniden etkinleştirin.` };
    }
  }
  return { kisitli: false, neden: null };
}

/** Firma başına abonelik erişimi (30 sn önbellek; platform değişikliğinde bu süreçte hemen unutulur). */
@Injectable()
export class AbonelikErisimService {
  private readonly onbellek = new Map<string, { erisim: AbonelikErisimi; bitis: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async getir(tenantId: string): Promise<AbonelikErisimi> {
    const simdi = Date.now();
    const k = this.onbellek.get(tenantId);
    if (k && k.bitis > simdi) return k.erisim;
    const a = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAbonelik.findUnique({ where: { tenantId }, select: { durum: true, donemSonu: true, iptalTarihi: true } }),
    );
    const erisim = abonelikErisimiHesapla(a);
    if (this.onbellek.size > 10_000) this.onbellek.clear();
    this.onbellek.set(tenantId, { erisim, bitis: simdi + ERISIM_ONBELLEK_MS });
    return erisim;
  }

  unut(tenantId: string): void {
    this.onbellek.delete(tenantId);
  }
}
