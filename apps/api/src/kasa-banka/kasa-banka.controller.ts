import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { ekstreDosyasiniDogrula, type YuklemeDosyasi } from "../core/guvenlik/dosya-dogrulama";
import { EkstreSatirDurum } from "@prisma/client";
import { Roller } from "../auth/roller.decorator";
import { EkstreService } from "./ekstre.service";
import { EkstreEslestirmeService } from "./ekstre-eslestirme.service";
import { KasaBankaService, type EkstreHesapTuru, type HesapTuru } from "./kasa-banka.service";
import { BankaEntegrasyonService } from "./banka-entegrasyon.service";
import { z } from "zod";
import { CekBordroService } from "./cek-bordro.service";
import { DovizIslemService } from "./doviz-islem.service";
import { DovizBaglamaService } from "./doviz-baglama.service";
import {
  acilisSemasi,
  dovizIslemSemasi,
  bankaAcilisliOlusturSemasi,
  bankaHesapGuncelleSemasi,
  kasaAcilisliOlusturSemasi,
  cekSenetGuncelleSemasi,
  cekSenetOlusturSemasi,
  ekstreEslestirSemasi,
  ekstreKuralGuncelleSemasi,
  ekstreYukleSemasi,
  geriAlmaSemasi,
  kasaBankaHareketOlusturSemasi,
  kasaGuncelleSemasi,
  makbuzSerisiSemasi,
  virmanOlusturSemasi,
  posHesapOlusturSemasi,
  posHesapGuncelleSemasi,
  posBankaAktarimSemasi,
} from "./kasa-banka.semalar";
import { SaltOkumadaAcik } from "../auth/public.decorator";

const EKSTRE_DURUMLARI: EkstreSatirDurum[] = ["beklemede", "eslesti", "yoksayildi"];

/**
 * KLN-02: satış rolü kasa/banka modülüne hiç erişemez (Kabul Ölçütü 5).
 * Sınıf düzeyi kısıt okuma uçlarını da kapsar; yazma uçlarındaki metot düzeyi
 * @Roller("muhasebe") bunu daraltarak salt-okunur rolü yazmaktan alıkoyar.
 */
@Controller("kasa-banka")
@Roller("muhasebe", "salt_okunur")
export class KasaBankaController {
  constructor(
    private readonly service: KasaBankaService,
    private readonly dovizIslem: DovizIslemService,
    private readonly ekstre: EkstreService,
    private readonly ekstreEslestirme: EkstreEslestirmeService,
    private readonly bankaEntegrasyon: BankaEntegrasyonService,
    private readonly cekBordro: CekBordroService,
    private readonly dovizBaglama: DovizBaglamaService,
  ) {}


  @Get("banka-baglantilari/eslemeler")
  bankaEslemeleri() { return this.bankaEntegrasyon.eslemeleriListele(); }

  @Post("banka-baglantilari/eslemeler") @Roller("muhasebe")
  bankaEslemeEkle(@Body() govde: unknown) { const s = z.object({ baglantiId: z.uuid(), bankaHesapId: z.uuid(), disHesapId: z.string().min(1).max(100) }).safeParse(govde); if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; ")); return this.bankaEntegrasyon.eslemeEkle(s.data); }

  @Get("banka-baglantilari/:id/vomsis-hesaplari")
  vomsisHesaplari(@Param("id") id: string) { return this.bankaEntegrasyon.vomsisHesaplari(id); }

  /** KSB-30: herhangi bir çekilen sağlayıcının hesapları (id, ad, iban, dovizCinsi, bankaAdi). */
  @Get("banka-baglantilari/:id/saglayici-hesaplari")
  saglayiciHesaplari(@Param("id") id: string) { return this.bankaEntegrasyon.saglayiciHesaplari(id); }

  @Post("banka-baglantilari/:id/senkronize") @Roller("muhasebe")
  bankaSenkronize(@Param("id") id: string) { return this.bankaEntegrasyon.senkronize(id); }

  /** KSB-15: otomatik çekim ayarı ve son durum. */
  @Get("banka-baglantilari/senkron-durumu")
  bankaSenkronDurumu() { return this.bankaEntegrasyon.senkronDurumlari(); }

  @Put("banka-baglantilari/:id/otomatik-senkron") @Roller("muhasebe")
  bankaOtomatikSenkron(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const s = z.object({ dakika: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60), z.literal(1440)]) }).safeParse(govde);
    if (!s.success) throw new BadRequestException("Aralık 0 (kapalı), 15, 30, 60 ya da 1440 dakika olmalıdır");
    return this.bankaEntegrasyon.otomatikSenkronAyarla(id, s.data.dakika);
  }

  // ─── KASA ENDPOINTS ────────────────────────────────────────────────────────

  @Get("kasalar")
  async kasaListele() {
    return this.service.kasaListele();
  }

  @Get("kasalar/:id")
  async kasaGetir(@Param("id") id: string) {
    return this.service.kasaGetir(id);
  }

  @Post("kasalar")
  @Roller("muhasebe")
  async kasaOlustur(@Body() govde: unknown) {
    const ayristirma = kasaAcilisliOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.kasaOlustur(ayristirma.data);
  }

  @Patch("kasalar/:id")
  @Roller("muhasebe")
  async kasaGuncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = kasaGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.kasaGuncelle(id, ayristirma.data);
  }

  @Delete("kasalar/:id")
  @Roller("muhasebe")
  @HttpCode(204)
  async kasaSil(@Param("id") id: string) {
    await this.service.kasaSil(id);
  }

  // ─── BANKA ENDPOINTS ───────────────────────────────────────────────────────

  @Get("bankalar")
  async bankaListele() {
    return this.service.bankaListele();
  }

  @Get("bankalar/:id")
  async bankaGetir(@Param("id") id: string) {
    return this.service.bankaGetir(id);
  }

  @Post("bankalar")
  @Roller("muhasebe")
  async bankaOlustur(@Body() govde: unknown) {
    const ayristirma = bankaAcilisliOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.bankaOlustur(ayristirma.data);
  }

  @Patch("bankalar/:id")
  @Roller("muhasebe")
  async bankaGuncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = bankaHesapGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.bankaGuncelle(id, ayristirma.data);
  }

  @Delete("bankalar/:id")
  @Roller("muhasebe")
  @HttpCode(204)
  async bankaSil(@Param("id") id: string) {
    await this.service.bankaSil(id);
  }

  @Get("pos-hesaplari")
  async posHesapListele() { return this.service.posHesapListele(); }

  @Post("pos-hesaplari")
  @Roller("muhasebe")
  async posHesapOlustur(@Body() govde: unknown) {
    const ayristirma = posHesapOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) throw new BadRequestException(ayristirma.error.issues.map((i) => `${i.path.join(".") || "alan"}: ${i.message}`).join("; "));
    return this.service.posHesapOlustur(ayristirma.data);
  }

  @Patch("pos-hesaplari/:id")
  @Roller("muhasebe")
  posHesapGuncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.posHesapGuncelle(id, ayristir(posHesapGuncelleSemasi, govde));
  }

  @Post("pos-hesaplari/bankaya-aktar")
  @Roller("muhasebe")
  async posBankayaAktar(@Body() govde: unknown) {
    const ayristirma = posBankaAktarimSemasi.safeParse(govde);
    if (!ayristirma.success) throw new BadRequestException(ayristirma.error.issues.map((i) => i.message).join("; "));
    return this.service.posBankayaAktar(ayristirma.data);
  }

  // ─── HAREKET ENDPOINTS ─────────────────────────────────────────────────────

  /** KSB-13: süzgeçli, imleçli liste; ilk sayfada toplamlar da döner. */
  @Get("hareketler")
  async hareketListele(@Query() sorgu: Record<string, string | undefined>) {
    const gun = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı").optional();
    const girdi = z.object({
      kasaId: z.uuid().optional(),
      bankaHesapId: z.uuid().optional(),
      posHesapId: z.uuid().optional(),
      baslangic: gun,
      bitis: gun,
      tur: z.enum(["tahsilat", "tediye", "virman_gelis", "virman_gidis", "acilis"]).optional(),
      arama: z.string().max(200).optional(),
      imlec: z.uuid().optional(),
      adet: z.coerce.number().int().min(1).max(1000).default(50),
    }).safeParse(Object.fromEntries(Object.entries(sorgu).filter(([, deger]) => deger !== "")));
    if (!girdi.success) throw new BadRequestException(girdi.error.issues.map((i) => i.message).join("; "));
    return this.service.hareketListele(girdi.data);
  }

  @Get("hareketler/:id/baglam")
  hareketBaglami(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.hareketBaglami(id);
  }

  /** KSB-07: tahsilat/ödeme fişinde carinin kalanı olan faturaları. */
  @Get("acik-faturalar")
  acikFaturalar(@Query("cariId") cariId?: string, @Query("tip") tip?: string, @Query("haricHareketId") haricHareketId?: string) {
    const girdi = z.object({ cariId: z.uuid(), tip: z.enum(["tahsilat", "tediye"]), haricHareketId: z.uuid().optional() }).safeParse({ cariId, tip, haricHareketId });
    if (!girdi.success) throw new BadRequestException("Cari ve işlem tipi (tahsilat/tediye) gereklidir");
    return this.service.acikFaturalar(girdi.data.cariId, girdi.data.tip, girdi.data.haricHareketId);
  }

  @Post("hareketler")
  @Roller("muhasebe")
  async hareketEkle(@Body() govde: unknown) {
    const ayristirma = kasaBankaHareketOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.hareketEkle(ayristirma.data);
  }

  /** KSB-23: carinin faturaya bağlanmamış kısmı kalan tahsilat/ödeme fişleri. */
  @Get("baglanmamis-fisler")
  baglanmamisFisler(@Query("cariId") cariId?: string) {
    const g = z.object({ cariId: z.uuid("Geçersiz cari") }).safeParse({ cariId });
    if (!g.success) throw new BadRequestException("Cari gereklidir");
    return this.dovizBaglama.baglanmamislar(g.data.cariId);
  }

  /** KSB-19: fişin bağlanmamış tutarı, elle bağları ve carinin açık faturaları (her dövizde). */
  @Get("hareketler/:id/fatura-baglama")
  faturaBaglama(@Param("id", ParseUUIDPipe) id: string) {
    return this.dovizBaglama.onizle(id);
  }

  /** KSB-19/20: fişi sonradan faturalara bağlar; farklı dövizde karşılıkla. */
  @Post("hareketler/:id/fatura-baglama")
  @Roller("muhasebe")
  faturalaraBagla(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const sema = z.object({
      faturalar: z.array(z.object({
        faturaId: z.uuid(),
        tutar: z.string().regex(/^\d+(\.\d{1,2})?$/, "Tutar en çok iki ondalıklı olmalı"),
        karsilik: z.string().regex(/^\d+(\.\d{1,2})?$/, "Karşılık en çok iki ondalıklı olmalı").nullable().optional(),
      })).min(1, "Bağlanacak fatura seçin").max(100),
    });
    return this.dovizBaglama.bagla(id, ayristir(sema, govde).faturalar);
  }

  /** KSB-24: elle bağlamayı çözer. */
  @Post("fatura-kapamalari/:id/coz")
  @Roller("muhasebe")
  baglamaCoz(@Param("id", ParseUUIDPipe) id: string) {
    return this.dovizBaglama.coz(id);
  }

  /** KSB-08: fişi geri alır (açık dönemde siler, kapalı dönemde ters kayıt). */
  @Post("hareketler/:id/geri-al")
  @Roller("muhasebe")
  async hareketGeriAl(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { neden } = ayristir(geriAlmaSemasi, govde);
    return this.service.hareketGeriAl(id, neden);
  }

  /** KSB-08: fişi geri alıp düzeltilmiş hâlini aynı işlemde yazar. */
  @Post("hareketler/:id/duzelt")
  @Roller("muhasebe")
  async hareketDuzelt(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { neden, yeni } = ayristir(geriAlmaSemasi.extend({ yeni: kasaBankaHareketOlusturSemasi }), govde);
    return this.service.hareketDuzelt(id, neden, yeni);
  }

  @Post("virman/:id/duzelt")
  @Roller("muhasebe")
  async virmanDuzelt(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { neden, yeni } = ayristir(geriAlmaSemasi.extend({ yeni: virmanOlusturSemasi }), govde);
    return this.service.virmanDuzelt(id, neden, yeni);
  }

  // ─── AÇILIŞ FİŞİ VE HESAP EKSTRESİ (P1-9) ─────────────────────────────────

  /** Hesabın açılış bakiyesini yazar ya da değiştirir (değişiklikte gerekçe zorunlu). */
  @Put("hesaplar/:hesap/acilis")
  @Roller("muhasebe")
  acilisKaydet(@Param("hesap") hesap: string, @Body() govde: unknown) {
    const { tur, id } = hesapAnahtari(hesap);
    return this.service.acilisKaydet(tur, id, ayristir(acilisSemasi, govde));
  }

  @Post("hesaplar/:hesap/acilis/sil")
  @Roller("muhasebe")
  acilisSil(@Param("hesap") hesap: string, @Body() govde: unknown) {
    const { tur, id } = hesapAnahtari(hesap);
    return this.service.acilisSil(tur, id, ayristir(geriAlmaSemasi, govde).neden);
  }

  /** Cari'siz ilk tahsilat/ödeme fişini açılış fişine çevirir. */
  @Post("hareketler/:id/acilisa-cevir")
  @Roller("muhasebe")
  acilisaCevir(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.acilisaCevir(id, ayristir(geriAlmaSemasi, govde).neden);
  }

  @Get("hesaplar/:hesap/ekstre")
  hesapEkstresi(@Param("hesap") hesap: string, @Query() sorgu: unknown) {
    const { tur, id } = ekstreHesapAnahtari(hesap);
    const { baslangic, bitis } = ayristir(donemSemasi, sorgu);
    return this.service.hesapEkstresi(tur, id, baslangic, bitis);
  }

  @Get("hesaplar/:hesap/ekstre/pdf")
  async hesapEkstresiPdf(@Param("hesap") hesap: string, @Query() sorgu: unknown, @Res() res: Response) {
    const { tur, id } = ekstreHesapAnahtari(hesap);
    const { baslangic, bitis } = ayristir(donemSemasi, sorgu);
    const pdf = await this.service.hesapEkstresiPdf(tur, id, baslangic, bitis);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${pdf.dosyaAdi}"`);
    res.send(pdf.buffer);
  }

  @Get("hesaplar/:hesap/ekstre/excel")
  async hesapEkstresiExcel(@Param("hesap") hesap: string, @Query() sorgu: unknown, @Res() res: Response) {
    const { tur, id } = ekstreHesapAnahtari(hesap);
    const { baslangic, bitis } = ayristir(donemSemasi, sorgu);
    const dosya = await this.service.hesapEkstresiExcel(tur, id, baslangic, bitis);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${dosya.dosyaAdi}"`);
    res.send(dosya.buffer);
  }

  // ─── DÖVİZ ALIM/SATIMI (P1-2a) ─────────────────────────────────────────────

  @Post("doviz-islemleri")
  @Roller("muhasebe")
  dovizIslemOlustur(@Body() govde: unknown) {
    return this.dovizIslem.olustur(ayristir(dovizIslemSemasi, govde));
  }

  @Get("doviz-islemleri/:id")
  dovizIslemGetir(@Param("id", ParseUUIDPipe) id: string) {
    return this.dovizIslem.getir(id);
  }

  @Post("doviz-islemleri/:id/geri-al")
  @Roller("muhasebe")
  dovizIslemGeriAl(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.dovizIslem.geriAl(id, ayristir(geriAlmaSemasi, govde).neden);
  }

  @Get("makbuz-serileri")
  makbuzSerileri() {
    return this.service.makbuzSerileri();
  }

  @Put("makbuz-serileri")
  @Roller("yonetici")
  makbuzSerisiAyarla(@Body() govde: unknown) {
    return this.service.makbuzSerisiAyarla(ayristir(makbuzSerisiSemasi, govde));
  }

  @Get("hareketler/:id/makbuz")
  async makbuz(@Param("id") id: string, @Res() res: Response) {
    const pdf = await this.service.makbuzPdf(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${pdf.dosyaAdi}"`);
    res.send(pdf.buffer);
  }

  @Post("virman")
  @Roller("muhasebe")
  async virmanEkle(@Body() govde: unknown) {
    const ayristirma = virmanOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.virmanEkle(ayristirma.data);
  }

  // ─── ÇEK & SENET ENDPOINTS ─────────────────────────────────────────────────

  @Get("cek-senet")
  async cekSenetListele(
    @Query("tur") tur?: "cek" | "senet",
    @Query("durum") durum?: string,
    @Query("yon") yon?: string,
    @Query("arama") arama?: string,
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
    @Query("acik") acik?: string,
  ) {
    if (acik !== undefined && acik !== "1" && acik !== "0") throw new BadRequestException("Geçersiz açık evrak filtresi");
    return this.service.cekSenetListele(tur, durum, yon, arama, baslangic, bitis, acik === "1");
  }

  @Get("cek-senet-ozet")
  async cekSenetOzet(@Query("yon") yon?: string) {
    return this.service.cekSenetOzet(yon);
  }

  @Get("cek-senet-vade-analizi")
  @Roller("muhasebe")
  async cekSenetVadeAnalizi() {
    return this.service.cekSenetVadeAnalizi();
  }

  /** KSB-08: çek/senedin son işlemini geri alır. */
  @Post("cek-senet/:id/geri-al")
  @Roller("muhasebe")
  async cekSenetGeriAl(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { neden } = ayristir(geriAlmaSemasi, govde);
    const sonuc = await this.service.cekSenetSonIslemiGeriAl(id, neden);
    if (sonuc.silindi) await this.cekBordro.silinenEvrakGorunumleriniTemizle(id);
    return sonuc;
  }

  @Get("cek-senet/:id")
  async cekSenetGetir(@Param("id") id: string) {
    return this.service.cekSenetGetir(id);
  }

  @Post("cek-senet")
  @Roller("muhasebe")
  async cekSenetOlustur(@Body() govde: unknown) {
    const ayristirma = cekSenetOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.cekSenetOlustur(ayristirma.data);
  }

  @Patch("cek-senet/:id")
  @Roller("muhasebe")
  async cekSenetGuncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = cekSenetGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.cekSenetGuncelle(id, ayristirma.data);
  }

  // ─── BANKA EKSTRESİ (KSB-06) ───────────────────────────────────────────────

  /** Dosyayı ayrıştırıp önizleme + sütun eşlemesi tahminini döner; kaydetmez. */
  @SaltOkumadaAcik()
  @Post("ekstre/onizle")
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("dosya", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async ekstreOnizle(
    @UploadedFile() dosya: YuklemeDosyasi | undefined,
    @Body("bankaHesapId") bankaHesapId?: string,
  ) {
    if (!dosya) throw new BadRequestException("Lütfen bir ekstre dosyası yükleyin");
    await ekstreDosyasiniDogrula(dosya);
    if (!bankaHesapId) throw new BadRequestException("Banka hesabı seçilmelidir");
    return this.ekstre.onizle(bankaHesapId, dosya.buffer);
  }

  /**
   * Eşleme çok parçalı gövdede JSON metni olarak gelir (dosyayla birlikte
   * gönderildiği için `@Body()` nesneye çözülmüyor).
   */
  @Post("ekstre/yukle")
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("dosya", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async ekstreYukle(
    @UploadedFile() dosya: YuklemeDosyasi | undefined,
    @Body("veri") veri?: string,
  ) {
    if (!dosya) throw new BadRequestException("Lütfen bir ekstre dosyası yükleyin");
    await ekstreDosyasiniDogrula(dosya);

    let govde: unknown;
    try {
      govde = JSON.parse(veri ?? "");
    } catch {
      throw new BadRequestException("Yükleme verisi okunamadı");
    }

    const ayristirma = ekstreYukleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }

    return this.ekstre.yukle(
      ayristirma.data.bankaHesapId,
      dosya.buffer,
      dosya.originalname ?? "ekstre.csv",
      ayristirma.data.esleme,
      ayristirma.data.eslemeyiKaydet,
    );
  }

  @Get("ekstre/satirlar")
  async ekstreSatirListele(
    @Query("durum") durum?: string,
    @Query("bankaHesapId") bankaHesapId?: string,
    @Query("arama") arama?: string,
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
    @Query("yon") yon?: "tahsilat" | "tediye",
  ) {
    if (durum && !EKSTRE_DURUMLARI.includes(durum as EkstreSatirDurum)) {
      throw new BadRequestException(
        `Geçersiz durum; beklenen: ${EKSTRE_DURUMLARI.join(", ")}`,
      );
    }
    return this.ekstre.satirListele(
      durum as EkstreSatirDurum | undefined,
      bankaHesapId,
      arama,
      baslangic,
      bitis,
      yon,
    );
  }

  /** KSB-06: ekstre bakiyesi ile sistem bakiyesinin karşılaştırması. */
  @Get("ekstre/mutabakat/:bankaHesapId")
  ekstreMutabakat(@Param("bankaHesapId", ParseUUIDPipe) bankaHesapId: string) {
    return this.ekstre.mutabakat(bankaHesapId);
  }

  /** KSB-06: seçilen satır için bütün eşleme türlerinin önerileri. */
  @Get("ekstre/satirlar/:id/oneriler")
  ekstreOneriler(@Param("id", ParseUUIDPipe) id: string) {
    return this.ekstreEslestirme.oneriler(id);
  }

  /** KSB-33: bekleyen satırlardan belirsizliği olmayan önerisi olanlar. */
  @Get("ekstre/kesin-oneriler")
  @Roller("muhasebe")
  ekstreKesinOneriler(@Query("bankaHesapId") bankaHesapId?: string) {
    return this.ekstreEslestirme.kesinOneriler(bankaHesapId && z.uuid().safeParse(bankaHesapId).success ? bankaHesapId : undefined);
  }

  /** KSB-33: seçilen satırları kesin önerileriyle eşleştirir (öneri sunucuda yeniden hesaplanır). */
  @Post("ekstre/toplu-eslestir")
  @Roller("muhasebe")
  ekstreTopluEslestir(@Body() govde: unknown) {
    const s = z.object({ satirIdleri: z.array(z.uuid()).min(1).max(200) }).safeParse(govde);
    if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
    return this.ekstreEslestirme.topluEslestir([...new Set(s.data.satirIdleri)]);
  }

  @Post("ekstre/satirlar/:id/eslestir")
  @Roller("muhasebe")
  ekstreEslestir(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.ekstreEslestirme.eslestir(id, ayristir(ekstreEslestirSemasi, govde));
  }

  @Post("ekstre/satirlar/:id/yoksay")
  @Roller("muhasebe")
  ekstreYoksay(@Param("id", ParseUUIDPipe) id: string) {
    return this.ekstreEslestirme.yoksay(id);
  }

  @Post("ekstre/satirlar/:id/geri-al")
  @Roller("muhasebe")
  ekstreGeriAl(@Param("id", ParseUUIDPipe) id: string) {
    return this.ekstreEslestirme.geriAl(id);
  }

  @Get("ekstre/kurallar")
  ekstreKurallari() {
    return this.ekstreEslestirme.kurallar();
  }

  @Patch("ekstre/kurallar/:id")
  @Roller("muhasebe")
  ekstreKuralGuncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.ekstreEslestirme.kuralGuncelle(id, ayristir(ekstreKuralGuncelleSemasi, govde));
  }

  @Delete("ekstre/kurallar/:id")
  @Roller("muhasebe")
  @HttpCode(204)
  ekstreKuralSil(@Param("id", ParseUUIDPipe) id: string) {
    return this.ekstreEslestirme.kuralSil(id);
  }
}

/** P1-9: "kasa:<uuid>" ya da "banka:<uuid>". */
function hesapAnahtari(deger: string): { tur: HesapTuru; id: string } {
  const sonuc = z.object({ tur: z.enum(["kasa", "banka"]), id: z.uuid() }).safeParse({ tur: deger.split(":")[0], id: deger.split(":")[1] });
  if (!sonuc.success) throw new BadRequestException("Hesap 'kasa:<id>' ya da 'banka:<id>' biçiminde olmalıdır");
  return sonuc.data;
}

/** KSB-39: ekstre uçları POS hesabını da kabul eder ("pos:<uuid>"). */
function ekstreHesapAnahtari(deger: string): { tur: EkstreHesapTuru; id: string } {
  const sonuc = z.object({ tur: z.enum(["kasa", "banka", "pos"]), id: z.uuid() }).safeParse({ tur: deger.split(":")[0], id: deger.split(":")[1] });
  if (!sonuc.success) throw new BadRequestException("Hesap 'kasa:<id>', 'banka:<id>' ya da 'pos:<id>' biçiminde olmalıdır");
  return sonuc.data;
}

const donemSemasi = z.object({
  baslangic: z.string().date("Geçersiz başlangıç tarihi").optional(),
  bitis: z.string().date("Geçersiz bitiş tarihi").optional(),
}).refine((d) => !d.baslangic || !d.bitis || d.baslangic <= d.bitis, { message: "Başlangıç tarihi bitişten sonra olamaz" });

function ayristir<T extends z.ZodType>(sema: T, govde: unknown): z.infer<T> {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}
