import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { MEVZUAT_TURLERI } from "@tekirextra/shared";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformUcu, Public } from "../auth/public.decorator";
import { KABUL_SONUC_ALANLARI, kabulSenaryolariSemasi } from "./bordro-kabul";
import { PlatformAuthService } from "./platform-auth.service";
import { PlatformMevzuatService } from "./platform-mevzuat.service";
import { PlatformAiTavanService } from "./platform-ai-tavan.service";
import { PlatformFirmaService } from "./platform-firma.service";

const tarih = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD olmalıdır");
const degisiklikSemasi = z.object({
  baslik: z.string().trim().min(3, "Başlık en az 3 karakter").max(200),
  dayanak: z.string().trim().min(5, "Mevzuat dayanağı zorunludur (tebliğ/kılavuz adı, sayısı, tarihi)").max(500),
  aciklama: z.string().trim().max(2000).optional().nullable(),
  yururlukBaslangic: tarih,
});
const satirlarSemasi = z.object({
  satirlar: z.array(z.object({
    tur: z.enum(MEVZUAT_TURLERI),
    anahtar: z.string().trim().min(1).max(40),
    islem: z.enum(["ekle", "degistir", "kaldir"]),
    deger: z.unknown().optional(),
  })).max(500),
});
const girisSemasi = z.object({ eposta: z.string().email(), parola: z.string().min(1), totpKodu: z.string().regex(/^\d{6}$/, "Doğrulama kodu 6 hane olmalıdır") });
const talepSemasi = z.object({ durum: z.enum(["acik", "cozuldu", "reddedildi"]), cozumNotu: z.string().trim().max(2000).optional().nullable() });

function ayristir<T>(sema: z.ZodType<T>, govde: unknown): T {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

/** MVZ-04: platform ekibi girişi; kiracı oturumundan ayrıdır. */
@Controller("platform/auth")
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Public()
  @Post("giris")
  giris(@Body() govde: unknown) {
    const { eposta, parola, totpKodu } = ayristir(girisSemasi, govde);
    return this.auth.giris(eposta, parola, totpKodu);
  }

  @PlatformUcu()
  @Get("ben")
  ben() {
    return aktifPlatformBaglam();
  }
}

/** MVZ-05…08: Mevzuat Merkezi yönetimi (yalnız platform token'ı). */
@PlatformUcu()
@Controller("platform/mevzuat")
export class PlatformMevzuatController {
  constructor(private readonly mevzuat: PlatformMevzuatService) {}

  @Get("degisiklikler")
  listele(@Query("durum") durum?: string) {
    const d = durum ? ayristir(z.enum(["taslak", "onay_bekliyor", "yayinlandi"]), durum) : undefined;
    return this.mevzuat.listele(d);
  }

  @Post("degisiklikler")
  olustur(@Body() govde: unknown) {
    return this.mevzuat.olustur(ayristir(degisiklikSemasi, govde));
  }

  @Get("degisiklikler/:id")
  getir(@Param("id", ParseUUIDPipe) id: string) {
    return this.mevzuat.getir(id);
  }

  @Patch("degisiklikler/:id")
  async guncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    await this.mevzuat.guncelle(id, ayristir(degisiklikSemasi, govde));
    return this.mevzuat.getir(id);
  }

  @Delete("degisiklikler/:id")
  async sil(@Param("id", ParseUUIDPipe) id: string) {
    await this.mevzuat.sil(id);
    return { durum: "ok" };
  }

  @Put("degisiklikler/:id/satirlar")
  async satirlar(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    await this.mevzuat.satirlariYaz(id, ayristir(satirlarSemasi, govde).satirlar);
    return this.mevzuat.getir(id);
  }

  /** MVZ-14: bordro parametresi değişikliğinin kabul senaryoları. */
  @Put("degisiklikler/:id/kabul-senaryolari")
  async kabulSenaryolari(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    await this.mevzuat.kabulSenaryolariYaz(id, ayristir(kabulSenaryolariSemasi, govde).senaryolar);
    return this.mevzuat.getir(id);
  }

  @Post("degisiklikler/:id/kabul-senaryolari/calistir")
  async kabulCalistir(@Param("id", ParseUUIDPipe) id: string) {
    await this.mevzuat.kabulSenaryolariCalistir(id);
    return this.mevzuat.getir(id);
  }

  @Get("kabul-sonuc-alanlari")
  kabulSonucAlanlari() {
    return KABUL_SONUC_ALANLARI;
  }

  @Post("degisiklikler/:id/onaya-gonder")
  async onayaGonder(@Param("id", ParseUUIDPipe) id: string) {
    await this.mevzuat.onayaGonder(id);
    return this.mevzuat.getir(id);
  }

  @Post("degisiklikler/:id/taslaga-cek")
  async taslagaCek(@Param("id", ParseUUIDPipe) id: string) {
    await this.mevzuat.taslagaCek(id);
    return this.mevzuat.getir(id);
  }

  @Post("degisiklikler/:id/geri-cevir")
  async geriCevir(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { gerekce } = ayristir(z.object({ gerekce: z.string().trim().min(5, "Geri çevirme gerekçesi zorunludur").max(2000) }), govde);
    await this.mevzuat.geriCevir(id, gerekce);
    return this.mevzuat.getir(id);
  }

  @Post("degisiklikler/:id/yayinla")
  async yayinla(@Param("id", ParseUUIDPipe) id: string) {
    const sonuc = await this.mevzuat.yayinla(id);
    return { ...sonuc, degisiklik: await this.mevzuat.getir(id) };
  }

  @Get("kayitlar")
  kayitlar(@Query("tur") tur: string, @Query("tarih") tarihDegeri?: string, @Query("anahtar") anahtar?: string) {
    return this.mevzuat.kayitlar(ayristir(z.enum(MEVZUAT_TURLERI), tur), tarihDegeri ? ayristir(tarih, tarihDegeri) : undefined, anahtar || undefined);
  }

  @Get("olaylar")
  olaylar(@Query("sayfa") sayfa?: string) {
    return this.mevzuat.olaylar(Number(sayfa) || 1);
  }

  /** MVZ-17: dönemsel değerlerin (bordro, kıdem tavanı, tevkifat alt sınırı) yayın takvimi. */
  @Get("yayin-takvimi")
  yayinTakvimi() {
    return this.mevzuat.yayinTakvimi();
  }

  @Get("talepler")
  talepler(@Query("durum") durum?: string) {
    return this.mevzuat.talepler(durum ? ayristir(z.enum(["acik", "cozuldu", "reddedildi"]), durum) : undefined);
  }

  @Patch("talepler/:id")
  async talepGuncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { durum, cozumNotu } = ayristir(talepSemasi, govde);
    await this.mevzuat.talepGuncelle(id, durum, cozumNotu);
    return { durum: "ok" };
  }
}

const tavanSemasi = z.object({ aylikTavanUsd: z.number().min(0, "Tavan negatif olamaz").max(1_000_000, "Tavan en çok 1.000.000 USD").nullable() });

/** AI-31: platform anahtarıyla çalışan kiracıların aylık yapay zekâ tavanı. */
@PlatformUcu()
@Controller("platform/ai")
export class PlatformAiController {
  constructor(private readonly tavan: PlatformAiTavanService) {}

  @Get("kiracilar")
  listele() {
    return this.tavan.listele();
  }

  @Put("kiracilar/:tenantId/tavan")
  tavanYaz(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Body() govde: unknown) {
    return this.tavan.tavanYaz(tenantId, ayristir(tavanSemasi, govde).aylikTavanUsd);
  }
}

const durumSemasi = z.object({ durum: z.enum(["askida", "aktif"]), neden: z.string().trim().min(5, "Neden en az 5 karakter").max(500) });
const planSemasi = z.object({ planKodu: z.string().min(1).max(40), neden: z.string().trim().min(5, "Neden en az 5 karakter").max(500) });
const kararSemasi = z.object({ onay: z.boolean(), not: z.string().trim().max(500).optional().nullable() });

/** Platform P0-1 / P1-1: firma genel bakışı ve abonelik yönetimi. */
@PlatformUcu()
@Controller("platform/firmalar")
export class PlatformFirmaController {
  constructor(private readonly firmalar: PlatformFirmaService) {}

  @Get()
  listele() {
    return this.firmalar.listele();
  }

  @Get(":tenantId/gecmis")
  gecmis(@Param("tenantId", ParseUUIDPipe) tenantId: string) {
    return this.firmalar.gecmis(tenantId);
  }

  @Post(":tenantId/durum")
  durum(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Body() govde: unknown) {
    const g = ayristir(durumSemasi, govde);
    return this.firmalar.durumDegistir(tenantId, g.durum, g.neden);
  }

  @Post(":tenantId/plan")
  plan(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Body() govde: unknown) {
    const g = ayristir(planSemasi, govde);
    return this.firmalar.planDegistir(tenantId, g.planKodu, g.neden);
  }

  @Post("talepler/:talepId/karar")
  karar(@Param("talepId", ParseUUIDPipe) talepId: string, @Body() govde: unknown) {
    const g = ayristir(kararSemasi, govde);
    return this.firmalar.talepKarar(talepId, g.onay, g.not ?? null);
  }
}
