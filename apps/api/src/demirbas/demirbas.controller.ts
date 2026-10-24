import {
  BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { excelDosyasiniDogrula, type YuklemeDosyasi } from "../core/guvenlik/dosya-dogrulama";
import { PdfService } from "../core/pdf/pdf.service";
import { AMORTISMAN_LISTESI } from "./amortisman-listesi";
import { AmortismanService } from "./amortisman.service";
import { acilisSablonu, raporExcel, zimmetTutanagiHtml } from "./demirbas-dosya";
import {
  cikisSemasi, demirbasGuncelleSemasi, demirbasOlusturSemasi, geriAlSemasi, ilaveBedelSemasi, listeSorgusuSemasi, normaleGecisSemasi,
  zimmetIadeSemasi, zimmetSemasi,
} from "./demirbas.semalar";
import { CIKIS_ADLARI, DemirbasService, SINIF_ADLARI } from "./demirbas.service";
import { SaltOkumadaAcik } from "../auth/public.decorator";

function ayristir<T extends z.ZodTypeAny>(sema: T, deger: unknown): z.infer<T> {
  const sonuc = sema.safeParse(deger);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function dosyaGonder(res: Response, buffer: Buffer, ad: string, tur = XLSX) {
  res.setHeader("Content-Type", tur);
  res.setHeader("Content-Disposition", `attachment; filename="${ad}"`);
  res.send(buffer);
}

const yilSemasi = z.coerce.number().int().min(1950).max(2100);

/** DMR-01…14: demirbaş ve sabit kıymet. Kesinleştirme ve geri alma yalnız yönetici (DMR-14). */
@Controller("demirbas")
@Roller("muhasebe", "salt_okunur")
export class DemirbasController {
  constructor(
    private readonly service: DemirbasService,
    private readonly amortisman: AmortismanService,
    private readonly pdf: PdfService,
  ) {}

  @Get()
  listele(@Query() sorgu: unknown) {
    return this.service.listele(ayristir(listeSorgusuSemasi, sorgu));
  }

  @Get("liste-kalemleri")
  listeKalemleri() {
    return AMORTISMAN_LISTESI;
  }

  @Get("sinirlar")
  sinirlar(@Query("yil") yil: string) {
    return this.service.sinirlar(ayristir(yilSemasi, yil));
  }

  @Get("fatura-satirlari")
  faturaSatirlari(@Query("no") no: string, @Query("tip") tip: string) {
    if (!no || no.trim().length < 3) throw new BadRequestException("Fatura numarasının en az üç karakterini yazın");
    return this.service.faturaSatirlari(no, tip === "satis" ? "satis" : "alis");
  }

  @Get("zimmetler")
  acikZimmetler(@Query("personelId", ParseUUIDPipe) personelId: string) {
    return this.service.acikZimmetler(personelId);
  }

  @Get("zimmet/:zimmetId/tutanak")
  async zimmetTutanagi(@Param("zimmetId", ParseUUIDPipe) zimmetId: string, @Res() res: Response) {
    const veri = await this.service.zimmetTutanagiVerisi(zimmetId);
    const buffer = await this.pdf.htmlToPdf(zimmetTutanagiHtml(veri, await this.pdf.belgeTemasi()));
    dosyaGonder(res, buffer, `zimmet-${veri.zimmet.demirbas.kod}.pdf`, "application/pdf");
  }

  // ─── Amortisman (DMR-07) ─────────────────────────────────────────────

  @Get("amortisman/donemler")
  donemler() {
    return this.amortisman.donemler();
  }

  @Get("amortisman/ara-donem")
  araDonem(@Query("yil") yil: string, @Query("ceyrek") ceyrek: string) {
    const c = ayristir(z.coerce.number().int().min(1).max(4), ceyrek) as 1 | 2 | 3 | 4;
    return this.amortisman.araDonem(ayristir(yilSemasi, yil), c);
  }

  @Get("amortisman/:yil")
  onizleme(@Param("yil", ParseIntPipe) yil: number) {
    return this.amortisman.onizleme(ayristir(yilSemasi, yil));
  }

  @Post("amortisman/:yil/kesinlestir")
  @Roller("yonetici")
  kesinlestir(@Param("yil", ParseIntPipe) yil: number) {
    return this.amortisman.kesinlestir(ayristir(yilSemasi, yil));
  }

  @Post("amortisman/:yil/geri-al")
  @Roller("yonetici")
  amortismanGeriAl(@Param("yil", ParseIntPipe) yil: number, @Body() govde: unknown) {
    return this.amortisman.geriAl(ayristir(yilSemasi, yil), ayristir(geriAlSemasi, govde).gerekce);
  }

  // ─── Raporlar (DMR-12) ───────────────────────────────────────────────

  @Get("rapor/excel")
  async raporExcel(@Query("tur") tur: string, @Query("yil") yilHam: string | undefined, @Query() sorgu: Record<string, string>, @Res() res: Response) {
    const para = true;
    if (tur === "liste" || tur === "zimmet" || tur === "cikis") {
      const kartlar = await this.service.listele(ayristir(listeSorgusuSemasi, { ...sorgu, tur: undefined, yil: undefined, durum: tur === "cikis" ? "elden_cikti" : sorgu.durum ?? "kullanimda" }));
      if (tur === "zimmet") {
        const satirlar = kartlar.filter((k) => k.zimmetli || k.konum).map((k) => ({ ...k, sinif: SINIF_ADLARI[k.sinif] }));
        return dosyaGonder(res, await raporExcel("Zimmetler", [
          { baslik: "Kod", anahtar: "kod", genislik: 14 }, { baslik: "Ad", anahtar: "ad", genislik: 36 }, { baslik: "Sınıf", anahtar: "sinif" },
          { baslik: "Zimmetli", anahtar: "zimmetli", genislik: 26 }, { baslik: "Konum", anahtar: "konum", genislik: 24 },
        ], satirlar), "demirbas-zimmetler.xlsx");
      }
      const yil = yilHam ? ayristir(yilSemasi, yilHam) : null;
      const satirlar = kartlar
        .filter((k) => tur !== "cikis" || !yil || k.cikisTarihi?.startsWith(String(yil)))
        .map((k) => ({ ...k, sinif: SINIF_ADLARI[k.sinif], cikisTuru: k.cikisTuru ? CIKIS_ADLARI[k.cikisTuru] : "" }));
      const toplam = (a: "bedel" | "birikmis" | "netDeger" | "buYil") => satirlar.reduce((t, k) => t + Number(k[a]), 0);
      return dosyaGonder(res, await raporExcel(tur === "cikis" ? "Elden çıkanlar" : "Demirbaş listesi", [
        { baslik: "Kod", anahtar: "kod", genislik: 14 }, { baslik: "Ad", anahtar: "ad", genislik: 36 }, { baslik: "Sınıf", anahtar: "sinif" },
        { baslik: "Edinme", anahtar: "edinmeTarihi", genislik: 12 }, { baslik: "Ömür", anahtar: "faydaliOmur", genislik: 8 }, { baslik: "Yöntem", anahtar: "yontem", genislik: 10 },
        { baslik: "Bedel", anahtar: "bedel", para }, { baslik: "Birikmiş", anahtar: "birikmis", para }, { baslik: "Net değer", anahtar: "netDeger", para },
        ...(tur === "cikis"
          ? [{ baslik: "Çıkış", anahtar: "cikisTuru" }, { baslik: "Çıkış tarihi", anahtar: "cikisTarihi", genislik: 12 }]
          : [{ baslik: "Bu yıl amortisman", anahtar: "buYil", para }, { baslik: "Konum", anahtar: "konum", genislik: 20 }, { baslik: "Zimmetli", anahtar: "zimmetli", genislik: 24 }]),
      ], satirlar, { bedel: toplam("bedel"), birikmis: toplam("birikmis"), netDeger: toplam("netDeger"), ...(tur === "cikis" ? {} : { buYil: toplam("buYil") }) }), tur === "cikis" ? "demirbas-cikislar.xlsx" : "demirbas-listesi.xlsx");
    }
    if (tur === "amortisman") {
      const yil = ayristir(yilSemasi, yilHam);
      const d = await this.amortisman.yilDokumu(yil);
      const satirlar = d.satirlar.map((s) => ({ ...s, sinif: SINIF_ADLARI[s.sinif] }));
      return dosyaGonder(res, await raporExcel(`Amortisman ${yil}${d.kesin ? "" : " (plan)"}`, [
        { baslik: "Kod", anahtar: "kod", genislik: 14 }, { baslik: "Ad", anahtar: "ad", genislik: 36 }, { baslik: "Sınıf", anahtar: "sinif" },
        { baslik: "Bedel", anahtar: "bedel", para }, { baslik: "Önceki birikmiş", anahtar: "birikmisOnce", para }, { baslik: `${yil} amortismanı`, anahtar: "tutar", para },
        { baslik: "KKEG", anahtar: "kkeg", para }, { baslik: "Birikmiş", anahtar: "birikmisSonra", para }, { baslik: "Net değer", anahtar: "netDeger", para },
      ], satirlar, { tutar: d.toplam, kkeg: d.toplamKkeg }), `amortisman-${yil}${d.kesin ? "" : "-plan"}.xlsx`);
    }
    throw new BadRequestException("Rapor türü liste, amortisman, zimmet ya da cikis olmalıdır");
  }

  // ─── Açılış (DMR-11) ─────────────────────────────────────────────────

  @Get("acilis/sablon")
  async acilisSablonu(@Res() res: Response) {
    dosyaGonder(res, await acilisSablonu(), "demirbas-acilis-sablonu.xlsx");
  }

  @SaltOkumadaAcik()
  @Post("acilis/onizle")
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async acilisOnizle(@UploadedFile() file: YuklemeDosyasi | undefined) {
    if (!file) throw new BadRequestException("Lütfen bir Excel dosyası yükleyin");
    await excelDosyasiniDogrula(file);
    const { _gecerli, ...sonuc } = await this.service.acilisOnizle(file.buffer);
    return sonuc;
  }

  @Post("acilis/uygula")
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async acilisUygula(@UploadedFile() file: YuklemeDosyasi | undefined) {
    if (!file) throw new BadRequestException("Lütfen bir Excel dosyası yükleyin");
    await excelDosyasiniDogrula(file);
    return this.service.acilisUygula(file.buffer);
  }

  // ─── Kart (DMR-01/02/04/08/10) ────────────────────────────────────────

  @Post()
  @Roller("muhasebe")
  olustur(@Body() govde: unknown) {
    return this.service.olustur(ayristir(demirbasOlusturSemasi, govde));
  }

  @Post("ilave-bedel/:ilaveId/sil")
  @Roller("muhasebe")
  ilaveBedelSil(@Param("ilaveId", ParseUUIDPipe) ilaveId: string) {
    return this.service.ilaveBedelSil(ilaveId);
  }

  @Post("zimmet/:zimmetId/iade")
  @Roller("muhasebe")
  zimmetIade(@Param("zimmetId", ParseUUIDPipe) zimmetId: string, @Body() govde: unknown) {
    return this.service.zimmetIade(zimmetId, ayristir(zimmetIadeSemasi, govde));
  }

  @Get(":id")
  getir(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.getir(id);
  }

  @Patch(":id")
  @Roller("muhasebe")
  guncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.guncelle(id, ayristir(demirbasGuncelleSemasi, govde));
  }

  @Delete(":id")
  @Roller("muhasebe")
  sil(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.sil(id);
  }

  @Post(":id/ilave-bedel")
  @Roller("muhasebe")
  ilaveBedel(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.ilaveBedelEkle(id, ayristir(ilaveBedelSemasi, govde));
  }

  @Post(":id/normale-gecis")
  @Roller("muhasebe")
  normaleGecis(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.normaleGecis(id, ayristir(normaleGecisSemasi, govde).yil);
  }

  @Post(":id/cikis")
  @Roller("muhasebe")
  cikis(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.cikis(id, ayristir(cikisSemasi, govde));
  }

  @Post(":id/cikis-geri-al")
  @Roller("muhasebe")
  cikisGeriAl(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.cikisGeriAl(id, ayristir(geriAlSemasi, govde).gerekce);
  }

  @Post(":id/zimmet")
  @Roller("muhasebe")
  zimmetle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.zimmetle(id, ayristir(zimmetSemasi, govde));
  }
}
