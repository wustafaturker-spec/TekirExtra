import {IHTIYAC_MODULU,ihtiyacAyarKilitAnahtari} from '../../stok/ihtiyac-erisim';
import { CRM_BELGE_MODULU } from "../../crm/crm-belge.semalar";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { aktifBaglam } from "../istek-baglami";
import { PrismaService } from "../prisma.service";
import { ayarTanimiAl } from "./ayar-kayit";
import { MALIYET_KONTROL_MODULU } from "./maliyet-kontrol-ayari";
import { TAHSILAT_MODULU } from "../../cari/tahsilat-erisim";
import { TAHSILAT_OTOMASYONU } from "../../cari/tahsilat-otomasyon-ayari";
import { TEKLIF_TALEBI_MODULU, TEKLIF_TALEBI_ROLLERI } from "../../ai/teklif-talebi/teklif-talebi-ayari";

@Injectable()
export class AyarlarService {
  constructor(private readonly prisma: PrismaService) {}

  /** Saklanan değerleri varsayılanların üstüne bindirerek döner. */
  async getir(modul: string, tx?: Prisma.TransactionClient): Promise<Record<string, unknown>> {
    const tanim = ayarTanimiAl(modul);
    if (!tanim) {
      throw new NotFoundException(`'${modul}' modülünün ayar tanımı yok`);
    }
    const { tenantId } = aktifBaglam();
    // Açık bir işlemin içinden okunabilsin diye `tx` dışarıdan verilebilir;
    // yoksa kendi işlemini açar.
    const oku = (islem: Prisma.TransactionClient) =>
      islem.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul } } });
    const kayit = tx ? await oku(tx) : await this.prisma.tenantIslem(tenantId, oku);
    const saklanan = (kayit?.ayarlar ?? {}) as Record<string, unknown>;
    return { ...tanim.varsayilanlar, ...saklanan };
  }

  /** Tam ayar nesnesini şemayla doğrulayıp kaydeder. */
  async guncelle(
    modul: string,
    veri: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const tanim = ayarTanimiAl(modul);
    if (!tanim) {
      throw new NotFoundException(`'${modul}' modülünün ayar tanımı yok`);
    }
    const ayristirma = tanim.sema.safeParse(veri);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues
          .map((s) => `${s.path.join(".")}: ${s.message}`)
          .join("; "),
      );
    }
    const dogrulanmis = ayristirma.data as Record<string, unknown>;
    const { tenantId, userId, rol } = aktifBaglam();
    if(modul===IHTIYAC_MODULU&&rol!=="yonetici")throw new ForbiddenException("İhtiyaç kullanım modunu yalnız yönetici değiştirebilir");
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      if(modul===IHTIYAC_MODULU)await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ihtiyacAyarKilitAnahtari(tenantId)},0))::text`;
      if (modul === TAHSILAT_OTOMASYONU && dogrulanmis.sorumluUserId) {
        const sorumluId = String(dogrulanmis.sorumluUserId);
        if (!(await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE tenant_id=${tenantId}::uuid AND id=${sorumluId}::uuid AND aktif AND rol IN ('yonetici','muhasebe') FOR SHARE`).length) throw new BadRequestException("Otomatik takip sorumlusu şirketin aktif yönetici veya muhasebe kullanıcısı olmalı");
      }
      if (modul === TEKLIF_TALEBI_MODULU) {
        if (dogrulanmis.sorumluUserId) {
          const sorumluId = String(dogrulanmis.sorumluUserId);
          const roller = [...TEKLIF_TALEBI_ROLLERI];
          if (!(await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE tenant_id=${tenantId}::uuid AND id=${sorumluId}::uuid AND aktif AND rol::text = ANY(${roller}) FOR SHARE`).length) throw new BadRequestException("Teklif talebi sorumlusu şirketin aktif yönetici, muhasebe veya satış kullanıcısı olmalı");
        }
        // AI-32: açılış anı sunucuda tutulur; istemcinin gönderdiği değer yok sayılır.
        const onceki = (await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul } }, select: { ayarlar: true } }))?.ayarlar as { acik?: boolean; acildiAt?: string | null } | undefined;
        dogrulanmis.acildiAt = dogrulanmis.acik ? (onceki?.acik && onceki.acildiAt ? onceki.acildiAt : new Date().toISOString()) : (onceki?.acildiAt ?? null);
      }
      const kayit = await tx.modulAyar.upsert({
        where: { tenantId_modul: { tenantId, modul } },
        create: { tenantId, modul, ayarlar: dogrulanmis as Prisma.InputJsonValue },
        update: { ayarlar: dogrulanmis as Prisma.InputJsonValue },
      });
      if (modul === IHTIYAC_MODULU || modul === CRM_BELGE_MODULU || modul === MALIYET_KONTROL_MODULU || modul === TAHSILAT_MODULU || modul === TAHSILAT_OTOMASYONU || modul === TEKLIF_TALEBI_MODULU) {
        await tx.auditLog.create({ data: {
          tenantId, userId, islem: modul === IHTIYAC_MODULU ? "ihtiyac_modu_guncellendi" : modul === CRM_BELGE_MODULU ? "crm_belge_modu_guncellendi" : modul === MALIYET_KONTROL_MODULU ? "maliyet_kontrol_modu_guncellendi" : modul === TAHSILAT_OTOMASYONU ? "tahsilat_otomasyonu_guncellendi" : modul === TEKLIF_TALEBI_MODULU ? "teklif_talebi_taslagi_guncellendi" : "tahsilat_modu_guncellendi", varlik: "modul_ayar", varlikId: kayit.id,
          detay: dogrulanmis as Prisma.InputJsonValue,
        } });
      }
    });
    return dogrulanmis;
  }
}
