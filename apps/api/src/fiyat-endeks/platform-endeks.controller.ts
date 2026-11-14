import { BadGatewayException, BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PlatformUcu } from "../auth/public.decorator";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { donemMetni, zincirKatsayisiGuncelle } from "./endeks-deposu";
import { EndeksService } from "./endeks.service";
import { EvdsHatasi } from "./evds-istemci";
import { kurEndeksiMi } from "./fiyat-endeks-veri";

const kod = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Kod büyük harf, rakam ve alt çizgiden oluşmalı (ör. TUFE)")
  .refine((k) => !kurEndeksiMi(k), "USD ve EUR kur karşılaştırması için ayrılmıştır");
const evdsKodu = z.string().trim().toUpperCase().regex(/^TP\.[A-Z0-9_.]{1,76}$/, "EVDS seri kodu TP. ile başlamalı (ör. TP.TUKFIY2025.GENEL)");
const ortak = {
  ad: z.string().trim().min(3, "Ad en az 3 karakter").max(160),
  bazYili: z.string().trim().max(20).nullable().optional(),
  kaynak: z.string().trim().min(2).max(60).optional(),
  sira: z.number().int().min(0).max(10_000).optional(),
  oncekiSeriKodu: kod.nullable().optional(),
};
const ekleSemasi = z.object({ kod, evdsKodu, ...ortak }).strict();
const guncelleSemasi = z.object({ ...ortak, ad: ortak.ad.optional(), etkin: z.boolean().optional() }).strict();
const sinaSemasi = z.object({ evdsKodu }).strict();
const cekSemasi = z.object({ kod: kod.optional(), gecmisYil: z.number().int().min(1).max(40).optional() }).strict();

function ayristir<T>(sema: z.ZodType<T>, govde: unknown): T {
  const r = sema.safeParse(govde ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}

/**
 * END-26 (kullanıcı kararı 2026-11-14): EVDS verisi globaldir ve platformdan
 * yönetilir. Seri silinmez, durdurulur. Her değişiklik platform olay kaydına
 * yazılır; EVDS anahtarı gösterilmez, yalnız tanımlı olup olmadığı döner.
 */
@PlatformUcu()
@Controller("platform/endeksler")
export class PlatformEndeksController {
  constructor(private readonly platform: PlatformPrismaService, private readonly endeks: EndeksService) {}

  private olay(olay: string, detay: Prisma.InputJsonValue) {
    return this.platform.db.mevzuatOlay.create({ data: { kullaniciId: aktifPlatformBaglam().kullaniciId, olay, detay } });
  }

  @Get()
  async listele() {
    const db = this.platform.db;
    const [seriler, sayimlar] = await Promise.all([
      db.endeksSerisi.findMany({ orderBy: [{ sira: "asc" }, { kod: "asc" }] }),
      db.endeksDegeri.groupBy({ by: ["seriKodu"], _count: { _all: true }, _min: { donem: true }, _max: { donem: true } }),
    ]);
    const sayim = new Map(sayimlar.map((s) => [s.seriKodu, s]));
    return {
      anahtarTanimli: this.endeks.anahtarTanimli(),
      seriler: seriler.map((s) => {
        const c = sayim.get(s.kod);
        return {
          kod: s.kod, evdsKodu: s.evdsKodu, ad: s.ad, siklik: s.siklik, bazYili: s.bazYili, kaynak: s.kaynak, etkin: s.etkin, sira: s.sira,
          oncekiSeriKodu: s.oncekiSeriKodu, zincirKatsayisi: s.zincirKatsayisi?.toString() ?? null, zincirDonemi: s.zincirDonemi ? donemMetni(s.zincirDonemi) : null,
          sonCekimAt: s.sonCekimAt, sonBasariliAt: s.sonBasariliAt, sonDonem: s.sonDonem ? donemMetni(s.sonDonem) : null, sonHata: s.sonHata,
          degerSayisi: c?._count._all ?? 0, ilkDonem: c?._min.donem ? donemMetni(c._min.donem) : null,
        };
      }),
    };
  }

  @Post()
  async ekle(@Body() govde: unknown) {
    const g = ayristir(ekleSemasi, govde);
    const db = this.platform.db;
    if (g.oncekiSeriKodu && !(await db.endeksSerisi.findUnique({ where: { kod: g.oncekiSeriKodu } }))) throw new BadRequestException("Zincirlenecek önceki seri bulunamadı.");
    try {
      await db.$transaction([
        db.endeksSerisi.create({ data: { kod: g.kod, evdsKodu: g.evdsKodu, ad: g.ad, bazYili: g.bazYili ?? null, kaynak: g.kaynak ?? "TÜİK", sira: g.sira ?? 100, oncekiSeriKodu: g.oncekiSeriKodu ?? null } }),
        this.olay("endeks_serisi_eklendi", { kod: g.kod, evdsKodu: g.evdsKodu, ad: g.ad }),
      ]);
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") throw new ConflictException("Bu kod ya da EVDS kodu zaten kayıtlı.");
      throw hata;
    }
    return { kod: g.kod };
  }

  @Patch(":kod")
  async guncelle(@Param("kod") seriKodu: string, @Body() govde: unknown) {
    const g = ayristir(guncelleSemasi, govde);
    const db = this.platform.db;
    const eski = await db.endeksSerisi.findUnique({ where: { kod: seriKodu } });
    if (!eski) throw new NotFoundException("Seri bulunamadı");
    if (g.oncekiSeriKodu) {
      if (g.oncekiSeriKodu === seriKodu) throw new BadRequestException("Seri kendisine zincirlenemez.");
      const onceki = await db.endeksSerisi.findUnique({ where: { kod: g.oncekiSeriKodu }, select: { oncekiSeriKodu: true } });
      if (!onceki) throw new BadRequestException("Zincirlenecek önceki seri bulunamadı.");
      if (onceki.oncekiSeriKodu === seriKodu) throw new BadRequestException("İki seri birbirine zincirlenemez.");
    }
    const veri = {
      ...(g.ad !== undefined ? { ad: g.ad } : {}), ...(g.bazYili !== undefined ? { bazYili: g.bazYili } : {}),
      ...(g.kaynak !== undefined ? { kaynak: g.kaynak } : {}), ...(g.sira !== undefined ? { sira: g.sira } : {}),
      ...(g.etkin !== undefined ? { etkin: g.etkin } : {}), ...(g.oncekiSeriKodu !== undefined ? { oncekiSeriKodu: g.oncekiSeriKodu } : {}),
    };
    await db.$transaction([
      db.endeksSerisi.update({ where: { kod: seriKodu }, data: veri }),
      this.olay("endeks_serisi_guncellendi", { kod: seriKodu, eski: { ad: eski.ad, etkin: eski.etkin, oncekiSeriKodu: eski.oncekiSeriKodu, sira: eski.sira }, yeni: veri }),
    ]);
    const zincir = g.oncekiSeriKodu !== undefined ? await zincirKatsayisiGuncelle(db, seriKodu) : undefined;
    return { kod: seriKodu, ...(zincir !== undefined ? { zincir } : {}) };
  }

  /** EVDS kodunu kayıt yazmadan sınar: son 24 ayın son değeri. */
  @Post("sina")
  async sina(@Body() govde: unknown) {
    try {
      return await this.endeks.sina(ayristir(sinaSemasi, govde).evdsKodu);
    } catch (hata) {
      if (hata instanceof EvdsHatasi) throw new BadGatewayException(hata.message);
      throw hata;
    }
  }

  /** "Şimdi çek" / "Geçmişi doldur": platform bağlantısıyla yazar. */
  @Post("cek")
  async cek(@Body() govde: unknown) {
    const g = ayristir(cekSemasi, govde);
    if (g.kod && !(await this.platform.db.endeksSerisi.findUnique({ where: { kod: g.kod } }))) throw new NotFoundException("Seri bulunamadı");
    const sonuclar = await this.endeks.cek({ db: this.platform.db, kodlar: g.kod ? [g.kod] : undefined, gecmisYil: g.gecmisYil });
    await this.olay("endeks_cekildi", { kod: g.kod ?? null, gecmisYil: g.gecmisYil ?? null, sonuclar: sonuclar.map((s) => ({ kod: s.kod, basarili: s.basarili, yeni: s.yeni ?? 0, revize: s.revize ?? 0 })) });
    return { sonuclar };
  }

  @Get(":kod/degerler")
  async degerler(@Param("kod") seriKodu: string) {
    const db = this.platform.db;
    if (!(await db.endeksSerisi.findUnique({ where: { kod: seriKodu }, select: { kod: true } }))) throw new NotFoundException("Seri bulunamadı");
    const [degerler, revizyonlar] = await Promise.all([
      db.endeksDegeri.findMany({ where: { seriKodu }, orderBy: { donem: "desc" }, take: 600 }),
      db.endeksDegerRevizyonu.findMany({ where: { seriKodu }, orderBy: { degistiAt: "desc" }, take: 200 }),
    ]);
    return {
      degerler: degerler.map((d) => ({ donem: donemMetni(d.donem), deger: d.deger.toString(), kaynak: d.kaynak, alindiAt: d.alindiAt })),
      revizyonlar: revizyonlar.map((r) => ({ donem: donemMetni(r.donem), eskiDeger: r.eskiDeger.toString(), yeniDeger: r.yeniDeger.toString(), eskiKaynak: r.eskiKaynak, yeniKaynak: r.yeniKaynak, degistiAt: r.degistiAt })),
    };
  }
}
