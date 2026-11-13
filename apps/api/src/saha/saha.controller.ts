import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MasrafBelgeService } from "../asistan-soru/masraf-belge.service";
import { BELGE_AZAMI_BAYT } from "../asistan-soru/masraf-belge.kurallari";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { BelgelerService } from "../belgeler/belgeler.service";
import { TahsilatRiskiService } from "../cari/tahsilat-riski";
import { eirsaliyeKabulBelgesi, eirsaliyeKabulSemasi, malKabulKaynaklari, partiToplamiDenetle, siparisKabulBelgesi, siparisKabulSemasi } from "./mal-kabul";
import { sahaUrunleri } from "./saha-urun";

const ayristir = <T>(sema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, govde: unknown): T => {
  const s = sema.safeParse(govde);
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => `${i.path.join(".") || "alan"}: ${i.message}`).join("; "));
  return s.data;
};

/**
 * SAH: mobil saha ekranlarının uçları. Sayım gönderimi mevcut `POST /stok/sayimlar` ucuyla,
 * kategori sorusunun yanıtı `POST /ai/sorular/:id/yanit` ile yapılır. Uçlar yetki modülüne
 * bağlıdır: ürün listesi Stok, fiş Masraf ve Gelir (+ yol adındaki "ai" ile Yapay Zekâ paketi).
 */
@Controller("saha/urunler")
export class SahaUrunController {
  constructor(private readonly prisma: PrismaService) {}

  /** SAH-05: barkodla bulma çevrimdışı da çalışsın diye ürün ve barkod listesi (fiyatsız). */
  @Get()
  @Roller("muhasebe", "depo", "uretim_planlama", "salt_okunur")
  async urunler() {
    const { tenantId } = aktifBaglam();
    const veri = await this.prisma.tenantIslem(tenantId, (tx) => sahaUrunleri(tx));
    return { ...veri, alindi: new Date().toISOString() };
  }
}

@Controller("saha/ai-fis")
export class SahaFisController {
  constructor(private readonly masrafBelge: MasrafBelgeService) {}

  /** SAH-08: kameradan masraf fişi; OCR ve taslak CNL-16 hattıyla (kategori belirsizse soru döner). */
  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("dosya", { limits: { fileSize: BELGE_AZAMI_BAYT, files: 1 } }))
  async masrafFisi(@UploadedFile() dosya: { originalname?: string; buffer?: Buffer } | undefined, @Body("not") not?: string) {
    if (!dosya?.buffer?.length) throw new BadRequestException("Fiş fotoğrafı gönderilmedi.");
    const aciklama = typeof not === "string" && not.trim() ? not.trim().slice(0, 300) : null;
    return this.masrafBelge.belgedenMasraf({ ad: (dosya.originalname || "saha-fis").slice(0, 80), buffer: dosya.buffer }, aciklama, "WEB");
  }
}

/**
 * SAH-06: sahada mal kabul. Depo rolü yalnız taslak alış irsaliyesi açar (SAH-04 ile aynı ilke);
 * kesinleştirme ve fark incelemesi panelde yapılır. Yetki modülü Stok ve Depo.
 */
@Controller("saha/mal-kabul")
export class SahaMalKabulController {
  constructor(private readonly prisma: PrismaService, private readonly belgeler: BelgelerService) {}

  @Get()
  @Roller("muhasebe", "satis", "depo")
  kaynaklar() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => malKabulKaynaklari(tx));
  }

  @Get("siparis/:id")
  @Roller("muhasebe", "satis", "depo")
  siparis(@Param("id", ParseUUIDPipe) id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => siparisKabulBelgesi(tx, id));
  }

  @Get("eirsaliye/:id")
  @Roller("muhasebe", "satis", "depo")
  async eirsaliye(@Param("id", ParseUUIDPipe) id: string) {
    const eslesme = await this.belgeler.gelenEirsaliyeEslesmesi(id);
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => eirsaliyeKabulBelgesi(tx, eslesme));
  }

  /** Okutulan miktarlarla siparişten taslak alış irsaliyesi (kısmi teslim; kalanı aşamaz). */
  @Post("siparis/:id")
  @Roller("muhasebe", "satis", "depo")
  async siparisKabul(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const g = ayristir(siparisKabulSemasi, govde);
    const { tenantId } = aktifBaglam();
    // Yalnız alış siparişi; satış siparişinin sevki sahadan yapılmaz.
    await this.prisma.tenantIslem(tenantId, (tx) => siparisKabulBelgesi(tx, id));
    for (const k of g.kalemler) partiToplamiDenetle(k.miktar, k.partiler, "Satır");
    const sonuc = await this.belgeler.donustur(id, "irsaliye", {
      kalemler: g.kalemler.map((k) => ({ satirId: k.satirId, miktar: k.miktar })),
      partiler: new Map(g.kalemler.filter((k) => k.partiler?.length).map((k) => [k.satirId, k.partiler!])),
    });
    return { belgeId: "belgeId" in sonuc ? sonuc.belgeId : null, siparisKapandi: "kaynakKapandi" in sonuc ? sonuc.kaynakKapandi : false };
  }

  /** Okutulan satırlarla gelen e-İrsaliyeden taslak alış irsaliyesi; okutulmayan satır gelmemiş sayılır. */
  @Post("eirsaliye/:id")
  @Roller("muhasebe", "satis", "depo")
  async eirsaliyeKabul(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const g = ayristir(eirsaliyeKabulSemasi, govde);
    for (const s of g.satirlar) partiToplamiDenetle(s.miktar, s.partiler, `${s.siraNo}. satır`);
    const belge = await this.belgeler.gelenEirsaliyedenAlisIrsaliyesi(
      id,
      { satirEslesmeleri: g.satirlar.map((s) => ({ siraNo: s.siraNo, stokId: s.stokId, varyantId: s.varyantId ?? null })), yeniCariOnay: false },
      { taslak: true, miktarlar: new Map(g.satirlar.map((s) => [s.siraNo, s.miktar])), partiler: new Map(g.satirlar.filter((s) => s.partiler?.length).map((s) => [s.siraNo, s.partiler!])) },
    );
    return { belgeId: belge.id };
  }
}

/**
 * SAH-07: sahada tahsilat. Bağlantı mevcut POS uçlarıyla (`POST /pos/tahsilatlar`, `bildirim: false`)
 * açılır; bu uç carinin açık faturalarını, uygun POS hesaplarını ve açık bağlantılarını verir.
 * Yalnız POS yetkili roller; yetki modülü Kasa-Banka.
 */
@Controller("saha/tahsilat")
export class SahaTahsilatController {
  constructor(private readonly prisma: PrismaService, private readonly risk: TahsilatRiskiService) {}

  @Get("cari/:id")
  @Roller("yonetici", "muhasebe")
  async cari(@Param("id", ParseUUIDPipe) id: string) {
    const { tenantId } = aktifBaglam();
    const temel = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const cari = await tx.cariHesap.findUnique({ where: { id }, select: { id: true, kod: true, unvan: true, eposta: true, telefon: true, dovizCinsi: true, aktif: true, _count: { select: { adresler: true } } } });
      if (!cari) throw new BadRequestException("Cari hesap bulunamadı");
      const [posHesaplari, baglantilar] = await Promise.all([
        tx.posHesap.findMany({
          where: { aktif: true, saglayici: { in: ["iyzico", "paytr"] }, dovizCinsi: cari.dovizCinsi, baglanti: { durum: "aktif" } },
          orderBy: { ad: "asc" }, select: { id: true, ad: true, saglayici: true },
        }),
        tx.posTahsilat.findMany({
          where: { cariId: id, durum: "baslatildi", sonKullanimTarihi: { gt: new Date() } },
          orderBy: { createdAt: "desc" }, take: 5, select: { id: true, tutar: true, dovizCinsi: true, createdAt: true, odemeSayfasiUrl: true },
        }),
      ]);
      return { cari, posHesaplari, baglantilar };
    });
    const { acikFaturalar } = await this.risk.cariRiski(id);
    const { _count, ...cari } = temel.cari;
    return {
      cari: { ...cari, adresVar: _count.adresler > 0 },
      acikFaturalar: acikFaturalar.slice(0, 50).map((f) => ({ faturaId: f.faturaId, no: f.no, vadeTarihi: f.vadeTarihi, gecikmeGun: f.gecikmeGun, kalanTry: f.kalanTry })),
      posHesaplari: temel.posHesaplari,
      acikBaglantilar: temel.baglantilar.filter((b) => b.odemeSayfasiUrl).map((b) => ({ id: b.id, tutar: b.tutar.toString(), dovizCinsi: b.dovizCinsi, olusturma: b.createdAt.toISOString() })),
    };
  }
}
