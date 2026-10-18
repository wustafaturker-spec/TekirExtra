import { PersonelKuyrukService } from "./personel-kuyruk.service";
import { PersonelErisimGuard } from "./personel-erisim.guard";
import { BadRequestException, Controller, Delete, Get, Post, Put, Body, Param, ParseUUIDPipe, Query, Res, UploadedFile, UseInterceptors, UseGuards } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { excelDosyasiniDogrula, type YuklemeDosyasi } from "../core/guvenlik/dosya-dogrulama";
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
import { bordroTopluSemasi, donemCalismaSemasi, personelCariBaglaSemasi, personelUcretSemasi } from "./personel.semalar";
import { aktifBaglam } from "../core/istek-baglami";
import { sayfaAdedi } from "../core/sayfalama";
import { Roller } from "../auth/roller.decorator";

@Controller("personel")
@Roller("muhasebe", "ik")
@UseGuards(PersonelErisimGuard)
export class PersonelController {
  constructor(private readonly personelService: PersonelService, private readonly kuyruk: PersonelKuyrukService) {}

  @Get()
  async listele(@Query("arama") arama?: string, @Query("durum") durum?: string, @Query("departmanId") departmanId?: string, @Query("adet") adet?: string, @Query("imlec") imlec?: string) {
    const { tenantId } = aktifBaglam();
    if (departmanId && !/^[0-9a-f-]{36}$/i.test(departmanId)) throw new BadRequestException("Geçersiz departman");
    return this.personelService.listele(tenantId, arama, { durum, departmanId, adet: adet ? sayfaAdedi(adet) : undefined, imlec });
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
  async bankaMaasDosyasi(@Query("yil") yil?: string, @Query("ay") ay?: string) {
    const { tenantId, userId } = aktifBaglam();
    const f = bordroListeFiltreSemasi.parse({ yil, ay });
    if (!f.yil || !f.ay) throw new BadRequestException("Dönem için yıl ve ay zorunludur");
    return this.personelService.bankaMaasDosyasiOlustur(tenantId, userId, f.yil, f.ay);
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
    const { tenantId, userId } = aktifBaglam();
    const veri = personelGuncelleSemasi.parse(body);
    return this.personelService.guncelle(tenantId, id, veri, userId);
  }

  @Post(":id/cikis-onizleme")
  cikisOnizleme(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.personelService.cikisOnizleme(aktifBaglam().tenantId, id, body);
  }

  @Post(":id/isten-cikar")
  async istenCikar(@Param("id") id: string, @Body() body: unknown) {
    const { tenantId, userId } = aktifBaglam();
    return this.personelService.istenCikar(tenantId, id, personelIstenCikarSemasi.parse(body), userId);
  }

  @Post(":id/yeniden-baslat")
  async yenidenBaslat(@Param("id") id: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    return this.personelService.yenidenBaslat(tenantId, id, personelYenidenBaslatSemasi.parse(body));
  }

  /** PRS-20: büyük kadroda arka plan işi döner ({ arkaPlan: true, isId }); ekran durumu izler. */
  @Post("bordrolar/tahakkuk")
  async bordroTopluTahakkuk(@Body() body: unknown) {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.kuyruk.tahakkukBaslat(tenantId, userId, rol, body);
  }

  @Get("bordrolar/tahakkuk-isleri/:isId")
  tahakkukIsDurumu(@Param("isId") isId: string) {
    return this.kuyruk.isDurumu(aktifBaglam().tenantId, isId);
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

  @Post("bordrolar/toplu")
  async bordroToplu(@Body() body: unknown) {
    const { tenantId, userId } = aktifBaglam();
    return this.personelService.bordroToplu(tenantId, userId, bordroTopluSemasi.parse(body));
  }

  @Get("calisma-gunleri/sablon")
  async puantajSablonu(@Query("yil") yil: string, @Query("ay") ay: string, @Res() res: Response) {
    const f = bordroListeFiltreSemasi.parse({ yil, ay });
    if (!f.yil || !f.ay) throw new BadRequestException("Dönem için yıl ve ay zorunludur");
    const buffer = await this.personelService.puantajSablonuUret(aktifBaglam().tenantId, f.yil, f.ay);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=puantaj-${f.yil}-${String(f.ay).padStart(2, "0")}.xlsx`);
    res.send(buffer);
  }

  @Post("calisma-gunleri/excel")
  @UseInterceptors(FileInterceptor("dosya", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async puantajIceAktar(@Query("yil") yil: string, @Query("ay") ay: string, @UploadedFile() dosya?: YuklemeDosyasi) {
    const f = bordroListeFiltreSemasi.parse({ yil, ay });
    if (!f.yil || !f.ay) throw new BadRequestException("Dönem için yıl ve ay zorunludur");
    if (!dosya) throw new BadRequestException("Excel dosyası seçin");
    await excelDosyasiniDogrula(dosya);
    return this.personelService.puantajIceAktar(aktifBaglam().tenantId, f.yil, f.ay, dosya.buffer);
  }

  @Post("bordrolar/:bordroId/yeniden-hesapla")
  async bordroYenidenHesapla(@Param("bordroId", ParseUUIDPipe) bordroId: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.personelService.bordroYenidenHesapla(tenantId, bordroId, userId);
  }

  /** PRS-03: yalnız yönetici; gerekçe zorunlu. */
  @Post("bordrolar/:bordroId/onay-geri-al")
  @Roller("yonetici")
  async bordroOnayGeriAl(@Param("bordroId", ParseUUIDPipe) bordroId: string, @Body() body: unknown) {
    const { tenantId, userId } = aktifBaglam();
    const { neden } = bordroRetSemasi.parse(body);
    return this.personelService.bordroOnayGeriAl(tenantId, bordroId, userId, neden);
  }

  @Delete("bordrolar/:bordroId")
  async bordroSil(@Param("bordroId", ParseUUIDPipe) bordroId: string, @Body() body: unknown) {
    const { tenantId, userId } = aktifBaglam();
    const { neden } = bordroRetSemasi.parse(body ?? {});
    return this.personelService.bordroSil(tenantId, bordroId, userId, neden);
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

  @Post("avanslar/:avansId/odeme-iptal")
  async avansOdemeIptal(@Param("avansId", ParseUUIDPipe) avansId: string, @Body() body: unknown) {
    const { tenantId, userId } = aktifBaglam();
    const { neden } = avansRetSemasi.parse(body);
    return this.personelService.avansOdemeIptal(tenantId, avansId, userId, neden);
  }

  @Post(":id/ucretler")
  async ucretEkle(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { tenantId, userId } = aktifBaglam();
    return this.personelService.ucretEkle(tenantId, id, userId, personelUcretSemasi.parse(body));
  }

  @Delete(":id/ucretler/:ucretId")
  async ucretSil(@Param("id", ParseUUIDPipe) id: string, @Param("ucretId", ParseUUIDPipe) ucretId: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.personelService.ucretSil(tenantId, id, ucretId, userId);
  }

  @Post(":id/cari-bagla")
  async cariBagla(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { tenantId, userId } = aktifBaglam();
    const { cariId } = personelCariBaglaSemasi.parse(body ?? {});
    return this.personelService.cariBagla(tenantId, id, userId, cariId);
  }

  @Post("avanslar/:avansId/odemeler")
  async avansOde(@Param("avansId") avansId: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    return this.personelService.avansOde(tenantId, avansId, avansOdeSemasi.parse(body));
  }
}
