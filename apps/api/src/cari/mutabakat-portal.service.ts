import { BadRequestException, ConflictException, GoneException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { bugunTR } from "@tekirextra/shared";
import { baglamlaCalistir } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { dosyaIceriginiDogrula } from "../core/guvenlik/dosya-dogrulama";
import { DepoService } from "../ekler/depo.service";
import { BildirimService } from "../bildirimler/bildirim.service";
import {
  anahtarBicimiGecerli, anahtarOzeti, bakiyeCumlesi, bakiyeFarklari, EK_EN_BUYUK, EK_MIMELERI, gorunenDurum, karsiBakiyeleri, mutabakatItirazBildirimi, trTarih,
  type DovizBakiyesi, type PortalYaniti,
} from "./cari-mutabakat";

const BEKLEYEN = ["gonderildi", "goruldu"];
const BULUNAMADI = "Mutabakat bağlantısı geçersiz ya da yenilendi; son e-postadaki bağlantıyı kullanın";

export interface PortalEki { originalname: string; mimetype: string; size: number; buffer: Buffer }

/**
 * CARI-42: karşı tarafın girişsiz mutabakat sayfası. Kimlik bağlamı yoktur;
 * kiracı adresten gelir, talep yalnız bağlantı anahtarının özetiyle bulunur.
 * Sayfa yalnız talepte dondurulan veriyi (bakiye, ekstre PDF'i) gösterir.
 */
@Injectable()
export class MutabakatPortalService {
  private readonly logger = new Logger(MutabakatPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly depo: DepoService,
    private readonly bildirimler: BildirimService,
  ) {}

  private async bul(tenantId: string, anahtar: string) {
    if (!anahtarBicimiGecerli(anahtar)) throw new NotFoundException(BULUNAMADI);
    const ozet = anahtarOzeti(anahtar);
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariMutabakat.findFirst({
      where: { OR: [{ anahtarOzeti: ozet }, { hatirlatmaAnahtarOzeti: ozet }] },
      include: { cari: { select: { unvan: true, kod: true } } },
    }));
    if (!k) throw new NotFoundException(BULUNAMADI);
    if (k.durum === "iptal") throw new GoneException("Bu mutabakat talebi gönderen firma tarafından geri alındı");
    return k;
  }

  async goruntule(tenantId: string, anahtar: string) {
    const k = await this.bul(tenantId, anahtar);
    if (k.durum === "gonderildi") {
      await this.prisma.tenantIslem(tenantId, (tx) => tx.cariMutabakat.updateMany({ where: { id: k.id, durum: "gonderildi" }, data: { durum: "goruldu", gorulduAt: new Date() } }));
    }
    const firma = await this.prisma.tenantIslem(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }));
    const bakiyeler = k.bakiyeler as unknown as DovizBakiyesi[];
    const durum = gorunenDurum(k, bugunTR());
    const mutabakatTarihi = k.mutabakatTarihi.toISOString().slice(0, 10);
    return {
      firma: firma?.unvan ?? "",
      cari: k.cari.unvan,
      mutabakatTarihi,
      baslangicTarihi: k.baslangicTarihi?.toISOString().slice(0, 10) ?? null,
      sonYanitTarihi: k.sonYanitTarihi.toISOString().slice(0, 10),
      bakiyeler,
      cumle: `${trTarih(mutabakatTarihi)} tarihi itibarıyla kayıtlarımıza göre ${bakiyeCumlesi(bakiyeler)}.`,
      durum: durum === "gonderildi" ? "goruldu" : durum,
      yanit: k.yanitAt ? {
        tur: k.durum as "mutabik" | "itiraz",
        ad: k.yanitlayanAd, gorev: k.yanitlayanGorev, tarih: k.yanitAt.toISOString(),
        aciklama: k.yanitAciklama, karsiBakiyeler: (k.karsiBakiyeler as unknown as DovizBakiyesi[] | null) ?? null, ekDosyaAdi: k.ekDosyaAdi,
      } : null,
    };
  }

  async ekstre(tenantId: string, anahtar: string) {
    const k = await this.bul(tenantId, anahtar);
    return { dosyaAdi: `ekstre-${k.mutabakatTarihi.toISOString().slice(0, 10)}.pdf`, icerik: await this.depo.indir(k.ekstreAnahtari) };
  }

  /**
   * Tek yanıt: durum koşullu güncellenir, ikinci yanıt (çift tıklama, iki
   * sekme) 409 alır. Ek önce depoya yazılır, yanıt kaydedilemezse silinir.
   */
  async yanitla(tenantId: string, anahtar: string, yanit: PortalYaniti, ek: PortalEki | undefined, istemci: { ip: string | null; tarayici: string | null }) {
    const k = await this.bul(tenantId, anahtar);
    if (k.durum === "mutabik" || k.durum === "itiraz") throw new ConflictException("Bu mutabakat zaten yanıtlandı");
    if (gorunenDurum(k, bugunTR()) === "suresi_doldu") throw new ConflictException(`Yanıt süresi ${trTarih(k.sonYanitTarihi.toISOString())} tarihinde doldu; gönderen firmayla iletişime geçin`);
    if (ek && yanit.yanit !== "itiraz") throw new BadRequestException("Dosya yalnız itirazda eklenir");
    if (ek) {
      if (ek.size > EK_EN_BUYUK) throw new BadRequestException("Dosya en çok 5 MB olabilir");
      if (!EK_MIMELERI.has(ek.mimetype)) throw new BadRequestException("Yalnız PDF, Excel ya da CSV dosyası eklenebilir");
      dosyaIceriginiDogrula(ek);
    }
    const ekAnahtari = ek ? `${tenantId}/mutabakat/${k.id}/itiraz-${randomUUID()}` : null;
    if (ek && ekAnahtari) await this.depo.yukle(ekAnahtari, ek.buffer, ek.mimetype);
    const karsi = yanit.yanit === "itiraz" ? karsiBakiyeleri(yanit.karsiBakiyeler) : null;
    const bakiyeler = k.bakiyeler as unknown as DovizBakiyesi[];
    const farklar = karsi ? bakiyeFarklari(bakiyeler, karsi) : [];
    const yanitAt = new Date();
    const yazildi = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.cariMutabakat.updateMany({
        where: { id: k.id, durum: { in: BEKLEYEN } },
        data: {
          durum: yanit.yanit, yanitAt, yanitlayanAd: yanit.ad, yanitlayanGorev: yanit.gorev, yanitlayanEposta: yanit.eposta || null,
          yanitAciklama: yanit.aciklama || null, karsiBakiyeler: (karsi ?? undefined) as Prisma.InputJsonValue | undefined,
          ekAnahtari, ekDosyaAdi: ek ? ek.originalname.slice(0, 200) : null, ekMime: ek?.mimetype ?? null,
          yanitIp: istemci.ip?.slice(0, 64) ?? null, yanitTarayici: istemci.tarayici?.slice(0, 500) ?? null,
        },
      });
      if (sonuc.count !== 1) return false;
      const ozet = yanit.yanit === "mutabik" ? "mutabık" : `itiraz etti${farklar.length ? ` (fark: ${farklar.map((f) => `${Number(f.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${f.dovizCinsi}`).join(", ")})` : ""}`;
      await tx.crmEtkilesim.create({
        data: {
          tenantId, cariId: k.cariId, userId: k.olusturanUserId, tip: "eposta", tarih: yanitAt,
          konu: `Mutabakat yanıtı: ${yanit.yanit === "mutabik" ? "mutabık" : "itiraz"} (${trTarih(k.mutabakatTarihi.toISOString())})`,
          aciklama: `${yanit.ad} (${yanit.gorev}) portaldan ${ozet}.${yanit.aciklama ? ` Açıklama: ${yanit.aciklama}` : ""}`.slice(0, 2000),
        },
      });
      await tx.auditLog.create({
        data: { tenantId, userId: null, islem: `cari_mutabakat_${yanit.yanit}`, varlik: "cari", varlikId: k.cariId, detay: { mutabakatId: k.id, yanitlayan: yanit.ad, gorev: yanit.gorev, ip: istemci.ip, farklar } as unknown as Prisma.InputJsonValue },
      });
      return true;
    });
    if (!yazildi) {
      if (ekAnahtari) await this.depo.sil(ekAnahtari).catch(() => undefined);
      throw new ConflictException("Bu mutabakat zaten yanıtlandı");
    }
    if (yanit.yanit === "itiraz") {
      // Tarama da üretir (vade:mutabakat:…); burada beklemeden zile düşsün.
      await baglamlaCalistir({ tenantId, userId: k.olusturanUserId, rol: "yonetici" }, () => this.bildirimler.uret(mutabakatItirazBildirimi({ id: k.id, cariId: k.cariId, cari: k.cari, mutabakatTarihi: k.mutabakatTarihi, yanitlayanAd: yanit.ad, farklar })))
        .catch((hata) => this.logger.warn(`Mutabakat itiraz bildirimi üretilemedi: ${String(hata)}`));
    }
    return { mesaj: yanit.yanit === "mutabik" ? "Teşekkürler; mutabakatınız kaydedildi." : "Teşekkürler; itirazınız gönderen firmaya iletildi." };
  }
}
