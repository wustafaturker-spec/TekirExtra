import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { abonelikModulleriniOku } from "../tenant/abonelik-kosullari";
import { etkinFiyatKosullariniBagla } from "../tenant/etkin-fiyat-kosullari";
import { paketApiYoluKapali, type PaketModulKodu } from "@tekirextra/shared";

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
  if (a.durum === "deneme" && a.donemSonu && a.donemSonu <= simdi) {
    return { kisitli: true, neden: "Deneme süreniz sona erdi. Kayıtlarınızı görüntüleyip dışa aktarabilirsiniz; yazmaya devam etmek için Abonelik sayfasından ödeme yapın." };
  }
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

  /** Kapsam önbelleğe alınmaz: atama sonraki API isteğinde ve araç çağrısında geçerlidir. */
  async modulleriGetir(tenantId: string) {
    const a = await this.prisma.tenantIslem(tenantId, async (tx) => etkinFiyatKosullariniBagla(tx, tenantId, await tx.tenantAbonelik.findUnique({ where: { tenantId }, select: { planKodu: true, paketSurumId: true, paketKosullari: true } })));
    return a ? abonelikModulleriniOku(a) : null;
  }
  async modulKapali(tenantId: string, modul: PaketModulKodu) {
    const moduller = await this.modulleriGetir(tenantId);
    return moduller !== null && !moduller.includes(modul);
  }
  async apiYoluKapali(tenantId: string, yol: string) { return paketApiYoluKapali(await this.modulleriGetir(tenantId), yol); }

  async getir(tenantId: string): Promise<AbonelikErisimi> {
    const simdi = Date.now();
    const k = this.onbellek.get(tenantId);
    if (k && k.bitis > simdi) return k.erisim;
    const a = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAbonelik.findUnique({ where: { tenantId }, select: { durum: true, donemSonu: true, iptalTarihi: true } }),
    );
    const erisim = abonelikErisimiHesapla(a);
    if (this.onbellek.size > 10_000) this.onbellek.clear();
    const donemSiniri = (a?.durum === "deneme" || a?.durum === "iptal") && a.donemSonu && a.donemSonu.getTime() > simdi ? a.donemSonu.getTime() : Infinity;
    this.onbellek.set(tenantId, { erisim, bitis: Math.min(simdi + ERISIM_ONBELLEK_MS, donemSiniri) });
    return erisim;
  }

  /**
   * PLT-05: kısıtlı (askıdaki / iptal dönemi bitmiş) firmada veri yazan ya da
   * maliyet doğuran zamanlanmış işler durur; bildirim ve mevzuat hatırlatması
   * sürer. Modül kontrolü istenmişse kapsam okunamadığında iş durur; eski
   * yalnız durum kontrolünde geriye uyumluluk korunur. Firma açılınca sonraki turda sürer.
   */
  async otomasyonDurdu(tenantId: string, modul?: PaketModulKodu | readonly PaketModulKodu[]): Promise<boolean> {
    try {
      if (modul) {
        const moduller = await this.modulleriGetir(tenantId);
        if (moduller && (typeof modul === "string" ? [modul] : modul).some((m) => !moduller.includes(m))) return true;
      }
      return (await this.getir(tenantId)).kisitli;
    } catch {
      return !!modul;
    }
  }

  unut(tenantId: string): void {
    this.onbellek.delete(tenantId);
  }
}
