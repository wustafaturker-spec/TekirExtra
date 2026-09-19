import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { GelenEbelgeDurum } from "@prisma/client";
import { Roller } from "../auth/roller.decorator";
import { EbelgeService } from "./ebelge.service";
import { EbelgeKuyrukService } from "./ebelge-kuyruk.service";
import { EbelgeGorunumService } from "./ebelge-gorunum.service";
import { earsivIptalSemasi, earsivRaporAralikSemasi, ebelgeGonderSemasi, gelenOnaySemasi, gelenXmlYukleSemasi, gelenYanitSemasi, gumrukBeyannameSemasi } from "./ebelge.semalar";

const GELEN_DURUMLARI: GelenEbelgeDurum[] = ["beklemede", "islendi", "reddedildi"];

@Controller("ebelge")
export class EbelgeController {
  constructor(
    private readonly ebelgeService: EbelgeService,
    private readonly kuyrukService: EbelgeKuyrukService,
    private readonly gorunumService: EbelgeGorunumService,
  ) {}

  /** EBLG-27: gelen belgenin PDF görünümü; kaynak saklanan UBL'dir. */
  @Get("gelen/:id/pdf")
  async gelenPdf(@Param("id") id: string, @Res() res: Response) {
    this.pdfYanitla(res, await this.gorunumService.gelenPdf(id));
  }

  /** EBLG-27: kestiğimiz belgenin alıcıya giden görünümü. */
  @Get("giden/:faturaId/pdf")
  async gidenPdf(@Param("faturaId") faturaId: string, @Res() res: Response) {
    this.pdfYanitla(res, await this.gorunumService.gidenPdf(faturaId));
  }

  private pdfYanitla(res: Response, pdf: { buffer: Buffer; dosyaAdi: string }) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${pdf.dosyaAdi}"`);
    res.send(pdf.buffer);
  }

  @Get("wizard/:faturaId")
  @Roller("muhasebe")
  async wizard(@Param("faturaId") faturaId: string) {
    return this.ebelgeService.wizardBilgisi(faturaId);
  }

  @Post("gonder/:faturaId")
  @Roller("muhasebe")
  async gonder(@Param("faturaId") faturaId: string, @Body() govde: unknown) {
    const secim = ebelgeGonderSemasi.safeParse(govde ?? {});
    if (!secim.success) throw new BadRequestException(secim.error.issues.map((s) => s.message).join("; "));
    // İhracat alanları önizlemeden önce yazılır: eksikleri sihirbazda girilen
    // değerlerle değil, faturadaki son hâliyle denetleriz (EBLG-53).
    if (secim.data.ihracat) {
      await this.ebelgeService.ihracatBilgisiniKaydet(faturaId, secim.data.ihracat);
    }
    if (secim.data.internetSatisi) {
      await this.ebelgeService.internetSatisiniKaydet(faturaId, secim.data.internetSatisi);
    }
    if (secim.data.iade) {
      await this.ebelgeService.iadeReferanslariniKaydet(faturaId, secim.data.iade.referanslar);
    }
    const wizard = await this.ebelgeService.wizardBilgisi(faturaId);
    if (!wizard.gonderilebilir) throw new BadRequestException(wizard.neden || "Fatura e-Belge gönderimine uygun değil");
    // Türe özel eksikler de burada durdurulur. `gonderilebilir` yalnız bağlantı,
    // kimlik ve tarih kontrollerini anlatır; ihracat ve internet satışı
    // listelerine bakılmazsa eksik belge kuyruğa girer ve hata orada patlar —
    // kullanıcı ise "gönderildi" görür.
    const engeller = [...(wizard.ihracat?.engeller ?? []), ...(wizard.internetSatisi?.engeller ?? []), ...(wizard.iade?.engeller ?? [])];
    if (engeller.length) throw new BadRequestException(engeller.map((e) => e.mesaj).join("; "));
    if (secim.data.earsivGonderimSekli) {
      await this.ebelgeService.earsivGonderimSekliniKaydet(faturaId, secim.data.earsivGonderimSekli);
    }
    return this.kuyrukService.kuyrugaEkle(faturaId);
  }

  /** EBLG-54: gümrük beyanname numarası; belge gönderildikten sonra da işlenir. */
  @Post("gumruk-beyannamesi/:faturaId")
  @Roller("muhasebe")
  async gumrukBeyannamesi(@Param("faturaId") faturaId: string, @Body() govde: unknown) {
    const girdi = gumrukBeyannameSemasi.safeParse(govde ?? {});
    if (!girdi.success) throw new BadRequestException(girdi.error.issues.map((s) => s.message).join("; "));
    await this.ebelgeService.gumrukBeyannamesiniKaydet(faturaId, { no: girdi.data.no ?? null, tarih: girdi.data.tarih ?? null });
    return { kaydedildi: true };
  }

  @Get("kuyruk")
  @Roller("muhasebe")
  kuyrukListele() { return this.kuyrukService.listele(); }

  @Get("kuyruk/ozet")
  @Roller("muhasebe")
  kuyrukOzet() { return this.kuyrukService.ozet(); }

  @Post("kuyruk/:isId/yeniden-dene")
  @Roller("muhasebe")
  yenidenDene(@Param("isId") isId: string) { return this.kuyrukService.yenidenDene(isId); }

  @Post("sorgula/:faturaId")
  @Roller("muhasebe")
  async sorgula(@Param("faturaId") faturaId: string) {
    await this.ebelgeService.durumSorgusuKontrol(faturaId);
    return this.kuyrukService.durumSorgulaKuyrugaEkle(faturaId);
  }

  @Post("earsiv/:faturaId/iptal-bildir")
  @Roller("muhasebe")
  async earsivIptal(@Param("faturaId") faturaId: string, @Body() govde: unknown) {
    const sonuc = earsivIptalSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.ebelgeService.earsivIptalBildir(faturaId, sonuc.data);
  }

  @Get("earsiv/raporlar")
  @Roller("muhasebe")
  async earsivRaporlar(@Query("baslangic") baslangic: string, @Query("bitis") bitis: string) {
    const sonuc = earsivRaporAralikSemasi.safeParse({ baslangic, bitis });
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.ebelgeService.earsivRaporListele(sonuc.data.baslangic, sonuc.data.bitis);
  }

  @Post("earsiv/raporlar/:uuid/durum")
  @Roller("muhasebe")
  async earsivRaporDurum(@Param("uuid") uuid: string) {
    return this.kuyrukService.earsivRaporKuyrugaEkle(uuid);
  }

  /** Rapor bölümünün GİB'e bildirilen tutarı; ekran satır bazında ister. */
  @Get("earsiv/raporlar/:uuid/tutar")
  @Roller("muhasebe")
  async earsivRaporTutari(@Param("uuid") uuid: string) {
    return this.ebelgeService.earsivRaporTutari(uuid);
  }

  // ─── GELEN KUTUSU (EBLG-05/06) ─────────────────────────────────────────────

  @Post("gelenleri-cek")
  @Roller("muhasebe")
  async gelenleriCek() {
    // Elle tazeleme korunur ama saatlik sınıra tabidir (EBLG-11): son
    // kullanıcı ekranı doğrudan entegratör API'sini sürmemelidir.
    await this.ebelgeService.elleTazelemeIzniAl();
    return this.kuyrukService.gelenBelgeleriKuyrugaEkle();
  }

  // ─── GİB MÜKELLEF LİSTESİ (EBLG-10) ────────────────────────────────────────

  @Get("mukellef-listesi")
  @Roller("muhasebe")
  mukellefListesiDurumu() {
    return this.ebelgeService.mukellefListesiDurumu();
  }

  @Post("mukellef-listesi/senkron")
  @Roller("muhasebe")
  mukellefListesiSenkron() {
    return this.ebelgeService.mukellefListesiSenkronEt();
  }

  @Post("gelen/xml-yukle")
  @Roller("muhasebe")
  async gelenXmlYukle(@Body() govde: unknown) {
    const ayristirma = gelenXmlYukleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.ebelgeService.gelenXmlYukle(ayristirma.data.xml);
  }

  @Get("gelen")
  async gelenListele(@Query("durum") durum?: string) {
    if (durum && !GELEN_DURUMLARI.includes(durum as GelenEbelgeDurum)) {
      throw new BadRequestException(
        `Geçersiz durum; beklenen: ${GELEN_DURUMLARI.join(", ")}`,
      );
    }
    return this.ebelgeService.gelenListele(durum as GelenEbelgeDurum | undefined);
  }

  @Get("gelen/:id")
  async gelenGetir(@Param("id") id: string) {
    return this.ebelgeService.gelenGetir(id);
  }

  @Post("gelen/:id/onayla")
  @Roller("muhasebe")
  async gelenOnayla(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = gelenOnaySemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.ebelgeService.gelenOnayla(id, ayristirma.data);
  }

  @Post("gelen/:id/taslak-iptal")
  @Roller("muhasebe")
  async gelenTaslakIptal(@Param("id") id: string) {
    return this.ebelgeService.gelenTaslakIptalEt(id);
  }

  @Post("gelen/:id/yanit")
  @Roller("muhasebe")
  async gelenYanit(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = gelenYanitSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.ebelgeService.gelenYanitGonder(id, ayristirma.data);
  }

  @Post("xml-yukle")
  @Roller("muhasebe")
  async xmlYukle(@Body("xml") xmlIcerik: string) {
    if (!xmlIcerik || typeof xmlIcerik !== "string") {
      throw new BadRequestException("Lütfen geçerli bir XML metni veya dosyası yükleyin");
    }
    return this.ebelgeService.xmlYukleVeParseEt(xmlIcerik);
  }
}
