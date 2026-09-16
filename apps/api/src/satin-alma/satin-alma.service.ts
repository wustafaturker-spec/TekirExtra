import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type SatinAlmaOlayTuru, type SatinAlmaTalepDurumu } from "@prisma/client";
import { belgeOlusturSemasi } from "../belgeler/belgeler.semalar";
import { BelgelerService } from "../belgeler/belgeler.service";
import { ButceService } from "../butce/butce.service";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { tahakkukOku } from "../rapor/tahakkuk";
import {
  VARSAYILAN_ONAY_ESIGI,
  butceDurumuHesapla,
  enDusukTeklifler,
  onayYetkisi,
  onaylayabilecekRoller,
  talepAcabilirMi,
  teklifHesapla,
  tumTalepleriGorurMu,
} from "./satin-alma.hesap";
import type { SiparisGirdisi, TalepGirdisi, TeklifGirdisi } from "./satin-alma.semalar";

type Tx = Prisma.TransactionClient;

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const isoGun = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Türkiye takvimine göre bugün (YYYY-AA-GG). */
const istanbulBugun = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());

function ayAraligi(tarih: Date) {
  const yil = tarih.getUTCFullYear();
  const ay = tarih.getUTCMonth();
  return { yil, ay: ay + 1, baslangic: new Date(Date.UTC(yil, ay, 1)), bitis: new Date(Date.UTC(yil, ay + 1, 0, 23, 59, 59, 999)) };
}

const DETAY = {
  talepEden: { select: { id: true, adSoyad: true } },
  onaylayan: { select: { adSoyad: true } },
  departman: { select: { id: true, ad: true } },
  siparisBelge: { select: { id: true, no: true, durum: true } },
  kalemler: { orderBy: { sira: "asc" }, include: { stok: { select: { kod: true, ad: true, tip: true } } } },
  teklifler: { orderBy: { createdAt: "asc" }, include: { tedarikci: { select: { id: true, kod: true, unvan: true } }, kalemler: true } },
  olaylar: { orderBy: { createdAt: "asc" }, include: { user: { select: { adSoyad: true } } } },
} satisfies Prisma.SatinAlmaTalebiInclude;

type TalepDetay = Prisma.SatinAlmaTalebiGetPayload<{ include: typeof DETAY }>;
type TutarKaynagi = { tahminiToplam: Prisma.Decimal; teklifler: { secildi: boolean; toplamTry: Prisma.Decimal }[] };

/**
 * Satın alma talep ve onay (SAT-01…SAT-08). Talep → onay → teklif → alış
 * siparişi. Sipariş mevcut belge zinciriyle oluşturulur; stok ve "yoldaki"
 * etkisi orada işler.
 */
@Injectable()
export class SatinAlmaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ayarlar: AyarlarService,
    private readonly belgeler: BelgelerService,
    private readonly butce: ButceService,
  ) {}

  private async onayEsigi(tx?: Tx): Promise<number> {
    const ayar = await this.ayarlar.getir("satin_alma", tx);
    return Number(ayar.onayEsigi ?? VARSAYILAN_ONAY_ESIGI);
  }

  private olay(tx: Tx, talepId: string, tur: SatinAlmaOlayTuru, aciklama?: string | null) {
    const { tenantId, userId } = aktifBaglam();
    return tx.satinAlmaTalepOlayi.create({ data: { tenantId, talepId, tur, aciklama: aciklama ?? null, userId } });
  }

  /** Teklif seçildiyse onun TL toplamı, yoksa tahmini toplam. */
  private etkinTutar(t: TutarKaynagi): number {
    return Number(t.teklifler.find((k) => k.secildi)?.toplamTry ?? t.tahminiToplam);
  }

  /** Durum değişimini koşullu yapar; iki sekmeden aynı anda verilen karar ikinci kez işlenmez. */
  private async gecis(tx: Tx, id: string, onceki: SatinAlmaTalepDurumu[], veri: Prisma.SatinAlmaTalebiUncheckedUpdateManyInput) {
    const sonuc = await tx.satinAlmaTalebi.updateMany({ where: { id, durum: { in: onceki } }, data: veri });
    if (sonuc.count !== 1) throw new ConflictException("Talep bu arada değişti; sayfayı yenileyip tekrar deneyin");
  }

  private async giderKalemleri(tx: Tx, tenantId: string) {
    const kalemler = await this.butce.kalemTanimlari(tx, tenantId);
    return kalemler
      .filter((k) => k.tur === "gider")
      .map((k) => ({ anahtar: k.anahtar, ad: k.altKategori && !["Genel", "Genel Masraf"].includes(k.altKategori) ? `${k.anaKategori} › ${k.altKategori}` : k.anaKategori }));
  }

  // ─── Seçenekler ve listeler ───────────────────────────────────────────────

  async secenekler() {
    const { tenantId, rol } = aktifBaglam();
    const yetkili = tumTalepleriGorurMu(rol);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const departmanlar = await tx.personelDepartman.findMany({ where: { aktif: true }, select: { id: true, ad: true }, orderBy: { ad: "asc" } });
      const butceKalemleri = await this.giderKalemleri(tx, tenantId);
      const stoklar = await tx.stokKart.findMany({
        where: { aktif: true },
        select: { id: true, kod: true, ad: true, anaBirim: true, tip: true, alisFiyati: true },
        orderBy: { kod: "asc" },
        take: 5000,
      });
      const tedarikciler = yetkili
        ? await tx.cariHesap.findMany({ where: { aktif: true, tip: { in: ["tedarikci", "her_ikisi"] } }, select: { id: true, kod: true, unvan: true }, orderBy: { unvan: "asc" }, take: 5000 })
        : [];
      return {
        departmanlar,
        butceKalemleri,
        stoklar: stoklar.map((s) => ({ ...s, alisFiyati: s.alisFiyati?.toFixed(4) ?? null })),
        tedarikciler,
        onayEsigi: await this.onayEsigi(tx),
        yetkiler: { talepAcabilir: talepAcabilirMi(rol), tumunuGorur: yetkili, teklifYonetir: yetkili },
      };
    });
  }

  async listele(kapsam: "benim" | "onay" | "tum") {
    const { tenantId, userId, rol } = aktifBaglam();
    if (kapsam === "tum" && !tumTalepleriGorurMu(rol)) throw new ForbiddenException("Tüm talepleri yalnız muhasebe ve yönetici görebilir");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const esik = await this.onayEsigi(tx);
      const where: Prisma.SatinAlmaTalebiWhereInput =
        kapsam === "benim" ? { talepEdenUserId: userId } : kapsam === "onay" ? { durum: "onay_bekliyor", talepEdenUserId: { not: userId } } : {};
      const talepler = await tx.satinAlmaTalebi.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 500,
        include: {
          talepEden: { select: { adSoyad: true } },
          departman: { select: { ad: true } },
          siparisBelge: { select: { id: true, no: true } },
          teklifler: { select: { secildi: true, toplamTry: true } },
        },
      });
      return talepler
        .filter((t) => kapsam !== "onay" || onayYetkisi({ rol, userId, talepEdenUserId: t.talepEdenUserId, tutar: this.etkinTutar(t), esik }) === null)
        .map((t) => ({
          id: t.id,
          no: t.no,
          durum: t.durum,
          ihtiyacTarihi: isoGun(t.ihtiyacTarihi),
          gerekce: t.gerekce,
          tahminiToplam: t.tahminiToplam.toFixed(2),
          etkinTutar: this.etkinTutar(t).toFixed(2),
          talepEden: t.talepEden.adSoyad,
          departman: t.departman?.ad ?? null,
          teklifSayisi: t.teklifler.length,
          siparisBelge: t.siparisBelge,
          onaylayabilecekRoller: t.durum === "onay_bekliyor" ? onaylayabilecekRoller(this.etkinTutar(t), esik) : [],
          olusturuldu: t.createdAt.toISOString(),
        }));
    });
  }

  async getir(id: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const t = await tx.satinAlmaTalebi.findUnique({ where: { id }, include: DETAY });
      if (!t) throw new NotFoundException("Satın alma talebi bulunamadı");
      const sahibi = t.talepEdenUserId === userId;
      const yetkili = tumTalepleriGorurMu(rol);
      // SAT-02: başkasının talebi, talebi görmeye yetkili olmayana yok sayılır.
      if (!sahibi && !yetkili) throw new NotFoundException("Satın alma talebi bulunamadı");
      const esik = await this.onayEsigi(tx);
      return this.detayGorunumu(tx, t, { sahibi, yetkili, esik });
    });
  }

  private async detayGorunumu(tx: Tx, t: TalepDetay, ctx: { sahibi: boolean; yetkili: boolean; esik: number }) {
    const { userId, rol } = aktifBaglam();
    const tutar = this.etkinTutar(t);
    const onayEngeli = t.durum === "onay_bekliyor" ? onayYetkisi({ rol, userId, talepEdenUserId: t.talepEdenUserId, tutar, esik: ctx.esik }) : null;
    const butce = await this.butceDurumu(tx, t);
    const kalemAdi = (await this.giderKalemleri(tx, t.tenantId)).find((k) => k.anahtar === t.butceAnahtari)?.ad ?? t.butceAnahtari;
    const enDusuk = enDusukTeklifler(t.teklifler.map((k) => ({ id: k.id, toplamTry: Number(k.toplamTry) })));
    return {
      id: t.id,
      no: t.no,
      durum: t.durum,
      ihtiyacTarihi: isoGun(t.ihtiyacTarihi),
      gerekce: t.gerekce,
      butceAnahtari: t.butceAnahtari,
      butceKalemi: kalemAdi,
      tahminiToplam: t.tahminiToplam.toFixed(2),
      etkinTutar: tutar.toFixed(2),
      talepEden: t.talepEden,
      departman: t.departman,
      onaylayan: t.onaylayan?.adSoyad ?? null,
      onayZamani: t.onayZamani?.toISOString() ?? null,
      butceAsimGerekcesi: t.butceAsimGerekcesi,
      redGerekcesi: t.redGerekcesi,
      teklifSecimGerekcesi: t.teklifSecimGerekcesi,
      siparisBelge: t.siparisBelge,
      kalemler: t.kalemler.map((k) => ({
        id: k.id,
        stokId: k.stokId,
        stokKod: k.stok.kod,
        stokAd: k.stok.ad,
        miktar: k.miktar.toFixed(3),
        birim: k.birim,
        tahminiBirimFiyat: k.tahminiBirimFiyat.toFixed(4),
        tutar: k.miktar.mul(k.tahminiBirimFiyat).toFixed(2),
      })),
      teklifler: t.teklifler.map((k) => ({
        id: k.id,
        tedarikci: k.tedarikci,
        dovizCinsi: k.dovizCinsi,
        kur: k.kur.toString(),
        teslimSuresiGun: k.teslimSuresiGun,
        gecerlilikTarihi: isoGun(k.gecerlilikTarihi),
        aciklama: k.aciklama,
        toplam: k.toplam.toFixed(2),
        toplamTry: k.toplamTry.toFixed(2),
        secildi: k.secildi,
        enDusuk: enDusuk.has(k.id),
        kalemler: k.kalemler.map((f) => ({ talepKalemiId: f.talepKalemiId, birimFiyat: f.birimFiyat.toFixed(4), kdvOrani: f.kdvOrani.toFixed(2) })),
      })),
      olaylar: t.olaylar.map((o) => ({ tur: o.tur, aciklama: o.aciklama, kullanici: o.user.adSoyad, zaman: o.createdAt.toISOString() })),
      butce,
      onaylayabilecekRoller: onaylayabilecekRoller(tutar, ctx.esik),
      onayEngeli,
      yetkiler: {
        duzenle: ctx.sahibi && t.durum === "taslak",
        gonder: ctx.sahibi && t.durum === "taslak",
        geriCek: ctx.sahibi && t.durum === "onay_bekliyor",
        iptal: (ctx.sahibi || ctx.yetkili) && (t.durum === "taslak" || t.durum === "onay_bekliyor"),
        onayla: t.durum === "onay_bekliyor" && onayEngeli === null,
        teklifYonet: ctx.yetkili && t.durum === "onaylandi",
        siparis: ctx.yetkili && t.durum === "onaylandi",
      },
    };
  }

  /**
   * SAT-04: ihtiyaç ayının onaylı bütçesi, gerçekleşeni (tahakkuk) ve aynı
   * kalemde o aya düşen diğer onaylı, henüz faturalaşmamış talepler.
   */
  private async butceDurumu(tx: Tx, t: TutarKaynagi & { id: string; tenantId: string; butceAnahtari: string; ihtiyacTarihi: Date }) {
    const { yil, ay, baslangic, bitis } = ayAraligi(t.ihtiyacTarihi);
    const butce = await tx.butce.findFirst({
      where: { tenantId: t.tenantId, yil, durum: "onayli" },
      include: { satirlar: { where: { anahtar: t.butceAnahtari, ay }, select: { tutar: true } } },
    });
    const { kalemler } = await tahakkukOku(tx, t.tenantId, baslangic, bitis);
    const gerceklesen = kalemler.filter((k) => k.tur === "gider" && k.anahtar === t.butceAnahtari).reduce((toplam, k) => toplam + k.tutarTry, 0);
    const digerleri = await tx.satinAlmaTalebi.findMany({
      where: {
        tenantId: t.tenantId,
        id: { not: t.id },
        butceAnahtari: t.butceAnahtari,
        ihtiyacTarihi: { gte: baslangic, lte: bitis },
        // Faturası gelmiş (sipariş kapanmış) talep gerçekleşende zaten sayılır.
        OR: [{ durum: "onaylandi" }, { durum: "siparise_donustu", siparisBelge: { is: { durum: { notIn: ["kapandi", "iptal"] } } } }],
      },
      select: { tahminiToplam: true, teklifler: { select: { secildi: true, toplamTry: true } } },
    });
    return {
      yil,
      ay,
      ...butceDurumuHesapla({
        butce: butce ? Number(butce.satirlar[0]?.tutar ?? 0) : null,
        gerceklesen,
        digerTalepler: digerleri.reduce((toplam, d) => toplam + this.etkinTutar(d), 0),
        talep: this.etkinTutar(t),
      }),
    };
  }

  // ─── Talep yaşam döngüsü ──────────────────────────────────────────────────

  private async kalemleriHazirla(tx: Tx, tenantId: string, girdi: TalepGirdisi) {
    if (!(await this.giderKalemleri(tx, tenantId)).some((k) => k.anahtar === girdi.butceAnahtari)) {
      throw new BadRequestException("Bütçe kalemi geçersiz; listeden bir gider kalemi seçin");
    }
    if (girdi.departmanId && !(await tx.personelDepartman.findFirst({ where: { id: girdi.departmanId, aktif: true }, select: { id: true } }))) {
      throw new BadRequestException("Departman bulunamadı");
    }
    const stoklar = await tx.stokKart.findMany({ where: { id: { in: [...new Set(girdi.kalemler.map((k) => k.stokId))] }, aktif: true }, select: { id: true, anaBirim: true } });
    const harita = new Map(stoklar.map((s) => [s.id, s]));
    let toplam = D(0);
    const satirlar = girdi.kalemler.map((k, sira) => {
      const stok = harita.get(k.stokId);
      if (!stok) throw new BadRequestException(`${sira + 1}. kalemin stok kartı bulunamadı veya pasif`);
      const miktar = D(k.miktar);
      const fiyat = D(k.tahminiBirimFiyat);
      toplam = toplam.add(miktar.mul(fiyat));
      return { tenantId, sira, stokId: stok.id, miktar, birim: stok.anaBirim, tahminiBirimFiyat: fiyat };
    });
    return { satirlar, toplam: toplam.toDecimalPlaces(2) };
  }

  async olustur(girdi: TalepGirdisi) {
    const { tenantId, userId, rol } = aktifBaglam();
    if (!talepAcabilirMi(rol)) throw new ForbiddenException("Bu rol satın alma talebi açamaz");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kalemler = await this.kalemleriHazirla(tx, tenantId, girdi);
      const yil = Number(istanbulBugun().slice(0, 4));
      const sayac = await tx.satinAlmaSayac.upsert({
        where: { tenantId_yil: { tenantId, yil } },
        create: { tenantId, yil, sonSira: 1 },
        update: { sonSira: { increment: 1 } },
      });
      const talep = await tx.satinAlmaTalebi.create({
        data: {
          tenantId,
          no: `STL${yil}${String(sayac.sonSira).padStart(6, "0")}`,
          talepEdenUserId: userId,
          departmanId: girdi.departmanId ?? null,
          ihtiyacTarihi: new Date(girdi.ihtiyacTarihi),
          gerekce: girdi.gerekce,
          butceAnahtari: girdi.butceAnahtari,
          tahminiToplam: kalemler.toplam,
          kalemler: { create: kalemler.satirlar.map(({ tenantId: kiraci, ...satir }) => ({ ...satir, tenantId: kiraci })) },
        },
      });
      await this.olay(tx, talep.id, "olusturuldu");
      return { id: talep.id, no: talep.no };
    });
  }

  /** Talebi getirip talep edenin kendisi olduğunu doğrular. */
  private async sahibinTalebi(tx: Tx, id: string) {
    const { userId } = aktifBaglam();
    const t = await tx.satinAlmaTalebi.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Satın alma talebi bulunamadı");
    if (t.talepEdenUserId !== userId) throw new ForbiddenException("Bu işlemi yalnız talebi açan kullanıcı yapabilir");
    return t;
  }

  async guncelle(id: string, girdi: TalepGirdisi) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const t = await this.sahibinTalebi(tx, id);
      if (t.durum !== "taslak") throw new BadRequestException("Yalnız taslak talep düzenlenebilir; onaydaki talebi önce geri çekin");
      const kalemler = await this.kalemleriHazirla(tx, tenantId, girdi);
      await tx.satinAlmaTalepKalemi.deleteMany({ where: { talepId: id } });
      await tx.satinAlmaTalebi.update({
        where: { id },
        data: {
          departmanId: girdi.departmanId ?? null,
          ihtiyacTarihi: new Date(girdi.ihtiyacTarihi),
          gerekce: girdi.gerekce,
          butceAnahtari: girdi.butceAnahtari,
          tahminiToplam: kalemler.toplam,
          kalemler: { create: kalemler.satirlar },
        },
      });
      await this.olay(tx, id, "guncellendi");
      return { id };
    });
  }

  async gonder(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.sahibinTalebi(tx, id);
      await this.gecis(tx, id, ["taslak"], { durum: "onay_bekliyor" });
      await this.olay(tx, id, "onaya_gonderildi");
      return { id, durum: "onay_bekliyor" };
    });
  }

  async geriCek(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.sahibinTalebi(tx, id);
      await this.gecis(tx, id, ["onay_bekliyor"], { durum: "taslak" });
      await this.olay(tx, id, "geri_cekildi");
      return { id, durum: "taslak" };
    });
  }

  async iptal(id: string, gerekce?: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const t = await tx.satinAlmaTalebi.findUnique({ where: { id } });
      if (!t) throw new NotFoundException("Satın alma talebi bulunamadı");
      if (t.talepEdenUserId !== userId && !tumTalepleriGorurMu(rol)) throw new ForbiddenException("Talebi yalnız açan kullanıcı, muhasebe veya yönetici iptal edebilir");
      await this.gecis(tx, id, ["taslak", "onay_bekliyor"], { durum: "iptal" });
      await this.olay(tx, id, "iptal_edildi", gerekce || null);
      return { id, durum: "iptal" };
    });
  }

  /** Onay/red ortak ön koşulu: talep onay bekliyor ve kullanıcı karar verebilir. */
  private async kararVerilecekTalep(tx: Tx, id: string) {
    const { userId, rol } = aktifBaglam();
    const t = await tx.satinAlmaTalebi.findUnique({ where: { id }, include: { teklifler: { select: { secildi: true, toplamTry: true } } } });
    if (!t) throw new NotFoundException("Satın alma talebi bulunamadı");
    if (t.durum !== "onay_bekliyor") throw new ConflictException("Talep onay beklemiyor");
    const engel = onayYetkisi({ rol, userId, talepEdenUserId: t.talepEdenUserId, tutar: this.etkinTutar(t), esik: await this.onayEsigi(tx) });
    if (engel) throw new ForbiddenException(engel);
    return t;
  }

  async onayla(id: string, butceAsimGerekcesi?: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const t = await this.kararVerilecekTalep(tx, id);
      const butce = await this.butceDurumu(tx, t);
      const gerekce = butceAsimGerekcesi?.trim() ?? "";
      if (butce.asim > 0 && gerekce.length < 5) {
        throw new BadRequestException(
          `Talep ${String(butce.ay).padStart(2, "0")}/${butce.yil} bütçesini ${butce.asim.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL aşıyor; onaylamak için aşım gerekçesi yazın (en az 5 karakter)`,
        );
      }
      await this.gecis(tx, id, ["onay_bekliyor"], { durum: "onaylandi", onaylayanUserId: userId, onayZamani: new Date(), butceAsimGerekcesi: butce.asim > 0 ? gerekce : null });
      await this.olay(tx, id, "onaylandi", butce.asim > 0 ? `Bütçe aşımı ${butce.asim.toFixed(2)} TL — ${gerekce}` : null);
      return { id, durum: "onaylandi", butce };
    });
  }

  async reddet(id: string, gerekce: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.kararVerilecekTalep(tx, id);
      await this.gecis(tx, id, ["onay_bekliyor"], { durum: "reddedildi", onaylayanUserId: userId, onayZamani: new Date(), redGerekcesi: gerekce });
      await this.olay(tx, id, "reddedildi", gerekce);
      return { id, durum: "reddedildi" };
    });
  }

  // ─── Teklif ve sipariş (muhasebe/yönetici) ────────────────────────────────

  private async onayliTalep(tx: Tx, id: string) {
    const t = await tx.satinAlmaTalebi.findUnique({ where: { id }, include: { kalemler: { orderBy: { sira: "asc" } }, teklifler: { select: { id: true, secildi: true, toplamTry: true } } } });
    if (!t) throw new NotFoundException("Satın alma talebi bulunamadı");
    if (t.durum !== "onaylandi") throw new ConflictException("Bu işlem yalnız onaylı talepte yapılabilir");
    return t;
  }

  private async teklifKaydet(
    tx: Tx,
    t: { id: string; tenantId: string; kalemler: { id: string; miktar: Prisma.Decimal }[] },
    girdi: Pick<TeklifGirdisi, "tedarikciCariId" | "dovizCinsi" | "kur" | "kalemler"> & Partial<Pick<TeklifGirdisi, "teslimSuresiGun" | "gecerlilikTarihi" | "aciklama">>,
    secildi: boolean,
  ) {
    const tedarikci = await tx.cariHesap.findFirst({ where: { id: girdi.tedarikciCariId, aktif: true }, select: { id: true, unvan: true } });
    if (!tedarikci) throw new BadRequestException("Tedarikçi carisi bulunamadı veya pasif");
    const kur = girdi.dovizCinsi === "TRY" ? "1" : girdi.kur;
    const { toplam, toplamTry } = teklifHesapla(t.kalemler, girdi.kalemler, kur);
    const teklif = await tx.satinAlmaTeklifi.create({
      data: {
        tenantId: t.tenantId,
        talepId: t.id,
        tedarikciCariId: tedarikci.id,
        dovizCinsi: girdi.dovizCinsi,
        kur: D(kur),
        teslimSuresiGun: girdi.teslimSuresiGun ?? null,
        gecerlilikTarihi: girdi.gecerlilikTarihi ? new Date(girdi.gecerlilikTarihi) : null,
        aciklama: girdi.aciklama ?? null,
        toplam,
        toplamTry,
        secildi,
        kalemler: { create: girdi.kalemler.map((k) => ({ tenantId: t.tenantId, talepKalemiId: k.talepKalemiId, birimFiyat: D(k.birimFiyat), kdvOrani: D(k.kdvOrani) })) },
      },
      include: { kalemler: true },
    });
    return { teklif, tedarikci };
  }

  async teklifEkle(talepId: string, girdi: TeklifGirdisi) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const t = await this.onayliTalep(tx, talepId);
      const { teklif, tedarikci } = await this.teklifKaydet(tx, t, girdi, false);
      await this.olay(tx, talepId, "teklif_eklendi", `${tedarikci.unvan} · ${teklif.toplamTry.toFixed(2)} TL`);
      return { id: teklif.id };
    });
  }

  private async teklifVeTalep(tx: Tx, teklifId: string) {
    const teklif = await tx.satinAlmaTeklifi.findUnique({ where: { id: teklifId }, include: { tedarikci: { select: { unvan: true } } } });
    if (!teklif) throw new NotFoundException("Teklif bulunamadı");
    return { teklif, talep: await this.onayliTalep(tx, teklif.talepId) };
  }

  async teklifSil(teklifId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const { teklif, talep } = await this.teklifVeTalep(tx, teklifId);
      await tx.satinAlmaTeklifi.delete({ where: { id: teklifId } });
      if (teklif.secildi) await tx.satinAlmaTalebi.update({ where: { id: talep.id }, data: { teklifSecimGerekcesi: null } });
      await this.olay(tx, talep.id, "teklif_silindi", teklif.tedarikci.unvan);
      return { id: teklifId };
    });
  }

  /** SAT-05: en düşükten farklı teklif ancak gerekçeyle seçilir. */
  async teklifSec(teklifId: string, gerekce?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const { teklif, talep } = await this.teklifVeTalep(tx, teklifId);
      const enDusuk = enDusukTeklifler(talep.teklifler.map((k) => ({ id: k.id, toplamTry: Number(k.toplamTry) })));
      const aciklama = gerekce?.trim() ?? "";
      if (!enDusuk.has(teklifId) && aciklama.length < 5) {
        throw new BadRequestException("Seçilen teklif en düşük TL toplamlı teklif değil; seçim gerekçesi yazın (en az 5 karakter)");
      }
      await tx.satinAlmaTeklifi.updateMany({ where: { talepId: talep.id }, data: { secildi: false } });
      await tx.satinAlmaTeklifi.update({ where: { id: teklifId }, data: { secildi: true } });
      await tx.satinAlmaTalebi.update({ where: { id: talep.id }, data: { teklifSecimGerekcesi: enDusuk.has(teklifId) ? null : aciklama } });
      await this.olay(tx, talep.id, "teklif_secildi", enDusuk.has(teklifId) ? teklif.tedarikci.unvan : `${teklif.tedarikci.unvan} — en düşük değil: ${aciklama}`);
      return { id: teklifId };
    });
  }

  /**
   * SAT-06: seçilen tekliften (ya da teklif yoksa `dogrudan` fiyatlardan) taslak
   * alış siparişi oluşturur. Talep önce "siparişe dönüştü" diye ayrılır ki iki
   * istek iki sipariş açmasın; belge oluşturulamazsa ayırma geri alınır.
   */
  async siparisOlustur(id: string, girdi: SiparisGirdisi) {
    const { tenantId } = aktifBaglam();
    const hazirlik = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const t = await this.onayliTalep(tx, id);
      let secilen = await tx.satinAlmaTeklifi.findFirst({ where: { talepId: id, secildi: true }, include: { kalemler: true, tedarikci: { select: { unvan: true } } } });
      if (!secilen) {
        if (t.teklifler.length > 0) throw new BadRequestException("Önce karşılaştırmadan bir teklif seçin");
        if (!girdi.dogrudan) throw new BadRequestException("Teklif girilmemiş talepte tedarikçi ve kalem fiyatları zorunludur");
        const { teklif, tedarikci } = await this.teklifKaydet(tx, t, girdi.dogrudan, true);
        await this.olay(tx, id, "teklif_eklendi", `${tedarikci.unvan} · ${teklif.toplamTry.toFixed(2)} TL (doğrudan sipariş)`);
        secilen = { ...teklif, tedarikci: { unvan: tedarikci.unvan } };
      }
      await this.gecis(tx, id, ["onaylandi"], { durum: "siparise_donustu" });
      return { talep: t, teklif: secilen };
    });

    const fiyatlar = new Map(hazirlik.teklif.kalemler.map((k) => [k.talepKalemiId, k]));
    let belge: { id: string };
    try {
      belge = await this.belgeler.olustur(
        belgeOlusturSemasi.parse({
          tur: "siparis",
          yon: "alis",
          tarih: istanbulBugun(),
          cariId: hazirlik.teklif.tedarikciCariId,
          depoId: girdi.depoId ?? null,
          dovizCinsi: hazirlik.teklif.dovizCinsi,
          kur: hazirlik.teklif.kur.toString(),
          aciklama: `${hazirlik.talep.no} numaralı satın alma talebinden`,
          satirlar: hazirlik.talep.kalemler.map((k) => ({
            stokId: k.stokId,
            miktar: k.miktar.toString(),
            birim: k.birim,
            birimFiyat: fiyatlar.get(k.id)!.birimFiyat.toString(),
            kdvOrani: fiyatlar.get(k.id)!.kdvOrani.toString(),
          })),
        }),
      );
    } catch (hata) {
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.satinAlmaTalebi.updateMany({ where: { id, durum: "siparise_donustu", siparisBelgeId: null }, data: { durum: "onaylandi" } }),
      );
      throw hata;
    }

    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.satinAlmaTalebi.update({ where: { id }, data: { siparisBelgeId: belge.id } });
      await this.olay(tx, id, "siparise_donustu", `Taslak alış siparişi oluşturuldu — ${hazirlik.teklif.tedarikci.unvan}`);
    });
    return { id, siparisBelgeId: belge.id };
  }
}
