import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { PlatformUcu } from "../auth/public.decorator";
import { SAGLAYICI_ALANLARI, type AbonelikSaglayiciKodu } from "./abonelik-saglayici";
import { SaglayiciAyarlariService } from "./saglayici-ayarlari.service";
import { AbonelikFaturaAyarService } from "./abonelik-fatura-ayar.service";
import { AbonelikFaturaService } from "./abonelik-fatura.service";

const kayitSemasi = z.object({
  ortam: z.enum(["test", "canli"]),
  etkin: z.boolean(),
  alanlar: z.record(z.string(), z.string().max(500)).default({}),
});

/** PLT-11: abonelik ödeme sağlayıcısı ayarı; işaretsiz platform ucu olduğu için yalnız platform yöneticisine açık. */
@PlatformUcu()
@Controller("platform/odeme-saglayicilari")
export class PlatformOdemeController {
  constructor(private readonly ayarlar: SaglayiciAyarlariService) {}

  @Get()
  listele() {
    return this.ayarlar.listele();
  }

  @Put(":saglayici")
  kaydet(@Param("saglayici") saglayici: string, @Body() govde: unknown) {
    if (!(saglayici in SAGLAYICI_ALANLARI)) throw new BadRequestException("Bilinmeyen sağlayıcı");
    const sonuc = kayitSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.ayarlar.kaydet(saglayici as AbonelikSaglayiciKodu, sonuc.data);
  }
}

const hesapSemasi = z.object({ tur: z.enum(["kasa", "banka", "pos"]), id: z.uuid() }).nullable();
const faturaAyarSemasi = z.object({ faturalayanTenantId: z.uuid().nullable(), kartHesap: hesapSemasi, elleHesap: hesapSemasi });

/** PLT-20/23: abonelik faturası ayarı, sorunlu faturalar ve yeniden deneme; yalnız platform yöneticisi. */
@PlatformUcu()
@Controller("platform/abonelik-fatura")
export class PlatformAbonelikFaturaController {
  constructor(
    private readonly ayar: AbonelikFaturaAyarService,
    private readonly fatura: AbonelikFaturaService,
  ) {}

  @Get()
  getir() {
    return this.ayar.getir();
  }

  @Get("hesaplar/:tenantId")
  hesaplar(@Param("tenantId", ParseUUIDPipe) tenantId: string) {
    return this.ayar.hesaplar(tenantId);
  }

  @Put()
  kaydet(@Body() govde: unknown) {
    const sonuc = faturaAyarSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.ayar.kaydet(sonuc.data);
  }

  @Post(":odemeId/yeniden-dene")
  @HttpCode(200)
  async yenidenDene(@Param("odemeId", ParseUUIDPipe) odemeId: string) {
    const bag = await this.fatura.yenidenDene(odemeId);
    return { mesaj: bag?.durum === "taslak" ? "Taslak fatura açıldı." : bag?.durum === "tahsil_edildi" ? "Tahsilat açıldı." : `Durum: ${bag?.durum ?? "bilinmiyor"}${bag?.hata ? ` — ${bag.hata}` : ""}`, bag };
  }
}
