import { Controller, Delete, Get, Post, Put, Body, Param, Query } from "@nestjs/common";
import { PersonelService } from "./personel.service";
import { 
  personelOlusturSemasi, 
  personelGuncelleSemasi, 
  bordroTahakkukSemasi, 
  bordroOdeSemasi, 
  avansOlusturSemasi 
} from "./personel.semalar";
import { personelIstenCikarSemasi, personelYenidenBaslatSemasi } from "./personel.semalar";
import { bordroRetSemasi } from "./personel.semalar";
import { bordroListeFiltreSemasi } from "./personel.semalar";
import { bordroKalemOlusturSemasi } from "./personel.semalar";
import { bordroOdemeIptalSemasi } from "./personel.semalar";
import { avansMahsupSemasi, avansOdeSemasi, avansRetSemasi } from "./personel.semalar";
import { donemCalismaSemasi } from "./personel.semalar";
import { aktifBaglam } from "../core/istek-baglami";
import { Roller } from "../auth/roller.decorator";

@Controller("personel")
@Roller("muhasebe")
export class PersonelController {
  constructor(private readonly personelService: PersonelService) {}

  @Get()
  async listele(@Query("arama") arama?: string) {
    const { tenantId } = aktifBaglam();
    return this.personelService.listele(tenantId, arama);
  }

  @Get("bordrolar")
  async bordroListele(@Query("yil") yil?: string, @Query("ay") ay?: string) {
    const { tenantId } = aktifBaglam();
    const filtre = bordroListeFiltreSemasi.parse({ yil, ay });
    return this.personelService.bordroListele(tenantId, filtre.yil, filtre.ay);
  }

  @Get("calisma-gunleri")
  async calismaGunleri(@Query("yil") yil?: string, @Query("ay") ay?: string) {
    const { tenantId } = aktifBaglam(); const f = bordroListeFiltreSemasi.parse({ yil, ay });
    if (!f.yil || !f.ay) return [];
    return this.personelService.donemCalismaListele(tenantId, f.yil, f.ay);
  }

  @Get("bordrolar/banka-dosyasi")
  async bankaMaasDosyasi(
    @Query("yil") yil: string,
    @Query("ay") ay: string,
    @Query("format") format?: "garanti" | "akbank" | "isbank" | "standart"
  ) {
    const { tenantId } = aktifBaglam();
    return this.personelService.bankaMaasDosyasiOlustur(tenantId, Number(yil), Number(ay), format || "standart");
  }

  @Post("calisma-gunleri")
  async calismaGunuKaydet(@Body() body: unknown) { return this.personelService.donemCalismaKaydet(aktifBaglam().tenantId, donemCalismaSemasi.parse(body)); }

  @Get("bordrolar/:bordroId")
  async bordroGetir(@Param("bordroId") bordroId: string) {
    const { tenantId } = aktifBaglam();
    return this.personelService.bordroGetir(tenantId, bordroId);
  }

  @Get("avanslar")
  async avansListele(@Query("personelId") personelId?: string) {
    const { tenantId } = aktifBaglam();
    return this.personelService.avansListele(tenantId, personelId);
  }

  @Get(":id")
  async getir(@Param("id") id: string) {
    const { tenantId } = aktifBaglam();
    return this.personelService.getir(tenantId, id);
  }

  @Get(":id/hassas-veriler")
  async hassasVeriGetir(@Param("id") id: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.personelService.hassasVeriGetir(tenantId, id, userId);
  }

  @Post("hassas-verileri-sifrele")
  @Roller("yonetici")
  async hassasVerileriSifrele() {
    const { tenantId, userId } = aktifBaglam();
    return this.personelService.hassasVerileriSifrele(tenantId, userId);
  }

  @Post()
  async olustur(@Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const veri = personelOlusturSemasi.parse(body);
    return this.personelService.olustur(tenantId, veri);
  }

  @Put(":id")
  async guncelle(@Param("id") id: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const veri = personelGuncelleSemasi.parse(body);
    return this.personelService.guncelle(tenantId, id, veri);
  }

  @Post(":id/isten-cikar")
  async istenCikar(@Param("id") id: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    return this.personelService.istenCikar(tenantId, id, personelIstenCikarSemasi.parse(body));
  }

  @Post(":id/yeniden-baslat")
  async yenidenBaslat(@Param("id") id: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    return this.personelService.yenidenBaslat(tenantId, id, personelYenidenBaslatSemasi.parse(body));
  }

  @Post("bordrolar/tahakkuk")
  async bordroTopluTahakkuk(@Body() body: unknown) {
    const { tenantId, userId } = aktifBaglam();
    const veri = bordroTahakkukSemasi.parse(body);
    return this.personelService.bordroTopluTahakkuk(tenantId, userId, veri);
  }

  @Post("bordrolar/:bordroId/onaya-gonder")
  async bordroOnayaGonder(@Param("bordroId") bordroId: string) {
    const { tenantId } = aktifBaglam();
    return this.personelService.bordroOnayaGonder(tenantId, bordroId);
  }

  @Post("bordrolar/:bordroId/onayla")
  async bordroOnayla(@Param("bordroId") bordroId: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.personelService.bordroOnayla(tenantId, bordroId, userId);
  }

  @Post("bordrolar/:bordroId/reddet")
  async bordroReddet(@Param("bordroId") bordroId: string, @Body() body: unknown) {
    const { tenantId, userId } = aktifBaglam();
    const { neden } = bordroRetSemasi.parse(body);
    return this.personelService.bordroReddet(tenantId, bordroId, userId, neden);
  }

  @Post("bordrolar/:bordroId/kalemler")
  async bordroKalemEkle(@Param("bordroId") bordroId: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    return this.personelService.bordroKalemEkle(tenantId, bordroId, bordroKalemOlusturSemasi.parse(body));
  }

  @Post("bordrolar/:bordroId/avans-mahsuplari")
  async bordroAvansMahsup(@Param("bordroId") bordroId: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    return this.personelService.bordroAvansMahsup(tenantId, bordroId, avansMahsupSemasi.parse(body));
  }

  @Delete("bordrolar/:bordroId/kalemler/:kalemId")
  async bordroKalemSil(@Param("bordroId") bordroId: string, @Param("kalemId") kalemId: string) {
    const { tenantId } = aktifBaglam();
    return this.personelService.bordroKalemSil(tenantId, bordroId, kalemId);
  }

  @Post("bordrolar/:bordroId/odemeler")
  async bordroOde(@Param("bordroId") bordroId: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const veri = bordroOdeSemasi.parse(body);
    return this.personelService.bordroOde(tenantId, bordroId, veri);
  }

  @Post("bordrolar/:bordroId/odemeler/:odemeId/iptal")
  async bordroOdemeIptal(@Param("bordroId") bordroId: string, @Param("odemeId") odemeId: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const { neden } = bordroOdemeIptalSemasi.parse(body);
    return this.personelService.bordroOdemeIptal(tenantId, bordroId, odemeId, neden);
  }

  @Post("avanslar")
  async avansVer(@Body() body: unknown) {
    const { tenantId, userId } = aktifBaglam();
    const veri = avansOlusturSemasi.parse(body);
    return this.personelService.avansVer(tenantId, userId, veri);
  }

  @Post("avanslar/:avansId/onayla")
  async avansOnayla(@Param("avansId") avansId: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.personelService.avansOnayla(tenantId, avansId, userId);
  }

  @Post("avanslar/:avansId/reddet")
  async avansReddet(@Param("avansId") avansId: string, @Body() body: unknown) {
    const { tenantId, userId } = aktifBaglam();
    const { neden } = avansRetSemasi.parse(body);
    return this.personelService.avansReddet(tenantId, avansId, userId, neden);
  }

  @Post("avanslar/:avansId/odemeler")
  async avansOde(@Param("avansId") avansId: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    return this.personelService.avansOde(tenantId, avansId, avansOdeSemasi.parse(body));
  }
}
