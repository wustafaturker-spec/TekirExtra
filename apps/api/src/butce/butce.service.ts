import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { SABIT_KALEMLER, tahakkukOku } from "../rapor/tahakkuk";
import { bosAylar, karsilastir, type KalemTanimi } from "./butce.hesap";

const yilAraligi = (yil: number) => ({
  baslangic: new Date(Date.UTC(yil, 0, 1)),
  bitis: new Date(Date.UTC(yil, 11, 31, 23, 59, 59, 999)),
});

/** Türkiye takvimine göre bugünün yılı ve ayı. */
function bugun(): { yil: number; ay: number } {
  const [yil, ay] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date()).split("-").map(Number);
  return { yil, ay };
}

type Tx = Prisma.TransactionClient;

/**
 * Yıllık bütçe (BUT-05…BUT-09): taslak → onay → revizyon ve gerçekleşenle
 * karşılaştırma. Gerçekleşen gelir-gider raporuyla aynı hesaptan gelir.
 */
@Injectable()
export class ButceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bütçelenebilecek kalemler: sabit kalemler + gelir ve masraf kategori ağaçları.
   * Satın alma talebinin bütçe kalemi de bu listeden seçilir (SAT-01).
   */
  async kalemTanimlari(tx: Tx, tenantId: string): Promise<KalemTanimi[]> {
    const [masraf, gelir] = [
      await tx.masrafKategori.findMany({ where: { tenantId }, select: { id: true, ad: true, ust: { select: { ad: true } } } }),
      await tx.gelirKategori.findMany({ where: { tenantId }, select: { id: true, ad: true, ust: { select: { ad: true } } } }),
    ];
    const yer = (k: { ad: string; ust: { ad: string } | null }, varsayilan: string) =>
      k.ust ? { anaKategori: k.ust.ad, altKategori: k.ad } : { anaKategori: k.ad, altKategori: varsayilan };
    const sirala = (a: KalemTanimi, b: KalemTanimi) => a.anaKategori.localeCompare(b.anaKategori, "tr") || a.altKategori.localeCompare(b.altKategori, "tr");
    const sabitGelir = SABIT_KALEMLER.filter((k) => k.tur === "gelir");
    const sabitGider = SABIT_KALEMLER.filter((k) => k.tur === "gider");
    return [
      ...sabitGelir,
      ...gelir.map((k) => ({ anahtar: `gelir_kategori:${k.id}`, tur: "gelir" as const, ...yer(k, "Genel") })).sort(sirala),
      ...sabitGider,
      ...masraf.map((k) => ({ anahtar: `masraf_kategori:${k.id}`, tur: "gider" as const, ...yer(k, "Genel Masraf") })).sort(sirala),
    ];
  }

  private satirHaritasi(satirlar: { anahtar: string; ay: number; tutar: Prisma.Decimal }[]) {
    const harita = new Map<string, number[]>();
    for (const s of satirlar) {
      const aylar = harita.get(s.anahtar) ?? bosAylar();
      aylar[s.ay - 1] = Math.round(Number(s.tutar) * 100);
      harita.set(s.anahtar, aylar);
    }
    return harita;
  }

  private revizyonGorunumu(b: { id: string; revizyon: number; durum: string; gerekce: string | null; onayTarihi: Date | null; createdAt: Date; onaylayan: { adSoyad: string } | null }) {
    return { id: b.id, revizyon: b.revizyon, durum: b.durum, gerekce: b.gerekce, onayTarihi: b.onayTarihi?.toISOString() ?? null, onaylayan: b.onaylayan?.adSoyad ?? null, olusturuldu: b.createdAt.toISOString() };
  }

  async getir(yil: number) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const revizyonlar = await tx.butce.findMany({
        where: { tenantId, yil },
        orderBy: { revizyon: "asc" },
        include: { satirlar: { select: { anahtar: true, ay: true, tutar: true } }, onaylayan: { select: { adSoyad: true } } },
      });
      const olaylar = await tx.butceOlayi.findMany({
        where: { tenantId, butce: { yil } },
        orderBy: { createdAt: "desc" },
        select: { tur: true, gerekce: true, createdAt: true, butce: { select: { revizyon: true } }, kullanici: { select: { adSoyad: true } } },
      });
      const acik = (durum: string) => revizyonlar.find((r) => r.durum === durum) ?? null;
      const tutarlar = (r: (typeof revizyonlar)[number] | null) =>
        r ? Object.fromEntries([...this.satirHaritasi(r.satirlar)].map(([k, v]) => [k, v.map((x) => x / 100)])) : null;
      const taslak = acik("taslak");
      const gecerli = acik("onayli");
      return {
        yil,
        kalemler: await this.kalemTanimlari(tx, tenantId),
        revizyonlar: revizyonlar.map((r) => this.revizyonGorunumu(r)),
        taslak: taslak ? { ...this.revizyonGorunumu(taslak), tutarlar: tutarlar(taslak) } : null,
        gecerli: gecerli ? { ...this.revizyonGorunumu(gecerli), tutarlar: tutarlar(gecerli) } : null,
        olaylar: olaylar.map((o) => ({ tur: o.tur, gerekce: o.gerekce, revizyon: o.butce.revizyon, kullanici: o.kullanici.adSoyad, zaman: o.createdAt.toISOString() })),
      };
    });
  }

  /** İlk taslak (BUT-08): boş ya da geçen yılın aylık gerçekleşeninden. */
  async olustur(yil: number, girdi: { kaynak: "bos" | "gecen_yil"; artisYuzde: number }) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (await tx.butce.count({ where: { tenantId, yil } })) {
        throw new ConflictException(`${yil} bütçesi zaten var; değiştirmek için revizyon açın`);
      }
      const butce = await tx.butce.create({ data: { tenantId, yil, revizyon: 1 } });
      if (girdi.kaynak === "gecen_yil") {
        const { baslangic, bitis } = yilAraligi(yil - 1);
        const { kalemler } = await tahakkukOku(tx, tenantId, baslangic, bitis);
        const carpan = 1 + girdi.artisYuzde / 100;
        const gruplar = new Map<string, number>();
        for (const k of kalemler) {
          const anahtar = `${k.anahtar}|${Number(k.tarih.slice(5, 7))}`;
          gruplar.set(anahtar, (gruplar.get(anahtar) ?? 0) + Math.round(k.tutarTry * 100));
        }
        const veri = [...gruplar]
          .map(([anahtar, kurus]) => {
            const [k, ay] = anahtar.split("|");
            return { tenantId, butceId: butce.id, anahtar: k, ay: Number(ay), tutar: new Prisma.Decimal(Math.max(0, Math.round(kurus * carpan)) / 100) };
          })
          .filter((s) => !s.tutar.isZero());
        if (veri.length) await tx.butceSatiri.createMany({ data: veri });
      }
      await tx.butceOlayi.create({
        data: { tenantId, butceId: butce.id, tur: "olusturuldu", userId, gerekce: girdi.kaynak === "gecen_yil" ? `${yil - 1} gerçekleşeninden, %${girdi.artisYuzde} artışla` : null },
      });
      return { id: butce.id };
    });
  }

  /** Yalnız taslak düzenlenir; gönderilen satırlar taslağın tamamının yerine geçer. */
  async satirlariKaydet(butceId: string, satirlar: { anahtar: string; ay: number; tutar: string }[]) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const butce = await tx.butce.findFirst({ where: { tenantId, id: butceId } });
      if (!butce) throw new NotFoundException("Bütçe bulunamadı");
      if (butce.durum !== "taslak") throw new BadRequestException("Onaylı bütçe değiştirilemez; revizyon açın");
      const gecerli = new Set((await this.kalemTanimlari(tx, tenantId)).map((k) => k.anahtar));
      const bilinmeyen = satirlar.find((s) => !gecerli.has(s.anahtar));
      if (bilinmeyen) throw new BadRequestException(`Bilinmeyen bütçe kalemi: ${bilinmeyen.anahtar}`);
      await tx.butceSatiri.deleteMany({ where: { tenantId, butceId } });
      const veri = satirlar
        .map((s) => ({ tenantId, butceId, anahtar: s.anahtar, ay: s.ay, tutar: new Prisma.Decimal(s.tutar) }))
        .filter((s) => !s.tutar.isZero());
      if (veri.length) await tx.butceSatiri.createMany({ data: veri });
      await tx.butce.update({ where: { id: butceId }, data: { updatedAt: new Date() } });
      return { kaydedilen: veri.length };
    });
  }

  /** Yalnız yönetici (BUT-06). Önceki onaylı revizyon yerine geçilmiş sayılır. */
  async onayla(butceId: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const butce = await tx.butce.findFirst({ where: { tenantId, id: butceId } });
      if (!butce) throw new NotFoundException("Bütçe bulunamadı");
      if (butce.durum !== "taslak") throw new BadRequestException("Yalnız taslak bütçe onaylanabilir");
      await tx.butce.updateMany({ where: { tenantId, yil: butce.yil, durum: "onayli" }, data: { durum: "yerine_gecildi" } });
      await tx.butce.update({ where: { id: butceId }, data: { durum: "onayli", onaylayanUserId: userId, onayTarihi: new Date() } });
      await tx.butceOlayi.create({ data: { tenantId, butceId, tur: "onaylandi", userId } });
      return { id: butceId, durum: "onayli" };
    });
  }

  /** Onaylı bütçeyi değiştirmenin tek yolu: gerekçeli yeni revizyon (BUT-06, BUT-08). */
  async revizyonAc(yil: number, gerekce: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const revizyonlar = await tx.butce.findMany({ where: { tenantId, yil }, orderBy: { revizyon: "desc" }, include: { satirlar: true } });
      if (revizyonlar.some((r) => r.durum === "taslak")) throw new ConflictException("Bu yıl için açık bir taslak zaten var");
      const gecerli = revizyonlar.find((r) => r.durum === "onayli");
      if (!gecerli) throw new BadRequestException("Revizyon açmak için onaylı bir bütçe olmalıdır");
      const yeni = await tx.butce.create({ data: { tenantId, yil, revizyon: revizyonlar[0].revizyon + 1, gerekce } });
      if (gecerli.satirlar.length) {
        await tx.butceSatiri.createMany({
          data: gecerli.satirlar.map((s) => ({ tenantId, butceId: yeni.id, anahtar: s.anahtar, ay: s.ay, tutar: s.tutar })),
        });
      }
      await tx.butceOlayi.create({ data: { tenantId, butceId: yeni.id, tur: "revizyon_acildi", gerekce, userId } });
      return { id: yeni.id, revizyon: yeni.revizyon };
    });
  }

  /** BUT-07: son onaylı revizyon ve ilk onaylı plan gerçekleşenle karşılaştırılır. */
  async karsilastirma(yil: number) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const onaylilar = await tx.butce.findMany({
        where: { tenantId, yil, durum: { in: ["onayli", "yerine_gecildi"] } },
        orderBy: { revizyon: "asc" },
        include: { satirlar: { select: { anahtar: true, ay: true, tutar: true } } },
      });
      const gecerli = onaylilar.find((b) => b.durum === "onayli") ?? null;
      const ilk = onaylilar[0] ?? null;
      const { baslangic, bitis } = yilAraligi(yil);
      const { kalemler, uyarilar } = await tahakkukOku(tx, tenantId, baslangic, bitis);
      const simdi = bugun();
      const sonAy = yil < simdi.yil ? 12 : yil > simdi.yil ? 0 : simdi.ay;
      const sonuc = karsilastir({
        tanimlar: await this.kalemTanimlari(tx, tenantId),
        plan: gecerli ? this.satirHaritasi(gecerli.satirlar) : new Map(),
        ilkPlan: ilk && gecerli && ilk.id !== gecerli.id ? this.satirHaritasi(ilk.satirlar) : null,
        gerceklesen: kalemler,
        sonAy,
      });
      return {
        yil,
        sonAy,
        gecerliRevizyon: gecerli?.revizyon ?? null,
        ilkRevizyon: ilk && gecerli && ilk.id !== gecerli.id ? ilk.revizyon : null,
        ...sonuc,
        uyarilar,
      };
    });
  }
}
