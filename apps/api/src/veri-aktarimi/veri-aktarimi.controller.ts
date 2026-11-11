import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { SaltOkumadaAcik } from "../auth/public.decorator";
import { excelDosyasiniDogrula, type YuklemeDosyasi } from "../core/guvenlik/dosya-dogrulama";
import { ADIMLAR, type Adim } from "./adim";
import { VeriAktarimiService } from "./veri-aktarimi.service";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const dosyaSiniri = { limits: { fileSize: 10 * 1024 * 1024, files: 1 } };
const eslemeSemasi = z.record(z.string().max(200), z.string().max(40)).default({});

function adimCoz(adim: string): Adim {
  if (!(ADIMLAR as readonly string[]).includes(adim)) throw new BadRequestException("Geçersiz aktarım adımı");
  return adim as Adim;
}

/** Çok parçalı formda `eslemeler` alanı JSON metnidir: { "Dosyadaki başlık": "alan" | "" }. */
function eslemeleriCoz(govde: { eslemeler?: unknown } | undefined) {
  const ham = govde?.eslemeler;
  if (ham === undefined || ham === "") return {};
  let deger: unknown;
  try { deger = typeof ham === "string" ? JSON.parse(ham) : ham; } catch { throw new BadRequestException("Başlık eşlemesi okunamadı"); }
  const r = eslemeSemasi.safeParse(deger);
  if (!r.success) throw new BadRequestException("Başlık eşlemesi geçersiz");
  return r.data;
}

async function excel(file: YuklemeDosyasi | undefined): Promise<YuklemeDosyasi> {
  if (!file) throw new BadRequestException("Lütfen bir Excel dosyası yükleyin");
  await excelDosyasiniDogrula(file);
  return file;
}

function gonder(res: Response, ad: string, buffer: Buffer) {
  res.setHeader("Content-Type", XLSX);
  res.setHeader("Content-Disposition", `attachment; filename=${ad}.xlsx`);
  res.send(buffer);
}

/**
 * VAK-01…09: veri aktarım sihirbazı. Yönetici ve muhasebe kullanır; geri alma yalnız
 * yöneticidedir (VAK-07). Önizleme ve hatalı satır dosyası yazmaz.
 */
@Controller("veri-aktarimi")
@Roller("muhasebe")
export class VeriAktarimiController {
  constructor(private readonly servis: VeriAktarimiService) {}

  @Get()
  durum() {
    return this.servis.durum();
  }

  @Put("gecis-tarihi")
  gecisTarihi(@Body() govde: unknown) {
    const r = z.object({ tarih: z.iso.date() }).safeParse(govde);
    if (!r.success) throw new BadRequestException("Geçerli bir tarih girin (YYYY-AA-GG)");
    return this.servis.gecisTarihiKaydet(r.data.tarih);
  }

  @Get("kontrol-ozeti")
  kontrolOzeti() {
    return this.servis.kontrolOzeti();
  }

  @Get("kontrol-ozeti/excel")
  async kontrolOzetiExcel(@Res() res: Response) {
    gonder(res, "veri-aktarimi-kontrol-ozeti", await this.servis.kontrolOzetiExcel());
  }

  @Get(":adim/sablon")
  async sablon(@Param("adim") adim: string, @Res() res: Response) {
    const a = adimCoz(adim);
    gonder(res, `${a.replace("_", "-")}-sablonu`, await this.servis.sablon(a));
  }

  @SaltOkumadaAcik()
  @Post(":adim/onizle")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", dosyaSiniri))
  async onizle(@Param("adim") adim: string, @UploadedFile() file: YuklemeDosyasi | undefined, @Body() govde: { eslemeler?: unknown }) {
    return this.servis.onizle(adimCoz(adim), (await excel(file)).buffer, eslemeleriCoz(govde));
  }

  @SaltOkumadaAcik()
  @Post(":adim/hatali-satirlar")
  @UseInterceptors(FileInterceptor("file", dosyaSiniri))
  async hataliSatirlar(@Param("adim") adim: string, @UploadedFile() file: YuklemeDosyasi | undefined, @Body() govde: { eslemeler?: unknown }, @Res() res: Response) {
    const a = adimCoz(adim);
    gonder(res, `${a.replace("_", "-")}-hatali-satirlar`, await this.servis.hataliSatirlar(a, (await excel(file)).buffer, eslemeleriCoz(govde)));
  }

  @Post(":adim/uygula")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", dosyaSiniri))
  async uygula(@Param("adim") adim: string, @UploadedFile() file: YuklemeDosyasi | undefined, @Body() govde: { eslemeler?: unknown }) {
    const f = await excel(file);
    return this.servis.uygula(adimCoz(adim), f.buffer, Buffer.from(f.originalname ?? "dosya.xlsx", "latin1").toString("utf8"), eslemeleriCoz(govde));
  }

  @Post("partiler/:id/geri-al")
  @HttpCode(200)
  @Roller("yonetici")
  geriAl(@Param("id") id: string) {
    if (!z.uuid().safeParse(id).success) throw new BadRequestException("Geçersiz aktarım");
    return this.servis.geriAl(id);
  }
}
