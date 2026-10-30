import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";

export type HesapTuru = "kasa" | "banka" | "pos";
export interface FaturaAyarGirdisi {
  faturalayanTenantId: string | null;
  kartHesap: { tur: HesapTuru; id: string } | null;
  elleHesap: { tur: HesapTuru; id: string } | null;
}

interface HesapSatiri { tur: HesapTuru; id: string; ad: string; doviz: string }

/**
 * PLT-20: faturalayan firma ve tahsilat hesapları (platform tarafı). Ayar ilk
 * kez bir firmaya bağlanınca faturalama başlangıcı yazılır; ondan önceki
 * ödemeler faturalanmaz. Firma değişirse başlangıç da yenilenir.
 */
@Injectable()
export class AbonelikFaturaAyarService {
  constructor(private readonly platform: PlatformPrismaService) {}

  async getir() {
    const db = this.platform.db;
    const ayar = await db.abonelikFaturaAyari.findUnique({ where: { id: 1 } });
    const firma = ayar?.faturalayanTenantId
      ? (await db.$queryRaw<{ tenant_id: string; unvan: string }[]>`SELECT * FROM platform_firma_adlari(ARRAY[${ayar.faturalayanTenantId}]::uuid[])`)[0]
      : null;
    const hesaplar = ayar?.faturalayanTenantId ? await this.hesaplar(ayar.faturalayanTenantId) : [];
    const sorunlu = await db.abonelikFaturasi.findMany({ where: { durum: { in: ["bekliyor", "hata", "kesinlesti"] } }, orderBy: { updatedAt: "desc" }, take: 100 });
    const adlar = sorunlu.length
      ? new Map((await db.$queryRaw<{ tenant_id: string; unvan: string }[]>`SELECT * FROM platform_firma_adlari(${[...new Set(sorunlu.map((s) => s.odeyenTenantId))]}::uuid[])`).map((r) => [r.tenant_id, r.unvan.trim()]))
      : new Map<string, string>();
    return {
      faturalayan: firma ? { tenantId: firma.tenant_id, unvan: firma.unvan.trim() } : null,
      kartHesap: ayar?.kartHesapTur && ayar.kartHesapId ? { tur: ayar.kartHesapTur, id: ayar.kartHesapId } : null,
      elleHesap: ayar?.elleHesapTur && ayar.elleHesapId ? { tur: ayar.elleHesapTur, id: ayar.elleHesapId } : null,
      baslangicAt: ayar?.baslangicAt ?? null,
      hesaplar,
      // PLT-23: fatura bekleyen / hata veren / tahsilatı açılamayan ödemeler.
      sorunlu: sorunlu.map((s) => ({ odemeId: s.odemeId, firma: adlar.get(s.odeyenTenantId) ?? s.odeyenTenantId, durum: s.durum, faturaNo: s.faturaNo, hata: s.hata, deneme: s.deneme, guncellendi: s.updatedAt })),
    };
  }

  hesaplar(tenantId: string) {
    return this.platform.db.$queryRaw<HesapSatiri[]>`SELECT * FROM platform_tahsilat_hesaplari(${tenantId}::uuid)`;
  }

  async kaydet(g: FaturaAyarGirdisi) {
    const { kullaniciId } = aktifPlatformBaglam();
    const db = this.platform.db;
    if (g.faturalayanTenantId) {
      const [firma] = await db.$queryRaw<{ tenant_id: string }[]>`SELECT * FROM platform_firma_adlari(ARRAY[${g.faturalayanTenantId}]::uuid[])`;
      if (!firma) throw new BadRequestException("Faturalayan firma bulunamadı");
      const hesaplar = await this.hesaplar(g.faturalayanTenantId);
      for (const [ad, h] of [["Kart", g.kartHesap], ["Elle", g.elleHesap]] as const) {
        if (!h) continue;
        const bulunan = hesaplar.find((x) => x.tur === h.tur && x.id === h.id);
        if (!bulunan) throw new BadRequestException(`${ad} tahsilat hesabı faturalayan firmada bulunamadı`);
        if (bulunan.doviz !== "TRY") throw new BadRequestException(`${ad} tahsilat hesabı TL olmalı (${bulunan.ad}: ${bulunan.doviz})`);
      }
    }
    const eski = await db.abonelikFaturaAyari.findUnique({ where: { id: 1 } });
    const firmaDegisti = (eski?.faturalayanTenantId ?? null) !== g.faturalayanTenantId;
    const veri = {
      faturalayanTenantId: g.faturalayanTenantId,
      kartHesapTur: g.faturalayanTenantId ? g.kartHesap?.tur ?? null : null, kartHesapId: g.faturalayanTenantId ? g.kartHesap?.id ?? null : null,
      elleHesapTur: g.faturalayanTenantId ? g.elleHesap?.tur ?? null : null, elleHesapId: g.faturalayanTenantId ? g.elleHesap?.id ?? null : null,
      ...(firmaDegisti ? { baslangicAt: g.faturalayanTenantId ? new Date() : null } : {}),
      guncelleyenId: kullaniciId, updatedAt: new Date(),
    };
    await db.abonelikFaturaAyari.upsert({ where: { id: 1 }, create: { id: 1, ...veri }, update: veri });
    await db.mevzuatOlay.create({ data: { kullaniciId, olay: "abonelik_fatura_ayari_degisti", detay: { faturalayanTenantId: g.faturalayanTenantId, kartHesap: g.kartHesap, elleHesap: g.elleHesap, firmaDegisti } as Prisma.InputJsonValue } });
    return {
      mesaj: !g.faturalayanTenantId
        ? "Otomatik abonelik faturası kapatıldı."
        : firmaDegisti
          ? "Faturalayan firma kaydedildi; bundan sonraki ödemeler için taslak fatura açılır (geçmiş ödemeler faturalanmaz)."
          : "Abonelik faturası ayarı kaydedildi.",
    };
  }
}
