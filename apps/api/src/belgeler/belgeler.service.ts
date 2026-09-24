import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { BelgeTur, Prisma, ZincirBelgeDurum } from "@prisma/client";
import {
  faturaHesapla,
  idisNormalize,
  bugunTR,
  faturaGecikmeUyarilari,
  IRSALIYE_FATURA_GUN_SAYISI,
  IRSALIYE_FATURA_TIPI,
  irsaliyeFaturaFarklari,
  irsaliyeFaturaSuresi,
  irsaliyeSevkGunu,
  irsaliyeFaturaTipiUyarMi,
  irsaliyeKanali,
  type FaturaHesaplaSatirGirdi,
  type KayitEylem,
} from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { izinliEylemler, eylemIzinli } from "../core/eylemler/eylem-kayit";
import { PdfService } from "../core/pdf/pdf.service";
import { metinNormalize } from "@tekirextra/shared";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { PrismaService } from "../core/prisma.service";
import { DepoService } from "../stok/depo.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { belgePdfHtml } from "./belge-pdf";
import { durumGecmisiOku } from "../core/durum-gecmisi";
import { ebelgeUygulamalariniOku } from "../ebelge/ebelge-uygulamalari.service";
import { belgeSirasiAl } from "./belge-sayac";
import type {
  belgeGuncelleSemasi,
  belgeOlusturSemasi,
  tasimaBilgisiSemasi,
  tedarikciBelgeNoSemasi,
  matbuBelgeNoSemasi,
  topluFaturaSemasi,
} from "./belgeler.semalar";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal =>
  new Prisma.Decimal(deger);

/** Belge zinciri (FTR-12): teklif → sipariş → irsaliye → fatura. */

const NO_ONEKLERI: Record<BelgeTur, string> = {
  teklif: "TKF",
  siparis: "SIP",
  irsaliye: "IRS",
};

/** FTR-27: alış irsaliyesinin iç serisi; giden e-İrsaliye serisiyle karışmaz. */
const ALIS_IRSALIYE_ONEKI = "AIR";
/** EBLG-83: kâğıt (matbu) satış irsaliyesinin iç serisi. */
const KAGIT_IRSALIYE_ONEKI = "KIR";

/** FTR-27: tedarikçinin irsaliye numarası yalnız alış irsaliyesinde tutulur. */
function tedarikciBelgeNoYaz(tur: string, yon: string, deger: string | null | undefined): string | null {
  return tur === "irsaliye" && yon === "alis" ? deger?.trim() || null : null;
}

/** Geçerli dönüşüm hedefleri (FTR-12 zinciri; sipariş faturaya atlayabilir). */
const DONUSUM_HEDEFLERI: Record<BelgeTur, ("siparis" | "irsaliye" | "fatura")[]> = {
  teklif: ["siparis"],
  siparis: ["irsaliye", "fatura"],
  irsaliye: ["fatura"],
};

type BelgeSatirKaydi = {
  stokId: string;
  varyantId?: string | null;
  partiBilgileri?: Prisma.JsonValue | null;
  miktar: Prisma.Decimal;
  birim: string;
  birimFiyat: Prisma.Decimal;
  iskontoOrani: Prisma.Decimal;
  iskontoTutari: Prisma.Decimal;
  genelIskontoPayi: Prisma.Decimal;
  matrah: Prisma.Decimal;
  kdvOrani: Prisma.Decimal;
  kdvTutari: Prisma.Decimal;
  tevkifatPay: number | null;
  tevkifatPayda: number | null;
  tevkifatTutari: Prisma.Decimal;
  netKdvTutari: Prisma.Decimal;
  toplamTutar: Prisma.Decimal;
  /** EBLG-72: irsaliyedeki etiket numarası faturaya da taşınır. */
  idisEtiketNo?: string | null;
};

@Injectable()
export class BelgelerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly depoService: DepoService,
    private readonly donemKilidi: DonemKilidiService,
    private readonly ayarlar?: AyarlarService,
  ) {}

  // ─── FATURALAMA SÜRESİ (EBLG-82) ──────────────────────────────────────────

  /** İrsaliyenin kaç gün içinde faturalanacağı; ayar yoksa 7 (VUK 231/5). */
  async irsaliyeFaturaGunSayisi(tx?: Prisma.TransactionClient): Promise<number> {
    const ayar = this.ayarlar ? await this.ayarlar.getir("ebelge", tx) : {};
    const gun = Number(ayar.irsaliyeFaturaGunSayisi);
    return Number.isInteger(gun) && gun > 0 ? gun : IRSALIYE_FATURA_GUN_SAYISI;
  }

  /**
   * Faturalanmayı bekleyen irsaliyenin süresi; bekleyen değilse null. Kesin
   * faturaya bağlı irsaliye faturalanmıştır. Taslak (ya da iptal edilmiş)
   * faturaya bağlı olan hâlâ bekler: yasal süre düzenlenmiş faturaya bakar.
   */
  private faturalamaSuresi(
    k: { tur: string; durum: string; tarih: Date; fiiliSevkZamani?: Date | null; fatura?: { durum: string } | null },
    gunSayisi: number,
    bugun: string,
  ) {
    if (k.tur !== "irsaliye" || !["onaylandi", "kapandi"].includes(k.durum)) return null;
    if (k.fatura?.durum === "kesin") return null;
    return irsaliyeFaturaSuresi({ sevkGunu: irsaliyeSevkGunu(k), bugun, gunSayisi });
  }

  /**
   * EBLG-76: "fatura sevkten önce düzenlendi" denmiş, gönderilmiş faturalar.
   * İrsaliye formunda bunlardan biri seçilir ve e-İrsaliyeye fatura referansı
   * olarak yazılır.
   */
  async sevkiyatBekleyenFaturalar(cariId?: string) {
    if (!cariId) return [];
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findMany({
      where: { tenantId, cariId, tip: "satis", durum: "kesin", sevkiyatYontemi: "fatura_once", ebelge: { is: { durum: { in: ["iletildi", "kabul"] } } } },
      orderBy: { tarih: "desc" }, take: 50, select: { id: true, no: true, tarih: true },
    }));
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async listele(
    tur?: string,
    yon?: string,
    durum?: string,
    arama?: string,
    baslangic?: string,
    bitis?: string,
    imlec?: string,
    adet = 50,
    /** EBLG-82: yalnız faturalanmayı bekleyen irsaliyeler. */
    faturaBekleyen = false,
  ) {
    const ctx = aktifBaglam();
    const baslangicTarihi = baslangic ? new Date(baslangic) : null;
    const bitisTarihi = bitis ? new Date(bitis) : null;
    if (baslangicTarihi && Number.isNaN(baslangicTarihi.getTime())) throw new BadRequestException("Başlangıç tarihi geçersiz");
    if (bitisTarihi && Number.isNaN(bitisTarihi.getTime())) throw new BadRequestException("Bitiş tarihi geçersiz");
    if (baslangicTarihi && bitisTarihi && baslangicTarihi > bitisTarihi) throw new BadRequestException("Başlangıç tarihi bitiş tarihinden sonra olamaz");
    const where: Prisma.BelgeWhereInput = {
      ...(tur ? { tur: tur as BelgeTur } : {}),
      ...(yon ? { yon: yon as "satis" | "alis" } : {}),
      // SAT-10: virgülle birden çok durum verilebilir ("onaylandi,kismen_kapandi")
      ...(durum
        ? (() => {
            const durumlar = durum.split(",").map((d) => d.trim()).filter(Boolean) as ZincirBelgeDurum[];
            return durumlar.length > 1 ? { durum: { in: durumlar } } : { durum: durumlar[0] };
          })()
        : {}),
      ...(baslangicTarihi || bitisTarihi ? { tarih: { ...(baslangicTarihi ? { gte: baslangicTarihi } : {}), ...(bitisTarihi ? { lte: bitisTarihi } : {}) } } : {}),
      ...(faturaBekleyen
        ? {
            tur: "irsaliye" as BelgeTur,
            durum: { in: ["onaylandi", "kapandi"] as ZincirBelgeDurum[] },
            AND: [{ OR: [{ faturaId: null }, { fatura: { is: { durum: { not: "kesin" } } } }] }],
          }
        : {}),
      ...(arama
        ? {
            OR: [
              { no: { contains: arama, mode: "insensitive" } },
              // FTR-27: alış irsaliyesi tedarikçinin numarasıyla da bulunur.
              { tedarikciBelgeNo: { contains: arama, mode: "insensitive" } },
              { matbuBelgeNo: { contains: arama, mode: "insensitive" } },
              // ARA-01: cari tarafı aksansız `arama_normal` kolonundan aranır.
              { cari: { aramaNormal: { contains: metinNormalize(arama) } } },
            ],
          }
        : {}),
    };
    const kayitlar = await this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.belge.findMany({
        where,
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: adet + 1,
        ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
        include: { cari: { select: { id: true, kod: true, unvan: true } }, fatura: { select: { durum: true } } },
      }),
    );
    const sonrakiImlec = kayitlar.length > adet ? kayitlar[adet - 1].id : null;
    const gunSayisi = kayitlar.some((k) => k.tur === "irsaliye") ? await this.irsaliyeFaturaGunSayisi() : IRSALIYE_FATURA_GUN_SAYISI;
    const bugun = bugunTR();
    return {
      kayitlar: kayitlar.slice(0, adet).map((k) => ({
        ...this.gorunum(k),
        cari: k.cari,
        faturalamaSuresi: this.faturalamaSuresi(k, gunSayisi, bugun),
        izinliEylemler: this.eylemler(k),
      })),
      sonrakiImlec,
    };
  }

  /** EBLG-35: belgenin e-İrsaliye durum geçmişi ve bağlı faturanın geçmişi. */
  async durumGecmisi(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({ where: { id }, select: { faturaId: true } });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      return durumGecmisiOku(tx, { OR: [{ belgeId: id }, ...(belge.faturaId ? [{ faturaId: belge.faturaId }] : [])] });
    });
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.belge.findUnique({
        where: { id },
        include: {
          cari: { select: { id: true, kod: true, unvan: true, vknTckn: true } },
          satirlar: { include: { stok: { select: { id: true, kod: true, ad: true } }, varyant: { select: { id: true, kod: true, ad: true, nitelikler: true } } } },
          kaynakBelge: { select: {
            id: true, tur: true, no: true, durum: true,
            kaynakBelge: { select: { id: true, tur: true, no: true, durum: true } },
          } },
          turetilenler: { select: {
            id: true, tur: true, no: true, durum: true, tarih: true,
            satirlar: { select: { kaynakSatirId: true, miktar: true, birim: true, stok: { select: { kod: true, ad: true } } } },
            turetilenler: { select: { id: true, tur: true, no: true, durum: true } },
          } },
          fatura: {
            select: {
              id: true, no: true, durum: true, genelToplam: true,
              ebelge: { select: { tur: true, durum: true } },
              kasaBankaHarekets: { select: { tutar: true } },
            },
          },
          eirsaliye: { select: { durum: true, entegratorRef: true, hataMesaji: true, aliciKayitsiz: true } },
        },
      }),
    );
    if (!kayit) throw new NotFoundException("Belge bulunamadı");
    const faturalamaSuresi = kayit.tur === "irsaliye" ? this.faturalamaSuresi(kayit, await this.irsaliyeFaturaGunSayisi(), bugunTR()) : null;
    const zincirBelgeleri = new Map<string, { id: string; tur: BelgeTur; no: string | null; durum: ZincirBelgeDurum }>();
    const zincireEkle = (belge: { id: string; tur: BelgeTur; no: string | null; durum: ZincirBelgeDurum } | null | undefined) => {
      if (belge) zincirBelgeleri.set(belge.id, { id: belge.id, tur: belge.tur, no: belge.no, durum: belge.durum });
    };
    zincireEkle(kayit.kaynakBelge?.kaynakBelge);
    zincireEkle(kayit.kaynakBelge);
    zincireEkle(kayit);
    for (const turetilen of kayit.turetilenler) {
      zincireEkle(turetilen);
      for (const altBelge of turetilen.turetilenler) zincireEkle(altBelge);
    }
    return {
      ...this.gorunum(kayit),
      cari: kayit.cari,
      satirlar: kayit.satirlar.map((s) => ({
        id: s.id,
        stokId: s.stokId,
        varyantId: s.varyantId,
        varyant: s.varyant,
        partiBilgileri: s.partiBilgileri,
        stokKod: s.stok.kod,
        stokAd: s.stok.ad,
        miktar: s.miktar.toFixed(3),
        // SAT-09: siparişte ne kadarı teslim edildi, ne kadarı bekliyor
        teslimEdilenMiktar: s.teslimEdilenMiktar.toFixed(3),
        kalanMiktar: s.miktar.sub(s.teslimEdilenMiktar).toFixed(3),
        birim: s.birim,
        birimFiyat: s.birimFiyat.toFixed(4),
        iskontoOrani: s.iskontoOrani.toFixed(2),
        matrah: s.matrah.toFixed(2),
        kdvOrani: s.kdvOrani.toFixed(2),
        kdvTutari: s.kdvTutari.toFixed(2),
        toplamTutar: s.toplamTutar.toFixed(2),
        idisEtiketNo: s.idisEtiketNo,
      })),
      // SAT-10: siparişin teslim geçmişi — hangi irsaliye, ne zaman, ne kadar.
      // İptal edilen irsaliye teslim sayılmaz, listede de yer almaz.
      teslimatlar:
        kayit.tur === "siparis"
          ? kayit.turetilenler
              .filter((t) => t.tur === "irsaliye" && t.durum !== "iptal")
              .map((t) => ({
                id: t.id,
                no: t.no,
                durum: t.durum,
                tarih: t.tarih.toISOString().slice(0, 10),
                kalemler: t.satirlar.map((s) => ({
                  satirId: s.kaynakSatirId,
                  stokKod: s.stok.kod,
                  stokAd: s.stok.ad,
                  miktar: s.miktar.toFixed(3),
                  birim: s.birim,
                })),
              }))
          : [],
      // Zincir izleme (FTR-12): tüm teklif, sipariş ve irsaliye halkaları
      zincirBelgeleri: [...zincirBelgeleri.values()],
      kaynakBelge: kayit.kaynakBelge,
      turetilenler: kayit.turetilenler,
      fatura: kayit.fatura ? (() => {
        const odenen = kayit.fatura.kasaBankaHarekets.reduce((toplam, hareket) => toplam.add(hareket.tutar), D(0));
        const kalan = Prisma.Decimal.max(kayit.fatura.genelToplam.sub(odenen), 0);
        return {
          id: kayit.fatura.id,
          no: kayit.fatura.no,
          durum: kayit.fatura.durum,
          ebelge: kayit.fatura.ebelge,
          odemeOzeti: {
            durum: kayit.fatura.durum !== "kesin" ? "beklemede" : kalan.isZero() ? "odendi" : odenen.greaterThan(0) ? "kismi" : "odenmedi",
            odenen: odenen.toFixed(2),
            kalan: kalan.toFixed(2),
          },
        };
      })() : null,
      eirsaliye: kayit.eirsaliye,
      faturalamaSuresi,
      izinliEylemler: this.eylemler(kayit),
    };
  }

  /** Taşıma alanları yalnız irsaliyede anlamlıdır; başka türde yazılmaz. */
  private tasimaAlanlari(girdi: { tur?: string; fiiliSevkZamani?: string | null; tasiyiciCariId?: string | null; plaka?: string | null; dorsePlaka?: string | null; soforAdi?: string | null; soforSoyadi?: string | null; soforTckn?: string | null; idisSevkiyatNo?: string | null; teslimatAdres?: string | null; teslimatIl?: string | null; teslimatIlce?: string | null; teslimatPostaKodu?: string | null }) {
    if (girdi.tur !== "irsaliye") return {};
    return {
      fiiliSevkZamani: girdi.fiiliSevkZamani ? new Date(girdi.fiiliSevkZamani) : null,
      // EBLG-72: Darphane bildiriminden dönen sevkiyat numarası.
      idisSevkiyatNo: girdi.idisSevkiyatNo ? idisNormalize(girdi.idisSevkiyatNo) : null,
      tasiyiciCariId: girdi.tasiyiciCariId ?? null,
      plaka: girdi.plaka ?? null,
      dorsePlaka: girdi.dorsePlaka ?? null,
      soforAdi: girdi.soforAdi ?? null,
      soforSoyadi: girdi.soforSoyadi ?? null,
      soforTckn: girdi.soforTckn ?? null,
      // EBLG-84: irsaliyeye özel teslimat adresi (ihracatta gümrük kapısı).
      teslimatAdres: girdi.teslimatAdres?.trim() || null,
      teslimatIl: girdi.teslimatIl?.trim() || null,
      teslimatIlce: girdi.teslimatIlce?.trim() || null,
      teslimatPostaKodu: girdi.teslimatPostaKodu?.trim() || null,
    };
  }

  async olustur(girdi: z.infer<typeof belgeOlusturSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "belge oluşturma");

    // FTR-14: satıcı kullanıcı bazında maksimum iskonto yetkisi kontrolü
    const user = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (user && user.maksIskontoYuzdesi !== null) {
      const maks = Number(user.maksIskontoYuzdesi);
      if (Number(girdi.genelIskontoYuzdesi ?? 0) > maks) {
        throw new BadRequestException(
          `Maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
        );
      }
      for (const [index, s] of girdi.satirlar.entries()) {
        if (Number(s.iskontoOrani ?? 0) > maks) {
          throw new BadRequestException(
            `Satır ${index + 1} için maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
          );
        }
      }
    }

    const hesap = this.hesapla(girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (girdi.faturaId) {
        if (girdi.tur !== "irsaliye" || girdi.yon !== "satis") throw new BadRequestException("Fatura bağlantısı yalnız satış irsaliyesinde kullanılabilir");
        const fatura = await tx.fatura.findUnique({ where: { id: girdi.faturaId }, select: { tenantId: true, cariId: true, tip: true, durum: true, sevkiyatYontemi: true, no: true, ebelge: { select: { durum: true } } } });
        if (!fatura || fatura.tenantId !== tenantId || fatura.cariId !== girdi.cariId || fatura.tip !== "satis" || fatura.durum !== "kesin" || fatura.sevkiyatYontemi !== "fatura_once" || !fatura.no || !fatura.ebelge || !["iletildi", "kabul"].includes(fatura.ebelge.durum)) throw new BadRequestException("Seçilen fatura bu müşteri için sevkten önce düzenlenmiş, gönderilmiş bir e-Belge olmalıdır");
      }
      const belge = await tx.belge.create({
        data: {
          tenantId,
          tur: girdi.tur,
          yon: girdi.yon,
          tarih: new Date(girdi.tarih),
          gecerlilikTarihi:
            girdi.tur === "teklif" && girdi.gecerlilikTarihi
              ? new Date(girdi.gecerlilikTarihi)
              : null,
          cariId: girdi.cariId,
          faturaId: girdi.faturaId ?? null,
          // EBLG-74: müşterinin sipariş referansı; e-İrsaliyeye OrderReference olur.
          siparisNo: girdi.siparisNo?.trim() || null,
          siparisTarihi: girdi.siparisTarihi ? new Date(girdi.siparisTarihi) : null,
          tedarikciBelgeNo: tedarikciBelgeNoYaz(girdi.tur, girdi.yon, girdi.tedarikciBelgeNo),
          depoId: girdi.depoId ?? null,
          dovizCinsi: girdi.dovizCinsi,
          kur: D(girdi.kur),
          genelIskontoYuzdesi: D(girdi.genelIskontoYuzdesi),
          genelIskontoTutari: D(girdi.genelIskontoTutari),
          ...this.toplamAlanlari(hesap),
          aciklama: girdi.aciklama,
          notlar: girdi.notlar,
          ...this.tasimaAlanlari(girdi),
        },
      });
      await this.satirlariYaz(tx, belge.id, hesap.satirlar, girdi.satirlar);
      return this.gorunum(belge);
    });
  }

  /**
   * Taşıma bilgilerini onaylanmış irsaliyede de günceller (EBLG-23). Şoför,
   * plaka ve fiili sevk zamanı çoğu zaman onaydan sonra, mal yüklenirken
   * belli oluyor; belgenin ticari içeriği kilitli kaldığı için bunu açmak
   * onay kilidini zayıflatmaz. e-İrsaliye gönderildikten sonra kapanır.
   */
  async tasimaBilgisiGuncelle(id: string, girdi: z.infer<typeof tasimaBilgisiSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({ where: { id }, include: { eirsaliye: true } });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      if (belge.tur !== "irsaliye") throw new BadRequestException("Taşıma bilgisi yalnızca irsaliyede tutulur");
      if (belge.durum === "iptal") throw new BadRequestException("İptal edilmiş belgenin taşıma bilgisi değiştirilemez");
      if (belge.eirsaliye && belge.eirsaliye.durum !== "hata") {
        throw new BadRequestException("e-İrsaliye gönderilmiş belgenin taşıma bilgisi değiştirilemez");
      }
      const guncel = await tx.belge.update({
        where: { id },
        data: this.tasimaAlanlari({ ...girdi, tur: "irsaliye" }),
      });
      return this.gorunum(guncel);
    });
  }
  /**
   * FTR-27: alış irsaliyesinde tedarikçinin numarası onaylı ya da faturalanmış
   * belgede de düzeltilir; belgenin ticari içeriğine dokunmaz.
   */
  async tedarikciBelgeNoGuncelle(id: string, girdi: z.infer<typeof tedarikciBelgeNoSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({ where: { id }, select: { tur: true, yon: true, durum: true } });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      if (belge.tur !== "irsaliye" || belge.yon !== "alis") throw new BadRequestException("Tedarikçi irsaliye numarası yalnızca alış irsaliyesinde tutulur");
      if (belge.durum === "iptal") throw new BadRequestException("İptal edilmiş belgenin tedarikçi numarası değiştirilemez");
      const guncel = await tx.belge.update({
        where: { id },
        data: { tedarikciBelgeNo: tedarikciBelgeNoYaz(belge.tur, belge.yon, girdi.tedarikciBelgeNo) },
      });
      return this.gorunum(guncel);
    });
  }
  /** EBLG-83: kâğıt irsaliyenin matbu numarası; ticari içeriğe dokunmaz. */
  async matbuBelgeNoGuncelle(id: string, girdi: z.infer<typeof matbuBelgeNoSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({ where: { id }, select: { kagitIrsaliye: true, durum: true } });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      if (!belge.kagitIrsaliye) throw new BadRequestException("Matbu numara yalnızca kâğıt irsaliyede tutulur");
      if (belge.durum === "iptal") throw new BadRequestException("İptal edilmiş belgenin matbu numarası değiştirilemez");
      const guncel = await tx.belge.update({ where: { id }, data: { matbuBelgeNo: girdi.matbuBelgeNo?.trim() || null } });
      return this.gorunum(guncel);
    });
  }



  async guncelle(id: string, girdi: z.infer<typeof belgeGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    const mevcut = await this.getir(id);
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih ?? mevcut.tarih, "belge güncelleme");
    if (mevcut.durum !== "taslak") {
      throw new BadRequestException("Yalnızca taslak belgeler güncellenebilir");
    }
    const birlesik = {
      tarih: girdi.tarih ?? mevcut.tarih,
      gecerlilikTarihi: girdi.gecerlilikTarihi ?? mevcut.gecerlilikTarihi,
      cariId: girdi.cariId ?? mevcut.cariId,
      depoId: girdi.depoId !== undefined ? girdi.depoId : mevcut.depoId,
      dovizCinsi: girdi.dovizCinsi ?? (mevcut.dovizCinsi as "TRY" | "USD" | "EUR"),
      kur: girdi.kur ?? mevcut.kur,
      genelIskontoYuzdesi: girdi.genelIskontoYuzdesi ?? mevcut.genelIskontoYuzdesi,
      genelIskontoTutari: girdi.genelIskontoTutari ?? mevcut.genelIskontoTutari,
      aciklama: girdi.aciklama ?? mevcut.aciklama,
      notlar: girdi.notlar ?? mevcut.notlar,
      fiiliSevkZamani: girdi.fiiliSevkZamani !== undefined ? girdi.fiiliSevkZamani : mevcut.fiiliSevkZamani,
      tasiyiciCariId: girdi.tasiyiciCariId !== undefined ? girdi.tasiyiciCariId : mevcut.tasiyiciCariId,
      plaka: girdi.plaka !== undefined ? girdi.plaka : mevcut.plaka,
      dorsePlaka: girdi.dorsePlaka !== undefined ? girdi.dorsePlaka : mevcut.dorsePlaka,
      soforAdi: girdi.soforAdi !== undefined ? girdi.soforAdi : mevcut.soforAdi,
      soforSoyadi: girdi.soforSoyadi !== undefined ? girdi.soforSoyadi : mevcut.soforSoyadi,
      soforTckn: girdi.soforTckn !== undefined ? girdi.soforTckn : mevcut.soforTckn,
      siparisNo: girdi.siparisNo !== undefined ? girdi.siparisNo : mevcut.siparisNo,
      siparisTarihi: girdi.siparisTarihi !== undefined ? girdi.siparisTarihi : mevcut.siparisTarihi,
      tedarikciBelgeNo: girdi.tedarikciBelgeNo !== undefined ? girdi.tedarikciBelgeNo : mevcut.tedarikciBelgeNo,
      idisSevkiyatNo: girdi.idisSevkiyatNo !== undefined ? girdi.idisSevkiyatNo : mevcut.idisSevkiyatNo,
      satirlar:
        girdi.satirlar ??
        mevcut.satirlar.map((s) => ({
          stokId: s.stokId,
          varyantId: s.varyantId,
          partiBilgileri: s.partiBilgileri as z.infer<typeof belgeOlusturSemasi>["satirlar"][number]["partiBilgileri"],
          miktar: s.miktar,
          birim: s.birim,
          birimFiyat: s.birimFiyat,
          iskontoOrani: s.iskontoOrani,
          kdvOrani: s.kdvOrani,
          tevkifatPay: null,
          tevkifatPayda: null,
          idisEtiketNo: s.idisEtiketNo,
        })),
    };

    // FTR-14: satıcı kullanıcı bazında maksimum iskonto yetkisi kontrolü
    const { userId } = aktifBaglam();
    const user = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (user && user.maksIskontoYuzdesi !== null) {
      const maks = Number(user.maksIskontoYuzdesi);
      if (Number(birlesik.genelIskontoYuzdesi ?? 0) > maks) {
        throw new BadRequestException(
          `Maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
        );
      }
      for (const [index, s] of birlesik.satirlar.entries()) {
        if (Number(s.iskontoOrani ?? 0) > maks) {
          throw new BadRequestException(
            `Satır ${index + 1} için maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
          );
        }
      }
    }

    const hesap = this.hesapla(birlesik);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.belgeSatir.deleteMany({ where: { belgeId: id } });
      await this.satirlariYaz(tx, id, hesap.satirlar, birlesik.satirlar);
      const belge = await tx.belge.update({
        where: { id },
        data: {
          tarih: new Date(birlesik.tarih),
          gecerlilikTarihi: birlesik.gecerlilikTarihi
            ? new Date(birlesik.gecerlilikTarihi)
            : null,
          cariId: birlesik.cariId,
          siparisNo: birlesik.siparisNo?.trim() || null,
          siparisTarihi: birlesik.siparisTarihi ? new Date(birlesik.siparisTarihi) : null,
          tedarikciBelgeNo: tedarikciBelgeNoYaz(mevcut.tur, mevcut.yon, birlesik.tedarikciBelgeNo),
          depoId: birlesik.depoId ?? null,
          dovizCinsi: birlesik.dovizCinsi,
          kur: D(birlesik.kur),
          genelIskontoYuzdesi: D(birlesik.genelIskontoYuzdesi),
          genelIskontoTutari: D(birlesik.genelIskontoTutari),
          ...this.toplamAlanlari(hesap),
          aciklama: birlesik.aciklama,
          notlar: birlesik.notlar,
        },
      });
      return this.gorunum(belge);
    });
  }

  async sil(id: string): Promise<void> {
    const { tenantId } = aktifBaglam();
    const belge = await this.getir(id);
    if (belge.durum !== "taslak") {
      throw new BadRequestException("Yalnızca taslak belgeler silinebilir");
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.belge.delete({ where: { id } }),
    );
  }

  async kopyala(id: string) {
    const { tenantId } = aktifBaglam();
    const belge = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.belge.findUnique({
        where: { id },
        include: { satirlar: true },
      }),
    );

    if (!belge) throw new NotFoundException("Belge bulunamadı");

    const ctx = aktifBaglam();
    if (!eylemIzinli("belge", "kopyala", { durum: belge.durum }, ctx)) {
      throw new ForbiddenException("Bu belge kopyalanamaz veya bu işlem için yetkiniz yok");
    }

    const yeni = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kopya = await tx.belge.create({
        data: {
          tenantId,
          tur: belge.tur,
          yon: belge.yon,
          durum: "taslak",
          no: null,
          tarih: new Date(),
          gecerlilikTarihi: null,
          cariId: belge.cariId,
          depoId: belge.depoId,
          dovizCinsi: belge.dovizCinsi,
          kur: belge.kur,
          genelIskontoYuzdesi: belge.genelIskontoYuzdesi,
          genelIskontoTutari: belge.genelIskontoTutari,
          toplamBrut: belge.toplamBrut,
          toplamSatirIskontosu: belge.toplamSatirIskontosu,
          genelIskontoToplam: belge.genelIskontoToplam,
          toplamMatrah: belge.toplamMatrah,
          toplamKdv: belge.toplamKdv,
          toplamTevkifat: belge.toplamTevkifat,
          toplamNetKdv: belge.toplamNetKdv,
          genelToplam: belge.genelToplam,
          aciklama: belge.aciklama ? `${belge.aciklama} (Kopya)` : "Kopya",
          notlar: belge.notlar,
          kaynakBelgeId: null,
          faturaId: null,
        },
      });

      for (const s of belge.satirlar) {
        await tx.belgeSatir.create({
          data: {
            tenantId,
            belgeId: kopya.id,
            stokId: s.stokId,
            varyantId: s.varyantId,
            partiBilgileri: s.partiBilgileri ?? Prisma.JsonNull,
            miktar: s.miktar,
            birim: s.birim,
            birimFiyat: s.birimFiyat,
            iskontoOrani: s.iskontoOrani,
            iskontoTutari: s.iskontoTutari,
            genelIskontoPayi: s.genelIskontoPayi,
            matrah: s.matrah,
            kdvOrani: s.kdvOrani,
            kdvTutari: s.kdvTutari,
            tevkifatPay: s.tevkifatPay,
            tevkifatPayda: s.tevkifatPayda,
            tevkifatTutari: s.tevkifatTutari,
            netKdvTutari: s.netKdvTutari,
            toplamTutar: s.toplamTutar,
          },
        });
      }

      return kopya;
    });

    return this.getir(yeni.id);
  }

  // ─── ONAY / İPTAL (rezervasyon ve yoldaki stok burada) ───────────────────

  async onayla(id: string) {
    const { tenantId } = aktifBaglam();
    const tarih = await this.prisma.tenantIslem(tenantId, (tx) => tx.belge.findUnique({ where: { id }, select: { tarih: true } }));
    if (!tarih) throw new NotFoundException("Belge bulunamadı");
    await this.donemKilidi.tarihDogrula(tenantId, tarih.tarih, "belge onaylama");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({
        where: { id },
        include: { satirlar: true },
      });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      if (belge.durum !== "taslak") {
        throw new BadRequestException("Yalnızca taslak belgeler onaylanabilir");
      }

      const yil = belge.tarih.getFullYear();
      const irsaliye = belge.tur === "irsaliye";
      // EBLG-83: satış irsaliyesinin kanalı onayda belirlenir. e-İrsaliye
      // numarası gönderimde verilir — hiç gönderilmeyen irsaliye giden seride
      // boşluk bırakmasın. Kâğıt irsaliye kendi serisinden numaralanır.
      let kagitIrsaliye = false;
      let no: string | null;
      if (irsaliye && belge.yon === "satis") {
        const karar = irsaliyeKanali((await ebelgeUygulamalariniOku(tx, tenantId)).eirsaliye.acik);
        if ("hata" in karar) throw new BadRequestException(karar.hata);
        kagitIrsaliye = karar.kanal === "kagit";
        no = kagitIrsaliye
          ? `${KAGIT_IRSALIYE_ONEKI}${yil}${String(await belgeSirasiAl(tx, { tenantId, tur: "irsaliye", yon: "satis", seri: KAGIT_IRSALIYE_ONEKI, yil })).padStart(6, "0")}`
          : null;
      } else {
        // FTR-27: alış irsaliyesi giden seriyi tüketmez; kendi sayacı var.
        // Teklif, sipariş ve alış irsaliyesi dışarı çıkmayan iç belgelerdir.
        const sira = await belgeSirasiAl(tx, { tenantId, tur: belge.tur, yon: irsaliye ? belge.yon : "satis", yil });
        no = `${irsaliye ? ALIS_IRSALIYE_ONEKI : NO_ONEKLERI[belge.tur]}${yil}${String(sira).padStart(6, "0")}`;
      }

      // Otomatik rezervasyon (S-01): satış siparişi rezerv, alış yoldaki üretir
      if (belge.tur === "siparis") {
        await this.siparisEtkisiUygula(tx, belge.yon, belge.satirlar, +1, belge.depoId);
      }

      const guncel = await tx.belge.update({
        where: { id },
        data: {
          // FTR-26: faturası önceden düzenlenmiş irsaliye (EBLG-76 "fatura
          // sevkten önce") onayla birlikte faturalanmış sayılır.
          durum: irsaliye && belge.faturaId ? "kapandi" : "onaylandi",
          no,
          kagitIrsaliye,
          // Fiili sevk zamanı girilmediyse onay anı yazılır: mal onaylanan
          // irsaliyeyle yola çıkar (EBLG-23).
          ...(irsaliye && !belge.fiiliSevkZamani ? { fiiliSevkZamani: new Date() } : {}),
        },
      });
      return this.gorunum(guncel);
    });
  }

  async iptal(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({
        where: { id },
        include: { satirlar: true },
      });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      if (belge.durum === "kapandi" || belge.durum === "iptal") {
        throw new BadRequestException(
          "Kapanmış veya iptal edilmiş belge iptal edilemez",
        );
      }
      // Onaylı siparişin rezervi/yoldakisi çözülür. Kısmen teslim edilmiş
      // siparişte teslim edilenin etkisi zincire geçtiği için yalnız kalan
      // miktar çözülür (SAT-09); hiç teslim yoksa bu tüm miktar demektir.
      if (belge.tur === "siparis" && ["onaylandi", "kismen_kapandi"].includes(belge.durum)) {
        const kalanlar = belge.satirlar
          .map((s) => ({ ...s, miktar: s.miktar.sub(s.teslimEdilenMiktar) }))
          .filter((s) => s.miktar.greaterThan(0));
        if (kalanlar.length > 0) {
          await this.siparisEtkisiUygula(tx, belge.yon, kalanlar, -1, belge.depoId);
        }
      }
      // İptal edilen irsaliyenin malı teslim edilmemiş sayılır: sipariş
      // satırındaki birikim geri alınır ve sipariş yeniden teslime açılır.
      if (belge.tur === "irsaliye") {
        await this.teslimGeriAl(tx, belge.satirlar, belge.kaynakBelgeId);
      }
      const guncel = await tx.belge.update({
        where: { id },
        data: { durum: "iptal" },
      });
      return this.gorunum(guncel);
    });
  }

  /**
   * SAT-09: iptal edilen irsaliyenin miktarlarını sipariş satırlarından düşer ve
   * kaynak siparişi kalan durumuna göre yeniden açar. Faturaya bağlanmış sipariş
   * (kapandı) bu yoldan geri açılmaz; orada teslim birikimi zaten yoktur.
   */
  private async teslimGeriAl(
    tx: Prisma.TransactionClient,
    satirlar: { miktar: Prisma.Decimal; kaynakSatirId: string | null }[],
    kaynakBelgeId: string | null,
  ): Promise<void> {
    const bagliSatirlar = satirlar.filter((s) => s.kaynakSatirId);
    if (bagliSatirlar.length === 0) return;
    for (const s of bagliSatirlar) {
      await tx.belgeSatir.update({
        where: { id: s.kaynakSatirId as string },
        data: { teslimEdilenMiktar: { decrement: s.miktar } },
      });
    }
    if (!kaynakBelgeId) return;
    const siparis = await tx.belge.findUnique({
      where: { id: kaynakBelgeId },
      include: { satirlar: { select: { miktar: true, teslimEdilenMiktar: true } } },
    });
    if (!siparis || siparis.tur !== "siparis" || siparis.faturaId || siparis.durum === "iptal") return;
    const teslimVar = siparis.satirlar.some((s) => s.teslimEdilenMiktar.greaterThan(0));
    const tamamlandi = siparis.satirlar.every((s) => s.teslimEdilenMiktar.greaterThanOrEqualTo(s.miktar));
    await tx.belge.update({
      where: { id: siparis.id },
      data: { durum: tamamlandi ? "kapandi" : teslimVar ? "kismen_kapandi" : "onaylandi" },
    });
  }

  // ─── DÖNÜŞTÜRME (FTR-12 zinciri) ──────────────────────────────────────────

  /**
   * Zincirde bir sonraki belgeyi üretir (FTR-12). Siparişten irsaliyeye
   * dönüşümde satır bazında miktar verilebilir (SAT-09): verilmezse her satırın
   * kalanı dönüşür. Kalanı olan sipariş `kismen_kapandi` olarak açık kalır ve
   * sonraki teslimler için yeniden dönüştürülebilir.
   */
  async donustur(
    id: string,
    hedef: "siparis" | "irsaliye" | "fatura",
    girdi?: { kalemler?: { satirId: string; miktar: string }[] },
  ) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({
        where: { id },
        include: { satirlar: true },
      });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      // Kısmen teslim edilmiş sipariş kalanı için yeniden dönüştürülebilir.
      const kismenAcik = belge.tur === "siparis" && belge.durum === "kismen_kapandi";
      if (belge.durum !== "onaylandi" && !kismenAcik) {
        throw new BadRequestException(
          "Yalnızca onaylanmış belgeler dönüştürülebilir",
        );
      }
      if (!DONUSUM_HEDEFLERI[belge.tur].includes(hedef)) {
        throw new BadRequestException(
          `${belge.tur} → ${hedef} dönüşümü zincire uygun değil (teklif → sipariş → irsaliye → fatura)`,
        );
      }

      const miktarlar = this.donusecekMiktarlar(belge, hedef, girdi?.kalemler);

      // Kısmen teslim edilmiş sipariş faturaya atlayamaz: teslim edilen mal
      // irsaliyesi üzerinden faturalanır, iki yol aynı malı iki kez faturalardı.
      if (hedef === "fatura" && belge.satirlar.some((s) => s.teslimEdilenMiktar.greaterThan(0))) {
        throw new BadRequestException(
          "Kısmen teslim edilmiş sipariş doğrudan faturalanamaz; irsaliyelerini faturalayın",
        );
      }

      if (hedef === "fatura") {
        const fatura = await this.faturaTaslagiYaz(tx, tenantId, [belge]);
        await tx.belge.update({
          where: { id },
          data: { durum: "kapandi", faturaId: fatura.id },
        });
        return { donusenTur: "fatura" as const, faturaId: fatura.id };
      }

      const donusenler = belge.satirlar.filter((s) => miktarlar.has(s.id));
      // Miktarların tamamı geliyorsa belge birebir kopyalanır; kısmi teslimde
      // satır ve belge toplamları yeni miktarlarla yeniden hesaplanır.
      const tamDonusum = donusenler.length === belge.satirlar.length && donusenler.every((s) => miktarlar.get(s.id)!.equals(s.miktar));
      const hesap = tamDonusum ? null : this.kismiHesap(belge, donusenler, miktarlar);

      // Teklif → sipariş rezervasyon üretmez; yeni sipariş önce taslak olur,
      // rezerv onayında konur. Sipariş → irsaliyede rezerv sürer (stok
      // düşümü faturada olduğundan mal hâlâ rezerve sayılır).
      const yeni = await tx.belge.create({
        data: {
          tenantId,
          tur: hedef,
          yon: belge.yon,
          tarih: new Date(),
          cariId: belge.cariId,
          // Zincir boyunca aynı depo taşınır (STK-07)
          depoId: belge.depoId,
          dovizCinsi: belge.dovizCinsi,
          kur: belge.kur,
          genelIskontoYuzdesi: belge.genelIskontoYuzdesi,
          genelIskontoTutari: hesap ? hesap.genelIskontoTutari : belge.genelIskontoTutari,
          ...(hesap
            ? this.toplamAlanlari(hesap.hesap)
            : {
                toplamBrut: belge.toplamBrut,
                toplamSatirIskontosu: belge.toplamSatirIskontosu,
                genelIskontoToplam: belge.genelIskontoToplam,
                toplamMatrah: belge.toplamMatrah,
                toplamKdv: belge.toplamKdv,
                toplamTevkifat: belge.toplamTevkifat,
                toplamNetKdv: belge.toplamNetKdv,
                genelToplam: belge.genelToplam,
              }),
          aciklama: belge.aciklama,
          notlar: belge.notlar,
          kaynakBelgeId: belge.id,
        },
      });
      await tx.belgeSatir.createMany({
        data: donusenler.map((s, i) => {
          const h = hesap?.hesap.satirlar[i];
          return {
            tenantId,
            belgeId: yeni.id,
            // İrsaliye satırı türediği sipariş satırını gösterir: iptal edilirse
            // teslim edilen miktarın nereden düşeceği buradan bilinir (SAT-09).
            kaynakSatirId: s.id,
            stokId: s.stokId,
            varyantId: s.varyantId,
            partiBilgileri: s.partiBilgileri ?? Prisma.JsonNull,
            miktar: miktarlar.get(s.id)!,
            birim: s.birim,
            birimFiyat: s.birimFiyat,
            iskontoOrani: s.iskontoOrani,
            iskontoTutari: h ? D(h.iskontoTutari) : s.iskontoTutari,
            genelIskontoPayi: h ? D(h.genelIskontoPayi) : s.genelIskontoPayi,
            matrah: h ? D(h.matrah) : s.matrah,
            kdvOrani: s.kdvOrani,
            kdvTutari: h ? D(h.kdvTutari) : s.kdvTutari,
            tevkifatPay: s.tevkifatPay,
            tevkifatPayda: s.tevkifatPayda,
            tevkifatTutari: h ? D(h.tevkifatTutari) : s.tevkifatTutari,
            netKdvTutari: h ? D(h.netKdvTutari) : s.netKdvTutari,
            toplamTutar: h ? D(h.toplamTutar) : s.toplamTutar,
          };
        }),
      });

      // Teslim edilen miktar sipariş satırında birikir; sipariş ancak her satırı
      // tamamlanınca kapanır, kalanı varsa "kısmen kapandı" olarak açık durur.
      let tamamlandi = true;
      if (belge.tur === "siparis") {
        for (const s of belge.satirlar) {
          const eklenen = miktarlar.get(s.id);
          if (eklenen) {
            await tx.belgeSatir.update({ where: { id: s.id }, data: { teslimEdilenMiktar: { increment: eklenen } } });
          }
          if (s.teslimEdilenMiktar.add(eklenen ?? D(0)).lessThan(s.miktar)) tamamlandi = false;
        }
      }
      await tx.belge.update({ where: { id }, data: { durum: tamamlandi ? "kapandi" : "kismen_kapandi" } });
      return { donusenTur: hedef, belgeId: yeni.id, kaynakKapandi: tamamlandi };
    });
  }

  /**
   * SAT-09: hangi satırdan ne kadar dönüşeceği. Kalem verilmezse her satırın
   * kalanı (miktar − teslim edilen) alınır; verilirse miktarlar kalanı aşamaz.
   */
  private donusecekMiktarlar(
    belge: { tur: BelgeTur; satirlar: { id: string; miktar: Prisma.Decimal; teslimEdilenMiktar: Prisma.Decimal }[] },
    hedef: "siparis" | "irsaliye" | "fatura",
    kalemler?: { satirId: string; miktar: string }[],
  ): Map<string, Prisma.Decimal> {
    const kalan = (s: { miktar: Prisma.Decimal; teslimEdilenMiktar: Prisma.Decimal }) => s.miktar.sub(s.teslimEdilenMiktar);
    const miktarlar = new Map<string, Prisma.Decimal>();
    if (kalemler?.length) {
      if (!(belge.tur === "siparis" && hedef === "irsaliye")) {
        throw new BadRequestException("Satır bazında miktar yalnız siparişten irsaliyeye dönüşümde verilebilir");
      }
      for (const kalem of kalemler) {
        const satir = belge.satirlar.find((s) => s.id === kalem.satirId);
        if (!satir) throw new BadRequestException("Belgede bulunmayan bir satır için miktar girilmiş");
        if (miktarlar.has(kalem.satirId)) throw new BadRequestException("Aynı satır için birden çok miktar girilmiş");
        const miktar = D(kalem.miktar);
        if (miktar.lessThanOrEqualTo(0)) throw new BadRequestException("Teslim miktarı sıfırdan büyük olmalıdır");
        if (miktar.greaterThan(kalan(satir))) {
          throw new BadRequestException(`Teslim miktarı sipariş kalanını aşamaz (kalan: ${kalan(satir).toFixed(3)})`);
        }
        miktarlar.set(kalem.satirId, miktar);
      }
    } else {
      for (const s of belge.satirlar) {
        if (kalan(s).greaterThan(0)) miktarlar.set(s.id, kalan(s));
      }
    }
    if (miktarlar.size === 0) throw new BadRequestException("Dönüştürülecek miktar kalmadı");
    return miktarlar;
  }

  /**
   * SAT-09: kısmi dönüşümün satır ve belge toplamları. Sabit tutarlı genel
   * iskonto, dönüşen satırların brütü oranında taşınır; yüzdeli iskonto zaten
   * yeni tutarların üzerinden işler.
   */
  private kismiHesap(
    belge: { genelIskontoYuzdesi: Prisma.Decimal; genelIskontoTutari: Prisma.Decimal; satirlar: BelgeSatirKaydi[] },
    donusenler: (BelgeSatirKaydi & { id: string })[],
    miktarlar: Map<string, Prisma.Decimal>,
  ) {
    const brut = (satirlar: { miktar: Prisma.Decimal; birimFiyat: Prisma.Decimal }[]) =>
      satirlar.reduce((toplam, s) => toplam.add(s.miktar.mul(s.birimFiyat)), D(0));
    const kaynakBrut = brut(belge.satirlar);
    const yeniBrut = brut(donusenler.map((s) => ({ miktar: miktarlar.get(s.id)!, birimFiyat: s.birimFiyat })));
    const genelIskontoTutari =
      belge.genelIskontoTutari.isZero() || kaynakBrut.isZero()
        ? D(0)
        : belge.genelIskontoTutari.mul(yeniBrut).div(kaynakBrut).toDecimalPlaces(2);
    const hesap = this.hesapla({
      satirlar: donusenler.map((s) => ({
        stokId: s.stokId,
        miktar: miktarlar.get(s.id)!,
        birimFiyat: s.birimFiyat,
        iskontoOrani: s.iskontoOrani,
        kdvOrani: s.kdvOrani,
        tevkifatPay: s.tevkifatPay,
        tevkifatPayda: s.tevkifatPayda,
      })),
      genelIskontoYuzdesi: belge.genelIskontoYuzdesi,
      genelIskontoTutari,
    });
    return { hesap, genelIskontoTutari };
  }

  // ─── TOPLU FATURALAMA (FTR-13) ───────────────────────────────────────────

  async topluFatura(girdi: z.infer<typeof topluFaturaSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belgeler = await tx.belge.findMany({
        where: { id: { in: girdi.belgeIds } },
        include: { satirlar: true },
      });
      if (belgeler.length !== girdi.belgeIds.length) {
        throw new NotFoundException("Seçilen belgelerden bazıları bulunamadı");
      }
      for (const b of belgeler) {
        if (b.durum !== "onaylandi") {
          throw new BadRequestException(
            `${b.no ?? b.id} bekleyen (onaylanmış) durumda değil`,
          );
        }
        if (b.tur === "teklif") {
          throw new BadRequestException(
            "Teklifler doğrudan faturalanamaz; önce siparişe dönüştürün",
          );
        }
      }
      const ilk = belgeler[0];
      if (
        !belgeler.every(
          (b) =>
            b.cariId === ilk.cariId &&
            b.dovizCinsi === ilk.dovizCinsi &&
            b.kur.equals(ilk.kur) &&
            b.yon === ilk.yon &&
            b.depoId === ilk.depoId,
        )
      ) {
        throw new BadRequestException(
          "Toplu faturalama için belgeler aynı cari, döviz, kur, yön ve depoda olmalıdır",
        );
      }

      const fatura = await this.faturaTaslagiYaz(tx, tenantId, belgeler);
      const kapananlar = await tx.belge.updateMany({
        where: {
          id: { in: girdi.belgeIds },
          durum: "onaylandi",
          faturaId: null,
        },
        data: { durum: "kapandi", faturaId: fatura.id },
      });
      if (kapananlar.count !== belgeler.length) {
        throw new ConflictException(
          "Seçilen belgelerden biri başka bir işlemde faturalanmış; listeyi yenileyip tekrar deneyin",
        );
      }
      return { faturaId: fatura.id, birlesenBelge: belgeler.length };
    });
  }

  // ─── PDF (T-02) ──────────────────────────────────────────────────────────

  async pdfUret(id: string): Promise<{ buffer: Buffer; dosyaAdi: string }> {
    const belge = await this.getir(id);
    const { tenantId } = aktifBaglam();
    const firma = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { unvan: true, vkn: true, vergiDairesi: true, adres: true, ilce: true, il: true, postaKodu: true, telefon: true, eposta: true, webSitesi: true, mersisNo: true, ticaretSicilNo: true },
      }),
    );
    if (!firma) throw new NotFoundException("Firma bulunamadı");
    const tema = await this.pdf.belgeTemasi();
    const buffer = await this.pdf.htmlToPdf(
      belgePdfHtml(belge, { ...firma, tema }),
    );
    return { buffer, dosyaAdi: `belge-${belge.no ?? "taslak"}.pdf` };
  }

  // ─── YARDIMCILAR ─────────────────────────────────────────────────────────

  /**
   * Satış siparişi rezerv, alış siparişi yoldaki miktarını günceller.
   * isaret: +1 onay, -1 iptal/çözüm. Miktarlar fatura ile aynı kabulle
   * satır miktarı üzerinden işlenir. Kart üzerindeki toplamla birlikte
   * siparişin deposunun bakiyesi de güncellenir (STK-07).
   */
  async siparisEtkisiUygula(
    tx: Prisma.TransactionClient,
    yon: "satis" | "alis",
    satirlar: { stokId: string; varyantId?: string | null; miktar: Prisma.Decimal }[],
    isaret: 1 | -1,
    depoId?: string | null,
  ): Promise<void> {
    const alan = yon === "satis" ? "rezerveMiktar" : "yoldakiMiktar";
    const hedefDepoId = await this.depoService.depoCozumle(tx, depoId);
    for (const s of satirlar) {
      await tx.stokKart.update({
        where: { id: s.stokId },
        data: {
          [alan]:
            isaret > 0 ? { increment: s.miktar } : { decrement: s.miktar },
        },
      });
      await this.depoService.bakiyeDegistir(
        tx,
        s.stokId,
        hedefDepoId,
        alan,
        isaret > 0 ? s.miktar : s.miktar.negated(),
      );
      if (s.varyantId) {
        await tx.stokVaryant.update({ where: { id: s.varyantId }, data: { [alan]: isaret > 0 ? { increment: s.miktar } : { decrement: s.miktar } } });
        await tx.stokVaryantDepoBakiye.upsert({
          where: { tenantId_varyantId_depoId: { tenantId: aktifBaglam().tenantId, varyantId: s.varyantId, depoId: hedefDepoId } },
          create: { tenantId: aktifBaglam().tenantId, varyantId: s.varyantId, depoId: hedefDepoId, [alan]: isaret > 0 ? s.miktar : s.miktar.negated() },
          update: { [alan]: isaret > 0 ? { increment: s.miktar } : { decrement: s.miktar } },
        });
      }
    }
  }

  /**
   * Faturaya bağlı zincir belgelerinin sipariş etkisini çözer (FTR-12) ya da
   * geri koyar (FTR-26 bağ kaldırma). Fatura kesinleşirken ve kesin faturaya
   * sonradan irsaliye bağlanırken çağrılır; stok hareketlerinden ÖNCE
   * çalışmalıdır ki kullanılabilir stok kontrolü (STK-17) rezervi çifte
   * saymasın.
   *
   * Doğrudan faturalanan siparişin tüm satırları çözülür (kısmi teslimli
   * sipariş faturaya atlayamaz). Siparişten türeyen irsaliyede ise yalnız
   * **irsaliyenin taşıdığı miktar** çözülür: kısmi teslimde (SAT-09) aynı
   * siparişin irsaliyeleri ayrı faturalara gider ve her biri kendi payını
   * çözer. Siparişin tamamını çözmek rezervi ikinci faturada eksiye
   * düşürüyordu.
   */
  async zincirEtkisiniCoz(
    tx: Prisma.TransactionClient,
    belgeIds: string[],
    isaret: 1 | -1 = -1,
  ): Promise<void> {
    if (belgeIds.length === 0) return;
    const belgeler = await tx.belge.findMany({
      where: { id: { in: belgeIds } },
      select: {
        tur: true,
        yon: true,
        depoId: true,
        kaynakBelge: { select: { tur: true, yon: true, depoId: true } },
        satirlar: { select: { stokId: true, varyantId: true, miktar: true, kaynakSatirId: true } },
      },
    });
    for (const b of belgeler) {
      if (b.tur === "siparis") {
        await this.siparisEtkisiUygula(tx, b.yon, b.satirlar, isaret, b.depoId);
      } else if (b.tur === "irsaliye" && b.kaynakBelge?.tur === "siparis") {
        const siparisSatirlari = b.satirlar.filter((s) => s.kaynakSatirId);
        if (siparisSatirlari.length > 0) {
          await this.siparisEtkisiUygula(tx, b.kaynakBelge.yon, siparisSatirlari, isaret, b.kaynakBelge.depoId);
        }
      }
    }
  }

  // ─── SONRADAN FATURAYA BAĞLAMA (FTR-26) ───────────────────────────────────

  /** İrsaliye detayındaki "Faturaya bağla" listesi. */
  async baglanabilirFaturalar(irsaliyeId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({ where: { id: irsaliyeId }, select: { tur: true, yon: true, cariId: true, durum: true, faturaId: true } });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      if (belge.tur !== "irsaliye" || belge.durum !== "onaylandi" || belge.faturaId) return [];
      const faturalar = await tx.fatura.findMany({
        where: {
          tenantId,
          cariId: belge.cariId,
          tip: IRSALIYE_FATURA_TIPI[belge.yon],
          durum: { in: ["taslak", "kesin"] },
          OR: [{ ebelge: { is: null } }, { ebelge: { is: { durum: { in: ["hata", "ret"] } } } }],
        },
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        take: 50,
        select: { id: true, no: true, tarih: true, durum: true, genelToplam: true, dovizCinsi: true },
      });
      return faturalar.map((f) => ({ ...f, tarih: f.tarih.toISOString().slice(0, 10), genelToplam: f.genelToplam.toFixed(2) }));
    });
  }

  /** Fatura detayındaki "İrsaliye bağla" listesi. */
  async baglanabilirIrsaliyeler(faturaId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({ where: { id: faturaId }, select: { cariId: true, tip: true } });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      const yon = fatura.tip === "satis" ? "satis" : fatura.tip === "alis" ? "alis" : null;
      if (!yon) return [];
      const belgeler = await tx.belge.findMany({
        where: {
          tenantId,
          cariId: fatura.cariId,
          tur: "irsaliye",
          yon,
          OR: [{ durum: "onaylandi", faturaId: null }, { faturaId }],
        },
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        take: 100,
        select: { id: true, no: true, tarih: true, faturaId: true, eirsaliye: { select: { durum: true } } },
      });
      return belgeler.map((b) => ({ id: b.id, no: b.no, tarih: b.tarih.toISOString().slice(0, 10), bagli: b.faturaId === faturaId, eirsaliyeDurumu: b.eirsaliye?.durum ?? null }));
    });
  }

  /** Madde 8: bağlamadan önce gösterilen yumuşak karşılaştırma. */
  async baglamaKarsilastir(faturaId: string, irsaliyeIds: string[]) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({
        where: { id: faturaId },
        select: { tip: true, tarih: true, satirlar: { select: { stokId: true, varyantId: true, miktar: true, birim: true, stok: { select: { kod: true, ad: true, tip: true } } } } },
      });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      // Faturaya zaten bağlı irsaliyeler de hesaba girer: fatura çoğu zaman
      // birden çok sevkiyatı kapsar.
      const irsaliyeler = await tx.belge.findMany({
        where: { tenantId, tur: "irsaliye", OR: [{ id: { in: irsaliyeIds } }, { faturaId }] },
        select: { no: true, tarih: true, fiiliSevkZamani: true, satirlar: { select: { stokId: true, varyantId: true, miktar: true, birim: true, stok: { select: { kod: true, ad: true, tip: true } } } } },
      });
      // EBLG-82: fatura tarihi irsaliyenin faturalama süresinden sonraysa uyarı.
      const gecikmeler = fatura.tip === "satis" || fatura.tip === "alis"
        ? faturaGecikmeUyarilari({
            faturaTarihi: fatura.tarih.toISOString().slice(0, 10),
            yon: fatura.tip,
            irsaliyeler: irsaliyeler.map((i) => ({ no: i.no, sevkGunu: irsaliyeSevkGunu(i) })),
            gunSayisi: await this.irsaliyeFaturaGunSayisi(tx),
          })
        : [];
      const satir = (s: { stokId: string; varyantId: string | null; miktar: Prisma.Decimal; birim: string; stok: { kod: string; ad: string; tip: string } }) => ({
        stokId: s.stokId,
        varyantId: s.varyantId,
        ad: `${s.stok.kod} ${s.stok.ad}`,
        miktar: s.miktar.toString(),
        birim: s.birim,
        stokTipi: s.stok.tip,
      });
      return { gecikmeler, farklar: irsaliyeFaturaFarklari(irsaliyeler.flatMap((i) => i.satirlar.map(satir)), fatura.satirlar.map(satir)) };
    });
  }

  async irsaliyeBagla(faturaId: string, irsaliyeIds: string[]) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => this.irsaliyeBaglaTx(tx, tenantId, faturaId, irsaliyeIds));
  }

  /**
   * İrsaliyeleri faturaya bağlar ve "kapandı" yapar. e-Fatura sihirbazının
   * sevkiyat adımı (EBLG-76) da bu yoldan geçer. Kesin faturaya bağlanan
   * irsaliyenin sipariş rezervi burada çözülür — kesinleştirme onu görmedi.
   */
  async irsaliyeBaglaTx(tx: Prisma.TransactionClient, tenantId: string, faturaId: string, irsaliyeIds: string[]) {
    const ids = [...new Set(irsaliyeIds)];
    if (ids.length === 0) throw new BadRequestException("Bağlanacak en az bir irsaliye seçin");
    const fatura = await tx.fatura.findUnique({ where: { id: faturaId }, select: { cariId: true, tip: true, durum: true, sevkiyatYontemi: true, ebelge: { select: { durum: true } } } });
    if (!fatura) throw new NotFoundException("Fatura bulunamadı");
    if (fatura.durum !== "taslak" && fatura.durum !== "kesin") throw new BadRequestException("İptal edilmiş faturaya irsaliye bağlanamaz");
    if (fatura.tip !== "satis" && fatura.tip !== "alis") throw new BadRequestException("İrsaliye yalnız satış veya alış faturasına bağlanır");
    if (fatura.ebelge && !["hata", "ret"].includes(fatura.ebelge.durum)) throw new ConflictException("e-Belge olarak gönderilmiş faturaya irsaliye bağlanamaz");
    const belgeler = await tx.belge.findMany({ where: { id: { in: ids }, tenantId }, select: { id: true, no: true, tur: true, yon: true, cariId: true, durum: true, faturaId: true, eirsaliye: { select: { durum: true } } } });
    if (belgeler.length !== ids.length) throw new NotFoundException("Seçilen irsaliyelerden bazıları bulunamadı");
    const yeniler: string[] = [];
    for (const b of belgeler) {
      const ad = b.no ?? "İrsaliye";
      if (b.tur !== "irsaliye") throw new BadRequestException(`${ad} bir irsaliye değil`);
      if (b.faturaId === faturaId) continue;
      if (b.faturaId) throw new ConflictException(`${ad} başka bir faturaya bağlı`);
      if (b.durum !== "onaylandi") throw new BadRequestException(`${ad} onaylı değil; yalnız onaylı irsaliye faturaya bağlanır`);
      if (b.cariId !== fatura.cariId) throw new BadRequestException(`${ad} faturayla aynı cariye ait değil`);
      if (!irsaliyeFaturaTipiUyarMi(b.yon, fatura.tip)) throw new BadRequestException(`${ad}: ${b.yon === "satis" ? "satış irsaliyesi satış" : "alış irsaliyesi alış"} faturasına bağlanır`);
      // Belgeye DespatchDocumentReference yazılacak; gitmemiş e-İrsaliyenin
      // GİB'de karşılığı yok (EBLG-76 sihirbazıyla aynı kural).
      if (b.eirsaliye && !["iletildi", "kabul", "kismi_kabul"].includes(b.eirsaliye.durum)) throw new BadRequestException(`${ad} e-İrsaliye olarak henüz iletilmedi; önce gönderimi tamamlayın`);
      yeniler.push(b.id);
    }
    if (yeniler.length === 0) return { baglanan: 0 };
    const guncellenen = await tx.belge.updateMany({ where: { id: { in: yeniler }, faturaId: null, durum: "onaylandi" }, data: { faturaId, durum: "kapandi" } });
    if (guncellenen.count !== yeniler.length) throw new ConflictException("Seçilen irsaliyelerden biri başka bir işlemde faturalanmış; listeyi yenileyip tekrar deneyin");
    if (fatura.durum === "kesin") await this.zincirEtkisiniCoz(tx, yeniler, -1);
    // Gönderilmiş e-İrsaliye bağlandıysa faturanın sevkiyat yolu bellidir.
    if (fatura.tip === "satis" && belgeler.some((b) => yeniler.includes(b.id) && b.eirsaliye)) {
      await tx.fatura.update({ where: { id: faturaId }, data: { sevkiyatYontemi: "irsaliye", fiiliSevkZamani: null } });
    }
    return { baglanan: yeniler.length };
  }

  async irsaliyeBaginiKaldir(irsaliyeId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => this.irsaliyeBaginiKaldirTx(tx, tenantId, irsaliyeId));
  }

  /**
   * Bağı kaldırır, irsaliye yeniden "onaylı" olur ve faturalanabilir listesine
   * döner. Kesin faturadaysa çözülen rezerv geri konur.
   */
  async irsaliyeBaginiKaldirTx(tx: Prisma.TransactionClient, tenantId: string, irsaliyeId: string) {
    const belge = await tx.belge.findUnique({ where: { id: irsaliyeId }, select: { id: true, tur: true, faturaId: true, eirsaliye: { select: { durum: true } } } });
    if (!belge || belge.tur !== "irsaliye") throw new NotFoundException("İrsaliye bulunamadı");
    if (!belge.faturaId) return { kaldirildi: false };
    const fatura = await tx.fatura.findUnique({ where: { id: belge.faturaId }, select: { id: true, durum: true, sevkiyatYontemi: true, ebelge: { select: { durum: true } } } });
    if (!fatura) throw new NotFoundException("Fatura bulunamadı");
    if (fatura.ebelge && !["hata", "ret"].includes(fatura.ebelge.durum)) throw new ConflictException("e-Belge olarak gönderilmiş faturanın irsaliye bağı kaldırılamaz");
    // EBLG-76 "fatura sevkten önce": e-İrsaliye fatura referansıyla gitti.
    if (fatura.sevkiyatYontemi === "fatura_once" && belge.eirsaliye) throw new ConflictException("Fatura referansıyla gönderilmiş e-İrsaliyenin bağı kaldırılamaz");
    if (fatura.durum === "kesin") await this.zincirEtkisiniCoz(tx, [belge.id], 1);
    await tx.belge.update({ where: { id: belge.id }, data: { faturaId: null, durum: "onaylandi" } });
    if (fatura.sevkiyatYontemi === "irsaliye") {
      const kalan = await tx.belge.count({ where: { tenantId, faturaId: fatura.id, tur: "irsaliye", eirsaliye: { isNot: null } } });
      if (kalan === 0) await tx.fatura.update({ where: { id: fatura.id }, data: { sevkiyatYontemi: null } });
    }
    return { kaldirildi: true };
  }

  /** Belgelerin satırlarını birleştirip fatura TASLAĞI yazar (stok/cari etkisi kesinleştirmede). */
  private async faturaTaslagiYaz(
    tx: Prisma.TransactionClient,
    tenantId: string,
    belgeler: {
      yon: string;
      cariId: string;
      depoId: string | null;
      dovizCinsi: "TRY" | "USD" | "EUR";
      kur: Prisma.Decimal;
      no: string | null;
      /** EBLG-74: sipariş referansı zincirden faturaya taşınır. */
      siparisNo?: string | null;
      siparisTarihi?: Date | null;
      satirlar: BelgeSatirKaydi[];
    }[],
  ) {
    const ilk = belgeler[0];
    const tumSatirlar = belgeler.flatMap((b) => b.satirlar);
    // Genel iskonto payları belge bazında zaten satırlara dağıtılmış olabilir;
    // faturada genel iskonto sıfırlanır, satır değerleri yeniden hesaplanır.
    const hesap = this.hesapla({
      genelIskontoYuzdesi: "0",
      genelIskontoTutari: "0",
      satirlar: tumSatirlar.map((s) => ({
        stokId: s.stokId,
        miktar: s.miktar,
        birim: s.birim,
        birimFiyat: s.birimFiyat,
        iskontoOrani: s.iskontoOrani,
        kdvOrani: s.kdvOrani,
        tevkifatPay: s.tevkifatPay,
        tevkifatPayda: s.tevkifatPayda,
      })),
    });
    const kaynakNolar = belgeler.map((b) => b.no).filter(Boolean).join(", ");
    const fatura = await tx.fatura.create({
      data: {
        tenantId,
        tip: ilk.yon === "satis" ? "satis" : "alis",
        durum: "taslak",
        tarih: new Date(),
        cariId: ilk.cariId,
        // Depo zincirden faturaya taşınır; boşsa kesinleştirmede varsayılana çözülür
        depoId: ilk.depoId,
        dovizCinsi: ilk.dovizCinsi,
        kur: ilk.kur,
        genelIskontoYuzdesi: D(0),
        genelIskontoTutari: D(0),
        ...this.toplamAlanlari(hesap),
        aciklama: kaynakNolar ? `Belge zincirinden: ${kaynakNolar}` : null,
        // EBLG-74: belgedeki müşteri sipariş referansı faturada da durur.
        siparisNo: ilk.siparisNo ?? null,
        siparisTarihi: ilk.siparisTarihi ?? null,
      },
    });
    for (const [i, s] of hesap.satirlar.entries()) {
      await tx.faturaSatir.create({
        data: {
          tenantId,
          faturaId: fatura.id,
          stokId: s.stokId,
          varyantId: tumSatirlar[i].varyantId,
          idisEtiketNo: tumSatirlar[i].idisEtiketNo ?? null,
          partiBilgileri: tumSatirlar[i].partiBilgileri ?? Prisma.JsonNull,
          miktar: D(s.miktar),
          birim: tumSatirlar[i].birim,
          birimFiyat: D(s.birimFiyat),
          iskontoOrani: D(s.iskontoOrani),
          iskontoTutari: D(s.iskontoTutari),
          genelIskontoPayi: D(s.genelIskontoPayi),
          matrah: D(s.matrah),
          kdvOrani: D(s.kdvOrani),
          kdvTutari: D(s.kdvTutari),
          tevkifatPay: s.tevkifatPay,
          tevkifatPayda: s.tevkifatPayda,
          tevkifatTutari: D(s.tevkifatTutari),
          netKdvTutari: D(s.netKdvTutari),
          toplamTutar: D(s.toplamTutar),
        },
      });
    }
    return fatura;
  }

  private async satirlariYaz(
    tx: Prisma.TransactionClient,
    belgeId: string,
    hesapSatirlari: ReturnType<typeof faturaHesapla>["satirlar"],
    girdiSatirlari: { birim?: string; varyantId?: string | null; partiBilgileri?: unknown[]; idisEtiketNo?: string | null }[],
  ): Promise<void> {
    const { tenantId } = aktifBaglam();
    for (const [i, s] of hesapSatirlari.entries()) {
      const varyantId = girdiSatirlari[i]?.varyantId;
      if (varyantId) {
        const varyant = await tx.stokVaryant.findFirst({ where: { id: varyantId, stokId: s.stokId, aktif: true } });
        if (!varyant) throw new BadRequestException("Varyant bu stok kartına ait değil veya pasif");
      }
      await tx.belgeSatir.create({
        data: {
          tenantId,
          belgeId,
          stokId: s.stokId,
          varyantId: girdiSatirlari[i]?.varyantId,
          partiBilgileri: (girdiSatirlari[i]?.partiBilgileri ?? []) as Prisma.InputJsonValue,
          miktar: D(s.miktar),
          birim: girdiSatirlari[i]?.birim ?? "adet",
          // EBLG-72: İDİS etiket numarası satırda taşınır.
          idisEtiketNo: girdiSatirlari[i]?.idisEtiketNo ? idisNormalize(girdiSatirlari[i]!.idisEtiketNo!) : null,
          birimFiyat: D(s.birimFiyat),
          iskontoOrani: D(s.iskontoOrani),
          iskontoTutari: D(s.iskontoTutari),
          genelIskontoPayi: D(s.genelIskontoPayi),
          matrah: D(s.matrah),
          kdvOrani: D(s.kdvOrani),
          kdvTutari: D(s.kdvTutari),
          tevkifatPay: s.tevkifatPay,
          tevkifatPayda: s.tevkifatPayda,
          tevkifatTutari: D(s.tevkifatTutari),
          netKdvTutari: D(s.netKdvTutari),
          toplamTutar: D(s.toplamTutar),
        },
      });
    }
  }

  private hesapla(girdi: {
    satirlar: {
      stokId: string;
      miktar: string | number | Prisma.Decimal;
      birimFiyat: string | number | Prisma.Decimal;
      iskontoOrani: string | number | Prisma.Decimal;
      kdvOrani: string | number | Prisma.Decimal;
      tevkifatPay?: number | null;
      tevkifatPayda?: number | null;
    }[];
    genelIskontoYuzdesi?: string | number | Prisma.Decimal;
    genelIskontoTutari?: string | number | Prisma.Decimal;
  }) {
    const satirlar: FaturaHesaplaSatirGirdi[] = girdi.satirlar.map((s) => ({
      stokId: s.stokId,
      miktar: Number(s.miktar),
      birimFiyat: Number(s.birimFiyat),
      iskontoOrani: Number(s.iskontoOrani),
      kdvOrani: Number(s.kdvOrani),
      tevkifatPay: s.tevkifatPay || undefined,
      tevkifatPayda: s.tevkifatPayda || undefined,
    }));
    return faturaHesapla({
      satirlar,
      genelIskontoYuzdesi: girdi.genelIskontoYuzdesi
        ? Number(girdi.genelIskontoYuzdesi)
        : 0,
      genelIskontoTutari: girdi.genelIskontoTutari
        ? Number(girdi.genelIskontoTutari)
        : 0,
    });
  }

  private toplamAlanlari(hesap: ReturnType<typeof faturaHesapla>) {
    return {
      toplamBrut: D(hesap.toplamBrut),
      toplamSatirIskontosu: D(hesap.toplamSatirIskontosu),
      genelIskontoToplam: D(hesap.genelIskontoTutari),
      toplamMatrah: D(hesap.toplamMatrah),
      toplamKdv: D(hesap.toplamKdv),
      toplamTevkifat: D(hesap.toplamTevkifat),
      toplamNetKdv: D(hesap.toplamNetKdv),
      genelToplam: D(hesap.genelToplam),
    };
  }

  private eylemler(kayit: { durum: string }): KayitEylem[] {
    return izinliEylemler("belge", { durum: kayit.durum }, aktifBaglam());
  }

  private gorunum(k: {
    id: string;
    tur: string;
    yon: string;
    durum: string;
    no: string | null;
    tarih: Date;
    gecerlilikTarihi: Date | null;
    cariId: string;
    depoId: string | null;
    dovizCinsi: string;
    kur: Prisma.Decimal;
    genelIskontoYuzdesi: Prisma.Decimal;
    genelIskontoTutari: Prisma.Decimal;
    toplamBrut: Prisma.Decimal;
    toplamSatirIskontosu: Prisma.Decimal;
    genelIskontoToplam: Prisma.Decimal;
    toplamMatrah: Prisma.Decimal;
    toplamKdv: Prisma.Decimal;
    toplamTevkifat: Prisma.Decimal;
    toplamNetKdv: Prisma.Decimal;
    genelToplam: Prisma.Decimal;
    aciklama: string | null;
    notlar: string | null;
    fiiliSevkZamani?: Date | null;
    tasiyiciCariId?: string | null;
    plaka?: string | null;
    dorsePlaka?: string | null;
    soforAdi?: string | null;
    soforSoyadi?: string | null;
    soforTckn?: string | null;
    /** EBLG-74: müşterinin sipariş referansı. */
    siparisNo?: string | null;
    siparisTarihi?: Date | string | null;
    /** EBLG-72: İDİS sevkiyat numarası; doluysa e-İrsaliye IDISIRSALIYE gider. */
    idisSevkiyatNo?: string | null;
    /** FTR-27: alış irsaliyesinde tedarikçinin irsaliye numarası. */
    tedarikciBelgeNo?: string | null;
    /** EBLG-84: irsaliyeye özel teslimat adresi. */
    teslimatAdres?: string | null;
    teslimatIl?: string | null;
    teslimatIlce?: string | null;
    teslimatPostaKodu?: string | null;
    /** EBLG-83: kâğıt irsaliye ve matbu numarası. */
    kagitIrsaliye?: boolean;
    matbuBelgeNo?: string | null;
    kaynakBelgeId: string | null;
    faturaId: string | null;
  }) {
    return {
      id: k.id,
      tur: k.tur,
      yon: k.yon,
      durum: k.durum,
      no: k.no,
      tarih: k.tarih.toISOString().slice(0, 10),
      gecerlilikTarihi: k.gecerlilikTarihi?.toISOString().slice(0, 10) ?? null,
      cariId: k.cariId,
      depoId: k.depoId,
      dovizCinsi: k.dovizCinsi,
      kur: D(k.kur).toFixed(4),
      genelIskontoYuzdesi: D(k.genelIskontoYuzdesi).toFixed(2),
      genelIskontoTutari: D(k.genelIskontoTutari).toFixed(2),
      toplamBrut: D(k.toplamBrut).toFixed(2),
      toplamSatirIskontosu: D(k.toplamSatirIskontosu).toFixed(2),
      genelIskontoToplam: D(k.genelIskontoToplam).toFixed(2),
      toplamMatrah: D(k.toplamMatrah).toFixed(2),
      toplamKdv: D(k.toplamKdv).toFixed(2),
      toplamTevkifat: D(k.toplamTevkifat).toFixed(2),
      toplamNetKdv: D(k.toplamNetKdv).toFixed(2),
      genelToplam: D(k.genelToplam).toFixed(2),
      aciklama: k.aciklama,
      notlar: k.notlar,
      fiiliSevkZamani: k.fiiliSevkZamani?.toISOString() ?? null,
      tasiyiciCariId: k.tasiyiciCariId ?? null,
      plaka: k.plaka ?? null,
      dorsePlaka: k.dorsePlaka ?? null,
      soforAdi: k.soforAdi ?? null,
      soforSoyadi: k.soforSoyadi ?? null,
      soforTckn: k.soforTckn ?? null,
      siparisNo: k.siparisNo ?? null,
      siparisTarihi: k.siparisTarihi
        ? (typeof k.siparisTarihi === "string" ? k.siparisTarihi : k.siparisTarihi.toISOString()).slice(0, 10)
        : null,
      idisSevkiyatNo: k.idisSevkiyatNo ?? null,
      tedarikciBelgeNo: k.tedarikciBelgeNo ?? null,
      teslimatAdres: k.teslimatAdres ?? null,
      teslimatIl: k.teslimatIl ?? null,
      teslimatIlce: k.teslimatIlce ?? null,
      teslimatPostaKodu: k.teslimatPostaKodu ?? null,
      kagitIrsaliye: k.kagitIrsaliye ?? false,
      matbuBelgeNo: k.matbuBelgeNo ?? null,
      kaynakBelgeId: k.kaynakBelgeId,
      faturaId: k.faturaId,
    };
  }
}
