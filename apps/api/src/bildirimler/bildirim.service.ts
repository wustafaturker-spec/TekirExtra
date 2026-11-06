import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { BildirimOnemi, BildirimTuru, Prisma } from "@prisma/client";
import { ozelRolPanelYoluKapali, type Rol } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type { bildirimListeSemasi } from "./bildirimler.semalar";
import { tahsilatBildirimKapsami } from "../cari/tahsilat-bildirimi";

type ListeGirdisi = z.infer<typeof bildirimListeSemasi>;

/** Bir olayın bildirime dönüşmesi için gereken her şey. */
export interface BildirimGirdisi {
  tur: BildirimTuru;
  onem: BildirimOnemi;
  baslik: string;
  aciklama: string;
  /**
   * Aynı olayın ikinci kez bildirilmemesini sağlayan anahtar (BLD-03).
   * Kayıt bazlı olaylarda `duzeltme:<id>`, toplu olaylarda `vade:<gün>` gibi.
   */
  birlesimAnahtari: string;
  kaynakTur?: string;
  kaynakRef?: string;
  hedefYol?: string;
  sonTarih?: Date;
  /** Bildirimin düşeceği roller; kullanıcılar bu rollerden türetilir. */
  roller: Rol[];
  /** Verilirse bildirim rollere değil yalnız bu kullanıcılara düşer (AI-04). */
  kullaniciIdler?: string[];
}

const ACIK_DURUMLAR = ["yeni", "okundu", "ustlenildi"] as const;

@Injectable()
export class BildirimService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Olayı kalıcı kayda çevirir ve hedef kullanıcılara teslimat açar.
   *
   * Olay sürüyorsa yeni kayıt açılmaz; başlık/açıklama tazelenir ve
   * `sonTespitTarihi` güncellenir. Kullanıcının kapattığı kanal için teslimat
   * satırı yazılmaz (BLD-04); iki kanal da kapalıysa kullanıcı hiç eklenmez.
   */
  async uret(girdi: BildirimGirdisi): Promise<{ bildirimId: string; yeniTeslimat: number }> {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bildirim = await tx.bildirim.upsert({
        where: { tenantId_birlesimAnahtari: { tenantId, birlesimAnahtari: girdi.birlesimAnahtari } },
        create: {
          tenantId,
          tur: girdi.tur,
          onem: girdi.onem,
          baslik: girdi.baslik,
          aciklama: girdi.aciklama,
          kaynakTur: girdi.kaynakTur,
          kaynakRef: girdi.kaynakRef,
          hedefYol: girdi.hedefYol,
          birlesimAnahtari: girdi.birlesimAnahtari,
          sonTarih: girdi.sonTarih,
        },
        update: {
          onem: girdi.onem,
          baslik: girdi.baslik,
          aciklama: girdi.aciklama,
          // `sonTarih` bilerek tazelenmez: son tarih ilk tespitte belirlenir,
          // aksi hâlde her tarama onu ileri iter ve SLA hiç dolmaz.
          sonTespitTarihi: new Date(),
          kapandiAt: null,
        },
      });

      const [kullanicilar, tercihler, mevcutTeslimatlar] = await Promise.all([
        tx.user.findMany({
          where: girdi.kullaniciIdler ? { id: { in: girdi.kullaniciIdler }, aktif: true } : { rol: { in: girdi.roller }, aktif: true },
          select: { id: true, ozelRol: { select: { kapaliKutular: true } } },
        }).then((liste) =>
          // KLN-20: özel rolü hedef ekranın modülünü görmeyen kullanıcıya düşmez.
          liste.filter((k) => !girdi.hedefYol || !k.ozelRol || !ozelRolPanelYoluKapali(k.ozelRol.kapaliKutular, girdi.hedefYol))),
        tx.bildirimTercihi.findMany({ where: { tur: girdi.tur }, select: { userId: true, uygulamaIci: true, eposta: true } }),
        tx.bildirimTeslimati.findMany({ where: { bildirimId: bildirim.id }, select: { userId: true } }),
      ]);
      const tercih = new Map(tercihler.map((t) => [t.userId, t]));
      const teslimEdilen = new Set(mevcutTeslimatlar.map((t) => t.userId));

      const yeniler = kullanicilar
        .filter((kullanici) => !teslimEdilen.has(kullanici.id))
        .map((kullanici) => ({ kullanici, secim: tercih.get(kullanici.id) ?? { uygulamaIci: true, eposta: true } }))
        .filter(({ secim }) => secim.uygulamaIci || secim.eposta)
        .map(({ kullanici, secim }) => ({
          tenantId,
          bildirimId: bildirim.id,
          userId: kullanici.id,
          // Uygulama içi kapalıysa kayıt yalnız e-posta kanalı için tutulur;
          // kullanıcı listesinde görünmemesi için doğrudan okundu sayılır.
          durum: secim.uygulamaIci ? ("yeni" as const) : ("okundu" as const),
          okunduAt: secim.uygulamaIci ? null : new Date(),
          epostaDurumu: secim.eposta ? ("beklemede" as const) : ("kapali" as const),
        }));

      if (yeniler.length) await tx.bildirimTeslimati.createMany({ data: yeniler });
      return { bildirimId: bildirim.id, yeniTeslimat: yeniler.length };
    });
  }

  /**
   * Bir türde artık tespit edilmeyen bildirimleri kapatır. Olay ortadan
   * kalktığında kullanıcının listesi kendiliğinden temizlenir; kapanmış kayıt
   * silinmez, geçmiş olarak kalır.
   *
   * Yalnız `onekler` ile başlayan, yani taramanın kendi ürettiği anahtarlar
   * kapatılır. Aynı türde olay anında üretilen bildirimler (alıcı reddi,
   * raporlanmış iptal) taramada hiç tespit edilmediği için onlara dokunulursa
   * dakikalar içinde sessizce kapanıyorlardı.
   */
  async kapatEksikleri(tur: BildirimTuru, acikAnahtarlar: string[], onekler: string[]): Promise<number> {
    const { tenantId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bildirim.updateMany({
        where: {
          tur,
          kapandiAt: null,
          OR: onekler.map((onek) => ({ birlesimAnahtari: { startsWith: onek } })),
          ...(acikAnahtarlar.length ? { birlesimAnahtari: { notIn: acikAnahtarlar } } : {}),
        },
        data: { kapandiAt: new Date() },
      }),
    );
    return sonuc.count;
  }

  /**
   * BLD-11: taramanın `kapatEksikleri` adımı, tür başına ayrı işlem yerine tek
   * okuma + en çok bir yazmayla. Kural birebir aynıdır: türü taranmış, anahtarı
   * öneklerden biriyle başlayan ve bu taramada bulunmayan açık kayıt kapanır.
   */
  async taramaEksikleriniKapat(kapsamlar: { tur: BildirimTuru; acikAnahtarlar: string[]; onekler: string[] }[]): Promise<number> {
    const { tenantId } = aktifBaglam();
    const turler = kapsamlar.filter((k) => k.onekler.length).map((k) => k.tur);
    if (!turler.length) return 0;
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const acik = await tx.bildirim.findMany({ where: { kapandiAt: null, tur: { in: turler } }, select: { id: true, tur: true, birlesimAnahtari: true } });
      const kural = new Map(kapsamlar.map((k) => [k.tur, { acik: new Set(k.acikAnahtarlar), onekler: k.onekler }]));
      const kapanacak = acik.filter((b) => {
        const k = kural.get(b.tur);
        return !!k && k.onekler.some((o) => b.birlesimAnahtari.startsWith(o)) && !k.acik.has(b.birlesimAnahtari);
      }).map((b) => b.id);
      if (!kapanacak.length) return 0;
      return (await tx.bildirim.updateMany({ where: { id: { in: kapanacak }, kapandiAt: null }, data: { kapandiAt: new Date() } })).count;
    });
  }

  async listele(girdi: ListeGirdisi) {
    const { tenantId, userId, rol } = aktifBaglam();
    if (girdi.kapsam === "firma" && rol !== "yonetici") throw new ForbiddenException("Firma geneli bildirimleri yalnız yönetici görebilir");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const tahsilatKapsami = await tahsilatBildirimKapsami(tx, tenantId, rol, userId, girdi.kapsam === "firma");
      const where: Prisma.BildirimTeslimatiWhereInput = {
        ...(girdi.kapsam === "firma" ? {} : { userId }),
        ...(girdi.durum ? { durum: girdi.durum } : {}),
        bildirim: {
          ...tahsilatKapsami,
          ...(girdi.tur ? { tur: girdi.tur } : {}),
          ...(girdi.onem ? { onem: girdi.onem } : {}),
          ...(girdi.kapanmis === "true" ? { kapandiAt: { not: null } } : { kapandiAt: null }),
        },
      };
      const [toplam, kayitlar] = await Promise.all([
        tx.bildirimTeslimati.count({ where }),
        tx.bildirimTeslimati.findMany({
          where,
          include: { bildirim: true, kullanici: { select: { id: true, adSoyad: true } } },
          orderBy: [{ createdAt: "desc" }],
          skip: (girdi.sayfa - 1) * girdi.limit,
          take: girdi.limit,
        }),
      ]);
      return { kayitlar, toplam, sayfa: girdi.sayfa, limit: girdi.limit, toplamSayfa: Math.ceil(toplam / girdi.limit) };
    });
  }

  /** Zil menüsünün beslendiği sayaçlar — okundu ile aksiyon alındı ayrı ölçülür (BLD-02). */
  async ozet() {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kapsam = await tahsilatBildirimKapsami(tx, tenantId, rol, userId);
      const gruplar = await tx.bildirimTeslimati.groupBy({
        by: ["durum"],
        where: { userId, bildirim: { ...kapsam, kapandiAt: null } },
        _count: { _all: true },
      });
      const say = (durumlar: string[]) => gruplar.filter((g) => durumlar.includes(g.durum)).reduce((toplam, g) => toplam + g._count._all, 0);
      const kritik = await tx.bildirimTeslimati.count({
        where: { userId, durum: { in: [...ACIK_DURUMLAR] }, bildirim: { ...kapsam, kapandiAt: null, onem: "kritik" } },
      });
      return {
        okunmamis: say(["yeni"]),
        acik: say([...ACIK_DURUMLAR]),
        ustlenilen: say(["ustlenildi"]),
        aksiyonAlinan: say(["aksiyon_alindi"]),
        kritik,
      };
    });
  }

  async okunduIsaretle(ids: string[]) {
    return this.durumYaz(ids, { durum: "okundu", okunduAt: new Date() }, ["yeni"]);
  }

  async tumunuOkunduIsaretle() {
    const { tenantId, userId, rol } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) =>
      tx.bildirimTeslimati.updateMany({ where: { userId, durum: "yeni", bildirim: await tahsilatBildirimKapsami(tx, tenantId, rol, userId) }, data: { durum: "okundu", okunduAt: new Date() } }));
    return { guncellenen: sonuc.count };
  }

  /** Kullanıcı bildirimi sahiplenir; kimin ilgilendiği böylece belli olur. */
  async ustlen(id: string) {
    return this.tekTeslimatGuncelle(id, { durum: "ustlenildi", ustlenildiAt: new Date(), okunduAt: new Date() });
  }

  async aksiyonAlindi(id: string, not?: string) {
    return this.tekTeslimatGuncelle(id, { durum: "aksiyon_alindi", aksiyonAt: new Date(), aksiyonNotu: not ?? null, okunduAt: new Date() });
  }

  async yokSay(id: string) {
    return this.tekTeslimatGuncelle(id, { durum: "yoksayildi", okunduAt: new Date() });
  }

  async tercihleriGetir() {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [tercihler, ayar] = await Promise.all([
        tx.bildirimTercihi.findMany({ where: { userId }, orderBy: { tur: "asc" } }),
        tx.bildirimKullaniciAyari.findUnique({ where: { userId } }),
      ]);
      return { tercihler, sessizBaslangic: ayar?.sessizBaslangic ?? null, sessizBitis: ayar?.sessizBitis ?? null };
    });
  }

  async tercihKaydet(girdi: { tur: BildirimTuru; uygulamaIci: boolean; eposta: boolean }) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bildirimTercihi.upsert({
        where: { tenantId_userId_tur: { tenantId, userId, tur: girdi.tur } },
        create: { tenantId, userId, tur: girdi.tur, uygulamaIci: girdi.uygulamaIci, eposta: girdi.eposta },
        update: { uygulamaIci: girdi.uygulamaIci, eposta: girdi.eposta },
      }),
    );
  }

  async sessizSaatKaydet(baslangic: string | null, bitis: string | null) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bildirimKullaniciAyari.upsert({
        where: { userId },
        create: { tenantId, userId, sessizBaslangic: baslangic, sessizBitis: bitis },
        update: { sessizBaslangic: baslangic, sessizBitis: bitis },
      }),
    );
  }

  private async durumYaz(ids: string[], veri: Prisma.BildirimTeslimatiUpdateManyMutationInput, gecerliDurumlar: string[]) {
    const { tenantId, userId, rol } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) =>
      tx.bildirimTeslimati.updateMany({ where: { id: { in: ids }, userId, durum: { in: gecerliDurumlar as never }, bildirim: await tahsilatBildirimKapsami(tx, tenantId, rol, userId) }, data: veri }));
    return { guncellenen: sonuc.count };
  }

  private async tekTeslimatGuncelle(id: string, veri: Prisma.BildirimTeslimatiUncheckedUpdateInput) {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const teslimat = await tx.bildirimTeslimati.findFirst({ where: { id, userId, bildirim: await tahsilatBildirimKapsami(tx, tenantId, rol, userId) }, select: { id: true } });
      if (!teslimat) throw new NotFoundException("Bildirim bulunamadı");
      return tx.bildirimTeslimati.update({ where: { id }, data: veri, include: { bildirim: true } });
    });
  }
}
