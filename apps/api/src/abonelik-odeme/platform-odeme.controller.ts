import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { PlatformUcu } from "../auth/public.decorator";
import { SAGLAYICI_ALANLARI, type AbonelikSaglayiciKodu } from "./abonelik-saglayici";
import { SaglayiciAyarlariService } from "./saglayici-ayarlari.service";
import { AbonelikFaturaAyarService } from "./abonelik-fatura-ayar.service";
import { AbonelikFaturaService } from "./abonelik-fatura.service";
import { PlatformAbonelikIadeService } from "./platform-abonelik-iade.service";

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

const iadeSemasi = z.object({
  tutar: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "Tutar en çok iki ondalıklı olmalı").refine((v) => Number(v) > 0, "Tutar sıfırdan büyük olmalı"),
  neden: z.string().trim().min(3, "İade nedeni en az 3 karakter olmalı").max(300),
  saglayiciyaGonder: z.boolean().default(true),
  islemAnahtari: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/, "Geçersiz işlem anahtarı"),
});

/** PLT-42…46: abonelik ödemesinin platformdan iadesi; yalnız platform yöneticisi. */
@PlatformUcu()
@Controller("platform/abonelik-odemeleri")
export class PlatformAbonelikIadeController {
  constructor(private readonly iade: PlatformAbonelikIadeService) {}

  @Post(":odemeId/iade")
  @HttpCode(200)
  iadeEt(@Param("odemeId", ParseUUIDPipe) odemeId: string, @Body() govde: unknown) {
    const sonuc = iadeSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.iade.iadeEt(odemeId, sonuc.data);
  }
}
