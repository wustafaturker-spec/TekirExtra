import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, CekSenetDurum, CekSenetYon, DovizCinsi, type KasaBankaHareketTip } from "@prisma/client";
import { bugunTR, GIRIS_KUR_TIPI, hareketKurTipi } from "@tekirextra/shared";
import type { KayitEylem } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { izinliEylemler } from "../core/eylemler/eylem-kayit";
import { cekVadeAnalizi, CEK_VADE_ACIK_DURUMLARI } from "./cek-vade-analizi";
import { metinNormalize } from "@tekirextra/shared";
import { PrismaService } from "../core/prisma.service";
import { PdfService } from "../core/pdf/pdf.service";
import { kurCoz, kurZorunlu } from "../doviz/kur-coz";
import { makbuzPdfHtml } from "./makbuz-pdf";
import { girisMi, hesapEkstresiHesapla } from "./hesap-ekstresi";
import { hesapEkstresiPdfHtml } from "./hesap-ekstresi-pdf";
import { hesapEkstresiExcel } from "./hesap-ekstresi-excel";
import { cariDenklestir, carileriDenklestir, elleKapamaYaz, kaynakKapamalariniCoz } from "../fatura/denklestirme";
import { bagDuzeltmeleriniGeriAl, baglaTx, fisOku } from "./doviz-baglama.service";
import { beklenenOdemeTipi, faturaKilitleVeKalaniGetir, faturaOdemeDurumu, mahsupAyir } from "../fatura/odeme-durumu";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import type {
  acilisSemasi,
  bankaAcilisliOlusturSemasi,
  bankaHesapGuncelleSemasi,
  kasaAcilisliOlusturSemasi,
  cekSenetGuncelleSemasi,
  cekSenetOlusturSemasi,
  kasaBankaHareketOlusturSemasi,
  kasaGuncelleSemasi,
  virmanOlusturSemasi,
  posHesapOlusturSemasi,
  posHesapGuncelleSemasi,
  posBankaAktarimSemasi,
} from "./kasa-banka.semalar";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

export interface KasaBankaBakiye {
  borc: string;
  alacak: string;
  bakiye: string;
}

/** KSB-09: varsayılan makbuz önekleri; numara biçimi tetikleyiciyle (makbuz_no_ver) aynıdır. */
const MAKBUZ_VARSAYILAN_ONEK = { tahsilat: "TM", tediye: "TD" } as const;
/** P1-9: ekstre ve açılış uçlarında hesap "kasa:<id>" ya da "banka:<id>" olarak anılır. */
export type HesapTuru = "kasa" | "banka";
type AcilisGirdisi = Omit<z.infer<typeof acilisSemasi>, "neden">;
const hesapAlani = (tur: HesapTuru, id: string) => (tur === "kasa" ? { kasaId: id } : { bankaHesapId: id });
const tarihTR = (tarih: Date) => tarih.toLocaleDateString("tr-TR", { timeZone: "UTC" });
const tutarTR = (tutar: Prisma.Decimal, doviz: string) => `${Number(tutar).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${doviz === "TRY" ? "TL" : doviz}`;

/** Dosya adında Türkçe harf ve boşluk kalmasın. */
const dosyaAdiParcasi = (ad: string) => metinNormalize(ad).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "hesap";

/** KSB-13: hareket listesi süzgeci; tarih "YYYY-AA-GG", hesaplardan biri verilir. */
export interface HareketSuzgeci {
  kasaId?: string;
  bankaHesapId?: string;
  posHesapId?: string;
  baslangic?: string;
  bitis?: string;
  tur?: "tahsilat" | "tediye" | "virman_gelis" | "virman_gidis" | "acilis";
  arama?: string;
  imlec?: string;
  adet: number;
}

const HAREKET_LISTE_ILISKILERI = {
  kasa: { select: { id: true, ad: true } },
  bankaHesap: { select: { id: true, ad: true, bankaAdi: true } },
  cari: { select: { id: true, kod: true, unvan: true } },
  fatura: { select: { id: true, no: true, genelToplam: true } },
  posHesap: { select: { id: true, ad: true, saglayici: true } },
} satisfies Prisma.KasaBankaHareketInclude;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hareketSuzgeciKosulu(s: Omit<HareketSuzgeci, "imlec" | "adet">): Prisma.KasaBankaHareketWhereInput {
  const aranan = s.arama?.trim() ? metinNormalize(s.arama.trim()) : "";
  return {
    ...(s.kasaId ? { kasaId: s.kasaId } : {}),
    ...(s.bankaHesapId ? { bankaHesapId: s.bankaHesapId } : {}),
    ...(s.posHesapId ? { posHesapId: s.posHesapId } : {}),
    ...(s.baslangic || s.bitis
      ? { tarih: { ...(s.baslangic ? { gte: new Date(`${s.baslangic}T00:00:00.000Z`) } : {}), ...(s.bitis ? { lte: new Date(`${s.bitis}T00:00:00.000Z`) } : {}) } }
      : {}),
    // Açılış fişi tahsilat/tediye tipinde tutulur ama ayrı bir tür olarak süzülür.
    ...(s.tur === "acilis" ? { kaynakTur: "acilis" } : s.tur ? { tip: s.tur, kaynakTur: { not: "acilis" } } : {}),
    ...(aranan
      ? { OR: [{ aramaNormal: { contains: aranan } }, { cari: { aramaNormal: { contains: aranan } } }, { fatura: { aramaNormal: { contains: aranan } } }] }
      : {}),
  };
}

export const makbuzNoBicimle = (onek: string, yil: number, sira: number) => `${onek}${yil}-${String(sira).padStart(6, "0")}`;

@Injectable()
export class KasaBankaService {
  constructor(private readonly prisma: PrismaService, private readonly pdf: PdfService, private readonly donemKilidi: DonemKilidiService) {}

  // ─── KASA YÖNETİMİ (KSB-01/04) ─────────────────────────────────────────────

  async kasaListele() {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();
    const kasalar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasa.findMany({
        orderBy: { ad: "asc" },
        include: { _count: { select: { hareketler: true } } },
      }),
    );

    const bakiyeler = await this.kasaBakiyeleri(kasalar.map((k) => k.id));
    const acilislar = await this.acilislar("kasa", kasalar.map((k) => k.id));

    return kasalar.map((k) => {
      const bakiye = bakiyeler.get(k.id) ?? { borc: "0.00", alacak: "0.00", bakiye: "0.00" };
      return {
        id: k.id,
        ad: k.ad,
        dovizCinsi: k.dovizCinsi,
        aktif: k.aktif,
        bakiye: bakiye.bakiye,
        borc: bakiye.borc,
        alacak: bakiye.alacak,
        acilis: acilislar.get(k.id) ?? null,
        izinliEylemler: this.eylemler("kasa", k, ctx.rol, k._count.hareketler),
      };
    });
  }

  async kasaGetir(id: string) {
    const ctx = aktifBaglam();
    const kasa = await this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.kasa.findUnique({
        where: { id },
        include: { _count: { select: { hareketler: true } } },
      }),
    );
    if (!kasa) throw new NotFoundException("Kasa bulunamadı");

    const bakiyeler = await this.kasaBakiyeleri([id]);
    const bakiye = bakiyeler.get(id) ?? { borc: "0.00", alacak: "0.00", bakiye: "0.00" };

    return {
      id: kasa.id,
      ad: kasa.ad,
      dovizCinsi: kasa.dovizCinsi,
      aktif: kasa.aktif,
      bakiye: bakiye.bakiye,
      borc: bakiye.borc,
      alacak: bakiye.alacak,
      izinliEylemler: this.eylemler("kasa", kasa, ctx.rol, kasa._count.hareketler),
    };
  }

  async kasaOlustur(girdi: z.infer<typeof kasaAcilisliOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    if (girdi.acilis) await this.donemKilidi.tarihDogrula(tenantId, girdi.acilis.tarih, "açılış fişi");
    if (await this.prisma.tenantIslem(tenantId, (tx) => tx.kasa.findFirst({ where: { ad: girdi.ad }, select: { id: true } }))) {
      throw new BadRequestException(`'${girdi.ad}' adında kasa zaten mevcut`);
    }
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kasa = await tx.kasa.create({ data: { tenantId, ad: girdi.ad, dovizCinsi: girdi.dovizCinsi } });
      if (girdi.acilis) await this.acilisYaz(tx, tenantId, "kasa", kasa, girdi.acilis);
      return kasa;
    });
  }

  async kasaGuncelle(id: string, girdi: z.infer<typeof kasaGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.kasaGetir(id);
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.kasa.update({
          where: { id },
          data: girdi,
        }),
      );
    } catch {
      throw new BadRequestException(`'${girdi.ad}' adında kasa zaten mevcut`);
    }
  }

  async kasaSil(id: string) {
    const { tenantId } = aktifBaglam();
    const hareketSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasaBankaHareket.count({ where: { kasaId: id } }),
    );
    if (hareketSayisi > 0) {
      throw new BadRequestException("Hareketi olan kasa silinemez; pasife alın");
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasa.delete({ where: { id } }),
    );
  }

  // ─── BANKA HESAP YÖNETİMİ (KSB-01/04) ──────────────────────────────────────

  async bankaListele() {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();
    const hesaplar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaHesap.findMany({
        orderBy: { ad: "asc" },
        include: { _count: { select: { hareketler: true } } },
      }),
    );

    const bakiyeler = await this.bankaBakiyeleri(hesaplar.map((h) => h.id));
    const acilislar = await this.acilislar("banka", hesaplar.map((h) => h.id));

    return hesaplar.map((h) => {
      const bakiye = bakiyeler.get(h.id) ?? { borc: "0.00", alacak: "0.00", bakiye: "0.00" };
      return {
        id: h.id,
        ad: h.ad,
        bankaAdi: h.bankaAdi,
        sube: h.sube,
        hesapNo: h.hesapNo,
        iban: h.iban,
        dovizCinsi: h.dovizCinsi,
        aktif: h.aktif,
        bakiye: bakiye.bakiye,
        borc: bakiye.borc,
        alacak: bakiye.alacak,
        acilis: acilislar.get(h.id) ?? null,
        izinliEylemler: this.eylemler("banka", h, ctx.rol, h._count.hareketler),
      };
    });
  }

  async bankaGetir(id: string) {
    const ctx = aktifBaglam();
    const hesap = await this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.bankaHesap.findUnique({
        where: { id },
        include: { _count: { select: { hareketler: true } } },
      }),
    );
    if (!hesap) throw new NotFoundException("Banka hesabı bulunamadı");

    const bakiyeler = await this.bankaBakiyeleri([id]);
    const bakiye = bakiyeler.get(id) ?? { borc: "0.00", alacak: "0.00", bakiye: "0.00" };

    return {
      id: hesap.id,
      ad: hesap.ad,
      bankaAdi: hesap.bankaAdi,
      sube: hesap.sube,
      hesapNo: hesap.hesapNo,
      iban: hesap.iban,
      dovizCinsi: hesap.dovizCinsi,
      aktif: hesap.aktif,
      bakiye: bakiye.bakiye,
      borc: bakiye.borc,
      alacak: bakiye.alacak,
      izinliEylemler: this.eylemler("banka", hesap, ctx.rol, hesap._count.hareketler),
    };
  }

  async bankaOlustur(girdi: z.infer<typeof bankaAcilisliOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    if (girdi.acilis) await this.donemKilidi.tarihDogrula(tenantId, girdi.acilis.tarih, "açılış fişi");
    if (await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaHesap.findFirst({ where: { ad: girdi.ad }, select: { id: true } }))) {
      throw new BadRequestException(`'${girdi.ad}' adında banka hesabı zaten mevcut`);
    }
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hesap = await tx.bankaHesap.create({
          data: {
            tenantId,
            ad: girdi.ad,
            bankaAdi: girdi.bankaAdi,
            sube: girdi.sube,
            hesapNo: girdi.hesapNo,
            iban: girdi.iban,
            swift: girdi.swift,
            faturadaGoster: girdi.faturadaGoster,
            dovizCinsi: girdi.dovizCinsi,
          },
        });
      if (girdi.acilis) await this.acilisYaz(tx, tenantId, "banka", hesap, girdi.acilis);
      return hesap;
    });
  }

  async bankaGuncelle(id: string, girdi: z.infer<typeof bankaHesapGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.bankaGetir(id);
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.bankaHesap.update({
          where: { id },
          data: girdi,
        }),
      );
    } catch {
      throw new BadRequestException(`'${girdi.ad}' adında banka hesabı zaten mevcut`);
    }
  }

  async bankaSil(id: string) {
    const { tenantId } = aktifBaglam();
    const hareketSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasaBankaHareket.count({ where: { bankaHesapId: id } }),
    );
    if (hareketSayisi > 0) {
      throw new BadRequestException("Hareketi olan banka hesabı silinemez; pasife alın");
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaHesap.delete({ where: { id } }),
    );
  }

  async posHesapListele() {
    const { tenantId } = aktifBaglam();
    const hesaplar = await this.prisma.tenantIslem(tenantId, (tx) => tx.posHesap.findMany({ orderBy: { ad: "asc" }, include: { varsayilanBankaHesap: { select: { id: true, ad: true } }, baglanti: { select: { durum: true, sonSenkronHatasi: true, updatedAt: true } } } }));
    const gruplar = await this.prisma.tenantIslem(tenantId, (tx) => tx.kasaBankaHareket.groupBy({ by: ["posHesapId", "tip"], where: { posHesapId: { in: hesaplar.map((h) => h.id) } }, _sum: { tutar: true } }));
    return hesaplar.map((h) => { let bakiye = D(0); for (const g of gruplar.filter((x) => x.posHesapId === h.id)) bakiye = g.tip === "tahsilat" || g.tip === "virman_gelis" ? bakiye.add(g._sum.tutar ?? 0) : bakiye.sub(g._sum.tutar ?? 0); return { ...h, bakiye: bakiye.toFixed(2) }; });
  }

  async posHesapOlustur(girdi: z.infer<typeof posHesapOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    if (girdi.saglayici === "banka") girdi = { ...girdi, baglantiId: null };
    else if (!girdi.baglantiId) throw new BadRequestException("Sanal POS hesabı için sağlayıcı bağlantısı seçin");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (girdi.baglantiId) { const b = await tx.baglanti.findFirst({ where: { id: girdi.baglantiId, aile: "pos" } }); if (!b) throw new BadRequestException("POS bağlantısı bulunamadı"); if (b.saglayici !== girdi.saglayici) throw new BadRequestException("POS hesabı ile bağlantı sağlayıcısı uyuşmuyor"); }
      if (girdi.varsayilanBankaHesapId) { const b = await tx.bankaHesap.findUnique({ where: { id: girdi.varsayilanBankaHesapId } }); if (!b || b.dovizCinsi !== girdi.dovizCinsi) throw new BadRequestException("Varsayılan banka hesabı aynı döviz cinsinde olmalıdır"); }
      return tx.posHesap.create({ data: { tenantId, ...girdi, komisyonOrani: girdi.komisyonOrani ? D(girdi.komisyonOrani) : undefined } });
    });
  }

  /** P1-6: POS hesabının adı, banka hesabı, valör günü ve komisyon oranı. */
  async posHesapGuncelle(id: string, girdi: z.infer<typeof posHesapGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const pos = await tx.posHesap.findUnique({ where: { id } });
      if (!pos) throw new NotFoundException("POS hesabı bulunamadı");
      if (girdi.varsayilanBankaHesapId) { const b = await tx.bankaHesap.findUnique({ where: { id: girdi.varsayilanBankaHesapId } }); if (!b || b.dovizCinsi !== pos.dovizCinsi) throw new BadRequestException("Banka hesabı POS hesabıyla aynı döviz cinsinde olmalıdır"); }
      if (pos.saglayici === "banka" && girdi.varsayilanBankaHesapId === null) throw new BadRequestException("Banka POS'unun bağlı banka hesabı kaldırılamaz");
      try {
        return await tx.posHesap.update({ where: { id }, data: { ...girdi, komisyonOrani: girdi.komisyonOrani ? D(girdi.komisyonOrani) : undefined } });
      } catch {
        throw new BadRequestException(`'${girdi.ad}' adında POS hesabı zaten mevcut`);
      }
    });
  }

  // ─── HAREKET YÖNETİMİ & FATURA KAPAMA (KSB-02/07) ─────────────────────────

  /**
   * KSB-13: hareket listesi sunucuda süzülür ve imleçle sayfalanır. İlk sayfada
   * (imleç yokken) süzgece uyan kayıtların döviz bazında toplamları ve günün
   * TL giriş/çıkışı da döner; sonraki sayfalar yalnız kayıt getirir.
   */
  async hareketListele(s: HareketSuzgeci) {
    const { tenantId } = aktifBaglam();
    const where = hareketSuzgeciKosulu(s);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.kasaBankaHareket.findMany({
        where,
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: s.adet + 1,
        ...(s.imlec ? { cursor: { id: s.imlec }, skip: 1 } : {}),
        include: HAREKET_LISTE_ILISKILERI,
        omit: { aramaNormal: true },
      });
      const sayfa = kayitlar.slice(0, s.adet);
      const geriAlinan = await this.geriAlinanlar(tx, sayfa);
      return {
        kayitlar: sayfa.map((h) => ({ ...h, geriAlindi: geriAlinan.has(h.id) || (h.karsiHareketId !== null && geriAlinan.has(h.karsiHareketId)) })),
        sonrakiImlec: kayitlar.length > s.adet ? sayfa[sayfa.length - 1].id : null,
        ...(s.imlec ? {} : await this.hareketToplamlari(tx, where)),
      };
    });
  }

  /** Ters kaydı atılmış fişler; virmanın iki bacağı birlikte geri alınmış sayılır. */
  private async geriAlinanlar(tx: Prisma.TransactionClient, hareketler: Array<{ id: string; karsiHareketId: string | null }>) {
    const idler = hareketler.flatMap((h) => (h.karsiHareketId ? [h.id, h.karsiHareketId] : [h.id]));
    if (!idler.length) return new Set<string>();
    const tersler = await tx.kasaBankaHareket.findMany({ where: { kaynakTur: "ters_kayit", kaynakRef: { in: idler } }, select: { kaynakRef: true } });
    return new Set(tersler.map((t) => t.kaynakRef as string));
  }

  private async hareketToplamlari(tx: Prisma.TransactionClient, where: Prisma.KasaBankaHareketWhereInput) {
    const bugun = new Date(`${bugunTR()}T00:00:00.000Z`);
    const [adet, gruplar, bugunku] = await Promise.all([
      tx.kasaBankaHareket.count({ where }),
      // Açılış fişi bakiyeye girer ama tahsilat/ödeme sayılmaz (KSB-12).
      tx.kasaBankaHareket.groupBy({ by: ["dovizCinsi", "tip"], where: { AND: [where, { kaynakTur: { not: "acilis" } }] }, _sum: { tutar: true } }),
      tx.kasaBankaHareket.groupBy({ by: ["tip"], where: { dovizCinsi: "TRY", tarih: bugun, kaynakTur: { not: "acilis" } }, _sum: { tutar: true } }),
    ]);
    const dovizler = new Map<string, { giris: Prisma.Decimal; cikis: Prisma.Decimal }>();
    for (const g of gruplar) {
      const d = dovizler.get(g.dovizCinsi) ?? { giris: D(0), cikis: D(0) };
      const tutar = g._sum.tutar ?? D(0);
      if (girisMi(g.tip)) d.giris = d.giris.add(tutar);
      else d.cikis = d.cikis.add(tutar);
      dovizler.set(g.dovizCinsi, d);
    }
    const bugunToplam = (giris: boolean) => bugunku.filter((g) => girisMi(g.tip) === giris).reduce((t, g) => t.add(g._sum.tutar ?? D(0)), D(0)).toFixed(2);
    return {
      toplamlar: {
        adet,
        dovizler: [...dovizler.entries()]
          .sort(([a], [b]) => (a === "TRY" ? -1 : b === "TRY" ? 1 : a.localeCompare(b)))
          .map(([dovizCinsi, t]) => ({ dovizCinsi, giris: t.giris.toFixed(2), cikis: t.cikis.toFixed(2), net: t.giris.sub(t.cikis).toFixed(2) })),
      },
      bugun: { giris: bugunToplam(true), cikis: bugunToplam(false) },
    };
  }

  /**
   * KSB-13: fiş ayrıntısının tam listeye bakmadan bildiği bağlam — virmanın
   * karşı bacağı, fişi geri alan ters kayıt, ters kaydın asıl fişi ve fişin
   * açılışa çevrilip çevrilemeyeceği (koşullar `acilisaCevir` ile aynı).
   */
  async hareketBaglami(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const h = await tx.kasaBankaHareket.findUnique({ where: { id }, include: HAREKET_LISTE_ILISKILERI, omit: { aramaNormal: true } });
      if (!h) throw new NotFoundException("Kasa/banka hareketi bulunamadı");
      const karsi = h.karsiHareketId
        ? await tx.kasaBankaHareket.findUnique({ where: { id: h.karsiHareketId }, include: HAREKET_LISTE_ILISKILERI, omit: { aramaNormal: true } })
        : null;
      const ters = await tx.kasaBankaHareket.findFirst({
        where: { kaynakTur: "ters_kayit", kaynakRef: { in: karsi ? [h.id, karsi.id] : [h.id] } },
        select: { id: true, tarih: true },
      });
      const asilId = h.kaynakTur === "ters_kayit" && h.kaynakRef && UUID.test(h.kaynakRef) ? h.kaynakRef : null;
      const asil = asilId ? await tx.kasaBankaHareket.findUnique({ where: { id: asilId }, select: { id: true, tarih: true, tip: true } }) : null;
      const hesap = h.kasaId ? { kasaId: h.kasaId } : h.bankaHesapId ? { bankaHesapId: h.bankaHesapId } : null;
      const acilisaCevrilebilir = Boolean(hesap) && h.kaynakTur === "manuel" && !h.cariId && !h.faturaId && !h.ekstreSatirId && !ters
        && (h.tip === "tahsilat" || h.tip === "tediye")
        && !(await tx.kasaBankaHareket.findFirst({
          where: { ...hesap, OR: [{ kaynakTur: "acilis" }, { id: { not: h.id }, tarih: { lt: h.tarih } }] },
          select: { id: true },
        }));
      return { karsi, ters, asil, acilisaCevrilebilir };
    });
  }

  /**
   * KSB-07: carinin bu işlem tipiyle kapatılabilecek, kalanı olan kesin
   * faturaları; en eski vade başta (önce o kapanır).
   */
  async acikFaturalar(cariId: string, tip: "tahsilat" | "tediye", haricHareketId?: string) {
    const { tenantId } = aktifBaglam();
    const tipler = tip === "tahsilat" ? (["satis", "alis_iade"] as const) : (["alis", "satis_iade"] as const);
    const faturalar = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findMany({
      where: { cariId, durum: "kesin", tip: { in: [...tipler] } },
      orderBy: [{ vadeTarihi: "asc" }, { tarih: "asc" }],
      take: 200,
      select: {
        id: true, no: true, tip: true, tarih: true, vadeTarihi: true, dovizCinsi: true, kur: true, durum: true, genelToplam: true,
        kapamalar: { select: { tutar: true, kasaBankaHareketId: true } },
        iadeKapamalari: { select: { tutar: true } },
      },
    }));
    // Düzeltilen fiş yeniden girileceği için onun kapaması sayılmaz; kapattığı fatura listede kalır.
    return faturalar
      .map((f) => ({ f, odeme: faturaOdemeDurumu({ ...f, kapamalar: f.kapamalar.filter((k) => !haricHareketId || k.kasaBankaHareketId !== haricHareketId) }) }))
      .filter(({ odeme }) => odeme.kalan.gt(0))
      .map(({ f, odeme }) => ({
        id: f.id,
        no: f.no,
        tip: f.tip,
        tarih: f.tarih.toISOString().slice(0, 10),
        vadeTarihi: f.vadeTarihi?.toISOString().slice(0, 10) ?? null,
        dovizCinsi: f.dovizCinsi,
        kur: f.kur.toFixed(6),
        genelToplam: f.genelToplam.toFixed(2),
        odenen: odeme.odenen.toFixed(2),
        kalan: odeme.kalan.toFixed(2),
      }));
  }

  async hareketEkle(girdi: z.infer<typeof kasaBankaHareketOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "kasa/banka hareketi oluşturma");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const once = girdi.tip === "tediye" ? await this.hesapBakiyesi(tx, girdi) : null;
      const hareket = await this.hareketOlustur(tx, tenantId, girdi);
      if (once) await this.eksiBakiyeDenetle(tx, girdi, once, girdi.eksiBakiyeOnay);
      return hareket;
    });
  }

  /** Tahsilat/tediye fişini verilen işlemin içinde yazar (ekleme ve düzeltme ortak). */
  /** Ekstre eşleştirmesi de kullanır (aynı işlem içinde). */
  async hareketOlustur(tx: Prisma.TransactionClient, tenantId: string, girdi: z.infer<typeof kasaBankaHareketOlusturSemasi>) {
    const tutar = D(girdi.tutar);
    {
      const hesap = girdi.kasaId ? await tx.kasa.findUnique({ where: { id: girdi.kasaId } }) : girdi.bankaHesapId ? await tx.bankaHesap.findUnique({ where: { id: girdi.bankaHesapId } }) : await tx.posHesap.findUnique({ where: { id: girdi.posHesapId! } });
      if (!hesap || !hesap.aktif) throw new BadRequestException("Aktif kasa, banka veya POS hesabı bulunamadı");
      if (hesap.dovizCinsi !== girdi.dovizCinsi) throw new BadRequestException(`Hesap ${hesap.dovizCinsi}, hareket ${girdi.dovizCinsi} cinsinde olamaz`);
      let cariId = girdi.cariId || null;
      if (cariId && !(await tx.cariHesap.findFirst({ where: { id: cariId, aktif: true }, select: { id: true } }))) throw new BadRequestException("Aktif cari hesap bulunamadı");
      const hareketTarihi = new Date(girdi.tarih);
      const kur = girdi.dovizCinsi === "TRY" ? D(1) : girdi.kur ? D(girdi.kur) : await kurZorunlu(tx, girdi.dovizCinsi, hareketTarihi, hareketKurTipi(girdi.tip));
      const tutarTry = tutar.mul(kur).toDecimalPlaces(2);

      // KSB-07: faturaya bağlanan ödeme faturanın dövizindeki karşılığıyla
      // mahsup edilir; kalanı aşan kısmı carinin avansı olarak kalır.
      let kapama: { dovizCinsi: DovizCinsi; karsilik: Prisma.Decimal; mahsup: Prisma.Decimal; avans: Prisma.Decimal } | null = null;
      if (girdi.faturaId) {
        const fatura = await faturaKilitleVeKalaniGetir(tx, girdi.faturaId);
        if (fatura.durum !== "kesin") throw new BadRequestException("Yalnızca kesinleşmiş faturaya ödeme bağlanabilir");
        const beklenenTip = beklenenOdemeTipi(fatura.tip);
        if (!beklenenTip || girdi.tip !== beklenenTip) throw new BadRequestException(`Bu fatura için ${beklenenTip === "tahsilat" ? "tahsilat" : "tediye"} kaydı gereklidir`);
        if (cariId && cariId !== fatura.cariId) throw new BadRequestException("Seçilen cari faturanın carisiyle uyuşmuyor");
        if (fatura.kalan.isZero()) throw new BadRequestException(`${fatura.no ?? "Fatura"} zaten kapanmış; ödemeyi faturaya bağlamadan cariye işleyin`);
        cariId = fatura.cariId;
        const karsilik = await this.faturaKarsiligi(tx, girdi, fatura.dovizCinsi, tutar, tutarTry, hareketTarihi);
        kapama = { dovizCinsi: fatura.dovizCinsi, karsilik, ...mahsupAyir(karsilik, fatura.kalan) };
      }

      // KSB-16: birden çok faturaya elle dağıtım; tutarlar hesabın dövizinde ve her biri kalanı aşamaz.
      // KSB-20: farklı dövizli faturalar fiş açıldıktan sonra karşılıklarıyla bağlanır.
      const coklu: { faturaId: string; no: string | null; tutar: Prisma.Decimal }[] = [];
      const caprazlar: { faturaId: string; tutar: string; karsilik: string | null }[] = [];
      if (girdi.faturalar?.length) {
        if (!cariId) throw new BadRequestException("Birden çok faturaya dağıtım için cari seçilmelidir");
        const dagitilan = girdi.faturalar.reduce((t, f) => t.add(D(f.tutar)), D(0));
        if (dagitilan.gt(tutar)) throw new BadRequestException(`Faturalara dağıtılan ${dagitilan.toFixed(2)} ${girdi.dovizCinsi}, ödeme tutarını aşamaz`);
        // Kilit sırası sabit: eşzamanlı iki ödeme aynı faturaları ters sırayla kilitleyip kilitlenmez.
        for (const secim of [...girdi.faturalar].sort((a, b) => a.faturaId.localeCompare(b.faturaId))) {
          const fatura = await faturaKilitleVeKalaniGetir(tx, secim.faturaId);
          const ad = fatura.no ?? "Numarasız fatura";
          if (fatura.durum !== "kesin") throw new BadRequestException(`${ad} kesinleşmemiş; yalnız kesinleşmiş faturaya ödeme bağlanır`);
          if (fatura.cariId !== cariId) throw new BadRequestException(`${ad} seçilen cariye ait değil`);
          if (beklenenOdemeTipi(fatura.tip) !== girdi.tip) throw new BadRequestException(`${ad} için ${beklenenOdemeTipi(fatura.tip) === "tahsilat" ? "tahsilat" : "tediye"} kaydı gereklidir`);
          if (fatura.dovizCinsi !== girdi.dovizCinsi) {
            caprazlar.push({ faturaId: fatura.id, tutar: secim.tutar, karsilik: secim.karsilik ?? null });
            continue;
          }
          const secilen = D(secim.tutar);
          if (secilen.gt(fatura.kalan)) throw new BadRequestException(`${ad} için yazılan ${secilen.toFixed(2)} ${girdi.dovizCinsi}, kalanı (${fatura.kalan.toFixed(2)}) aşıyor`);
          coklu.push({ faturaId: fatura.id, no: fatura.no, tutar: secilen });
        }
      }

      // 1. Kasa/Banka hareketini oluştur
      const hareket = await tx.kasaBankaHareket.create({
        data: {
          tenantId,
          kasaId: girdi.kasaId,
          bankaHesapId: girdi.bankaHesapId,
          posHesapId: girdi.posHesapId,
          tip: girdi.tip,
          tutar,
          dovizCinsi: girdi.dovizCinsi,
          kur,
          tutarTry,
          tarih: hareketTarihi,
          aciklama: girdi.aciklama,
          cariId,
          faturaId: girdi.faturaId,
          faturaKarsiligi: kapama?.karsilik ?? null,
          faturaMahsubu: kapama?.mahsup ?? null,
          kaynakTur: girdi.faturaId || coklu.length ? "fatura_kapama" : "manuel",
          kaynakRef: girdi.faturaId || null,
        },
      });

      // 2. Cari bağlantısı varsa Cari Hareketini oluştur (KSB-02)
      // Tahsilat -> Cari alacaklanır (borcu azalır)
      // Tediye -> Cari borçlanır (alacağı azalır)
      // Faturaya bağlıysa hareket faturanın dövizinde yazılır; böylece dövizli
      // fatura başka dövizle kapatılınca cari iki dövizde açık kalmaz.
      if (cariId) {
        const cariHareketTip = girdi.tip === "tahsilat" ? "alacak" : "borc";
        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId,
            tip: cariHareketTip,
            tutar: kapama?.karsilik ?? tutar,
            dovizCinsi: kapama?.dovizCinsi ?? girdi.dovizCinsi,
            kur: kapama ? (kapama.dovizCinsi === "TRY" ? D(1) : tutarTry.div(kapama.karsilik).toDecimalPlaces(6)) : kur,
            tutarTry,
            tarih: hareketTarihi,
            aciklama: girdi.aciklama ?? `${girdi.tip.toUpperCase()} kasa/banka fişi`,
            kaynakTur: "kasa_banka",
            kaynakRef: hareket.id,
          },
        });
      }

      // KSB-16: bağlanan kısım elle kapamadır; artanı ve bağlanmamış ödeme vadeye göre dağılır.
      if (kapama && girdi.faturaId && cariId) await elleKapamaYaz(tx, { tenantId, cariId, faturaId: girdi.faturaId, tutar: kapama.mahsup, kaynak: { kasaBankaHareketId: hareket.id } });
      for (const k of coklu) await elleKapamaYaz(tx, { tenantId, cariId: cariId!, faturaId: k.faturaId, tutar: k.tutar, kaynak: { kasaBankaHareketId: hareket.id } });
      const caprazBaglar = caprazlar.length ? await baglaTx(tx, tenantId, await fisOku(tx, hareket.id), caprazlar) : [];
      if (cariId && !caprazlar.length) await cariDenklestir(tx, tenantId, cariId);

      return {
        ...hareket,
        faturaKapamalari: [
          ...coklu.map((k) => ({ faturaId: k.faturaId, no: k.no, tutar: k.tutar.toFixed(2) })),
          ...caprazBaglar.map((k) => ({ faturaId: k.faturaId, no: k.no, tutar: k.tutar, karsilik: k.karsilik, dovizCinsi: k.dovizCinsi })),
        ],
        faturaKapama: kapama && { dovizCinsi: kapama.dovizCinsi, karsilik: kapama.karsilik.toFixed(2), mahsup: kapama.mahsup.toFixed(2), avans: kapama.avans.toFixed(2) },
      };
    }
  }

  /**
   * Ödemenin fatura dövizindeki karşılığı. Aynı dövizde tutarın kendisidir.
   * Farklı dövizde kullanıcının girdiği karşılık (bankanın uyguladığı kur)
   * esas alınır; girilmediyse ödemenin TL karşılığı, işlem günü fatura
   * dövizinin kuruyla çevrilir.
   */
  private async faturaKarsiligi(
    tx: Prisma.TransactionClient,
    girdi: z.infer<typeof kasaBankaHareketOlusturSemasi>,
    faturaDovizi: DovizCinsi,
    tutar: Prisma.Decimal,
    tutarTry: Prisma.Decimal,
    tarih: Date,
  ): Promise<Prisma.Decimal> {
    if (faturaDovizi === girdi.dovizCinsi) return tutar;
    if (girdi.faturaKarsiligi) return D(girdi.faturaKarsiligi).toDecimalPlaces(2);
    if (faturaDovizi === "TRY") return tutarTry;
    // DVZ-09: ödemenin yönü (tahsilat alış, tediye satış) faturanın kur türüyle aynıdır.
    const faturaDoviziKuru = await kurZorunlu(tx, faturaDovizi, tarih, hareketKurTipi(girdi.tip));
    const karsilik = tutarTry.div(faturaDoviziKuru).toDecimalPlaces(2);
    if (!karsilik.gt(0)) throw new BadRequestException("Ödemenin fatura dövizindeki karşılığı hesaplanamadı");
    return karsilik;
  }

  async makbuzPdf(id: string): Promise<{ buffer: Buffer; dosyaAdi: string }> {
    const { tenantId } = aktifBaglam();
    const [hareket, firma] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.kasaBankaHareket.findUnique({ where: { id }, include: { kasa: true, bankaHesap: true, posHesap: true, cari: { select: { kod: true, unvan: true, belgeDili: true, belgeCiftDil: true } }, fatura: { select: { no: true } } } }),
      tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true, vkn: true, vergiDairesi: true, adres: true, ilce: true, il: true, postaKodu: true, telefon: true, eposta: true, webSitesi: true, mersisNo: true, ticaretSicilNo: true } }),
    ]));
    if (!hareket || !hareket.makbuzNo) throw new NotFoundException("Bu fiş için makbuz yok; makbuz yalnız tahsilat/ödeme fişlerine verilir");
    if (!firma) throw new NotFoundException("Firma bulunamadı");
    const [tema, gorunum, kaseDataUri] = await Promise.all([this.pdf.belgeTemasi(), this.pdf.belgeGorunumu(), this.pdf.firmaKaseDataUri()]);
    const { html, altBilgi } = makbuzPdfHtml(hareket, { firma, gorunum, logoDataUri: tema.logoDataUri, kaseDataUri });
    return { buffer: await this.pdf.htmlToPdf(html, { altBilgi }), dosyaAdi: `makbuz-${hareket.makbuzNo}.pdf` };
  }

  // ─── MAKBUZ SERİLERİ (KSB-09) ─────────────────────────────────────────────

  /** Makbuz serileri; içinde bulunulan yılın serisi henüz yoksa varsayılanıyla gösterilir. */
  async makbuzSerileri() {
    const { tenantId } = aktifBaglam();
    const yil = Number(bugunTR().slice(0, 4));
    const seriler = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.makbuzSeri.findMany({ orderBy: [{ yil: "desc" }, { tur: "asc" }] });
      // Önek, seride gerçekten numara verildiyse kilitlenir (devir sırası tek başına kilitlemez).
      return Promise.all(kayitlar.map(async (s) => ({
        ...s,
        onekKilitli: (await tx.kasaBankaHareket.count({ where: { tip: s.tur as "tahsilat" | "tediye", makbuzNo: { startsWith: `${s.onek}${s.yil}-` } } })) > 0,
      })));
    });
    const liste = seriler.map((s) => ({ tur: s.tur, yil: s.yil, onek: s.onek, sonSira: s.sonSira, tanimli: true, onekKilitli: s.onekKilitli }));
    for (const tur of ["tahsilat", "tediye"] as const) {
      if (!liste.some((s) => s.tur === tur && s.yil === yil)) {
        const onceki = liste.find((s) => s.tur === tur);
        liste.push({ tur, yil, onek: onceki?.onek ?? MAKBUZ_VARSAYILAN_ONEK[tur], sonSira: 0, tanimli: false, onekKilitli: false });
      }
    }
    return liste
      .sort((a, b) => b.yil - a.yil || a.tur.localeCompare(b.tur))
      .map((s) => ({ ...s, siradakiNo: makbuzNoBicimle(s.onek, s.yil, s.sonSira + 1) }));
  }

  /**
   * Seri önekini ya da devir sırasını ayarlar. Önek, o yıl o seride numara
   * verilmeden önce değiştirilebilir (yoksa aynı yılda iki önek karışır);
   * sıra yalnız ileri alınır (verilmiş numara tekrar verilemez).
   */
  async makbuzSerisiAyarla(girdi: { tur: "tahsilat" | "tediye"; yil: number; onek: string; sonSira: number }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM makbuz_serileri WHERE tur = ${girdi.tur} AND yil = ${girdi.yil} FOR UPDATE`;
      const mevcut = await tx.makbuzSeri.findUnique({ where: { tenantId_tur_yil: { tenantId, tur: girdi.tur, yil: girdi.yil } } });
      if (mevcut) {
        if (girdi.sonSira < mevcut.sonSira) throw new BadRequestException(`Son sıra geri alınamaz; bu seride ${makbuzNoBicimle(mevcut.onek, mevcut.yil, mevcut.sonSira)} numarası verildi`);
        if (girdi.onek !== mevcut.onek) {
          const verilen = await tx.kasaBankaHareket.count({ where: { makbuzNo: { startsWith: `${mevcut.onek}${mevcut.yil}-` }, tip: girdi.tur } });
          if (verilen > 0) throw new BadRequestException(`${girdi.yil} yılında bu seride ${verilen} makbuz numarası verildi; önek ancak gelecek yıl için değiştirilebilir`);
        }
        return tx.makbuzSeri.update({ where: { id: mevcut.id }, data: { onek: girdi.onek, sonSira: girdi.sonSira } });
      }
      return tx.makbuzSeri.create({ data: { tenantId, ...girdi } });
    });
  }

  // ─── HESAPLAR ARASI VİRMAN (KSB-03) ───────────────────────────────────────

  async virmanEkle(girdi: z.infer<typeof virmanOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    const tutar = D(girdi.tutar);

    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "virman");
    // Kasa ve banka hesaplarının para birimlerini kontrol et (Aynı birim olmalı)
    const dovizCinsi = await this.virmanKurallariniDenetle(girdi);
    const kaynak = { kasaId: girdi.kaynakKasaId, bankaHesapId: girdi.kaynakBankaHesapId };
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const once = await this.hesapBakiyesi(tx, kaynak);
      const virman = await this.virmanOlustur(tx, tenantId, girdi, dovizCinsi, tutar);
      await this.eksiBakiyeDenetle(tx, kaynak, once, girdi.eksiBakiyeOnay);
      return virman;
    });
  }

  /** Virmanın iki bacağını verilen işlemin içinde yazar (ekleme ve düzeltme ortak). */
  /** Ekstre eşleştirmesi de kullanır (aynı işlem içinde). */
  async virmanOlustur(tx: Prisma.TransactionClient, tenantId: string, girdi: z.infer<typeof virmanOlusturSemasi>, dovizCinsi: DovizCinsi, tutar: Prisma.Decimal) {
    {
      const tarih = new Date(girdi.tarih); const kur = dovizCinsi === "TRY" ? D(1) : await kurZorunlu(tx, dovizCinsi, tarih, GIRIS_KUR_TIPI); const tutarTry = tutar.mul(kur).toDecimalPlaces(2);
      // 1. Kaynak hesaptan para çıkışı (virman_gidis)
      const gidis = await tx.kasaBankaHareket.create({
        data: {
          tenantId,
          kasaId: girdi.kaynakKasaId || null,
          bankaHesapId: girdi.kaynakBankaHesapId || null,
          posHesapId: girdi.kaynakPosHesapId || null,
          tip: "virman_gidis",
          tutar,
          dovizCinsi,
          kur,
          tutarTry,
          tarih,
          aciklama: girdi.aciklama ?? "Hesaplar arası virman transferi",
        },
      });

      // 2. Hedef hesaba para girişi (virman_gelis)
      const gelis = await tx.kasaBankaHareket.create({
        data: {
          tenantId,
          kasaId: girdi.hedefKasaId || null,
          bankaHesapId: girdi.hedefBankaHesapId || null,
          posHesapId: girdi.hedefPosHesapId || null,
          tip: "virman_gelis",
          tutar,
          dovizCinsi,
          kur,
          tutarTry,
          tarih,
          aciklama: girdi.aciklama ?? "Hesaplar arası virman transferi",
          karsiHareketId: gidis.id,
        },
      });

      // 3. Kaynak harekete karşı hareket ID'sini yaz
      await tx.kasaBankaHareket.update({
        where: { id: gidis.id },
        data: { karsiHareketId: gelis.id },
      });

      return { gidis, gelis };
    }
  }

  // ─── FİŞ GERİ ALMA VE DÜZELTME (KSB-08) ───────────────────────────────────

  /**
   * Elle girilmiş tahsilat/tediye fişini ya da virmanı geri alır.
   * Açık dönemdeki fiş silinir (cari hareketiyle birlikte, görüntüsü denetim
   * izine yazılır); kapalı dönemdeki fiş için bugün tarihli ters kayıt atılır.
   */
  async hareketGeriAl(id: string, neden: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => this.geriAlIslem(tx, tenantId, id, neden));
  }

  /** "Geri al + yeniden gir": eski fiş geri alınır, düzeltilmiş fiş aynı işlemde yazılır. */
  async hareketDuzelt(id: string, neden: string, yeni: z.infer<typeof kasaBankaHareketOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, yeni.tarih, "düzeltilmiş fiş");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const once = yeni.tip === "tediye" ? await this.hesapBakiyesi(tx, yeni) : null;
      const geriAlma = await this.geriAlIslem(tx, tenantId, id, neden, "tahsilat_tediye");
      const hareket = await this.hareketOlustur(tx, tenantId, yeni);
      if (once) await this.eksiBakiyeDenetle(tx, yeni, once, yeni.eksiBakiyeOnay);
      return { geriAlma, hareket };
    });
  }

  /** Virmanın düzeltmesi: iki bacak geri alınır, yeni virman aynı işlemde yazılır. */
  async virmanDuzelt(id: string, neden: string, yeni: z.infer<typeof virmanOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, yeni.tarih, "düzeltilmiş virman");
    const dovizCinsi = await this.virmanKurallariniDenetle(yeni);
    const kaynak = { kasaId: yeni.kaynakKasaId, bankaHesapId: yeni.kaynakBankaHesapId };
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const once = await this.hesapBakiyesi(tx, kaynak);
      const geriAlma = await this.geriAlIslem(tx, tenantId, id, neden, "virman");
      const virman = await this.virmanOlustur(tx, tenantId, yeni, dovizCinsi, D(yeni.tutar));
      await this.eksiBakiyeDenetle(tx, kaynak, once, yeni.eksiBakiyeOnay);
      return { geriAlma, virman };
    });
  }

  async geriAlIslem(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    neden: string,
    beklenen?: "tahsilat_tediye" | "virman",
    /** false: fişi başka modül (çek/senet) kendi geri almasının parçası olarak geri alıyor. */
    kaynakDenetimi = true,
  ): Promise<{ yontem: "silindi" | "ters_kayit"; hareketIdleri: string[] }> {
    const iliskiler = {
      ekstreSatir: { select: { id: true, eslesmeTuru: true } },
      posTahsilat: { select: { id: true } },
      masraf: { select: { id: true } },
      krediKartiOdemesi: { select: { id: true } },
      gelirKaydi: { select: { id: true } },
      pazaryeriKesinti: { select: { id: true } },
      kurFarkiFatura: { select: { no: true, tip: true, durum: true } },
    } as const;
    const kilitleVeOku = async (hareketId: string) => {
      // Eşzamanlı iki geri alma aynı fişi iki kez işleyemez.
      await tx.$queryRaw`SELECT id FROM kasa_banka_hareketleri WHERE id = ${hareketId}::uuid FOR UPDATE`;
      return tx.kasaBankaHareket.findUnique({ where: { id: hareketId }, include: iliskiler });
    };

    const hareket = await kilitleVeOku(id);
    if (!hareket) throw new NotFoundException("Kasa/banka hareketi bulunamadı");
    if (hareket.kaynakTur === "ters_kayit") throw new BadRequestException("Ters kayıt geri alınamaz; gerekiyorsa işlemi yeniden girin");
    if (hareket.kaynakTur === "acilis") throw new BadRequestException("Açılış fişi geri alınmaz; Hesap ekstresi ekranındaki Açılış bakiyesi bölümünden değiştirin ya da silin");
    const virman = hareket.tip === "virman_gelis" || hareket.tip === "virman_gidis";
    if (beklenen === "virman" && !virman) throw new BadRequestException("Bu kayıt virman değil");
    if (beklenen === "tahsilat_tediye" && virman) throw new BadRequestException("Virman, virman düzeltmesiyle değiştirilir");

    const bacaklar = [hareket];
    if (virman && hareket.karsiHareketId) {
      const karsi = await kilitleVeOku(hareket.karsiHareketId);
      if (karsi) bacaklar.push(karsi);
    }
    for (const bacak of kaynakDenetimi ? bacaklar : []) {
      const kaynak = KasaBankaService.kaynakModulu(bacak);
      if (kaynak) throw new BadRequestException(`Bu kayıt ${kaynak} tarafından oluşturuldu; geri almayı oradan yapın`);
    }
    const idler = bacaklar.map((b) => b.id);
    if (await tx.kasaBankaHareket.findFirst({ where: { kaynakTur: "ters_kayit", kaynakRef: { in: idler } }, select: { id: true } })) {
      throw new ConflictException("Bu fiş zaten geri alındı");
    }
    // KSB-07: kur farkı faturalanmış ödeme geri alınırsa fatura sahipsiz kalır.
    const kurFarkiFaturasi = bacaklar.map((b) => b.kurFarkiFatura).find((f) => f && f.durum !== "iptal");
    if (kurFarkiFaturasi) {
      throw new BadRequestException(kurFarkiFaturasi.tip === "satis"
        ? `Bu fişin kur farkı ${kurFarkiFaturasi.no ? `${kurFarkiFaturasi.no} numaralı faturayla` : "taslak bir faturayla"} faturalandı; önce kur farkı faturasını ${kurFarkiFaturasi.durum === "taslak" ? "silin" : "iptal edin"}`
        : `Bu fişin kur farkı ${kurFarkiFaturasi.no ? `${kurFarkiFaturasi.no} numaralı ` : ""}gelen faturayla eşleştirildi; önce Kur farkı ekranından eşleşmeyi geri alın`);
    }

    const cariHareketleri = await tx.cariHareket.findMany({ where: { kaynakTur: "kasa_banka", kaynakRef: { in: idler } } });
    const kapali = await this.donemKapaliMi(tenantId, hareket.tarih);
    const goruntu = { neden, hareketler: bacaklar, cariHareketleri };

    if (!kapali) {
      // KSB-24: fişin farklı dövizli fatura bağlamalarının cari düzeltmeleri de fişle gider.
      await bagDuzeltmeleriniGeriAl(tx, tenantId, idler, { sil: true });
      await tx.cariHareket.deleteMany({ where: { id: { in: cariHareketleri.map((c) => c.id) } } });
      await tx.kasaBankaHareket.deleteMany({ where: { id: { in: idler } } });
      // "Mevcut fişle eşle" ile bağlanmış satırın son fişi gidince satır yeniden onaya düşer.
      for (const satirId of new Set(bacaklar.map((b) => b.ekstreSatir?.id).filter((x): x is string => Boolean(x)))) {
        if (!(await tx.kasaBankaHareket.count({ where: { ekstreSatirId: satirId } }))) {
          await tx.bankaEkstreSatir.update({ where: { id: satirId }, data: { durum: "beklemede", cariId: null, faturaId: null, eslesmeTuru: null } });
        }
      }
      await this.geriAlmaIzi(tx, tenantId, "kasa_banka_fisi_silindi", id, goruntu);
      await carileriDenklestir(tx, tenantId, bacaklar.map((b) => b.cariId));
      return { yontem: "silindi", hareketIdleri: idler };
    }

    // Kapalı dönem: kayıt değişmez, bugün tarihli ters kayıt atılır.
    const bugun = bugunTR();
    await this.donemKilidi.tarihDogrula(tenantId, bugun, "ters kayıt");
    await bagDuzeltmeleriniGeriAl(tx, tenantId, idler, { tarih: bugun });
    const tersTip: Record<string, KasaBankaHareketTip> = { tahsilat: "tediye", tediye: "tahsilat", virman_gelis: "virman_gidis", virman_gidis: "virman_gelis" };
    const yeniIdler = new Map<string, string>();
    for (const bacak of bacaklar) {
      const ters = await tx.kasaBankaHareket.create({
        data: {
          tenantId,
          kasaId: bacak.kasaId,
          bankaHesapId: bacak.bankaHesapId,
          posHesapId: bacak.posHesapId,
          tip: tersTip[bacak.tip],
          tutar: bacak.tutar,
          dovizCinsi: bacak.dovizCinsi,
          kur: bacak.kur,
          tutarTry: bacak.tutarTry,
          tarih: new Date(bugun),
          aciklama: `Ters kayıt: ${bacak.aciklama ?? "kasa/banka fişi"} — ${neden}`.slice(0, 500),
          cariId: bacak.cariId,
          faturaId: bacak.faturaId,
          // Faturanın kalanı mahsup toplamından hesaplandığı için ters kayıt mahsubu geri açar.
          faturaKarsiligi: bacak.faturaKarsiligi?.negated() ?? null,
          faturaMahsubu: bacak.faturaMahsubu?.negated() ?? null,
          kaynakTur: "ters_kayit",
          kaynakRef: bacak.id,
        },
      });
      yeniIdler.set(bacak.id, ters.id);
      for (const cari of cariHareketleri.filter((c) => c.kaynakRef === bacak.id)) {
        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: cari.cariId,
            tip: cari.tip === "borc" ? "alacak" : "borc",
            tutar: cari.tutar,
            dovizCinsi: cari.dovizCinsi,
            kur: cari.kur,
            tutarTry: cari.tutarTry,
            tarih: new Date(bugun),
            aciklama: `Ters kayıt: ${cari.aciklama ?? "kasa/banka fişi"}`.slice(0, 500),
            kaynakTur: "kasa_banka",
            kaynakRef: ters.id,
          },
        });
      }
    }
    if (bacaklar.length === 2) {
      const [a, b] = bacaklar.map((bacak) => yeniIdler.get(bacak.id)!);
      await tx.kasaBankaHareket.update({ where: { id: a }, data: { karsiHareketId: b } });
      await tx.kasaBankaHareket.update({ where: { id: b }, data: { karsiHareketId: a } });
    }
    await this.geriAlmaIzi(tx, tenantId, "kasa_banka_fisi_ters_kayit", id, { ...goruntu, tersHareketler: [...yeniIdler.values()] });
    // KSB-16: ters kaydedilen ödemenin kapamaları çözülür, cari yeniden dağıtılır.
    await kaynakKapamalariniCoz(tx, { kasaBankaHareketIdler: idler });
    await carileriDenklestir(tx, tenantId, bacaklar.map((b) => b.cariId));
    return { yontem: "ters_kayit", hareketIdleri: [...yeniIdler.values()] };
  }

  private static readonly VARSAYILAN_KONUM: Record<string, string> = { portfoyde: "Şirket portföyü", tahsile_verildi: "Bankada tahsilde", teminata_verildi: "Bankada teminatta", ciro_edildi: "Ciro edilen caride", tahsil_edildi: "Tahsil edildi", odendi: "Ödendi", karsiliksiz: "Karşılıksız işlem dosyası", iade_edildi: "İade edildi", verildi: "Lehtara teslim" };

  /**
   * KSB-08: çek/senedin son işlemini geri alır. Son işlem kayıtsa ve dönemi
   * açıksa evrak cari hareketiyle silinir; bir durum geçişiyse evrak önceki
   * durumuna döner ve geçişin yazdığı fiş/cari hareketi geri alınır. Dönem
   * kapalıysa kayıtlar silinmez, bugün tarihli ters kayıt atılır.
   */
  async cekSenetSonIslemiGeriAl(id: string, neden: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => this.cekSonIslemiGeriAlTx(tx, tenantId, userId, id, neden));
  }

  /**
   * Son işlemi işlem içinde geri alır. Bordroyla yapılmış işlem tek başına
   * geri alınmaz (KSB-11); bordro geri alması `bordroIcinden` ile çağırır.
   */
  async cekSonIslemiGeriAlTx(tx: Prisma.TransactionClient, tenantId: string, userId: string, id: string, neden: string, bordroIcinden?: string) {
    return this.cekCarileriniDenklestir(tx, tenantId, id, () => this.cekSonIsleminiGeriAl(tx, tenantId, userId, id, neden, bordroIcinden));
  }

  /**
   * KSB-16: çekin durumu (karşılıksız, iade, ciro) carilerin kapamalarını
   * değiştirir. İşlemden önceki ve sonraki cari/ciro carisi denkleştirilir;
   * silinen evrakın kapamaları zincirleme gider.
   */
  private async cekCarileriniDenklestir<T>(tx: Prisma.TransactionClient, tenantId: string, id: string, islem: () => Promise<T>): Promise<T> {
    const once = await tx.cekSenet.findUnique({ where: { id }, select: { cariId: true, ciroCariId: true } });
    const sonuc = await islem();
    const sonra = await tx.cekSenet.findUnique({ where: { id }, select: { cariId: true, ciroCariId: true } });
    await carileriDenklestir(tx, tenantId, [once?.cariId, once?.ciroCariId, sonra?.cariId, sonra?.ciroCariId]);
    return sonuc;
  }

  private async cekSonIsleminiGeriAl(tx: Prisma.TransactionClient, tenantId: string, userId: string, id: string, neden: string, bordroIcinden?: string) {
    {
      await tx.$queryRaw`SELECT id FROM cek_senetler WHERE id = ${id}::uuid FOR UPDATE`;
      const cs = await tx.cekSenet.findUnique({
        where: { id },
        include: { olaylar: { where: { geriAlindi: false, geriAlma: false }, orderBy: { createdAt: "desc" }, take: 1 } },
      });
      if (!cs) throw new NotFoundException("Çek/Senet bulunamadı");
      const son = cs.olaylar[0];
      if (!son) throw new BadRequestException("Geri alınacak işlem kalmadı");
      if (son.oncekiDurum && cs.durum !== son.yeniDurum) throw new ConflictException("Çek/senet başka bir işlemle güncellendi; ekranı yenileyin");
      if (son.bordroId !== (bordroIcinden ?? son.bordroId) || (son.bordroId && !bordroIcinden)) {
        const sonraki = son.bordroId ? await tx.cekSenetBordro.findUnique({ where: { id: son.bordroId }, select: { no: true } }) : null;
        throw new BadRequestException(bordroIcinden
          ? `${cs.portfoyNo} portföy numaralı evrakta bu bordrodan sonra ${sonraki ? `${sonraki.no} bordrosuyla ` : ""}işlem yapılmış; önce ${sonraki ? "o bordroyu" : "o işlemi"} geri alın`
          : `${cs.portfoyNo} portföy numaralı evrakın son işlemi ${sonraki?.no ?? "bir"} bordrosuyla yapıldı; bordroyu bütün olarak geri alın`);
      }

      const kapali = await this.donemKapaliMi(tenantId, son.islemTarihi);
      const bugun = bugunTR();
      if (kapali) await this.donemKilidi.tarihDogrula(tenantId, bugun, "ters kayıt", tx);

      // Bu evrakın henüz geri alınmamış cari hareketleri (tür bazında).
      const acikCariHareketleri = async (kaynakTur: string) => {
        const kayitlar = await tx.cariHareket.findMany({ where: { kaynakTur, kaynakRef: id } });
        const tersler = await tx.cariHareket.findMany({ where: { kaynakTur: "cek_senet_geri_alma", kaynakRef: { in: kayitlar.map((k) => k.id) } }, select: { kaynakRef: true } });
        const geriAlinan = new Set(tersler.map((t) => t.kaynakRef));
        return kayitlar.filter((k) => !geriAlinan.has(k.id));
      };
      const cariEtkisiniGeriAl = async (kayitlar: Awaited<ReturnType<typeof acikCariHareketleri>>) => {
        if (!kapali) {
          await tx.cariHareket.deleteMany({ where: { id: { in: kayitlar.map((k) => k.id) } } });
          return;
        }
        for (const k of kayitlar) {
          await tx.cariHareket.create({
            data: {
              tenantId, cariId: k.cariId, tip: k.tip === "borc" ? "alacak" : "borc", tutar: k.tutar, dovizCinsi: k.dovizCinsi, kur: k.kur, tutarTry: k.tutarTry,
              tarih: new Date(bugun), aciklama: `Geri alma: ${k.aciklama ?? "çek/senet"} — ${neden}`.slice(0, 500), kaynakTur: "cek_senet_geri_alma", kaynakRef: k.id,
            },
          });
        }
      };
      const iz = (islem: string, ek: Record<string, unknown> = {}) => this.geriAlmaIzi(tx, tenantId, islem, id, { neden, cekSenet: { ...cs, olaylar: undefined }, olay: son, ...ek });

      // Son işlem evrakın kaydıysa: açık dönemde evrak tamamen silinir.
      if (!son.oncekiDurum) {
        const cariler = await acikCariHareketleri("cek_senet");
        if (!kapali) {
          await cariEtkisiniGeriAl(cariler);
          await iz("cek_senet_kaydi_silindi", { cariHareketleri: cariler });
          await tx.cekSenet.delete({ where: { id } });
          return { yontem: "silindi" as const, silindi: true, durum: null };
        }
        await cariEtkisiniGeriAl(cariler);
        await tx.cekSenet.update({ where: { id }, data: { durum: "iade_edildi", fizikselKonum: "Kayıt geri alındı" } });
        await tx.cekSenetOlay.update({ where: { id: son.id }, data: { geriAlindi: true } });
        await tx.cekSenetOlay.create({ data: { tenantId, cekSenetId: id, oncekiDurum: cs.durum, yeniDurum: "iade_edildi", islemTarihi: new Date(bugun), aciklama: `Kayıt geri alındı (ters kayıt): ${neden}`, userId, geriAlma: true } });
        await iz("cek_senet_kaydi_ters_kayit", { cariHareketleri: cariler });
        return { yontem: "ters_kayit" as const, silindi: false, durum: "iade_edildi" };
      }

      // Durum geçişi: geçişin yazdığı fiş ve cari hareketleri geri alınır.
      let fisler: string[] = [];
      if (son.yeniDurum === "tahsil_edildi" || son.yeniDurum === "odendi") {
        const adaylar = await tx.kasaBankaHareket.findMany({ where: { kaynakTur: "cek_senet", kaynakRef: id }, select: { id: true } });
        const tersler = await tx.kasaBankaHareket.findMany({ where: { kaynakTur: "ters_kayit", kaynakRef: { in: adaylar.map((a) => a.id) } }, select: { kaynakRef: true } });
        const geriAlinan = new Set(tersler.map((t) => t.kaynakRef));
        fisler = adaylar.map((a) => a.id).filter((f) => !geriAlinan.has(f));
        for (const fis of fisler) await this.geriAlIslem(tx, tenantId, fis, neden, "tahsilat_tediye", false);
      }
      const cariTuru = son.yeniDurum === "ciro_edildi" ? "cek_senet_ciro" : son.yeniDurum === "karsiliksiz" || son.yeniDurum === "iade_edildi" ? "cek_senet_ters" : null;
      const cariler = cariTuru ? await acikCariHareketleri(cariTuru) : [];
      await cariEtkisiniGeriAl(cariler);

      // Bankaya geri dönülüyorsa (ör. tahsil geri alındı) önceki olayın hesabı geri gelir.
      const oncekiOlay = await tx.cekSenetOlay.findFirst({ where: { cekSenetId: id, geriAlindi: false, geriAlma: false, id: { not: son.id } }, orderBy: { createdAt: "desc" }, select: { bankaHesapId: true } });
      const bankaya = son.oncekiDurum === "tahsile_verildi" || son.oncekiDurum === "teminata_verildi";
      await tx.cekSenet.update({
        where: { id },
        data: {
          durum: son.oncekiDurum,
          fizikselKonum: KasaBankaService.VARSAYILAN_KONUM[son.oncekiDurum] ?? cs.fizikselKonum,
          ...(son.yeniDurum === "ciro_edildi" ? { ciroCariId: null } : {}),
          ...(bankaya ? { bankaHesapId: oncekiOlay?.bankaHesapId ?? cs.bankaHesapId } : {}),
        },
      });
      await tx.cekSenetOlay.update({ where: { id: son.id }, data: { geriAlindi: true } });
      await tx.cekSenetOlay.create({
        data: { tenantId, cekSenetId: id, oncekiDurum: son.yeniDurum, yeniDurum: son.oncekiDurum, islemTarihi: kapali ? new Date(bugun) : son.islemTarihi, aciklama: `Geri alındı: ${neden}`.slice(0, 500), userId, geriAlma: true },
      });
      await iz(kapali ? "cek_senet_islemi_ters_kayit" : "cek_senet_islemi_geri_alindi", { fisler, cariHareketleri: cariler });
      return { yontem: kapali ? "ters_kayit" as const : "silindi" as const, silindi: false, durum: son.oncekiDurum };
    }
  }

  /** Fişi başka bir modül ürettiyse o modülün adı (geri alma oradan yapılır). */
  private static kaynakModulu(h: { tip: string; kaynakTur: string; ekstreSatir: { eslesmeTuru: string | null } | null; posTahsilat: unknown; masraf: unknown; krediKartiOdemesi: unknown; gelirKaydi: unknown; pazaryeriKesinti: unknown }): string | null {
    // Ekstre eşleştirmesinin ürettiği kayıt (bir satıra birden çok fiş olabilir) ekstreden geri alınır;
    // yalnız elle girilip sonradan ekstreye bağlanan fiş buradan geri alınabilir.
    if (h.ekstreSatir && h.ekstreSatir.eslesmeTuru !== "mevcut_fis") return "Banka Ekstresi ekranı (satırın eşleşmesini geri alın)";
    if (h.masraf || h.kaynakTur === "masraf") return "Masraflar ekranı";
    if (h.posTahsilat || h.kaynakTur === "pos_tahsilat") return "POS tahsilatı";
    if (h.kaynakTur === "pos_iade") return "POS Hesapları ekranı (iade)";
    if (h.kaynakTur === "doviz_islem") return "Döviz alım/satımı (fiş ayrıntısındaki \"Döviz işlemini geri al\")";
    if (h.kaynakTur === "pos_mutabakat") return "POS mutabakatı (Banka Ekstresi ekranı)";
    if (h.krediKartiOdemesi || h.kaynakTur === "kredi_karti_ekstre") return "Kredi Kartları ekranı";
    if (h.gelirKaydi || h.kaynakTur === "faturasiz_gelir") return "Faaliyet Dışı Gelirler ekranı";
    if (h.pazaryeriKesinti || h.kaynakTur === "pazaryeri_kesinti") return "Pazaryeri Kesintileri ekranı";
    if (h.kaynakTur === "cek_senet") return "Çek & Senetler ekranı";
    if (h.kaynakTur === "odeme_talimati") return "Ödeme Talimatları ekranı (gerçekleşmeyi geri alın)";
    if (h.kaynakTur.startsWith("personel_")) return "Personel & İK ekranı";
    if (!["manuel", "fatura_kapama"].includes(h.kaynakTur)) return "ilgili modül";
    return null;
  }

  private async donemKapaliMi(tenantId: string, tarih: Date): Promise<boolean> {
    try {
      await this.donemKilidi.tarihDogrula(tenantId, tarih, "geri alma");
      return false;
    } catch (hata) {
      if (hata instanceof ConflictException) return true;
      throw hata;
    }
  }

  private async geriAlmaIzi(tx: Prisma.TransactionClient, tenantId: string, islem: string, varlikId: string, detay: unknown) {
    const { userId } = aktifBaglam();
    await tx.auditLog.create({
      data: { tenantId, userId, islem, varlik: "kasa-banka", varlikId, detay: JSON.parse(JSON.stringify(detay)) as Prisma.InputJsonValue },
    });
  }

  async posBankayaAktar(girdi: z.infer<typeof posBankaAktarimSemasi>) {
    const { tenantId } = aktifBaglam(); const brut = D(girdi.brutTutar); const komisyon = D(girdi.komisyonTutar); const net = brut.sub(komisyon);
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "POS hesabından bankaya aktarım");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const pos = await tx.posHesap.findUnique({ where: { id: girdi.posHesapId } });
      if (!pos || !pos.aktif) throw new NotFoundException("Aktif POS hesabı bulunamadı");
      const bankaId = girdi.bankaHesapId ?? pos.varsayilanBankaHesapId;
      if (!bankaId) throw new BadRequestException("Aktarım için banka hesabı seçilmelidir");
      const banka = await tx.bankaHesap.findUnique({ where: { id: bankaId } });
      if (!banka || !banka.aktif || banka.dovizCinsi !== pos.dovizCinsi) throw new BadRequestException("Aktif ve aynı döviz cinsinde banka hesabı seçilmelidir");
      const ekstreSatir = girdi.ekstreSatirId ? await tx.bankaEkstreSatir.findUnique({ where: { id: girdi.ekstreSatirId } }) : null;
      if (girdi.ekstreSatirId && (!ekstreSatir || ekstreSatir.durum !== "beklemede" || await tx.kasaBankaHareket.count({ where: { ekstreSatirId: ekstreSatir.id } }))) throw new BadRequestException("Onay bekleyen ekstre satırı bulunamadı");
      if (ekstreSatir && (ekstreSatir.bankaHesapId !== bankaId || !ekstreSatir.tutar.gt(0) || !ekstreSatir.tutar.equals(net))) throw new BadRequestException("Ekstre satırı banka hesabı veya net aktarım tutarıyla uyuşmuyor");
      const bakiyeGruplari = await tx.kasaBankaHareket.groupBy({ by: ["tip"], where: { posHesapId: pos.id }, _sum: { tutar: true } });
      let kullanilabilir = D(0);
      for (const grup of bakiyeGruplari) kullanilabilir = grup.tip === "tahsilat" || grup.tip === "virman_gelis" ? kullanilabilir.add(grup._sum.tutar ?? 0) : kullanilabilir.sub(grup._sum.tutar ?? 0);
      if (brut.greaterThan(kullanilabilir)) throw new BadRequestException(`Aktarım tutarı POS bakiyesini aşıyor (kullanılabilir: ${kullanilabilir.toFixed(2)} ${pos.dovizCinsi})`);
      const tarih = new Date(girdi.tarih);
      const kur = await kurCoz(tx, tenantId, pos.dovizCinsi, tarih, GIRIS_KUR_TIPI);
      if (!kur) throw new BadRequestException(`${girdi.tarih} tarihi için kayıtlı ${pos.dovizCinsi} kuru yok; kur kaydı oluşmadan dövizli POS mutabakatı yapılamaz`);
      const try_ = (tutar: Prisma.Decimal) => tutar.mul(kur).toDecimalPlaces(2);
      const ortak = { tenantId, dovizCinsi: pos.dovizCinsi, kur, tarih, kaynakTur: "pos_mutabakat", aciklama: girdi.aciklama ?? `${pos.ad} sağlayıcı ödemesi` };
      const gidis = await tx.kasaBankaHareket.create({ data: { ...ortak, posHesapId: pos.id, tip: "virman_gidis", tutar: net, tutarTry: try_(net) } });
      const gelis = await tx.kasaBankaHareket.create({ data: { ...ortak, bankaHesapId: bankaId, tip: "virman_gelis", tutar: net, tutarTry: try_(net), karsiHareketId: gidis.id } });
      await tx.kasaBankaHareket.update({ where: { id: gidis.id }, data: { karsiHareketId: gelis.id } });
      const komisyonHareketi = komisyon.gt(0) ? await tx.kasaBankaHareket.create({ data: { ...ortak, posHesapId: pos.id, tip: "tediye", tutar: komisyon, tutarTry: try_(komisyon), kaynakRef: gidis.id, aciklama: `${pos.ad} komisyon/kesinti` } }) : null;
      const komisyonMasrafi = komisyonHareketi ? await (async () => {
        const kategori = await tx.masrafKategori.upsert({
          where: { tenantId_ad: { tenantId, ad: "Banka ve POS Komisyonları" } },
          create: { tenantId, ad: "Banka ve POS Komisyonları", varsayilanKdvOrani: D(0) },
          update: { aktif: true },
        });
        return tx.masraf.create({
          data: {
            tenantId,
            kategoriId: kategori.id,
            belgeTuru: "dekont",
            tarih,
            saticiUnvan: pos.ad,
            aciklama: `${pos.ad} komisyon/kesinti`,
            matrah: komisyon,
            kdvOrani: D(0),
            kdvTutari: D(0),
            toplam: komisyon,
            dovizCinsi: pos.dovizCinsi,
            kur,
            durum: "onaylandi",
            odemeDurumu: "odendi",
            odenenTutar: komisyon,
            odemeTarihi: tarih,
            hareketId: komisyonHareketi.id,
          },
        });
      })() : null;
      if (ekstreSatir) {
        await tx.bankaEkstreSatir.update({ where: { id: ekstreSatir.id }, data: { durum: "eslesti", eslesmeTuru: "pos" } });
        await tx.kasaBankaHareket.update({ where: { id: gelis.id }, data: { ekstreSatirId: ekstreSatir.id } });
      }
      return { gidis, gelis, komisyonHareketi, komisyonMasrafi, brutTutar: brut.toFixed(2), netTutar: net.toFixed(2), komisyonTutar: komisyon.toFixed(2) };
    });
  }

  // ─── ÇEK VE SENET TAKİBİ (KSB-05) ─────────────────────────────────────────

  async cekSenetListele(tur?: "cek" | "senet", durum?: string, yon?: string, arama?: string, baslangic?: string, bitis?: string, yalnizAcik = false) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cekSenet.findMany({
        where: {
          tur: tur || undefined,
          durum: yalnizAcik ? { in: [...CEK_VADE_ACIK_DURUMLARI] } : durum ? (durum as CekSenetDurum) : undefined,
          yon: yon ? (yon as CekSenetYon) : undefined,
          vadeTarihi: { ...(baslangic ? { gte: new Date(baslangic) } : {}), ...(bitis ? { lte: new Date(bitis) } : {}) },
          ...(arama ? { OR: [
            { portfoyNo: { contains: arama, mode: "insensitive" } },
            { cekNo: { contains: arama, mode: "insensitive" } },
            { borclu: { contains: arama, mode: "insensitive" } },
            { banka: { contains: arama, mode: "insensitive" } },
            { cari: { aramaNormal: { contains: metinNormalize(arama) } } },
          ] } : {}),
        },
        orderBy: { vadeTarihi: "asc" },
        include: {
          cari: { select: { id: true, kod: true, unvan: true } },
          ciroCari: { select: { id: true, kod: true, unvan: true } },
          bankaHesap: { select: { id: true, ad: true } },
        },
      }),
    );
  }

  async cekSenetGetir(id: string) {
    const { tenantId } = aktifBaglam();
    const CS = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cekSenet.findUnique({
        where: { id },
        include: {
          cari: true,
          ciroCari: true,
          bankaHesap: { select: { id: true, ad: true } },
          olaylar: { orderBy: [{ createdAt: "desc" }], take: 100, include: { bordro: { select: { id: true, no: true, tur: true } } } },
        },
      }),
    );
    if (!CS) throw new NotFoundException("Çek/Senet bulunamadı");
    return CS;
  }

  async cekSenetVadeAnalizi() {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.cekSenet.findMany({
      where: { tenantId, durum: { in: [...CEK_VADE_ACIK_DURUMLARI] } },
      select: { yon: true, durum: true, vadeTarihi: true, tutar: true, dovizCinsi: true },
    }));
    return cekVadeAnalizi(kayitlar, bugun);
  }

  async cekSenetOzet(yon?: string) {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.cekSenet.findMany({
      where: { yon: yon ? (yon as CekSenetYon) : undefined },
      select: { durum: true, vadeTarihi: true, tutarTry: true, dovizCinsi: true, tutar: true },
    }));
    const bugun = new Date(`${bugunTR()}T00:00:00Z`);
    const otuzGun = new Date(bugun); otuzGun.setUTCDate(otuzGun.getUTCDate() + 30);
    const acikDurumlar = yon === "verilen" ? ["verildi"] : yon === "alinan" ? ["portfoyde", "tahsile_verildi", "teminata_verildi"] : [...CEK_VADE_ACIK_DURUMLARI];
    const acik = kayitlar.filter((k) => acikDurumlar.includes(k.durum));
    const toplam = (liste: typeof kayitlar) => liste.reduce((t, k) => t.add(k.tutarTry), D(0)).toFixed(2);
    const dovizler = Object.fromEntries([...new Set(["TRY", ...acik.map((k) => k.dovizCinsi)])].map((d) => [d, acik.filter((k) => k.dovizCinsi === d).reduce((t, k) => t.add(k.tutar), D(0)).toFixed(2)]));
    return {
      acik: { adet: acik.length, toplamTry: toplam(acik), dovizler },
      geciken: { adet: acik.filter((k) => k.vadeTarihi < bugun).length, toplamTry: toplam(acik.filter((k) => k.vadeTarihi < bugun)) },
      yaklasan: { adet: acik.filter((k) => k.vadeTarihi >= bugun && k.vadeTarihi <= otuzGun).length, toplamTry: toplam(acik.filter((k) => k.vadeTarihi >= bugun && k.vadeTarihi <= otuzGun)) },
      bankada: { adet: kayitlar.filter((k) => ["tahsile_verildi", "teminata_verildi"].includes(k.durum)).length, toplamTry: toplam(kayitlar.filter((k) => ["tahsile_verildi", "teminata_verildi"].includes(k.durum))) },
      ciro: { adet: kayitlar.filter((k) => k.durum === "ciro_edildi").length, toplamTry: toplam(kayitlar.filter((k) => k.durum === "ciro_edildi")) },
      karsiliksiz: { adet: kayitlar.filter((k) => k.durum === "karsiliksiz").length, toplamTry: toplam(kayitlar.filter((k) => k.durum === "karsiliksiz")) },
    };
  }

  async cekSenetOlustur(girdi: z.infer<typeof cekSenetOlusturSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    // Kayıt cari hareketi yazar; işlem tarihi kapalı döneme düşemez.
    await this.donemKilidi.tarihDogrula(tenantId, girdi.islemTarihi, "çek/senet kaydı");
    return this.prisma.tenantIslem(tenantId, (tx) => this.cekKaydiYaz(tx, tenantId, userId, girdi));
  }

  /**
   * Çek/senet kaydını işlem içinde yazar (tek kayıt ve giriş/borç çeki bordrosu
   * ortak kullanır). Dönem kilidi çağıran tarafından denetlenir.
   */
  async cekKaydiYaz(tx: Prisma.TransactionClient, tenantId: string, userId: string, girdi: z.infer<typeof cekSenetOlusturSemasi>, bordro?: { id: string; no: string }) {
    const tutar = D(girdi.tutar);
    const kur = D(girdi.kur);
    const tutarTry = tutar.mul(kur).toDecimalPlaces(2);
    if (await tx.cekSenet.findFirst({ where: { portfoyNo: girdi.portfoyNo }, select: { id: true } })) {
      throw new BadRequestException(`“${girdi.portfoyNo}” portföy numarası zaten kullanılıyor`);
    }
    {
      const CS = await tx.cekSenet.create({
        data: {
          tenantId,
          tur: girdi.tur,
          portfoyNo: girdi.portfoyNo,
          cekNo: girdi.cekNo,
          islemTarihi: new Date(girdi.islemTarihi),
          vadeTarihi: new Date(girdi.vadeTarihi),
          tutar,
          dovizCinsi: girdi.dovizCinsi,
          kur,
          tutarTry,
          borclu: girdi.borclu,
          kesideYeri: girdi.kesideYeri,
          banka: girdi.banka,
          sube: girdi.sube,
          hesapNo: girdi.hesapNo,
          yon: girdi.yon,
          durum: girdi.yon === "verilen" ? "verildi" : "portfoyde",
          cariId: girdi.cariId,
          aciklama: girdi.aciklama,
          fizikselKonum: girdi.fizikselKonum ?? (girdi.yon === "alinan" ? "Şirket portföyü" : "Lehtara teslim"),
        },
      });

      await tx.cekSenetOlay.create({ data: { tenantId, cekSenetId: CS.id, yeniDurum: CS.durum, islemTarihi: new Date(girdi.islemTarihi), aciklama: bordro ? `${bordro.no} bordrosuyla kaydedildi` : "Çek/senet kaydı oluşturuldu", userId, bordroId: bordro?.id ?? null } });

      // Alınan çek/senet: müşteri alacaklanır (bize olan borcu azalır).
      // Verilen çek/senet: lehtar borçlanır (bizim ona olan borcumuz azalır).
      if (girdi.cariId) {
        const verilen = girdi.yon === "verilen";
        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: girdi.cariId,
            tip: verilen ? "borc" : "alacak",
            tutar,
            dovizCinsi: girdi.dovizCinsi,
            kur,
            tutarTry,
            tarih: new Date(girdi.islemTarihi),
            aciklama: `${girdi.tur.toUpperCase()} ${verilen ? "verildi" : "alımı"} (Portföy No: ${girdi.portfoyNo}${bordro ? `, Bordro: ${bordro.no}` : ""})`,
            kaynakTur: "cek_senet",
            kaynakRef: CS.id,
          },
        });
      }

      // KSB-16: çek/senet carinin tahsilatı/ödemesidir; açık faturalara vadeyle dağılır.
      if (girdi.cariId) await cariDenklestir(tx, tenantId, girdi.cariId);
      return CS;
    }
  }

  async cekSenetGuncelle(id: string, girdi: z.infer<typeof cekSenetGuncelleSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    const CS = await this.cekSenetGetir(id);
    await this.cekGecisiniDenetle(tenantId, CS, girdi);
    return this.prisma.tenantIslem(tenantId, (tx) => this.cekGecisiYaz(tx, tenantId, userId, CS, girdi));
  }

  /** Geçişin kuralları, hesabı ve dönem kilidi (işlem dışında, önce çağrılır). */
  async cekGecisiniDenetle(tenantId: string, CS: { yon: CekSenetYon; durum: CekSenetDurum; dovizCinsi: DovizCinsi; portfoyNo: string }, girdi: z.infer<typeof cekSenetGuncelleSemasi>) {
    this.cekSenetDurumunuDenetle(CS.yon, girdi.durum);

    const gecisler: Record<string, string[]> = CS.yon === "alinan" ? {
      portfoyde: ["tahsile_verildi", "teminata_verildi", "ciro_edildi", "tahsil_edildi", "karsiliksiz", "iade_edildi"],
      tahsile_verildi: ["portfoyde", "tahsil_edildi", "karsiliksiz", "iade_edildi"],
      teminata_verildi: ["portfoyde", "tahsil_edildi", "karsiliksiz", "iade_edildi"],
    } : { verildi: ["odendi", "karsiliksiz", "iade_edildi"] };
    if (!(gecisler[CS.durum] ?? []).includes(girdi.durum)) throw new BadRequestException(`${CS.portfoyNo}: ${CS.durum} durumundan ${girdi.durum} durumuna geçilemez`);

    const fisYazilacak = girdi.durum === "tahsil_edildi" || girdi.durum === "odendi";
    if (fisYazilacak) await this.islemHesabiniDenetle(girdi, CS.dovizCinsi);
    const islemTarihi = girdi.islemTarihi ? new Date(girdi.islemTarihi) : new Date();
    // Tahsil/ödeme fiş, ciro/karşılıksız/iade cari hareketi yazar; yalnız konum
    // değiştiren geçişler (bankaya verme, portföye dönme) kapalı dönemi etkilemez.
    if (["tahsil_edildi", "odendi", "ciro_edildi", "karsiliksiz", "iade_edildi"].includes(girdi.durum)) {
      await this.donemKilidi.tarihDogrula(tenantId, islemTarihi, "çek/senet işlemi");
    }
  }

  /** Durum geçişini işlem içinde yazar (tek evrak ve çıkış bordroları ortak kullanır). */
  async cekGecisiYaz(...arg: Parameters<KasaBankaService["cekGecisiniYaz"]>) {
    const [tx, tenantId, , CS] = arg;
    return this.cekCarileriniDenklestir(tx, tenantId, CS.id, () => this.cekGecisiniYaz(...arg));
  }

  private async cekGecisiniYaz(
    tx: Prisma.TransactionClient, tenantId: string, userId: string,
    CS: Awaited<ReturnType<KasaBankaService["cekSenetGetir"]>>, girdi: z.infer<typeof cekSenetGuncelleSemasi>, bordro?: { id: string; no: string },
  ) {
    const id = CS.id;
    const fisYazilacak = girdi.durum === "tahsil_edildi" || girdi.durum === "odendi";
    const islemTarihi = girdi.islemTarihi ? new Date(girdi.islemTarihi) : new Date();
    const varsayilanKonum = KasaBankaService.VARSAYILAN_KONUM;
    const bankaya = girdi.durum === "tahsile_verildi" || girdi.durum === "teminata_verildi";
    let bankaHesabi: { id: string; ad: string } | null = null;
    if (bankaya && girdi.bankaHesapId) {
      bankaHesabi = await tx.bankaHesap.findUnique({ where: { id: girdi.bankaHesapId }, select: { id: true, ad: true } });
      if (!bankaHesabi) throw new BadRequestException("Çekin verileceği banka hesabı bulunamadı");
    }
    {
      const hak = await tx.cekSenet.updateMany({ where: { id, durum: CS.durum }, data: { durum: girdi.durum } });
      if (hak.count !== 1) throw new BadRequestException("Çek/senet başka bir işlemle güncellendi; ekranı yenileyin");
      const guncel = await tx.cekSenet.update({
        where: { id },
        data: {
          ciroCariId: girdi.ciroCariId,
          aciklama: girdi.aciklama ?? CS.aciklama,
          fizikselKonum: girdi.fizikselKonum ?? (bankaHesabi ? `${varsayilanKonum[girdi.durum]} · ${bankaHesabi.ad}` : varsayilanKonum[girdi.durum]),
          // Bankadayken hangi hesapta olduğu tutulur; bankadan çıkınca son hesap iz olarak kalır.
          ...(bankaya ? { bankaHesapId: bankaHesabi?.id ?? null } : {}),
        },
      });

      if (fisYazilacak) {
        const odeme = girdi.durum === "odendi";
        await tx.kasaBankaHareket.create({
          data: {
            tenantId,
            kasaId: girdi.hesapKasaId ?? null,
            bankaHesapId: girdi.hesapBankaHesapId ?? null,
            tip: odeme ? "tediye" : "tahsilat",
            tutar: CS.tutar,
            dovizCinsi: CS.dovizCinsi,
            kur: CS.kur,
            tutarTry: D(CS.tutar).mul(D(CS.kur)).toDecimalPlaces(2),
            tarih: islemTarihi,
            aciklama: odeme
              ? `${CS.tur.toUpperCase()} ödemesi (Portföy No: ${CS.portfoyNo}, Lehtar: ${CS.cari?.unvan ?? "—"})`
              : `${CS.tur.toUpperCase()} tahsili (Portföy No: ${CS.portfoyNo}, Borçlu: ${CS.borclu})`,
            kaynakTur: "cek_senet",
            kaynakRef: CS.id,
          },
        });
      }

      if (girdi.durum === "ciro_edildi" && girdi.ciroCariId) {
        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: girdi.ciroCariId,
            tip: "borc",
            tutar: CS.tutar,
            dovizCinsi: CS.dovizCinsi,
            kur: CS.kur,
            tutarTry: D(CS.tutar).mul(D(CS.kur)).toDecimalPlaces(2),
            tarih: islemTarihi,
            aciklama: `${CS.tur.toUpperCase()} Ciro Edildi (Portföy No: ${CS.portfoyNo}${bordro ? `, Bordro: ${bordro.no}` : ""})`,
            kaynakTur: "cek_senet_ciro",
            kaynakRef: CS.id,
          },
        });
      }

      if (["karsiliksiz", "iade_edildi"].includes(girdi.durum) && CS.cariId) {
        await tx.cariHareket.create({ data: {
          tenantId, cariId: CS.cariId, tip: CS.yon === "alinan" ? "borc" : "alacak",
          tutar: CS.tutar, dovizCinsi: CS.dovizCinsi, kur: CS.kur,
          tutarTry: D(CS.tutar).mul(D(CS.kur)).toDecimalPlaces(2), tarih: islemTarihi,
          aciklama: `${CS.tur.toUpperCase()} ${girdi.durum === "karsiliksiz" ? "karşılıksız" : "iade"} ters kaydı (Portföy No: ${CS.portfoyNo})`,
          kaynakTur: "cek_senet_ters", kaynakRef: CS.id,
        } });
      }

      await tx.cekSenetOlay.create({
        data: {
          tenantId, cekSenetId: CS.id, oncekiDurum: CS.durum, yeniDurum: girdi.durum, islemTarihi, userId,
          aciklama: bordro ? `${bordro.no} bordrosu${girdi.aciklama ? ` · ${girdi.aciklama}` : ""}` : girdi.aciklama,
          bordroId: bordro?.id ?? null, bankaHesapId: bankaHesabi?.id ?? null,
        },
      });

      return guncel;
    }
  }

  // ─── AÇILIŞ FİŞİ, EKSİ BAKİYE UYARISI VE HESAP EKSTRESİ (P1-9) ────────────

  /** Hesapların açılış fişleri; tutar işaretlidir (eksi açılış = tediye). */
  private async acilislar(tur: HesapTuru, idler: string[]) {
    if (idler.length === 0) return new Map<string, { id: string; tarih: string; tutar: string; kur: string; aciklama: string | null }>();
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.kasaBankaHareket.findMany({
      where: { kaynakTur: "acilis", ...(tur === "kasa" ? { kasaId: { in: idler } } : { bankaHesapId: { in: idler } }) },
      select: { id: true, kasaId: true, bankaHesapId: true, tip: true, tarih: true, tutar: true, kur: true, aciklama: true },
    }));
    return new Map(kayitlar.map((a) => [(a.kasaId ?? a.bankaHesapId)!, {
      id: a.id,
      tarih: a.tarih.toISOString().slice(0, 10),
      tutar: (a.tip === "tediye" ? a.tutar.negated() : a.tutar).toFixed(2),
      kur: a.kur.toFixed(6),
      aciklama: a.aciklama,
    }]));
  }

  /** Hesap satırını kilitler: açılış denetimleri (ilk hareket, tek açılış) eşzamanlı yazımla bozulmasın. */
  private async hesabiKilitle(tx: Prisma.TransactionClient, tur: HesapTuru, id: string) {
    if (tur === "kasa") await tx.$queryRaw`SELECT id FROM kasalar WHERE id = ${id}::uuid FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM banka_hesaplari WHERE id = ${id}::uuid FOR UPDATE`;
    const secim = { id: true, ad: true, dovizCinsi: true } as const;
    const hesap = tur === "kasa" ? await tx.kasa.findUnique({ where: { id }, select: secim }) : await tx.bankaHesap.findUnique({ where: { id }, select: secim });
    if (!hesap) throw new NotFoundException(tur === "kasa" ? "Kasa bulunamadı" : "Banka hesabı bulunamadı");
    return hesap;
  }

  /**
   * Açılış fişini yazar ya da var olanı değiştirir. Açılış hesabın ilk
   * hareketinden sonra tarihlenemez; tutar işaretlidir, eksi açılış tediyedir.
   */
  private async acilisYaz(tx: Prisma.TransactionClient, tenantId: string, tur: HesapTuru, hesap: { id: string; dovizCinsi: DovizCinsi }, girdi: AcilisGirdisi, neden?: string | null) {
    const alan = hesapAlani(tur, hesap.id);
    const tarih = new Date(girdi.tarih);
    const ilk = await tx.kasaBankaHareket.findFirst({ where: { ...alan, kaynakTur: { not: "acilis" } }, orderBy: { tarih: "asc" }, select: { tarih: true } });
    if (ilk && tarih > ilk.tarih) throw new BadRequestException(`Açılış tarihi hesabın ilk hareketinden (${tarihTR(ilk.tarih)}) sonra olamaz`);
    const mevcut = await tx.kasaBankaHareket.findFirst({ where: { ...alan, kaynakTur: "acilis" } });
    if (mevcut) {
      if (!neden || neden.trim().length < 3) throw new BadRequestException("Açılış bakiyesini değiştirmek için gerekçe yazın (en az 3 karakter)");
      await this.donemKilidi.tarihDogrula(tenantId, mevcut.tarih, "açılış fişi değiştirme", tx);
    }
    const isaretli = D(girdi.tutar);
    const tutar = isaretli.abs();
    const kur = hesap.dovizCinsi === "TRY" ? D(1) : girdi.kur ? D(girdi.kur) : await kurZorunlu(tx, hesap.dovizCinsi, tarih, GIRIS_KUR_TIPI);
    const veri = {
      tip: (isaretli.isNegative() ? "tediye" : "tahsilat") as KasaBankaHareketTip,
      tutar,
      dovizCinsi: hesap.dovizCinsi,
      kur,
      tutarTry: tutar.mul(kur).toDecimalPlaces(2),
      tarih,
      aciklama: girdi.aciklama?.trim() || "Açılış bakiyesi",
    };
    if (!mevcut) return tx.kasaBankaHareket.create({ data: { tenantId, ...alan, ...veri, kaynakTur: "acilis" } });
    const kayit = await tx.kasaBankaHareket.update({ where: { id: mevcut.id }, data: veri });
    await this.geriAlmaIzi(tx, tenantId, "kasa_banka_acilis_degisti", mevcut.id, { neden, onceki: mevcut, yeni: kayit });
    return kayit;
  }

  async acilisKaydet(tur: HesapTuru, hesapId: string, girdi: z.infer<typeof acilisSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "açılış fişi");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hesap = await this.hesabiKilitle(tx, tur, hesapId);
      return this.acilisYaz(tx, tenantId, tur, hesap, girdi, girdi.neden);
    });
  }

  async acilisSil(tur: HesapTuru, hesapId: string, neden: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.hesabiKilitle(tx, tur, hesapId);
      const mevcut = await tx.kasaBankaHareket.findFirst({ where: { ...hesapAlani(tur, hesapId), kaynakTur: "acilis" } });
      if (!mevcut) throw new NotFoundException("Bu hesabın açılış fişi yok");
      await this.donemKilidi.tarihDogrula(tenantId, mevcut.tarih, "açılış fişi silme", tx);
      await tx.kasaBankaHareket.delete({ where: { id: mevcut.id } });
      await this.geriAlmaIzi(tx, tenantId, "kasa_banka_acilis_silindi", mevcut.id, { neden, hareket: mevcut });
      return { silindi: true };
    });
  }

  /**
   * Daha önce cari'siz tahsilat/tediye olarak girilmiş açılışı açılış fişine
   * çevirir. Bakiye değişmez; fiş tahsilat/ödeme sayılmaktan çıkar ve makbuz
   * numarası boşa düşer (numara yanar, yeniden verilmez).
   */
  async acilisaCevir(hareketId: string, neden: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const h = await tx.kasaBankaHareket.findUnique({ where: { id: hareketId }, include: { ekstreSatir: { select: { id: true } } } });
      if (!h) throw new NotFoundException("Kasa/banka hareketi bulunamadı");
      const tur: HesapTuru | null = h.kasaId ? "kasa" : h.bankaHesapId ? "banka" : null;
      if (!tur) throw new BadRequestException("POS hesabında açılış fişi tutulmaz");
      await this.hesabiKilitle(tx, tur, (h.kasaId ?? h.bankaHesapId)!);
      if (h.kaynakTur === "acilis") throw new ConflictException("Bu fiş zaten açılış fişi");
      if (h.kaynakTur !== "manuel" || (h.tip !== "tahsilat" && h.tip !== "tediye")) throw new BadRequestException("Yalnız elle girilmiş tahsilat/ödeme fişi açılışa çevrilebilir");
      if (h.cariId || h.faturaId) throw new BadRequestException("Cariye ya da faturaya bağlı fiş açılış olamaz");
      if (h.ekstreSatir) throw new BadRequestException("Banka ekstresine bağlı fiş açılış olamaz; önce ekstre eşleşmesini geri alın");
      const alan = hesapAlani(tur, (h.kasaId ?? h.bankaHesapId)!);
      if (await tx.kasaBankaHareket.findFirst({ where: { ...alan, kaynakTur: "acilis" }, select: { id: true } })) throw new ConflictException("Bu hesabın zaten bir açılış fişi var");
      if (await tx.kasaBankaHareket.findFirst({ where: { kaynakTur: "ters_kayit", kaynakRef: h.id }, select: { id: true } })) throw new BadRequestException("Geri alınmış fiş açılışa çevrilemez");
      const onceki = await tx.kasaBankaHareket.findFirst({ where: { ...alan, id: { not: h.id }, tarih: { lt: h.tarih } }, orderBy: { tarih: "asc" }, select: { tarih: true } });
      if (onceki) throw new BadRequestException(`Açılış hesabın ilk hareketi olmalı; bu fişten önce ${tarihTR(onceki.tarih)} tarihli hareket var`);
      await this.donemKilidi.tarihDogrula(tenantId, h.tarih, "açılışa çevirme", tx);
      const kayit = await tx.kasaBankaHareket.update({ where: { id: h.id }, data: { kaynakTur: "acilis", makbuzNo: null } });
      await this.geriAlmaIzi(tx, tenantId, "kasa_banka_acilisa_cevrildi", h.id, { neden, onceki: h });
      return kayit;
    });
  }

  /** Hesabın işlem içindeki güncel bakiyesi (POS hesabı ve hesapsız girdi için null). */
  async hesapBakiyesi(tx: Prisma.TransactionClient, hesap: { kasaId?: string | null; bankaHesapId?: string | null }): Promise<Prisma.Decimal | null> {
    if (!hesap.kasaId && !hesap.bankaHesapId) return null;
    const gruplar = await tx.kasaBankaHareket.groupBy({ by: ["tip"], where: hesap.kasaId ? { kasaId: hesap.kasaId } : { bankaHesapId: hesap.bankaHesapId! }, _sum: { tutar: true } });
    return gruplar.reduce((t, g) => (girisMi(g.tip) ? t.add(g._sum.tutar ?? 0) : t.sub(g._sum.tutar ?? 0)), D(0));
  }

  /**
   * P1-9: işlem hesabı eksi bakiyeye düşürdüyse (ya da eksideki hesabı daha da
   * düşürdüyse) onay ister; 409 işlemi geri sarar, kullanıcı onaylayınca aynı
   * istek `eksiBakiyeOnay` ile yinelenir. Engel değil, uyarıdır.
   */
  async eksiBakiyeDenetle(tx: Prisma.TransactionClient, hesap: { kasaId?: string | null; bankaHesapId?: string | null }, once: Prisma.Decimal | null, onay?: boolean) {
    if (onay || once === null) return;
    const sonra = await this.hesapBakiyesi(tx, hesap);
    if (!sonra || !sonra.isNegative() || !sonra.lt(once)) return;
    const kayit = hesap.kasaId
      ? await tx.kasa.findUnique({ where: { id: hesap.kasaId }, select: { ad: true, dovizCinsi: true } })
      : await tx.bankaHesap.findUnique({ where: { id: hesap.bankaHesapId! }, select: { ad: true, dovizCinsi: true } });
    throw new ConflictException(`Bu işlemden sonra ${hesap.kasaId ? "kasa" : "banka hesabı"} "${kayit?.ad ?? ""}" eksi bakiyeye düşer: ${tutarTR(sonra, kayit?.dovizCinsi ?? "TRY")}. İşlem doğruysa yine de kaydedebilirsiniz.`);
  }

  async hesapEkstresi(tur: HesapTuru, id: string, baslangic?: string, bitis?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const banka = tur === "banka" ? await tx.bankaHesap.findUnique({ where: { id }, select: { id: true, ad: true, dovizCinsi: true, aktif: true, bankaAdi: true, sube: true, hesapNo: true, iban: true } }) : null;
      const hesap = tur === "kasa" ? await tx.kasa.findUnique({ where: { id }, select: { id: true, ad: true, dovizCinsi: true, aktif: true } }) : banka;
      if (!hesap) throw new NotFoundException(tur === "kasa" ? "Kasa bulunamadı" : "Banka hesabı bulunamadı");
      const alan = hesapAlani(tur, id);
      const devirGruplari = baslangic
        ? await tx.kasaBankaHareket.groupBy({ by: ["tip"], where: { ...alan, tarih: { lt: new Date(baslangic) } }, _sum: { tutar: true, tutarTry: true } })
        : [];
      const hareketler = await tx.kasaBankaHareket.findMany({
        where: { ...alan, ...(baslangic || bitis ? { tarih: { ...(baslangic ? { gte: new Date(baslangic) } : {}), ...(bitis ? { lte: new Date(bitis) } : {}) } } : {}) },
        orderBy: [{ tarih: "asc" }, { createdAt: "asc" }],
        include: { cari: { select: { unvan: true } }, fatura: { select: { no: true } } },
      });
      // Açılış, ilk hareketle aynı güne düşebilir; o gün içinde her zaman en başta yer alır.
      hareketler.sort((a, b) => a.tarih.getTime() - b.tarih.getTime() || Number(b.kaynakTur === "acilis") - Number(a.kaynakTur === "acilis"));
      const karsiIdler = hareketler.map((h) => h.karsiHareketId).filter((x): x is string => Boolean(x));
      const karsilar = karsiIdler.length
        ? await tx.kasaBankaHareket.findMany({ where: { id: { in: karsiIdler } }, select: { id: true, kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true } }, posHesap: { select: { ad: true } } } })
        : [];
      const karsiAdi = new Map(karsilar.map((k) => [k.id, k.kasa?.ad ?? k.bankaHesap?.ad ?? k.posHesap?.ad ?? null]));
      const acilis = (await this.acilislar(tur, [id])).get(id) ?? null;
      // Açılış bu tarihten sonraya konamaz; ekran açılış formunu bu tarihle başlatır.
      const ilkHareket = await tx.kasaBankaHareket.findFirst({ where: { ...alan, kaynakTur: { not: "acilis" } }, orderBy: { tarih: "asc" }, select: { tarih: true } });
      const hesaplanan = hesapEkstresiHesapla(devirGruplari.map((g) => ({ tip: g.tip, tutar: g._sum.tutar, tutarTry: g._sum.tutarTry })), hareketler.map((h) => ({
        id: h.id,
        tarih: h.tarih,
        tip: h.tip,
        tutar: h.tutar,
        kur: h.kur,
        tutarTry: h.tutarTry,
        kaynakTur: h.kaynakTur,
        makbuzNo: h.makbuzNo,
        aciklama: h.aciklama,
        cari: h.cari?.unvan ?? null,
        belge: h.fatura?.no ?? null,
        karsiHesap: h.karsiHareketId ? karsiAdi.get(h.karsiHareketId) ?? null : null,
      })));
      return {
        hesap: {
          tur, id: hesap.id, ad: hesap.ad, dovizCinsi: hesap.dovizCinsi, aktif: hesap.aktif,
          banka: banka && { bankaAdi: banka.bankaAdi, sube: banka.sube, hesapNo: banka.hesapNo, iban: banka.iban },
        },
        baslangic: baslangic ?? null,
        bitis: bitis ?? null,
        acilis,
        ilkHareketTarihi: ilkHareket?.tarih.toISOString().slice(0, 10) ?? null,
        ...hesaplanan,
      };
    });
  }

  async hesapEkstresiPdf(tur: HesapTuru, id: string, baslangic?: string, bitis?: string): Promise<{ buffer: Buffer; dosyaAdi: string }> {
    const { tenantId } = aktifBaglam();
    const [veri, firma, tema] = await Promise.all([
      this.hesapEkstresi(tur, id, baslangic, bitis),
      this.prisma.tenantIslem(tenantId, (tx) => tx.tenant.findUnique({
        where: { id: tenantId },
        select: { unvan: true, vkn: true, vergiDairesi: true, adres: true, ilce: true, il: true, postaKodu: true, telefon: true, eposta: true, webSitesi: true, mersisNo: true, ticaretSicilNo: true },
      })),
      this.pdf.belgeTemasi(),
    ]);
    if (!firma) throw new NotFoundException("Firma bulunamadı");
    const buffer = await this.pdf.htmlToPdf(hesapEkstresiPdfHtml(veri, firma, tema), { yatay: true, sayfaNumarasi: true });
    return { buffer, dosyaAdi: `hesap-ekstresi-${dosyaAdiParcasi(veri.hesap.ad)}.pdf` };
  }

  async hesapEkstresiExcel(tur: HesapTuru, id: string, baslangic?: string, bitis?: string): Promise<{ buffer: Buffer; dosyaAdi: string }> {
    const veri = await this.hesapEkstresi(tur, id, baslangic, bitis);
    return { buffer: await hesapEkstresiExcel(veri), dosyaAdi: `hesap-ekstresi-${dosyaAdiParcasi(veri.hesap.ad)}.xlsx` };
  }

  // ─── BAKİYE HESAPLAMA METOTLARI (PRIVATE) ──────────────────────────────────

  private async kasaBakiyeleri(kasaIdler: string[]): Promise<Map<string, KasaBankaBakiye>> {
    if (kasaIdler.length === 0) return new Map();
    const { tenantId } = aktifBaglam();

    const gruplar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasaBankaHareket.groupBy({
        by: ["kasaId", "tip"],
        where: { kasaId: { in: kasaIdler } },
        _sum: { tutar: true },
      }),
    );

    const sonuc = new Map<string, KasaBankaBakiye>();
    kasaIdler.forEach((id) => {
      sonuc.set(id, { borc: "0.00", alacak: "0.00", bakiye: "0.00" });
    });

    for (const g of gruplar) {
      if (!g.kasaId) continue;
      const mevcut = sonuc.get(g.kasaId) ?? { borc: "0.00", alacak: "0.00", bakiye: "0.00" };
      const tutarVal = D(g._sum.tutar ?? 0);

      // Kasa için:
      // borç (girişler): tahsilat, virman_gelis
      // alacak (çıkışlar): tediye, virman_gidis
      if (g.tip === "tahsilat" || g.tip === "virman_gelis") {
        mevcut.borc = D(mevcut.borc).add(tutarVal).toFixed(2);
      } else {
        mevcut.alacak = D(mevcut.alacak).add(tutarVal).toFixed(2);
      }
      mevcut.bakiye = D(mevcut.borc).sub(D(mevcut.alacak)).toFixed(2);
      sonuc.set(g.kasaId, mevcut);
    }

    return sonuc;
  }

  private async bankaBakiyeleri(hesapIdler: string[]): Promise<Map<string, KasaBankaBakiye>> {
    if (hesapIdler.length === 0) return new Map();
    const { tenantId } = aktifBaglam();

    const gruplar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasaBankaHareket.groupBy({
        by: ["bankaHesapId", "tip"],
        where: { bankaHesapId: { in: hesapIdler } },
        _sum: { tutar: true },
      }),
    );

    const sonuc = new Map<string, KasaBankaBakiye>();
    hesapIdler.forEach((id) => {
      sonuc.set(id, { borc: "0.00", alacak: "0.00", bakiye: "0.00" });
    });

    for (const g of gruplar) {
      if (!g.bankaHesapId) continue;
      const mevcut = sonuc.get(g.bankaHesapId) ?? { borc: "0.00", alacak: "0.00", bakiye: "0.00" };
      const tutarVal = D(g._sum.tutar ?? 0);

      if (g.tip === "tahsilat" || g.tip === "virman_gelis") {
        mevcut.borc = D(mevcut.borc).add(tutarVal).toFixed(2);
      } else {
        mevcut.alacak = D(mevcut.alacak).add(tutarVal).toFixed(2);
      }
      mevcut.bakiye = D(mevcut.borc).sub(D(mevcut.alacak)).toFixed(2);
      sonuc.set(g.bankaHesapId, mevcut);
    }

    return sonuc;
  }

  /** Yönüne göre bir çek/senetin alabileceği durumlar (KSB-05). */
  private static readonly ALINAN_DURUMLARI: CekSenetDurum[] = [
    "portfoyde",
    "tahsile_verildi",
    "teminata_verildi",
    "ciro_edildi",
    "tahsil_edildi",
    "karsiliksiz",
    "iade_edildi",
  ];
  private static readonly VERILEN_DURUMLARI: CekSenetDurum[] = [
    "verildi",
    "odendi",
    "karsiliksiz",
    "iade_edildi",
  ];

  /**
   * Alınan bir çek "ödendi", verilen bir çek "tahsil edildi" olamaz; aksi
   * hâlde para ters yöne akar (alınana tediye, verilene tahsilat fişi).
   */
  private cekSenetDurumunuDenetle(yon: CekSenetYon, durum: CekSenetDurum): void {
    const izinli =
      yon === "verilen"
        ? KasaBankaService.VERILEN_DURUMLARI
        : KasaBankaService.ALINAN_DURUMLARI;
    if (!izinli.includes(durum)) {
      throw new BadRequestException(
        `'${durum}' durumu ${yon === "verilen" ? "verilen" : "alınan"} çek/senet için geçersiz`,
      );
    }
  }

  /**
   * Tahsil/ödeme hesabının var olduğunu ve para biriminin çek/senetle
   * uyuştuğunu doğrular; uyuşmazsa hesabın bakiyesi karışık para birimine
   * düşerdi.
   */
  private async islemHesabiniDenetle(
    girdi: z.infer<typeof cekSenetGuncelleSemasi>,
    cekDovizCinsi: DovizCinsi,
  ): Promise<void> {
    const { tenantId } = aktifBaglam();

    const hesapDovizi = girdi.hesapKasaId
      ? (
          await this.prisma.tenantIslem(tenantId, (tx) =>
            tx.kasa.findUnique({ where: { id: girdi.hesapKasaId! } }),
          )
        )?.dovizCinsi
      : (
          await this.prisma.tenantIslem(tenantId, (tx) =>
            tx.bankaHesap.findUnique({ where: { id: girdi.hesapBankaHesapId! } }),
          )
        )?.dovizCinsi;

    if (!hesapDovizi) {
      throw new BadRequestException("Seçilen kasa/banka hesabı bulunamadı");
    }
    if (hesapDovizi !== cekDovizCinsi) {
      throw new BadRequestException(
        `Çek/senet ${cekDovizCinsi} cinsinden; ${hesapDovizi} hesabıyla işlem yapılamaz`,
      );
    }
  }

  async virmanKurallariniDenetle(girdi: z.infer<typeof virmanOlusturSemasi>): Promise<DovizCinsi> {
    const { tenantId } = aktifBaglam();

    let kaynakDoviz: DovizCinsi | undefined;
    let hedefDoviz: DovizCinsi | undefined;

    if (girdi.kaynakKasaId) {
      const k = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.kasa.findUnique({ where: { id: girdi.kaynakKasaId! } }),
      );
      kaynakDoviz = k?.aktif ? k.dovizCinsi : undefined;
    } else if (girdi.kaynakBankaHesapId) {
      const b = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.bankaHesap.findUnique({ where: { id: girdi.kaynakBankaHesapId! } }),
      );
      kaynakDoviz = b?.aktif ? b.dovizCinsi : undefined;
    } else {
      const p = await this.prisma.tenantIslem(tenantId, (tx) => tx.posHesap.findUnique({ where: { id: girdi.kaynakPosHesapId! } })); kaynakDoviz = p?.aktif ? p.dovizCinsi : undefined;
    }

    if (girdi.hedefKasaId) {
      const k = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.kasa.findUnique({ where: { id: girdi.hedefKasaId! } }),
      );
      hedefDoviz = k?.aktif ? k.dovizCinsi : undefined;
    } else if (girdi.hedefBankaHesapId) {
      const b = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.bankaHesap.findUnique({ where: { id: girdi.hedefBankaHesapId! } }),
      );
      hedefDoviz = b?.aktif ? b.dovizCinsi : undefined;
    } else {
      const p = await this.prisma.tenantIslem(tenantId, (tx) => tx.posHesap.findUnique({ where: { id: girdi.hedefPosHesapId! } })); hedefDoviz = p?.aktif ? p.dovizCinsi : undefined;
    }

    if (!kaynakDoviz || !hedefDoviz) {
      throw new BadRequestException("Kaynak veya Hedef hesap bulunamadı");
    }

    if (kaynakDoviz !== hedefDoviz) {
      throw new BadRequestException("Farklı döviz cinsleri arasında virman yapılamaz");
    }

    const kaynak = girdi.kaynakKasaId ? `kasa:${girdi.kaynakKasaId}` : girdi.kaynakBankaHesapId ? `banka:${girdi.kaynakBankaHesapId}` : `pos:${girdi.kaynakPosHesapId}`;
    const hedef = girdi.hedefKasaId ? `kasa:${girdi.hedefKasaId}` : girdi.hedefBankaHesapId ? `banka:${girdi.hedefBankaHesapId}` : `pos:${girdi.hedefPosHesapId}`;
    if (kaynak === hedef) throw new BadRequestException("Kaynak ve hedef hesap aynı olamaz");

    return kaynakDoviz;
  }

  private eylemler(
    varlik: "kasa" | "banka",
    kayit: { aktif: boolean },
    _rol: string,
    hareketSayisi: number,
  ): KayitEylem[] {
    return izinliEylemler(
      varlik,
      { aktif: kayit.aktif, hareketSayisi },
      aktifBaglam(),
    );
  }
}
