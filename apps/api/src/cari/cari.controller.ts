import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
  UploadedFile,
  Res,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { Roller } from "../auth/roller.decorator";
import { CariService } from "./cari.service";
import { teminatSemasi } from "./cari-teminat";
import { CariIceAktarmaService } from "./cari-ice-aktarma.service";
import {
  cariOlusturSemasi,
  cariGuncelleSemasi,
  adresSemasi,
  postaKutusuSecimSemasi,
  bankaHesapSemasi,
  etiketSemasi,
  kisiSemasi,
  cariHareketSemasi,
  crmEtkilesimSemasi,
  crmGorevDurumSemasi,
  crmGorevSemasi,
  ekstreEpostaSemasi,
  ekstreSorguSemasi,
} from "./cari.semalar";
import { sayfaAdedi } from "../core/sayfalama";
import { AbonelikService } from "../tenant/abonelik.service";
import { excelDosyasiniDogrula, type YuklemeDosyasi } from "../core/guvenlik/dosya-dogrulama";
import { iptalleriGoster } from "../fatura/iptal-cifti";
import { SaltOkumadaAcik } from "../auth/public.decorator";

/** CARI-24/25/26: sorgudan ekstre türü, çevrilecek döviz ve mutabakat işareti. */
function ekstreSecenekleri(sorgu: unknown) {
  const sonuc = ekstreSorguSemasi.safeParse(sorgu ?? {});
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
  const tur = sonuc.data.tur ?? "standart";
  return { tur, hedefDoviz: tur === "doviz" ? sonuc.data.doviz : undefined, mutabakat: sonuc.data.mutabakat === "1" };
}

/** CARI-35: kullanıcı aynı VKN/TCKN'li ikinci cariyi bilerek açıyor. */
const mukerrerVknOnayi = (govde: unknown) => (govde as { mukerrerVknOnayi?: unknown } | null)?.mukerrerVknOnayi === true;

/** CARI-37: BA/BS dönemi (yıl + ay). */
function babsDonemi(yil?: string, ay?: string) {
  const y = Number(yil), a = Number(ay);
  if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(a) || a < 1 || a > 12) throw new BadRequestException("Dönem için geçerli yıl ve ay (1-12) girin");
  return { yil: y, ay: a };
}

/** CARI-39: teminat gövdesi. */
function teminatGirdisi(govde: unknown) {
  const sonuc = teminatSemasi.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
  return sonuc.data;
}

@Controller("cari")
export class CariController {
  constructor(private readonly cariService: CariService, private readonly abonelik: AbonelikService, private readonly iceAktarma: CariIceAktarmaService) {}

  @Get()
  async listele(
    @Query("arama") arama?: string,
    @Query("imlec") imlec?: string,
    @Query("adet") adet?: string,
    @Query("tip") tip?: string,
    @Query("durum") durum?: string,
    @Query("bakiye") bakiye?: string,
    @Query("bakiyeMin") bakiyeMin?: string,
    @Query("bakiyeMax") bakiyeMax?: string,
    @Query("siralama") siralama?: string,
    @Query("grup") grup?: string,
  ) {
    const adetSayi = sayfaAdedi(adet);
    // CARI-36: bakiye aralığı (TL, güncel kur) ve sıralama.
    const sayi = (deger?: string) => {
      if (deger === undefined || deger.trim() === "") return undefined;
      const n = Number(deger.replace(",", "."));
      if (!Number.isFinite(n)) throw new BadRequestException("Bakiye sınırı sayı olmalıdır");
      return n;
    };
    const siralamalar = ["kod", "unvan", "bakiye_azalan", "bakiye_artan"] as const;
    if (siralama && !siralamalar.includes(siralama as (typeof siralamalar)[number])) throw new BadRequestException("Geçersiz sıralama");
    if (grup && grup !== "yok" && !/^[0-9a-f-]{36}$/i.test(grup)) throw new BadRequestException("Geçersiz cari grubu");
    return this.cariService.listele(arama, imlec, adetSayi, tip, durum, bakiye, {
      grup: grup || undefined,
      bakiyeMin: sayi(bakiyeMin),
      bakiyeMax: sayi(bakiyeMax),
      siralama: siralama as (typeof siralamalar)[number] | undefined,
    });
  }

  /** KSB-16: göç öncesi ödemeleri dağıtılmamış bütün carileri vadeye göre denkleştirir. */
  @Post("denklestir-toplu")
  @Roller("yonetici")
  async topluDenklestir() {
    return this.cariService.topluDenklestir();
  }

  @Get("etiketler")
  async etiketleriListele() {
    return this.cariService.etiketleriListele();
  }

  @Post("etiketler")
  @Roller("muhasebe")
  async etiketOlustur(@Body() govde: unknown) {
    const ayristirma = etiketSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.cariService.etiketOlustur(ayristirma.data);
  }

  @Delete("etiketler/:etiketId")
  @Roller("muhasebe")
  @HttpCode(204)
  async etiketSil(@Param("etiketId") etiketId: string) {
    await this.cariService.etiketSil(etiketId);
  }

  @Get(":id")
  async getir(@Param("id") id: string) {
    return this.cariService.getir(id);
  }

  @Post()
  @Roller("muhasebe")
  async olustur(@Body() govde: unknown) {
    const ayristirma = cariOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    await this.abonelik.limitDogrula("cari");
    return this.cariService.olustur(ayristirma.data, { mukerrerVknOnayi: mukerrerVknOnayi(govde) });
  }

  /** EBLG-95: "Muhtelif Müşteriler" sistem carisini getirir, yoksa açar. */
  @Post("muhtelif-musteri")
  @Roller("muhasebe", "satis")
  async muhtelifMusteri() {
    return this.cariService.muhtelifMusteriCarisi();
  }

  /** KSB-16: "Vadeye göre yeniden denkleştir" önizlemesi (yazmaz). */
  @Get(":id/denklestirme")
  @Roller("muhasebe")
  async denklestirmeOnizle(@Param("id") id: string) {
    return this.cariService.denklestir(id, false);
  }

  @Post(":id/denklestir")
  @Roller("muhasebe")
  async denklestir(@Param("id") id: string) {
    return this.cariService.denklestir(id, true);
  }

  @Post(":id/kopyala")
  @Roller("muhasebe", "satis")
  async kopyala(@Param("id") id: string) {
    return this.cariService.kopyala(id);
  }

  @Patch(":id")
  @Roller("muhasebe")
  async guncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = cariGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => `${s.path.join(".") || "alan"}: ${s.message}`).join("; "),
      );
    }
    return this.cariService.guncelle(id, ayristirma.data, { mukerrerVknOnayi: mukerrerVknOnayi(govde) });
  }

  @Delete(":id")
  @Roller("muhasebe")
  @HttpCode(204)
  async sil(@Param("id") id: string) {
    await this.cariService.sil(id);
  }

  /** EBLG-86: alıcının GİB posta kutusunu elle seç; `null` kurala döndürür. */
  @Patch(":id/posta-kutusu")
  @Roller("muhasebe")
  async postaKutusuSec(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = postaKutusuSecimSemasi.safeParse(govde);
    if (!ayristirma.success) throw new BadRequestException(ayristirma.error.issues.map((s) => s.message).join("; "));
    return this.cariService.postaKutusuSec(id, ayristirma.data);
  }

  @Post(":id/adresler")
  @Roller("muhasebe")
  async adresEkle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = adresSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.cariService.adresEkle(id, ayristirma.data);
  }

  @Patch(":id/adresler/:adresId")
  @Roller("muhasebe")
  async adresGuncelle(@Param("id") id: string, @Param("adresId") adresId: string, @Body() govde: unknown) {
    const ayristirma = adresSemasi.safeParse(govde);
    if (!ayristirma.success) throw new BadRequestException(ayristirma.error.issues.map((s) => s.message).join("; "));
    return this.cariService.adresGuncelle(id, adresId, ayristirma.data);
  }

  @Delete(":id/adresler/:adresId")
  @Roller("muhasebe")
  @HttpCode(204)
  async adresSil(@Param("id") id: string, @Param("adresId") adresId: string) {
    await this.cariService.adresSil(id, adresId);
  }

  @Post(":id/kisiler")
  @Roller("muhasebe")
  async kisiEkle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = kisiSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.cariService.kisiEkle(id, ayristirma.data);
  }

  @Delete(":id/kisiler/:kisiId")
  @Roller("muhasebe")
  @HttpCode(204)
  async kisiSil(@Param("id") id: string, @Param("kisiId") kisiId: string) {
    await this.cariService.kisiSil(id, kisiId);
  }

  @Post(":id/banka-hesaplari")
  @Roller("muhasebe")
  async bankaHesapEkle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = bankaHesapSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.cariService.bankaHesapEkle(id, ayristirma.data);
  }

  @Delete(":id/banka-hesaplari/:hesapId")
  @Roller("muhasebe")
  @HttpCode(204)
  async bankaHesapSil(
    @Param("id") id: string,
    @Param("hesapId") hesapId: string,
  ) {
    await this.cariService.bankaHesapSil(id, hesapId);
  }

  @Post(":id/etiketler/:etiketId")
  @Roller("muhasebe")
  async etiketAta(
    @Param("id") id: string,
    @Param("etiketId") etiketId: string,
  ) {
    return this.cariService.etiketAta(id, etiketId);
  }

  @Delete(":id/etiketler/:etiketId")
  @Roller("muhasebe")
  @HttpCode(204)
  async etiketKaldir(
    @Param("id") id: string,
    @Param("etiketId") etiketId: string,
  ) {
    await this.cariService.etiketKaldir(id, etiketId);
  }

  @Post(":id/hareketler")
  @Roller("muhasebe")
  async hareketEkle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = cariHareketSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.cariService.hareketEkle(id, ayristirma.data);
  }

  @Delete(":id/hareketler/:hareketId")
  @Roller("muhasebe")
  @HttpCode(204)
  async hareketSil(@Param("id") id: string, @Param("hareketId") hareketId: string) {
    await this.cariService.hareketSil(id, hareketId);
  }

  @Get(":id/crm")
  async crmGetir(@Param("id") id: string) { return this.cariService.crmGetir(id); }

  /** CARI-43: Cari Durum Paneli; bölümler rolün görebildiğine göre döner (CARI-46). */
  @Get(":id/durum")
  async durum(@Param("id") id: string) { return this.cariService.durum(id); }

  @Get(":id/davranis-analizi")
  async davranisAnalizi(@Param("id") id: string) { return this.cariService.davranisAnalizi(id); }

  @Post(":id/crm/etkilesimler")
  @Roller("muhasebe", "satis")
  async crmEtkilesimEkle(@Param("id") id: string, @Body() govde: unknown) {
    const sonuc = crmEtkilesimSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.cariService.crmEtkilesimEkle(id, sonuc.data);
  }

  @Post(":id/crm/gorevler")
  @Roller("muhasebe", "satis")
  async crmGorevEkle(@Param("id") id: string, @Body() govde: unknown) {
    const sonuc = crmGorevSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.cariService.crmGorevEkle(id, sonuc.data);
  }

  @Patch(":id/crm/gorevler/:gorevId")
  @Roller("muhasebe", "satis")
  async crmGorevDurum(@Param("id") id: string, @Param("gorevId") gorevId: string, @Body() govde: unknown) {
    const sonuc = crmGorevDurumSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.cariService.crmGorevDurum(id, gorevId, sonuc.data.durum);
  }

  @Get(":id/ekstre")
  async ekstre(
    @Param("id") id: string,
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
    @Query("iptaller") iptaller?: string,
    @Query() sorgu?: unknown,
  ) {
    return this.cariService.ekstre(id, baslangic, bitis, iptalleriGoster(iptaller), ekstreSecenekleri(sorgu));
  }

  /** CARI-31: içe aktarma şablonu (başlıklar, örnek satır, açıklama sayfası). */
  @Get("excel/sablon")
  @Roller("muhasebe")
  async excelSablon(@Res() res: Response) {
    const buffer = await this.iceAktarma.sablon();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=cari-sablonu.xlsx");
    res.send(buffer);
  }

  /** CARI-31: önizleme — hiçbir şey yazmaz; satır satır yeni/güncelle/hatalı. */
  @SaltOkumadaAcik()
  @Post("excel/onizleme")
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async excelOnizleme(@UploadedFile() file: YuklemeDosyasi | undefined) {
    return this.iceAktarma.onizleme(await this.excelDosyasi(file));
  }

  /** CARI-31: onay — dosya yeniden doğrulanır, hatasız satırlar yazılır. */
  @Post("excel/ice-aktar")
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async excelIceAktar(@UploadedFile() file: YuklemeDosyasi | undefined) {
    return this.iceAktarma.iceAktar(await this.excelDosyasi(file));
  }

  @SaltOkumadaAcik()
  @Post("excel/hatali-satirlar")
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async excelHataliSatirlar(@UploadedFile() file: YuklemeDosyasi | undefined, @Res() res: Response) {
    const buffer = await this.iceAktarma.hataliSatirlar(await this.excelDosyasi(file));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=cari-hatali-satirlar.xlsx");
    res.send(buffer);
  }

  private async excelDosyasi(file: YuklemeDosyasi | undefined): Promise<Buffer> {
    if (!file) throw new BadRequestException("Lütfen bir Excel dosyası yükleyin");
    await excelDosyasiniDogrula(file);
    return file.buffer;
  }

  @Get(":id/ekstre/pdf")
  async ekstrePdf(
    @Param("id") id: string,
    @Res() res: Response,
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
    @Query("iptaller") iptaller?: string,
    @Query() sorgu?: unknown,
  ) {
    const buffer = await this.cariService.ekstrePdf(id, baslangic, bitis, iptalleriGoster(iptaller), ekstreSecenekleri(sorgu));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=ekstre-${id}.pdf`,
    );
    res.send(buffer);
  }

  @Get(":id/ekstre/excel")
  async ekstreExcel(
    @Param("id") id: string,
    @Res() res: Response,
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
    @Query("iptaller") iptaller?: string,
    @Query() sorgu?: unknown,
  ) {
    const buffer = await this.cariService.ekstreExcel(id, baslangic, bitis, iptalleriGoster(iptaller), ekstreSecenekleri(sorgu));
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=ekstre-${id}.xlsx`,
    );
    res.send(buffer);
  }

  @Post(":id/ekstre/eposta")
  @Roller("muhasebe", "satis")
  async ekstreEposta(@Param("id") id: string, @Body() govde: unknown) {
    const sonuc = ekstreEpostaSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.cariService.ekstreEpostaGonder(id, sonuc.data.baslangic, sonuc.data.bitis, sonuc.data.alici, sonuc.data.iptalleriGoster ?? false, {
      tur: sonuc.data.tur, hedefDoviz: sonuc.data.tur === "doviz" ? sonuc.data.hedefDoviz : undefined, mutabakat: sonuc.data.mutabakat,
    });
  }

  // ─── CARI-39: teminatlar ─────────────────────────────────────────────────

  @Get(":id/teminatlar")
  async teminatlar(@Param("id") id: string) {
    return this.cariService.teminatlar(id);
  }

  @Post(":id/teminatlar")
  @Roller("muhasebe")
  async teminatEkle(@Param("id") id: string, @Body() govde: unknown) {
    return this.cariService.teminatEkle(id, teminatGirdisi(govde));
  }

  @Patch(":id/teminatlar/:teminatId")
  @Roller("muhasebe")
  async teminatGuncelle(@Param("id") id: string, @Param("teminatId") teminatId: string, @Body() govde: unknown) {
    return this.cariService.teminatGuncelle(id, teminatId, teminatGirdisi(govde));
  }

  @Post(":id/teminatlar/:teminatId/iade")
  @Roller("muhasebe")
  async teminatIade(@Param("id") id: string, @Param("teminatId") teminatId: string, @Body() govde: unknown) {
    const tarih = (govde as { iadeTarihi?: unknown } | null)?.iadeTarihi;
    if (tarih !== undefined && tarih !== null && (typeof tarih !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tarih))) throw new BadRequestException("İade tarihi YYYY-AA-GG olmalıdır");
    return this.cariService.teminatIade(id, teminatId, (tarih as string | null | undefined) ?? undefined);
  }

  @Delete(":id/teminatlar/:teminatId")
  @Roller("muhasebe")
  @HttpCode(204)
  async teminatSil(@Param("id") id: string, @Param("teminatId") teminatId: string) {
    await this.cariService.teminatSil(id, teminatId);
  }

  // ─── CARI-37: Form BA/BS mutabakatı ──────────────────────────────────────

  @Get(":id/babs")
  async babs(@Param("id") id: string, @Query("yil") yil?: string, @Query("ay") ay?: string) {
    const d = babsDonemi(yil, ay);
    return this.cariService.babsMutabakati(id, d.yil, d.ay);
  }

  @Get(":id/babs/pdf")
  async babsPdf(@Param("id") id: string, @Res() res: Response, @Query("yil") yil?: string, @Query("ay") ay?: string) {
    const d = babsDonemi(yil, ay);
    const buffer = await this.cariService.babsMutabakatPdf(id, d.yil, d.ay);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=babs-mutabakat-${d.yil}-${String(d.ay).padStart(2, "0")}.pdf`);
    res.send(buffer);
  }

  @Post(":id/babs/eposta")
  @Roller("muhasebe")
  async babsEposta(@Param("id") id: string, @Body() govde: unknown) {
    const g = (govde ?? {}) as { yil?: unknown; ay?: unknown; alici?: unknown };
    const d = babsDonemi(String(g.yil ?? ""), String(g.ay ?? ""));
    const alici = typeof g.alici === "string" && g.alici.trim() ? g.alici.trim() : undefined;
    if (alici && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alici)) throw new BadRequestException("Geçerli bir e-posta adresi girin");
    return this.cariService.babsMutabakatEposta(id, d.yil, d.ay, alici);
  }
}
