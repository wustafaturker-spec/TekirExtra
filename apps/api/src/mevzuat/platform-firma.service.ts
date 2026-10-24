import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { ABONELIK_PLANLARI } from "../tenant/abonelik.service";
import { PlatformPrismaService } from "./platform-prisma.service";

interface FirmaSatiri {
  tenant_id: string;
  unvan: string;
  vkn: string;
  kayit_tarihi: Date;
  plan_kodu: string;
  durum: string;
  donem_sonu: Date | null;
  iptal_tarihi: Date | null;
  aktif_kullanici: bigint;
  son_giris: Date | null;
  ebelge_saglayici: string | null;
  bekleyen_talep_id: string | null;
  bekleyen_plan: string | null;
}

/**
 * Platform P0-1 / P1-1: firma genel bakışı ve abonelik yönetimi. Platform rolü
 * kiracı tablolarını okuyamaz; her şey veritabanındaki dar işlevlerden geçer
 * (yalnız sayılar ve durumlar, firma verisinin içeriği değil). Her işlem
 * platform olay kaydına yazılır.
 */
@Injectable()
export class PlatformFirmaService {
  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly erisim: AbonelikErisimService,
  ) {}

  async listele() {
    const satirlar = await this.platform.db.$queryRaw<FirmaSatiri[]>`SELECT * FROM platform_firma_ozeti()`;
    return satirlar.map((r) => ({
      tenantId: r.tenant_id,
      unvan: r.unvan.trim(),
      vkn: r.vkn,
      kayitTarihi: r.kayit_tarihi,
      planKodu: r.plan_kodu,
      planAdi: planAdi(r.plan_kodu),
      durum: r.durum,
      donemSonu: r.donem_sonu,
      iptalTarihi: r.iptal_tarihi,
      aktifKullanici: Number(r.aktif_kullanici),
      sonGiris: r.son_giris,
      ebelgeSaglayici: r.ebelge_saglayici,
      bekleyenTalep: r.bekleyen_talep_id ? { id: r.bekleyen_talep_id, istenenPlan: r.bekleyen_plan, istenenPlanAdi: planAdi(r.bekleyen_plan ?? "") } : null,
    }));
  }

  async gecmis(tenantId: string) {
    const [satir] = await this.platform.db.$queryRaw<{ gecmis: unknown }[]>`SELECT platform_firma_abonelik_gecmisi(${tenantId}::uuid) AS gecmis`;
    return satir?.gecmis ?? { degisiklikler: [], talepler: [] };
  }

  /** Askıya alma ve geri açma; neden zorunlu ve firmanın abonelik geçmişine de yazılır. */
  async durumDegistir(tenantId: string, durum: "askida" | "aktif", neden: string) {
    const { kullaniciId, eposta } = aktifPlatformBaglam();
    await this.cagir(() => this.platform.db.$executeRaw`SELECT platform_abonelik_guncelle(${tenantId}::uuid, NULL, ${durum}, ${`${durum === "askida" ? "Askıya alındı" : "Askıdan çıkarıldı"} (${eposta}): ${neden}`})`);
    await this.olay(kullaniciId, durum === "askida" ? "firma_askiya_alindi" : "firma_askidan_cikarildi", { tenantId, neden });
    this.erisim.unut(tenantId);
    return { mesaj: durum === "askida" ? "Firma askıya alındı; salt okunur." : "Firma yeniden etkin." };
  }

  async planDegistir(tenantId: string, planKodu: string, neden: string) {
    if (!ABONELIK_PLANLARI.some((p) => p.kod === planKodu)) throw new BadRequestException("Geçersiz plan");
    const { kullaniciId, eposta } = aktifPlatformBaglam();
    await this.cagir(() => this.platform.db.$executeRaw`SELECT platform_abonelik_guncelle(${tenantId}::uuid, ${planKodu}, NULL, ${`Platform plan değişikliği (${eposta}): ${neden}`})`);
    await this.olay(kullaniciId, "firma_plani_degisti", { tenantId, planKodu, neden });
    this.erisim.unut(tenantId);
    return { mesaj: `Plan ${planAdi(planKodu)} yapıldı.` };
  }

  async talepKarar(talepId: string, onay: boolean, not: string | null) {
    const { kullaniciId } = aktifPlatformBaglam();
    const [satir] = await this.cagir(() =>
      this.platform.db.$queryRaw<{ tenant_id: string }[]>`SELECT platform_abonelik_talebi_karar(${talepId}::uuid, ${onay}, ${not}, ${kullaniciId}::uuid) AS tenant_id`,
    );
    await this.olay(kullaniciId, onay ? "plan_talebi_onaylandi" : "plan_talebi_reddedildi", { talepId, tenantId: satir.tenant_id, not });
    this.erisim.unut(satir.tenant_id);
    return { mesaj: onay ? "Talep onaylandı; yeni plan geçerli." : "Talep reddedildi." };
  }

  private async olay(kullaniciId: string, olay: string, detay: Record<string, unknown>) {
    await this.platform.db.mevzuatOlay.create({ data: { kullaniciId, olay, detay: detay as Prisma.InputJsonValue } });
  }

  private async cagir<T>(is: () => Promise<T>): Promise<T> {
    try {
      return await is();
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : String(hata);
      if (mesaj.includes("firma_yok")) throw new NotFoundException("Firma bulunamadı");
      if (mesaj.includes("talep_bekliyor_degil")) throw new ConflictException("Talep artık beklemiyor (karar verilmiş ya da geri çekilmiş)");
      throw hata;
    }
  }
}

function planAdi(kod: string): string {
  if (kod === "v1") return "Profesyonel (eski kayıt)";
  return ABONELIK_PLANLARI.find((p) => p.kod === kod)?.ad ?? kod;
}
