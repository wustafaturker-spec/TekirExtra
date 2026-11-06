import { firmaEbelgeEksikleri, ILAVE_FATURA_TIPLERI } from "@tekirextra/shared";
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
} from "@nestjs/common";
import { z } from "zod";
import { Public, SaltOkumadaAcik } from "../auth/public.decorator";
import { Roller } from "../auth/roller.decorator";
import { ebelgeUygulamalariCozTenant, mukellefiyetCelismeleriniOku } from "../ebelge/ebelge-uygulamalari.service";
import type { Prisma } from "@prisma/client";
import { degisiklikleriBul } from "../core/denetim-farki";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import {
  BaglantilarService,
  baglantiGuncelleSemasi,
  baglantiOlusturSemasi,
} from "./baglantilar.service";
import { BelgeTasarimlariService, TASARIM_TURLERI, firmaTasarimiSemasi, tasarimOnizleSemasi, tasarimSecimSemasi, tasarimYukleSemasi } from "./belge-tasarimlari.service";
import { KayitService, kayitSemasi } from "./kayit.service";
import { AZAMI_ROZET_BOYU, AZAMI_ROZET_SAYISI } from "../ebelge/firma-tasarimi/firma-tasarimi";

/** Boş metin "sil" demektir; alan null olarak kaydedilir. */
const serbestMetin = (sinir: number) => z.string().trim().max(sinir).transform((d) => d || null).nullable().optional();

const firmaGuncelleSemasi = z.object({
  unvan: z.string().min(2).max(255).optional(),
  vergiDairesiKodu: z.string().trim().min(1).max(10).optional(),
  // VKN yalnızca tenant oluşturulurken belirlenir. Sonraki değişiklikler
  // doğrulanmış platform destek sürecinden yapılmalıdır.
  vergiDairesi: z.string().min(2).max(120).optional(),
  // EBLG-62: e-belgenin satıcı tarafına ve PDF'lere yazılan bilgiler.
  adres: serbestMetin(300),
  ilce: serbestMetin(80),
  il: serbestMetin(80),
  postaKodu: serbestMetin(10),
  telefon: serbestMetin(30),
  eposta: z.union([z.string().trim().email("Geçerli bir e-posta girin"), z.literal("")]).transform((d) => d || null).nullable().optional(),
  webSitesi: serbestMetin(200),
  mersisNo: z.union([z.string().trim().regex(/^\d{16}$/, "MERSİS numarası 16 hanedir"), z.literal("")]).transform((d) => d || null).nullable().optional(),
  ticaretSicilNo: serbestMetin(30),
  // Yolcu beraberi (tax-free): KDV iadesini yapan aracı kurumun varsayılanı.
  araciKurumVkn: z.union([z.string().trim().regex(/^\d{10}$/, "Aracı kurum VKN'si 10 hanedir"), z.literal("")]).transform((d) => d || null).nullable().optional(),
  araciKurumEtiket: z.union([z.string().trim().regex(/^urn:mail:\S+@\S+$/, "Etiket urn:mail:…@… biçiminde olmalıdır"), z.literal("")]).transform((d) => d || null).nullable().optional(),
  araciKurumUnvan: serbestMetin(200),
  // SGK faturası: firmanın grubu ve Kurum'da tanımlı kodu/adı (EBLG-70).
  sgkIlaveFaturaTipi: z.union([z.enum(ILAVE_FATURA_TIPLERI.map((t) => t.kod) as [string, ...string[]]), z.literal("")]).transform((d) => d || null).nullable().optional(),
  sgkMukellefKodu: serbestMetin(40),
  sgkMukellefAdi: serbestMetin(200),
  // EBLG-77: firmanın kendi e-belge mükellefiyetleri; null "otomatik" demektir.
  efaturaMukellefi: z.boolean().nullable().optional(),
  earsivMukellefi: z.boolean().nullable().optional(),
  eirsaliyeMukellefi: z.boolean().nullable().optional(),
  // EBLG-101: entegratöre yüklenen firma tasarımının firmaya ait parçaları.
  belgeMarkaAdi: serbestMetin(40),
  belgeMarkaAlt: serbestMetin(80),
  belgeEkBilgi: serbestMetin(160),
  belgeRozetleri: z
    .array(z.string().regex(/^data:image\/(png|jpe?g|gif|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/, "Rozet bir görsel olmalıdır").max(AZAMI_ROZET_BOYU, "Rozet görseli en çok 60 KB olabilir"))
    .max(AZAMI_ROZET_SAYISI, `En çok ${AZAMI_ROZET_SAYISI} rozet eklenebilir`)
    .optional(),
});

/** Firma ekranının okuduğu alanlar; e-belge eksikleri de bununla hesaplanır. */
const FIRMA_ALANLARI = {
  id: true, unvan: true, kisiTuru: true, vkn: true, vergiDairesi: true, vergiDairesiKodu: true,
  adres: true, ilce: true, il: true, postaKodu: true, telefon: true, eposta: true, webSitesi: true, mersisNo: true, ticaretSicilNo: true,
  araciKurumVkn: true, araciKurumEtiket: true, araciKurumUnvan: true,
  sgkIlaveFaturaTipi: true, sgkMukellefKodu: true, sgkMukellefAdi: true,
  efaturaMukellefi: true,
  earsivMukellefi: true,
  eirsaliyeMukellefi: true,
  belgeMarkaAdi: true, belgeMarkaAlt: true, belgeEkBilgi: true, belgeRozetleri: true,
  abonelik: { select: { planKodu: true, durum: true, faturaEpostasi: true, donemBaslangici: true, donemSonu: true } },
} as const;

@Controller()
export class TenantController {
  constructor(
    private readonly kayit: KayitService,
    private readonly baglantilar: BaglantilarService,
    private readonly prisma: PrismaService,
    private readonly tasarimlar: BelgeTasarimlariService,
  ) {}

  /** Kayıt ekranındaki seçenekler yalnız güncel açık satış sürümünden üretilir. */
  @Public()
  @Get("tenant/kayit/paketler")
  async kayitPaketleri() {
    return this.kayit.acikSatisPaketleri();
  }

  @Public()
  @Get("vergi-daireleri")
  async vergiDaireleri() {
    return this.prisma.vergiDairesi.findMany({ where: { aktif: true }, orderBy: [{ ilKodu: "asc" }, { ilce: "asc" }, { ad: "asc" }] });
  }

  /** Self-servis firma kaydı (KLN-07) — kimliksiz erişilir. */
  @Public()
  @Post("tenant/kayit")
  async firmaKaydi(@Body() govde: unknown) {
    const ayristirma = kayitSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    const sonuc = await this.kayit.kaydet(ayristirma.data);
    return {
      ...sonuc,
      mesaj: "Kayıt alındı; doğrulama e-postanızı kontrol edin",
    };
  }

  @Get("firma")
  async firma() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: FIRMA_ALANLARI,
      });
      if (!tenant) return null;
      // EBLG-76/77: ekranda hem elle seçim hem listeden gelen geçerli durum gösterilir.
      const ebelgeUygulamalari = await ebelgeUygulamalariCozTenant(tx, tenant);

      const logo = await tx.ek.findFirst({
        where: { sahipTur: "firma", sahipId: tenantId },
        orderBy: { createdAt: "desc" },
        select: { id: true, dosyaAdi: true, mimeTip: true, boyut: true },
      });

      // EBLG-62: e-belge gönderimini durduracak eksikler ekranda gösterilir.
      return {
        ...tenant,
        ebelgeUygulamalari,
        ebelgeCelismeleri: await mukellefiyetCelismeleriniOku(tx, tenant),
        logo,
        ebelgeEksikleri: firmaEbelgeEksikleri(tenant),
      };
    });
  }

  @Patch("firma")
  @Roller("yonetici")
  async firmaGuncelle(@Body() govde: unknown) {
    const ayristirma = firmaGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(ayristirma.error.issues.map((s) => s.message).join("; ") || "Geçersiz firma bilgisi");
    }
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const yeni = ayristirma.data;
      if (yeni.il || yeni.ilce || yeni.vergiDairesi || yeni.vergiDairesiKodu) {
        const mevcut = await tx.tenant.findUnique({ where: { id: tenantId }, select: { il: true, ilce: true, vergiDairesi: true, vergiDairesiKodu: true } });
        const il = yeni.il ?? mevcut?.il;
        const ilce = yeni.ilce ?? mevcut?.ilce;
        const vergiDairesi = yeni.vergiDairesi ?? mevcut?.vergiDairesi;
        // Gönderilmeyen kod mevcut koddur; aynı il/ilçeyi yeniden göndermek konum değişikliği sayılmaz.
        const kod = yeni.vergiDairesiKodu ?? mevcut?.vergiDairesiKodu;
        const konumDegisti = il !== mevcut?.il || ilce !== mevcut?.ilce || vergiDairesi !== mevcut?.vergiDairesi || kod !== mevcut?.vergiDairesiKodu;
        const daire = kod && il && ilce ? await tx.vergiDairesi.findFirst({ where: { kod, il, ilce, aktif: true }, select: { kod: true, ad: true } }) : null;
        if (konumDegisti && (!il || !ilce || !daire)) {
          throw new BadRequestException("İl, ilçe ve vergi dairesi etkin listeden birlikte seçilmelidir");
        }
        if (daire) Object.assign(yeni, { vergiDairesi: daire.ad, vergiDairesiKodu: daire.kod, il, ilce });
      }
      const onceki = await tx.tenant.findUnique({ where: { id: tenantId }, select: FIRMA_ALANLARI });
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: yeni,
        select: FIRMA_ALANLARI,
      });
      // Yönetim P1-4: firma kimliği (VKN, unvan, e-belge mükellefiyeti…) değişikliği izlenir.
      const degisiklikler = degisiklikleriBul(onceki, tenant);
      if (Object.keys(degisiklikler).length) {
        await tx.auditLog.create({ data: { tenantId, userId, islem: "firma_bilgisi_degisti", varlik: "tenant", varlikId: tenantId, detay: { degisiklikler } as Prisma.InputJsonValue } });
      }

      const logo = await tx.ek.findFirst({
        where: { sahipTur: "firma", sahipId: tenantId },
        orderBy: { createdAt: "desc" },
        select: { id: true, dosyaAdi: true, mimeTip: true, boyut: true },
      });

      // EBLG-62: e-belge gönderimini durduracak eksikler ekranda gösterilir.
      return {
        ...tenant,
        ebelgeUygulamalari: await ebelgeUygulamalariCozTenant(tx, tenant),
        ebelgeCelismeleri: await mukellefiyetCelismeleriniOku(tx, tenant),
        logo,
        ebelgeEksikleri: firmaEbelgeEksikleri(tenant),
      };
    });
  }

  @Get("baglantilar")
  @Roller("yonetici")
  baglantiListesi() {
    return this.baglantilar.listele();
  }

  @Post("baglantilar")
  @Roller("yonetici")
  baglantiOlustur(@Body() govde: unknown) {
    const ayristirma = baglantiOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException("Geçersiz bağlantı bilgisi");
    }
    return this.baglantilar.olustur(ayristirma.data);
  }

  @SaltOkumadaAcik()
  @Post("baglantilar/:id/test")
  @Roller("yonetici")
  @HttpCode(200)
  baglantiTest(@Param("id") id: string) {
    return this.baglantilar.test(id);
  }

  @Patch("baglantilar/:id")
  @Roller("yonetici")
  baglantiGuncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = baglantiGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException("Geçersiz bağlantı bilgisi");
    }
    return this.baglantilar.guncelle(id, ayristirma.data);
  }

  @Post("baglantilar/:id/aktif-et")
  @Roller("yonetici")
  baglantiAktifEt(@Param("id") id: string) {
    return this.baglantilar.aktifEt(id);
  }

  // ─── ENTEGRATÖR BELGE TASARIMLARI (EBLG-99) ────────────────────────────────

  @Get("baglantilar/:id/tasarimlar")
  @Roller("yonetici")
  tasarimListesi(@Param("id") id: string, @Query("tur") tur: string) {
    const ayristirma = z.enum(TASARIM_TURLERI).safeParse(tur);
    if (!ayristirma.success) throw new BadRequestException("Geçersiz belge türü");
    return this.tasarimlar.listele(id, ayristirma.data);
  }

  @Post("baglantilar/:id/tasarimlar")
  @Roller("yonetici")
  tasarimYukle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = tasarimYukleSemasi.safeParse(govde);
    if (!ayristirma.success) throw new BadRequestException(ayristirma.error.issues[0]?.message ?? "Geçersiz tasarım");
    return this.tasarimlar.yukle(id, ayristirma.data);
  }

  @SaltOkumadaAcik()
  @Post("baglantilar/:id/tasarimlar/onizle")
  @Roller("yonetici")
  @HttpCode(200)
  tasarimOnizle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = tasarimOnizleSemasi.safeParse(govde);
    if (!ayristirma.success) throw new BadRequestException("Geçersiz önizleme isteği");
    return this.tasarimlar.onizle(id, ayristirma.data);
  }

  @Post("baglantilar/:id/tasarimlar/firma-tasarimi")
  @Roller("yonetici")
  firmaTasarimiOlustur(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = firmaTasarimiSemasi.safeParse(govde);
    if (!ayristirma.success) throw new BadRequestException("Geçersiz belge türü");
    return this.tasarimlar.firmaTasarimiOlustur(id, ayristirma.data.tur);
  }

  @Patch("baglantilar/:id/tasarim-secimi")
  @Roller("yonetici")
  tasarimSec(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = tasarimSecimSemasi.safeParse(govde);
    if (!ayristirma.success) throw new BadRequestException("Geçersiz tasarım seçimi");
    return this.tasarimlar.sec(id, ayristirma.data);
  }

  @Delete("baglantilar/:id")
  @Roller("yonetici")
  async baglantiSil(@Param("id") id: string) {
    await this.baglantilar.sil(id);
    return { durum: "ok" };
  }
}
