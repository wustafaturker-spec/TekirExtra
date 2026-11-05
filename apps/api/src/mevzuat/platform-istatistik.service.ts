import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { bugunTR } from "@tekirextra/shared";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformPrismaService } from "./platform-prisma.service";
import { aralikDogrula, gunEkle, type IstatistikFiltresi } from "./platform-istatistik-filtre";

interface Gun { gun: string; etkinFirma: number; etkinKullanici: number; giris: number; islem: number; planEksik: boolean; uretildiAt: string | null; surum: number | null }
interface Toplam { etkinFirma: number; giris: number; islem: number }
interface Firma { tenantId: string; unvan: string | null; etkinGun: number; giris: number; islem: number; etkinKullanici: number }
export interface GuncelIstatistik {
  zaman: string; toplam: number; aktif: number; deneme: number; askida: number; iptal: number;
  geciken: number; talep: number; yaklasan: number; baglantiHatali: number; basarisizOdeme7Gun: number;
  planlar: { kod: string; adet: number }[];
}
@Injectable()
export class PlatformIstatistikService {
  constructor(private readonly platform: PlatformPrismaService) {}
  private yonetici() {
    const b = aktifPlatformBaglam();
    if (b.rol === "mevzuat_editoru") throw new ForbiddenException("Firma istatistikleri için platform yöneticisi yetkisi gerekir.");
    return b;
  }
  async rapor(f: IstatistikFiltresi) {
    this.yonetici();
    const a = aralikDogrula(f.baslangic, f.bitis);
    const operasyonGun = f.operasyonGun ?? f.bitis;
    if (operasyonGun < f.baslangic || operasyonGun > f.bitis) throw new BadRequestException("Operasyon ayrıntı günü seçili tarih aralığında olmalı.");
    const plan = f.plan || null;
    const firma = f.firma ?? null;
    return this.platform.db.$transaction(async (tx) => {
      const [ayar] = await tx.$queryRaw<{ baslangic: string }[]>`SELECT baslangic::text FROM platform_istatistik_ayari WHERE id = 1`;
      const filtre = Prisma.sql`(${plan}::text IS NULL OR o.plan_kodu = ${plan}) AND (${firma}::uuid IS NULL OR o.tenant_id = ${firma}::uuid)`;
      const [veri] = await tx.$queryRaw<{
        gunler: Gun[]; donem: Toplam; onceki: Toplam; moduller: { kod: string; adet: number }[];
        firmalar: Firma[]; firmaToplam: bigint;
      }[]>`
        WITH kaynak AS MATERIALIZED (SELECT o.* FROM platform_firma_gunluk_ozetleri o
          JOIN platform_istatistik_gunleri g ON g.gun = o.gun AND g.surum = 1
          WHERE o.gun BETWEEN ${a.oncekiBaslangic}::date AND ${f.bitis}::date AND o.gun >= ${ayar.baslangic}::date AND ${filtre}),
        gunler AS (
          SELECT d::date::text AS gun, g.uretildi_at AT TIME ZONE 'UTC' AS "uretildiAt", g.surum,
            count(k.tenant_id) FILTER (WHERE k.etkin_kullanici > 0) AS "etkinFirma", COALESCE(sum(k.etkin_kullanici),0) AS "etkinKullanici",
            COALESCE(sum(k.giris),0) AS giris, COALESCE(sum(k.islem),0) AS islem,
            (${plan}::text IS NOT NULL AND EXISTS (SELECT 1 FROM platform_firma_gunluk_ozetleri x WHERE x.gun = d::date
              AND x.plan_kodu IS NULL AND (${firma}::uuid IS NULL OR x.tenant_id = ${firma}::uuid))) AS "planEksik"
          FROM generate_series(${a.oncekiBaslangic}::date, ${f.bitis}::date, interval '1 day') d
          LEFT JOIN platform_istatistik_gunleri g ON g.gun = d::date LEFT JOIN kaynak k ON k.gun = d::date
          GROUP BY d, g.uretildi_at, g.surum
        ), donem AS (SELECT * FROM kaynak WHERE gun >= ${f.baslangic}::date),
        firmalar AS (SELECT tenant_id, count(*) FILTER (WHERE etkin_kullanici > 0) AS "etkinGun", sum(giris) AS giris, sum(islem) AS islem
          FROM donem GROUP BY tenant_id
          HAVING ${f.olcut === "giris" ? Prisma.sql`sum(giris) > 0` : f.olcut === "islem" ? Prisma.sql`sum(islem) > 0` : Prisma.sql`sum(etkin_kullanici) > 0`}),
        sayfa AS (SELECT * FROM firmalar ORDER BY "etkinGun" DESC, tenant_id ASC LIMIT 25 OFFSET ${(f.sayfa - 1) * 25})
        SELECT (SELECT jsonb_agg(to_jsonb(g) ORDER BY gun) FROM gunler g) AS gunler,
          (SELECT jsonb_build_object('etkinFirma', count(DISTINCT tenant_id) FILTER (WHERE etkin_kullanici > 0), 'giris', COALESCE(sum(giris),0), 'islem', COALESCE(sum(islem),0)) FROM donem) AS donem,
          (SELECT jsonb_build_object('etkinFirma', count(DISTINCT tenant_id) FILTER (WHERE etkin_kullanici > 0), 'giris', COALESCE(sum(giris),0), 'islem', COALESCE(sum(islem),0)) FROM kaynak WHERE gun < ${f.baslangic}::date) AS onceki,
          COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY adet DESC, kod) FROM (SELECT j.key AS kod, sum(j.value::bigint) AS adet FROM donem d CROSS JOIN LATERAL jsonb_each_text(d.moduller) j GROUP BY j.key) m), '[]'::jsonb) AS moduller,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('tenantId', s.tenant_id, 'unvan', n.unvan, 'etkinGun', s."etkinGun", 'giris', s.giris, 'islem', s.islem,
            'etkinKullanici', platform_istatistik_tekil_kullanici(${f.baslangic}::date, ${f.bitis}::date, ${plan}::text, s.tenant_id)) ORDER BY s."etkinGun" DESC, s.tenant_id)
            FROM sayfa s LEFT JOIN LATERAL platform_firma_adlari(ARRAY[s.tenant_id]) n ON true), '[]'::jsonb) AS firmalar,
          (SELECT count(*) FROM firmalar) AS "firmaToplam"`;
      const [ek] = await tx.$queryRaw<{ kullanici: bigint; oncekiKullanici: bigint; guncel: GuncelIstatistik; buyume: unknown; baslama: unknown; operasyon: unknown; odeme: { sayilar: { basarisiz: number; sonuclanmadi: number } } }[]>`
        SELECT platform_istatistik_tekil_kullanici(${f.baslangic}::date, ${f.bitis}::date, ${plan}::text, ${firma}::uuid) AS kullanici,
          platform_istatistik_tekil_kullanici(${a.oncekiBaslangic}::date, ${a.oncekiBitis}::date, ${plan}::text, ${firma}::uuid) AS "oncekiKullanici",
          platform_istatistik_guncel(${plan}::text, ${firma}::uuid) AS guncel,
          platform_buyume_raporu(${f.baslangic}::date, ${f.bitis}::date, ${plan}::text, ${firma}::uuid) AS buyume,
          platform_kullanima_baslama(${f.bitis}::date, ${plan}::text, ${firma}::uuid, ${f.baslamaDurum}::text, ${f.baslamaSayfa}::integer) AS baslama,
          platform_bekleyen_isler(${plan}::text, ${firma}::uuid, ${f.operasyon}::text, ${f.operasyonSayfa}::integer) AS operasyon,
          platform_sorunlu_odeme_kapsami(${f.baslangic}::date, ${f.bitis}::date, ${plan}::text, ${firma}::uuid, 'hepsi'::text, 1) AS odeme`;
      const tumGunler = veri.gunler.map((g) => ({ ...g, eksik: !g.uretildiAt || g.surum !== 1 || g.gun < ayar.baslangic || g.planEksik }));
      const donemGunleri = tumGunler.filter((g) => g.gun >= f.baslangic);
      const oncekiGunler = tumGunler.filter((g) => g.gun < f.baslangic);
      const metrikler = (t: Toplam, kullanici: bigint, gunler: typeof tumGunler) => ({
        etkinFirma: gunler.some((g) => g.eksik) ? null : t.etkinFirma,
        etkinKullanici: gunler.some((g) => g.eksik) ? null : Number(kullanici),
        giris: gunler.some((g) => g.eksik) ? null : t.giris,
        islem: gunler.some((g) => g.eksik) ? null : t.islem,
      });
      const [gecmis] = await tx.$queryRaw<{ veri: unknown }[]>`SELECT platform_operasyon_gecmisi(${f.baslangic}::date, ${f.bitis}::date, ${plan}::text, ${firma}::uuid, ${operasyonGun}::date, ${f.operasyonGecmisSayfa}::integer) AS veri`;
      return {
        aralik: { baslangic: f.baslangic, bitis: f.bitis, oncekiBaslangic: a.oncekiBaslangic, oncekiBitis: a.oncekiBitis },
        olcum: { baslangic: ayar.baslangic, gunSayisi: a.adet, olculenGun: donemGunleri.filter((g) => !g.eksik).length,
          eksikGunler: donemGunleri.filter((g) => g.eksik).map((g) => g.gun), bugunDahil: f.bitis === bugunTR(),
          sonGuncelleme: donemGunleri.flatMap((g) => g.uretildiAt ? [g.uretildiAt] : []).sort().at(-1) ?? null },
        donem: metrikler(veri.donem, ek.kullanici, donemGunleri), onceki: metrikler(veri.onceki, ek.oncekiKullanici, oncekiGunler),
        gunler: donemGunleri.map((g) => ({ gun: g.gun, etkinFirma: g.eksik ? null : g.etkinFirma, etkinKullanici: g.eksik ? null : g.etkinKullanici, giris: g.eksik ? null : g.giris, islem: g.eksik ? null : g.islem })),
        moduller: veri.moduller, guncel: ek.guncel, buyume: ek.buyume, baslama: ek.baslama, operasyon: ek.operasyon, odeme: { sayilar: ek.odeme.sayilar },
        operasyonGecmisi: gecmis.veri,
        firmalar: { kayitlar: veri.firmalar, toplam: Number(veri.firmaToplam), sayfa: f.sayfa, sayfaBoyutu: 25 },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }
  async gunuUret(gun: string) {
    const [r] = await this.platform.db.$queryRaw<{ adet: number | null }[]>`SELECT platform_firma_istatistik_uret(${gun}::date) AS adet`;
    return r.adet;
  }
  async operasyonGozle() {
    const [r] = await this.platform.db.$queryRaw<{ tamam: boolean }[]>`SELECT platform_operasyon_gozle() AS tamam`;
    return r.tamam;
  }
  async yenidenHesapla(baslangic: string, bitis: string) {
    const { kullaniciId } = this.yonetici();
    const { adet } = aralikDogrula(baslangic, bitis, 31);
    const [ayar] = await this.platform.db.$queryRaw<{ baslangic: string }[]>`SELECT baslangic::text FROM platform_istatistik_ayari WHERE id = 1`;
    if (baslangic < ayar.baslangic) throw new BadRequestException("Ölçüm başlangıcından önceki günler yeniden hesaplanamaz.");
    let bekleyen = 0;
    for (let i = 0; i < adet; i++) if (await this.gunuUret(gunEkle(baslangic, i)) === null) bekleyen++;
    await this.platform.db.mevzuatOlay.create({ data: { kullaniciId, olay: "firma_istatistikleri_hesaplandi", detay: { baslangic, bitis, gun: adet, tamamlanan: adet - bekleyen, bekleyen } } });
    return { tamamlanan: adet - bekleyen, bekleyen, mesaj: bekleyen
      ? `${adet - bekleyen} gün tamamlandı; ${bekleyen} gün için başka bir hesaplama sürüyor. Sonuçlar için sayfayı yenileyin.`
      : `${adet} gün için istatistik hesaplama tamamlandı.` };
  }
}
