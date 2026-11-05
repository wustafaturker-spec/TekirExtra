import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { bugunTR } from "@tekirextra/shared";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformPrismaService } from "./platform-prisma.service";
import { olayDetayiniMaskele } from "./olay-gorunurlugu";

interface TakipGirdisi { sorumluId: string | null; durum: "acik" | "bekliyor" | "tamamlandi"; sonrakiGorusme: string | null; surum: number }
interface TakipSatiri {
  sorumluId: string | null; durum: TakipGirdisi["durum"]; sonrakiGorusme: string | null; surum: number;
  sorumluAdi: string | null; sorumluUygun: boolean | null; guncelleyen: string | null; updatedAt: Date;
}

@Injectable()
export class PlatformFirmaTakipService {
  constructor(private readonly platform: PlatformPrismaService) {}
  private yonetici() {
    const b = aktifPlatformBaglam();
    if (b.rol === "mevzuat_editoru") throw new ForbiddenException("Firma takibi için platform yöneticisi yetkisi gerekir.");
    return b;
  }
  private async firmaVar(tx: Pick<Prisma.TransactionClient, "$queryRaw">, id: string) {
    const satirlar = await tx.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id FROM platform_firma_adlari(ARRAY[${id}::uuid])`;
    if (!satirlar.length) throw new NotFoundException("Firma bulunamadı.");
  }
  sorumlular() {
    this.yonetici();
    return this.platform.db.platformKullanici.findMany({ where: { aktif: true, rol: "yonetici", davetTuru: null }, select: { id: true, adSoyad: true }, orderBy: [{ adSoyad: "asc" }, { id: "asc" }] });
  }
  private async oku(tx: Pick<Prisma.TransactionClient, "$queryRaw">, id: string) {
    const [r] = await tx.$queryRaw<TakipSatiri[]>`SELECT t.sorumlu_id AS "sorumluId", t.durum, t.sonraki_gorusme::text AS "sonrakiGorusme", t.surum,
      s.ad_soyad AS "sorumluAdi", (s.aktif AND s.rol = 'yonetici' AND s.davet_turu IS NULL) AS "sorumluUygun",
      k.ad_soyad AS guncelleyen, t.updated_at AS "updatedAt"
      FROM platform_firma_takipleri t LEFT JOIN platform_kullanicilari s ON s.id = t.sorumlu_id
      LEFT JOIN platform_kullanicilari k ON k.id = t.guncelleyen_id WHERE t.tenant_id = ${id}::uuid`;
    const takip = r ?? { sorumluId: null, durum: "acik" as const, sonrakiGorusme: null, surum: 0, sorumluAdi: null, sorumluUygun: null, guncelleyen: null, updatedAt: null };
    return { ...takip, gecikti: takip.durum !== "tamamlandi" && !!takip.sonrakiGorusme && takip.sonrakiGorusme < bugunTR() };
  }
  async getir(id: string) {
    this.yonetici();
    await this.firmaVar(this.platform.db, id);
    return this.oku(this.platform.db, id);
  }
  async guncelle(id: string, g: TakipGirdisi) {
    const { kullaniciId } = this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      // Kullanıcı rolü/pasife alma ve firma takibine atama aynı kilit sırasını kullanır.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki', 0))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`firma-takip:${id}`}, 0))::text`;
      await this.firmaVar(tx, id);
      const eski = await this.oku(tx, id);
      if (eski.surum !== g.surum) throw new ConflictException("Firma takibi başka biri tarafından değiştirildi. Taslağınızı koruyup güncel kaydı yükleyin.");
      if (g.sorumluId) {
        const uygun = await tx.platformKullanici.findFirst({ where: { id: g.sorumluId, aktif: true, rol: "yonetici", davetTuru: null }, select: { id: true } });
        if (!uygun) throw new BadRequestException("Sorumlu, kurulumu tamamlanmış aktif bir platform yöneticisi olmalı.");
      }
      await tx.$executeRaw`INSERT INTO platform_firma_takipleri (tenant_id, sorumlu_id, durum, sonraki_gorusme, surum, guncelleyen_id, updated_at)
        VALUES (${id}::uuid, ${g.sorumluId}::uuid, ${g.durum}, ${g.sonrakiGorusme}::date, 1, ${kullaniciId}::uuid, now())
        ON CONFLICT (tenant_id) DO UPDATE SET sorumlu_id = EXCLUDED.sorumlu_id, durum = EXCLUDED.durum,
          sonraki_gorusme = EXCLUDED.sonraki_gorusme, surum = platform_firma_takipleri.surum + 1, guncelleyen_id = EXCLUDED.guncelleyen_id, updated_at = now()`;
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "firma_takibi_guncellendi", detay: { tenantId: id,
        onceki: { sorumluId: eski.sorumluId, durum: eski.durum, sonrakiGorusme: eski.sonrakiGorusme },
        yeni: { sorumluId: g.sorumluId, durum: g.durum, sonrakiGorusme: g.sonrakiGorusme }, surum: g.surum + 1 } } });
      return this.oku(tx, id);
    });
  }
  async notlar(id: string, sayfa = 1) {
    this.yonetici();
    await this.firmaVar(this.platform.db, id);
    const [r] = await this.platform.db.$queryRaw<{ kayitlar: unknown[]; toplam: bigint }[]>`
      WITH kaynak AS (SELECT n.id, n.metin, n.created_at AT TIME ZONE 'UTC' AS zaman, k.ad_soyad AS yazar
        FROM platform_firma_notlari n JOIN platform_kullanicilari k ON k.id = n.yazar_id WHERE n.tenant_id = ${id}::uuid),
      sayfa AS (SELECT * FROM kaynak ORDER BY zaman DESC, id DESC LIMIT 25 OFFSET ${(sayfa - 1) * 25})
      SELECT COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY zaman DESC, id DESC) FROM sayfa s), '[]'::jsonb) AS kayitlar,
        (SELECT count(*) FROM kaynak) AS toplam`;
    return { kayitlar: r.kayitlar, toplam: Number(r.toplam), sayfa, sayfaBoyutu: 25 };
  }
  async notEkle(id: string, g: { metin: string; islemAnahtari: string }) {
    const { kullaniciId } = this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      await this.firmaVar(tx, id);
      const satirlar = await tx.$queryRaw<{ id: string }[]>`INSERT INTO platform_firma_notlari (tenant_id, yazar_id, metin, islem_anahtari)
        VALUES (${id}::uuid, ${kullaniciId}::uuid, ${g.metin}, ${g.islemAnahtari}::uuid)
        ON CONFLICT (tenant_id, yazar_id, islem_anahtari) DO NOTHING RETURNING id`;
      if (!satirlar.length) {
        const [eski] = await tx.$queryRaw<{ id: string; metin: string }[]>`SELECT id, metin FROM platform_firma_notlari
          WHERE tenant_id = ${id}::uuid AND yazar_id = ${kullaniciId}::uuid AND islem_anahtari = ${g.islemAnahtari}::uuid`;
        if (!eski || eski.metin !== g.metin) throw new ConflictException("Aynı işlem anahtarı farklı bir not için kullanılmış.");
        return { id: eski.id, mesaj: "Not daha önce kaydedilmişti." };
      }
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "firma_notu_eklendi", detay: { tenantId: id, notId: satirlar[0].id } } });
      return { id: satirlar[0].id, mesaj: "İç not kaydedildi." };
    });
  }
  async olaylar(id: string, sayfa = 1) {
    this.yonetici();
    await this.firmaVar(this.platform.db, id);
    const where = { detay: { path: ["tenantId"], equals: id } } satisfies Prisma.MevzuatOlayWhereInput;
    const [kayitlar, toplam] = await this.platform.db.$transaction([
      this.platform.db.mevzuatOlay.findMany({ where, orderBy: [{ zaman: "desc" }, { id: "desc" }], skip: (sayfa - 1) * 25, take: 25 }),
      this.platform.db.mevzuatOlay.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const kisiler = await this.platform.db.platformKullanici.findMany({ where: { id: { in: kayitlar.flatMap((k) => k.kullaniciId ? [k.kullaniciId] : []) } }, select: { id: true, adSoyad: true } });
    const adlar = new Map(kisiler.map((k) => [k.id, k.adSoyad]));
    return { kayitlar: kayitlar.map((k) => ({ ...k, detay: olayDetayiniMaskele(k.detay), kullanici: k.kullaniciId ? adlar.get(k.kullaniciId) ?? "Platform kullanıcısı" : "Sistem" })), toplam, sayfa, sayfaBoyutu: 25 };
  }
}
