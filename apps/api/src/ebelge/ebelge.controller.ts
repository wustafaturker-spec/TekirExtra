import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { GelenEbelgeDurum } from "@prisma/client";
import { Roller } from "../auth/roller.decorator";
import { EbelgeUygulamasi } from "./ebelge-uygulamasi.decorator";
import { EbelgeUygulamalariService } from "./ebelge-uygulamalari.service";
import { EbelgeService } from "./ebelge.service";
import { EbelgeKuyrukService } from "./ebelge-kuyruk.service";
import { EbelgeGorunumService } from "./ebelge-gorunum.service";
import { OnDenetimAiService } from "./on-denetim-ai.service";
import { earsivIptalSemasi, earsivRaporAralikSemasi, ebelgeGonderSemasi, gelenOnaySemasi, gelenFiyatAnaliziSemasi, gelenXmlYukleSemasi, gelenYanitSemasi, gumrukBeyannameSemasi, onDenetimSusturmaSemasi } from "./ebelge.semalar";

const GELEN_DURUMLARI: GelenEbelgeDurum[] = ["beklemede", "islendi", "reddedildi"];

@Controller("ebelge")
export class EbelgeController {
  constructor(
    private readonly ebelgeService: EbelgeService,
    private readonly kuyrukService: EbelgeKuyrukService,
    private readonly gorunumService: EbelgeGorunumService,
    private readonly uygulamalarService: EbelgeUygulamalariService,
    @Optional() private readonly onDenetimAiService?: OnDenetimAiService,
  ) {}

  /**
   * EBLG-77: firmanın hangi e-belge uygulamalarına kayıtlı olduğu. Menü ve
   * sihirbaz bunu okuyup kapalı yordamları hiç göstermez; uçları guard ayrıca
   * korur. Rol kısıtı yoktur: menü her kullanıcıda doğru çizilmeli.
   */
  @Get("uygulamalar")
  ebelgeUygulamalari() {
    return this.uygulamalarService.uygulamalar();
  }

  /** EBLG-27: gelen belgenin PDF görünümü; kaynak saklanan UBL'dir. */
  @EbelgeUygulamasi("efatura")
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

  /** EBLG-113: taşıyıcı VKN'si bir cari kartıyla eşleşiyor mu; sihirbaz ipucu. */
  @EbelgeUygulamasi("earsiv")
  @Get("tasiyici-cari")
  @Roller("muhasebe")
  async tasiyiciCari(@Query("vkn") vkn?: string) {
    if (!vkn || !/^\d{10,11}$/.test(vkn)) throw new BadRequestException("VKN 10 ya da 11 haneli olmalıdır");
    return this.ebelgeService.tasiyiciCari(vkn);
  }

  @EbelgeUygulamasi("efatura", "earsiv")
  @Get("wizard/:faturaId")
  @Roller("muhasebe")
  async wizard(@Param("faturaId") faturaId: string) {
    return this.ebelgeService.wizardBilgisi(faturaId);
  }

  @EbelgeUygulamasi("efatura", "earsiv")
  @Post("gonder/:faturaId")
  @Roller("muhasebe")
  async gonder(@Param("faturaId") faturaId: string, @Body() govde: unknown) {
    const { wizard, secim } = await this.sihirbazSeciminiKaydet(faturaId, govde);
    // EBLG-141: ön denetim uyarıları kullanıcı onayı olmadan kuyruğa girmez.
    const bulgular = "onDenetim" in wizard && wizard.onDenetim ? wizard.onDenetim.bulgular : [];
    const karar = await this.ebelgeService.onDenetimOnayiDenetle({ faturaId }, bulgular, secim.onDenetimOnayi);
    const sonuc = await this.kuyrukService.kuyrugaEkle(faturaId);
    if (karar) await this.ebelgeService.onDenetimKarariYaz({ faturaId }, karar);
    return sonuc;
  }

  /** EBLG-141: faturada geçilen ön denetim uyarıları. */
  @EbelgeUygulamasi("efatura", "earsiv")
  @Get("on-denetim/kararlar/:faturaId")
  @Roller("muhasebe")
  onDenetimKararlari(@Param("faturaId", ParseUUIDPipe) faturaId: string) {
    return this.ebelgeService.onDenetimKararlari(faturaId);
  }

  /**
   * AI-71: ön denetimde yapay zekâ. Sihirbaz bunu beklemeden açılır; sonuç
   * yalnız gösterilir, gönderim onayına girmez.
   */
  @EbelgeUygulamasi("efatura", "earsiv")
  @Post("on-denetim/ai/:faturaId")
  @Roller("muhasebe")
  onDenetimAi(@Param("faturaId", ParseUUIDPipe) faturaId: string) {
    if (!this.onDenetimAiService) throw new BadRequestException("Yapay zekâ ön denetimi kullanılamıyor");
    return this.onDenetimAiService.denetle(faturaId);
  }

  /** EBLG-143: ön denetimin etkisi (aylık ret oranı, geçilen uyarılar). */
  @EbelgeUygulamasi("efatura", "earsiv")
  @Get("on-denetim/olcum")
  @Roller("muhasebe")
  onDenetimOlcumu(@Query("ay") ay?: string) {
    const aySayisi = Number(ay ?? 6);
    if (!Number.isInteger(aySayisi) || aySayisi < 1 || aySayisi > 24) throw new BadRequestException("Ay sayısı 1–24 olmalıdır");
    return this.ebelgeService.onDenetimOlcumu(aySayisi);
  }

  @EbelgeUygulamasi("efatura", "earsiv")
  @Get("on-denetim/susturmalar")
  @Roller("muhasebe")
  onDenetimSusturmalari() {
    return this.ebelgeService.onDenetimSusturmalari();
  }

  @EbelgeUygulamasi("efatura", "earsiv")
  @Post("on-denetim/susturmalar")
  @Roller("muhasebe")
  onDenetimSustur(@Body() govde: unknown) {
    const girdi = onDenetimSusturmaSemasi.safeParse(govde ?? {});
    if (!girdi.success) throw new BadRequestException(girdi.error.issues.map((s) => s.message).join("; "));
    return this.ebelgeService.onDenetimSustur(girdi.data.cariId, girdi.data.kod);
  }

  @EbelgeUygulamasi("efatura", "earsiv")
  @Delete("on-denetim/susturmalar/:id")
  @Roller("muhasebe")
  async onDenetimSusturmaKaldir(@Param("id", ParseUUIDPipe) id: string) {
    await this.ebelgeService.onDenetimSusturmaKaldir(id);
    return { kaldirildi: true };
  }

  /**
   * L: sihirbazın son adımı. Seçimler gönderimdeki gibi kaydedilir, belge
   * gönderilecek hâliyle üretilip entegratörün önizleme ucundan geçirilir;
   * belge oluşmaz, numara harcanmaz.
   */
  @EbelgeUygulamasi("efatura", "earsiv")
  @Post("onizle/:faturaId")
  @Roller("muhasebe")
  async onizle(@Param("faturaId") faturaId: string, @Body() govde: unknown) {
    await this.sihirbazSeciminiKaydet(faturaId, govde);
    return this.ebelgeService.onizle(faturaId);
  }

  /**
   * Sihirbazda girilen türe özel alanları faturaya yazar ve eksik kalmışsa
   * durdurur. Gönderim ile önizleme aynı yoldan geçer; önizlenen belge
   * gönderilecek belgenin kendisidir.
   */
  private async sihirbazSeciminiKaydet(faturaId: string, govde: unknown) {
    const secim = ebelgeGonderSemasi.safeParse(govde ?? {});
    if (!secim.success) throw new BadRequestException(secim.error.issues.map((s) => s.message).join("; "));
    if (secim.data.sevkiyat) await this.ebelgeService.sevkiyatBaglantisiniKaydet(faturaId, secim.data.sevkiyat);
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
    if (secim.data.yolcuBeraberi) {
      await this.ebelgeService.yolcuBeraberiniKaydet(faturaId, {
        isaretli: secim.data.yolcuBeraberi.isaretli,
        yolcu: secim.data.yolcuBeraberi.yolcu,
        araciKurum: secim.data.yolcuBeraberi.araciKurum,
      });
    }
    if (secim.data.kamu) {
      await this.ebelgeService.kamuBilgisiniKaydet(faturaId, secim.data.kamu);
    }
    if (secim.data.sgk) {
      await this.ebelgeService.sgkBilgisiniKaydet(faturaId, secim.data.sgk);
    }
    if (secim.data.sarj) {
      await this.ebelgeService.sarjBilgisiniKaydet(faturaId, secim.data.sarj);
    }
    const wizard = await this.ebelgeService.wizardBilgisi(faturaId);
    if (!wizard.gonderilebilir) throw new BadRequestException(wizard.neden || "Fatura e-Belge gönderimine uygun değil");
    // Türe özel eksikler de burada durdurulur. `gonderilebilir` yalnız bağlantı,
    // kimlik ve tarih kontrollerini anlatır; ihracat ve internet satışı
    // listelerine bakılmazsa eksik belge kuyruğa girer ve hata orada patlar —
    // kullanıcı ise "gönderildi" görür.
    const engeller = [...(wizard.ihracat?.engeller ?? []), ...(wizard.yurtDisiEarsiv?.engeller ?? []), ...(wizard.internetSatisi?.engeller ?? []), ...(wizard.iade?.engeller ?? []), ...(wizard.kamu?.engeller ?? []), ...(wizard.sgk?.engeller ?? []), ...(wizard.sarj?.engeller ?? []), ...(wizard.idis?.engeller ?? []), ...(wizard.yolcuBeraberi?.engeller ?? []), ...(wizard.ytb?.engeller ?? []), ...(wizard.sevkiyat?.engeller ?? [])];
    if (engeller.length) throw new BadRequestException(engeller.map((e) => e.mesaj).join("; "));
    if (secim.data.earsivGonderimSekli) {
      await this.ebelgeService.earsivGonderimSekliniKaydet(faturaId, secim.data.earsivGonderimSekli);
    }
    return { wizard, secim: secim.data };
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

  @EbelgeUygulamasi("efatura", "earsiv")
  @Get("kuyruk")
  @Roller("muhasebe")
  kuyrukListele() { return this.kuyrukService.listele(); }

  @EbelgeUygulamasi("efatura", "earsiv")
  @Get("kuyruk/ozet")
  @Roller("muhasebe")
  kuyrukOzet() { return this.kuyrukService.ozet(); }

  @EbelgeUygulamasi("efatura", "earsiv")
  @Post("kuyruk/:isId/yeniden-dene")
  @Roller("muhasebe")
  yenidenDene(@Param("isId") isId: string) { return this.kuyrukService.yenidenDene(isId); }

  @EbelgeUygulamasi("efatura", "earsiv")
  @Post("sorgula/:faturaId")
  @Roller("muhasebe")
  async sorgula(@Param("faturaId") faturaId: string) {
    await this.ebelgeService.durumSorgusuKontrol(faturaId);
    return this.kuyrukService.durumSorgulaKuyrugaEkle(faturaId);
  }

  @EbelgeUygulamasi("earsiv")
  @Post("earsiv/:faturaId/iptal-bildir")
  @Roller("muhasebe")
  async earsivIptal(@Param("faturaId") faturaId: string, @Body() govde: unknown) {
    const sonuc = earsivIptalSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.ebelgeService.earsivIptalBildir(faturaId, sonuc.data);
  }

  @EbelgeUygulamasi("earsiv")
  @Get("earsiv/raporlar")
  @Roller("muhasebe")
  async earsivRaporlar(@Query("baslangic") baslangic: string, @Query("bitis") bitis: string) {
    const sonuc = earsivRaporAralikSemasi.safeParse({ baslangic, bitis });
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.ebelgeService.earsivRaporListele(sonuc.data.baslangic, sonuc.data.bitis);
  }

  @EbelgeUygulamasi("earsiv")
  @Post("earsiv/raporlar/:uuid/durum")
  @Roller("muhasebe")
  async earsivRaporDurum(@Param("uuid") uuid: string) {
    return this.kuyrukService.earsivRaporKuyrugaEkle(uuid);
  }

  /** Rapor bölümünün GİB'e bildirilen tutarı; ekran satır bazında ister. */
  @EbelgeUygulamasi("earsiv")
  @Get("earsiv/raporlar/:uuid/tutar")
  @Roller("muhasebe")
  async earsivRaporTutari(@Param("uuid") uuid: string) {
    return this.ebelgeService.earsivRaporTutari(uuid);
  }

  // ─── GELEN KUTUSU (EBLG-05/06) ─────────────────────────────────────────────

  @EbelgeUygulamasi("efatura")
  @Post("gelenleri-cek")
  @Roller("muhasebe")
  async gelenleriCek() {
    // Elle tazeleme korunur ama saatlik sınıra tabidir (EBLG-11): son
    // kullanıcı ekranı doğrudan entegratör API'sini sürmemelidir.
    await this.ebelgeService.elleTazelemeIzniAl();
    return this.kuyrukService.gelenBelgeleriKuyrugaEkle(true);
  }

  // ─── GİB MÜKELLEF LİSTESİ (EBLG-10) ────────────────────────────────────────

  @EbelgeUygulamasi("efatura")
  @Get("mukellef-listesi")
  @Roller("muhasebe")
  mukellefListesiDurumu() {
    return this.ebelgeService.mukellefListesiDurumu();
  }

  @EbelgeUygulamasi("efatura")
  @Post("mukellef-listesi/senkron")
  @Roller("muhasebe")
  mukellefListesiSenkron() {
    return this.ebelgeService.mukellefListesiSenkronEt();
  }

  @EbelgeUygulamasi("efatura")
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

  @EbelgeUygulamasi("efatura")
  @Get("gelen")
  async gelenListele(@Query("durum") durum?: string) {
    if (durum && !GELEN_DURUMLARI.includes(durum as GelenEbelgeDurum)) {
      throw new BadRequestException(
        `Geçersiz durum; beklenen: ${GELEN_DURUMLARI.join(", ")}`,
      );
    }
    return this.ebelgeService.gelenListele(durum as GelenEbelgeDurum | undefined);
  }

  @EbelgeUygulamasi("efatura")
  @Get("gelen/:id")
  async gelenGetir(@Param("id") id: string) {
    return this.ebelgeService.gelenGetir(id);
  }

  @EbelgeUygulamasi("efatura")
  @Post("gelen/:id/fiyat-analizi")
  @Roller("muhasebe")
  async gelenFiyatAnalizi(@Param("id", new ParseUUIDPipe()) id: string, @Body() govde: unknown) {
    const sonuc = gelenFiyatAnaliziSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException("Geçersiz fiyat analizi eşleştirmesi (en çok 100 satır)");
    return this.ebelgeService.gelenFiyatAnalizi(id, sonuc.data.satirEslesmeleri);
  }

  /** EBLG-144: kullanıcının eşleştirmesiyle gelen alış denetimi (eşleşme değişince ekran yeniden sorar). */
  @EbelgeUygulamasi("efatura")
  @Post("gelen/:id/denetim")
  @Roller("muhasebe")
  async gelenDenetim(@Param("id", new ParseUUIDPipe()) id: string, @Body() govde: unknown) {
    const sonuc = gelenFiyatAnaliziSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException("Geçersiz satır eşleştirmesi (en çok 100 satır)");
    const denetim = await this.ebelgeService.gelenDenetimSakla(id, sonuc.data.satirEslesmeleri);
    if (!denetim) throw new BadRequestException("Belge denetlenemedi");
    return denetim;
  }

  @EbelgeUygulamasi("efatura")
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

  @EbelgeUygulamasi("efatura")
  @Post("gelen/:id/taslak-iptal")
  @Roller("muhasebe")
  async gelenTaslakIptal(@Param("id") id: string) {
    return this.ebelgeService.gelenTaslakIptalEt(id);
  }

  @EbelgeUygulamasi("efatura")
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
