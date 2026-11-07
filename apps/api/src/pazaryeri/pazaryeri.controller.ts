import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { z } from "zod";
import { pazaryeriFaturalastirSemasi, pazaryeriKesintiGiderlestirSemasi, pazaryeriKesintiSemasi, pazaryeriSiparisSemasi, pazaryeriSatirEsleSemasi, pazaryeriKesintiSinifSemasi, pazaryeriFaturaVknSemasi, pazaryeriKesintiEslestirSemasi, pazaryeriKesintiMasrafSemasi } from "./pazaryeri.semalar";
import { PazaryeriEslestirmeService } from "./pazaryeri-eslestirme.service";
import { PazaryeriService } from "./pazaryeri.service";

@Controller("pazaryeri")
export class PazaryeriController {
  constructor(private readonly service: PazaryeriService, private readonly eslestirme: PazaryeriEslestirmeService) {}
  // Müşterinin adı, telefonu, TCKN/VKN'si ve adresi döner; ekran yalnız muhasebede.
  @Get("siparisler") @Roller("muhasebe") listele(@Query("durum") durum?: string) { return this.service.listele(durum); }
  @Post("siparisler/ice-aktar") @Roller("yonetici")
  iceAktar(@Body() govde: unknown) {
    const sonuc = pazaryeriSiparisSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.iceAktar(sonuc.data);
  }
  @Post("siparisler/faturalastir") @Roller("yonetici", "muhasebe")
  faturalastir(@Body() govde: unknown) {
    const sonuc = pazaryeriFaturalastirSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.faturalastir(sonuc.data.siparisler);
  }
  @Post("siparisler/:siparisId/satirlar/:satirId/esle") @Roller("yonetici", "muhasebe")
  satirEsle(@Param("siparisId") siparisId: string, @Param("satirId") satirId: string, @Body() govde: unknown) {
    const sonuc = pazaryeriSatirEsleSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.satirEsle(siparisId, satirId, sonuc.data);
  }
  @Post("senkronize") @Roller("yonetici", "muhasebe")
  senkronize(@Body() govde: unknown) {
    const sonuc = z.object({ baglantiId: z.string().uuid().optional() }).safeParse(govde ?? {});
    if (!sonuc.success) throw new BadRequestException("Geçersiz bağlantı");
    return this.service.senkronizeEt(sonuc.data.baglantiId);
  }
  @Post("stok-fiyat/senkronize") @Roller("yonetici")
  stokFiyatSenkronize(@Body() govde: unknown) {
    const sonuc = z.object({ baglantiId: z.string().uuid().optional() }).safeParse(govde ?? {});
    if (!sonuc.success) throw new BadRequestException("Geçersiz bağlantı");
    return this.service.stokFiyatSenkronizeEt(sonuc.data.baglantiId);
  }
  @Get("kesintiler") @Roller("yonetici", "muhasebe")
  kesintileriListele(@Query("durum") durum?: string) {
    if (durum && !["bekliyor", "giderlesti", "faturayla_eslesti", "faturasiz", "masrafa_donustu"].includes(durum)) throw new BadRequestException("Geçersiz kesinti durumu");
    return this.service.kesintileriListele(durum);
  }
  @Post("kesintiler/ice-aktar") @Roller("yonetici", "muhasebe")
  kesintiIceAktar(@Body() govde: unknown) {
    const sonuc = pazaryeriKesintiSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.kesintiIceAktar(sonuc.data);
  }
  /** PZR-10: faturasız kesintileri (ceza, diğer) masraf kaydına dönüştür. */
  @Post("kesintiler/masrafa-donustur") @Roller("yonetici", "muhasebe")
  kesintileriMasrafla(@Body() govde: unknown) {
    const sonuc = pazaryeriKesintiMasrafSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.kesintileriMasrafla(sonuc.data);
  }

  /** PZR-09: yıllık stopaj özeti. */
  @Get("kesintiler/stopaj-ozeti") @Roller("yonetici", "muhasebe")
  stopajOzeti(@Query("yil") yil?: string) {
    const y = yil ? Number(yil) : new Date().getFullYear();
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException("Geçersiz yıl");
    return this.service.stopajOzeti(y);
  }

  /** PZR-07: komisyon faturası eşleştirme durumu (bağlantı başına VKN, faturalar, öneriler, faturası gelmeyenler). */
  @Get("kesintiler/eslestirme") @Roller("yonetici", "muhasebe")
  eslestirmeDurumu() {
    return this.eslestirme.durum();
  }

  /** PZR-07: bağlantının fatura kesen VKN'si. */
  @Post("baglantilar/:id/fatura-vkn") @Roller("yonetici", "muhasebe")
  faturaVknAyarla(@Param("id") id: string, @Body() govde: unknown) {
    const sonuc = pazaryeriFaturaVknSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    if (!z.string().uuid().safeParse(id).success) throw new BadRequestException("Geçersiz bağlantı");
    return this.eslestirme.vknAyarla(id, sonuc.data.vkn);
  }

  /** PZR-07: kesintileri faturaya bağla (öneri onayı ya da elle seçim). */
  @Post("kesintiler/eslestir") @Roller("yonetici", "muhasebe")
  kesintileriEslestir(@Body() govde: unknown) {
    const sonuc = pazaryeriKesintiEslestirSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.eslestirme.eslestir(sonuc.data);
  }

  /** PZR-07: faturanın eşleşmesini kaldır. */
  @Post("kesintiler/eslesme-kaldir/:gelenEbelgeId") @Roller("yonetici", "muhasebe")
  eslesmeyiKaldir(@Param("gelenEbelgeId") gelenEbelgeId: string) {
    if (!z.string().uuid().safeParse(gelenEbelgeId).success) throw new BadRequestException("Geçersiz fatura");
    return this.eslestirme.eslesmeyiKaldir(gelenEbelgeId);
  }

  /** PZR-08: kesinti türleri ve sınıfları. */
  @Get("kesintiler/turler") @Roller("yonetici", "muhasebe")
  kesintiTurleri() {
    return this.service.kesintiTurleri();
  }

  /** PZR-08: türün sınıfını seç (kalıcı kural; işlenmemiş kesintiler güncellenir). */
  @Post("kesintiler/turler/sinif") @Roller("yonetici", "muhasebe")
  kesintiTuruSinifla(@Body() govde: unknown) {
    const sonuc = pazaryeriKesintiSinifSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.kesintiTuruSinifla(sonuc.data);
  }

  @Post("kesintiler/giderlestir") @Roller("yonetici", "muhasebe")
  kesintileriGiderlestir(@Body() govde: unknown) {
    const sonuc = pazaryeriKesintiGiderlestirSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.kesintileriGiderlestir(sonuc.data);
  }
  @Post("kesintiler/senkronize") @Roller("yonetici", "muhasebe")
  kesintileriSenkronize(@Body() govde: unknown) {
    const sonuc = z.object({ baglantiId: z.string().uuid().optional() }).safeParse(govde ?? {});
    if (!sonuc.success) throw new BadRequestException("Geçersiz bağlantı");
    return this.service.kesintileriSenkronizeEt(sonuc.data.baglantiId);
  }
}
