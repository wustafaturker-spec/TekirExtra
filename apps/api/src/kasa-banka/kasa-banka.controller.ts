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
import { KasaBankaService } from "./kasa-banka.service";
import { BankaEntegrasyonService } from "./banka-entegrasyon.service";
import { z } from "zod";
import { OdemeTalimatiService } from "./odeme-talimati.service";
import {
  bankaHesapGuncelleSemasi,
  bankaHesapOlusturSemasi,
  cekSenetGuncelleSemasi,
  cekSenetOlusturSemasi,
  ekstreEslestirSemasi,
  ekstreYukleSemasi,
  kasaBankaHareketOlusturSemasi,
  kasaGuncelleSemasi,
  kasaOlusturSemasi,
  virmanOlusturSemasi,
  posHesapOlusturSemasi,
  posBankaAktarimSemasi,
} from "./kasa-banka.semalar";

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
    private readonly ekstre: EkstreService,
    private readonly bankaEntegrasyon: BankaEntegrasyonService,
    private readonly odemeTalimati: OdemeTalimatiService,
  ) {}

  @Get("odeme-talimatlari")
  odemeTalimatlari() { return this.odemeTalimati.listele(); }

  @Post("odeme-talimatlari") @Roller("muhasebe", "yonetici")
  odemeTalimatiOlustur(@Body() govde: unknown) { const s = z.object({ bankaHesapId: z.uuid(), aliciUnvan: z.string().min(2).max(200), aliciIban: z.string().transform((x) => x.replace(/\s/g, "")).pipe(z.string().regex(/^TR\d{24}$/i, "Geçerli bir TR IBAN girin")), tutar: z.string().regex(/^\d+(\.\d{1,2})?$/), aciklama: z.string().min(1).max(140) }).safeParse(govde); if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; ")); return this.odemeTalimati.olustur(s.data); }

  @Post("odeme-talimatlari/:id/onayla") @Roller("muhasebe", "yonetici")
  odemeTalimatiOnayla(@Param("id") id: string, @Body() govde: unknown) { const s = z.object({ totpKodu: z.string().regex(/^\d{6}$/) }).safeParse(govde); if (!s.success) throw new BadRequestException("6 haneli TOTP kodu gereklidir"); return this.odemeTalimati.onayla(id, s.data.totpKodu); }

  @Post("odeme-talimatlari/:id/iptal") @Roller("muhasebe", "yonetici")
  odemeTalimatiIptal(@Param("id") id: string) { return this.odemeTalimati.iptal(id); }

  @Get("banka-baglantilari/eslemeler")
  bankaEslemeleri() { return this.bankaEntegrasyon.eslemeleriListele(); }

  @Post("banka-baglantilari/eslemeler") @Roller("muhasebe")
  bankaEslemeEkle(@Body() govde: unknown) { const s = z.object({ baglantiId: z.uuid(), bankaHesapId: z.uuid(), disHesapId: z.string().min(1).max(100) }).safeParse(govde); if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; ")); return this.bankaEntegrasyon.eslemeEkle(s.data); }

  @Get("banka-baglantilari/:id/vomsis-hesaplari")
  vomsisHesaplari(@Param("id") id: string) { return this.bankaEntegrasyon.vomsisHesaplari(id); }

  @Post("banka-baglantilari/:id/senkronize") @Roller("muhasebe")
  bankaSenkronize(@Param("id") id: string) { return this.bankaEntegrasyon.senkronize(id); }

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
    const ayristirma = kasaOlusturSemasi.safeParse(govde);
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
    const ayristirma = bankaHesapOlusturSemasi.safeParse(govde);
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

  @Post("pos-hesaplari/bankaya-aktar")
  @Roller("muhasebe")
  async posBankayaAktar(@Body() govde: unknown) {
    const ayristirma = posBankaAktarimSemasi.safeParse(govde);
    if (!ayristirma.success) throw new BadRequestException(ayristirma.error.issues.map((i) => i.message).join("; "));
    return this.service.posBankayaAktar(ayristirma.data);
  }

  // ─── HAREKET ENDPOINTS ─────────────────────────────────────────────────────

  @Get("hareketler")
  async hareketListele(
    @Query("kasaId") kasaId?: string,
    @Query("bankaHesapId") bankaHesapId?: string,
    @Query("posHesapId") posHesapId?: string,
  ) {
    return this.service.hareketListele(kasaId, bankaHesapId, posHesapId);
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
  ) {
    return this.service.cekSenetListele(tur, durum, yon, arama, baslangic, bitis);
  }

  @Get("cek-senet-ozet")
  async cekSenetOzet(@Query("yon") yon?: string) {
    return this.service.cekSenetOzet(yon);
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
  @Post("ekstre/onizle")
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("dosya", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async ekstreOnizle(
    @UploadedFile() dosya: YuklemeDosyasi | undefined,
    @Body("bankaHesapId") bankaHesapId?: string,
  ) {
    if (!dosya) throw new BadRequestException("Lütfen bir ekstre dosyası yükleyin");
    ekstreDosyasiniDogrula(dosya);
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
    ekstreDosyasiniDogrula(dosya);

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

  @Post("ekstre/satirlar/:id/eslestir")
  @Roller("muhasebe")
  async ekstreEslestir(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = ekstreEslestirSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.ekstre.eslestir(id, ayristirma.data);
  }

  @Post("ekstre/satirlar/:id/yoksay")
  @Roller("muhasebe")
  async ekstreYoksay(@Param("id") id: string) {
    return this.ekstre.yoksay(id);
  }

  @Post("ekstre/satirlar/:id/geri-al")
  @Roller("muhasebe")
  async ekstreGeriAl(@Param("id") id: string) {
    return this.ekstre.geriAl(id);
  }
}

/** KSB-08: geri alma ve düzeltmede gerekçe zorunludur; denetim izine yazılır. */
const geriAlmaSemasi = z.object({
  neden: z.string().trim().min(3, "Geri alma gerekçesi en az 3 karakter olmalıdır").max(300),
});

function ayristir<T extends z.ZodType>(sema: T, govde: unknown): z.infer<T> {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}
