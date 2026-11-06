import { Injectable, NotFoundException } from "@nestjs/common";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { duyuruIcerigiHtmlTemizle } from "./platform-duyuru.semalar";
import { gorselIceriginiImzala } from "./duyuru-gorsel-imza";

export interface TenantDuyuru {
  id: string; baslik: string; icerik: string; butonMetni: string | null; butonUrl: string | null;
  gosterimYerleri?: ("merkez" | "ust_bant" | "popup" | "modul_karti")[];
  modulYollari?: string[];
  tekrarPolitikasi?: "her_zaman" | "bir_kez" | "gunde_bir" | "haftada_bir";
  tekrarGosterilebilir?: boolean; tekrarSonrakiGosterim?: string | null;
  popupOnceligi?: number; popupTuru?: "normal" | "kritik"; ertelemeDakika?: number;
  ertelendiAt?: string | null; sonrakiGosterim?: string | null; popupKapatildi?: boolean;
  surum: number; baslangic: string; bitis: string; okundu: boolean;
}
interface TenantDuyuruListesi { kayitlar: TenantDuyuru[]; toplam: number; sayfa: number; sayfaBoyutu: number }
@Injectable()
export class TenantDuyuruService {
  constructor(private readonly prisma: PrismaService) {}
  async listele(sayfa: number, gecmis: boolean, id: string | null = null) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [r] = await tx.$queryRaw<{ veri: TenantDuyuruListesi }[]>`SELECT tenant_duyurular(${gecmis},${sayfa}::integer,${id}::uuid) AS veri`;
      return { ...r.veri, kayitlar: r.veri.kayitlar.map((d) => ({ ...d, icerik: gorselIceriginiImzala(duyuruIcerigiHtmlTemizle(d.icerik)) })) };
    });
  }
  async getir(id: string, gecmis: boolean) {
    const r = await this.listele(1, gecmis, id);
    if (!r.kayitlar.length) throw new NotFoundException("Duyuru bulunamadı veya artık yayında değil.");
    return r.kayitlar[0];
  }
  async olay(id: string, tur: "gosterim" | "okudum" | "tiklama") {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [r] = await tx.$queryRaw<{ uygun: boolean }[]>`SELECT tenant_duyuru_olay(${id}::uuid,${tur}) AS uygun`;
      if (!r.uygun) throw new NotFoundException("Duyuru bulunamadı veya artık yayında değil.");
      return { kaydedildi: true };
    });
  }
  async tercih(id: string, tur: "ertele" | "kapat") {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [r] = await tx.$queryRaw<{ uygun: boolean; sonrakiGosterim: Date | null }[]>`SELECT uygun,sonraki_gosterim AS "sonrakiGosterim" FROM tenant_duyuru_tercihi(${id}::uuid,${tur})`;
      if (!r.uygun) throw new NotFoundException("Duyuru bulunamadı veya artık popup olarak yayında değil.");
      return { kaydedildi: true, sonrakiGosterim: r.sonrakiGosterim?.toISOString() ?? null };
    });
  }
}
