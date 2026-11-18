import { BadGatewayException, BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PlatformUcu } from "../auth/public.decorator";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { degerleriYaz, donemMetni, donemTarihi, zincirKatsayisiGuncelle } from "./endeks-deposu";
import { EndeksService } from "./endeks.service";
import { EvdsHatasi } from "./evds-istemci";

const kod = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Kod büyük harf, rakam ve alt çizgiden oluşmalı (ör. TUFE)");
const kaynakSiklik = z.enum(["aylik", "gunluk"]);
const tur = z.enum(["endeks", "kur"]);
const evdsKodu = z.string().trim().toUpperCase().regex(/^TP\.[A-Z0-9_.]{1,76}$/, "EVDS seri kodu TP. ile başlamalı (ör. TP.TUKFIY2025.GENEL)");
const ortak = {
  ad: z.string().trim().min(3, "Ad en az 3 karakter").max(160),
  bazYili: z.string().trim().max(20).nullable().optional(),
  kaynak: z.string().trim().min(2).max(60).optional(),
  sira: z.number().int().min(0).max(10_000).optional(),
  oncekiSeriKodu: kod.nullable().optional(),
};
// Kaynak sıklığı eklemede belirlenir, sonradan değişmez (değerler farklı yöntemle hesaplanmış olurdu).
const ekleSemasi = z.object({ kod, evdsKodu, ...ortak, kaynakSiklik: kaynakSiklik.default("aylik"), tur: tur.default("endeks") }).strict();
const guncelleSemasi = z.object({ ...ortak, ad: ortak.ad.optional(), etkin: z.boolean().optional(), tur: tur.optional() }).strict();
const sinaSemasi = z.object({ evdsKodu, kaynakSiklik: kaynakSiklik.default("aylik") }).strict();
const cekSemasi = z.object({ kod: kod.optional(), gecmisYil: z.number().int().min(1).max(40).optional() }).strict();
/** END-05: dönem YYYY-MM; değer pozitif, en çok 6 ondalık; dayanak zorunlu. */
const elleSemasi = z.object({
  donem: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Dönem YYYY-AA biçiminde olmalı (ör. 2026-10)"),
  deger: z.string().trim().regex(/^\d{1,13}(\.\d{1,6})?$/, "Değer pozitif sayı olmalı (en çok 6 ondalık, nokta ile)").refine((v) => Number(v) > 0, "Değer sıfırdan büyük olmalı"),
  aciklama: z.string().trim().min(5, "Dayanağı yazın (ör. TÜİK bülteni, tarih)").max(300),
}).strict();
/** İçinde bulunulan ay (Türkiye saati) YYYY-MM-01. */
const buAy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }).slice(0, 7) + "-01";

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
    const [seriler, sayimlar, elleSayim, uyariSayim, kullanimlar] = await Promise.all([
      db.endeksSerisi.findMany({ orderBy: [{ sira: "asc" }, { kod: "asc" }] }),
      db.endeksDegeri.groupBy({ by: ["seriKodu"], _count: { _all: true }, _min: { donem: true }, _max: { donem: true } }),
      db.endeksDegeri.groupBy({ by: ["seriKodu"], where: { kaynak: "elle" }, _count: { _all: true } }),
      db.endeksDegerRevizyonu.groupBy({ by: ["seriKodu"], where: { gorulduAt: null }, _count: { _all: true } }),
      db.$queryRaw<{ seri_kodu: string; kiraci_sayisi: bigint }[]>`SELECT * FROM platform_endeks_kullanim_sayilari()`,
    ]);
    const sayim = new Map(sayimlar.map((s) => [s.seriKodu, s]));
    const elle = new Map(elleSayim.map((s) => [s.seriKodu, s._count._all]));
    const uyari = new Map(uyariSayim.map((s) => [s.seriKodu, s._count._all]));
    const kullanim = new Map(kullanimlar.map((k) => [k.seri_kodu, Number(k.kiraci_sayisi)]));
    return {
      anahtarTanimli: this.endeks.anahtarTanimli(),
      seriler: seriler.map((s) => {
        const c = sayim.get(s.kod);
        return {
          kod: s.kod, evdsKodu: s.evdsKodu, ad: s.ad, siklik: s.siklik, kaynakSiklik: s.kaynakSiklik, tur: s.tur, bazYili: s.bazYili, kaynak: s.kaynak, etkin: s.etkin, sira: s.sira,
          oncekiSeriKodu: s.oncekiSeriKodu, zincirKatsayisi: s.zincirKatsayisi?.toString() ?? null, zincirDonemi: s.zincirDonemi ? donemMetni(s.zincirDonemi) : null,
          sonCekimAt: s.sonCekimAt, sonBasariliAt: s.sonBasariliAt, sonDonem: s.sonDonem ? donemMetni(s.sonDonem) : null, sonHata: s.sonHata,
          degerSayisi: c?._count._all ?? 0, ilkDonem: c?._min.donem ? donemMetni(c._min.donem) : null,
          elleDegerSayisi: elle.get(s.kod) ?? 0, gorulmemisRevizyon: uyari.get(s.kod) ?? 0,
          kiraciSayisi: kullanim.get(s.kod) ?? 0,
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
        db.endeksSerisi.create({ data: { kod: g.kod, evdsKodu: g.evdsKodu, ad: g.ad, bazYili: g.bazYili ?? null, kaynak: g.kaynak ?? "TÜİK", sira: g.sira ?? 100, oncekiSeriKodu: g.oncekiSeriKodu ?? null, kaynakSiklik: g.kaynakSiklik, tur: g.tur } }),
        this.olay("endeks_serisi_eklendi", { kod: g.kod, evdsKodu: g.evdsKodu, ad: g.ad, kaynakSiklik: g.kaynakSiklik, tur: g.tur }),
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
      ...(g.tur !== undefined ? { tur: g.tur } : {}),
    };
    await db.$transaction([
      db.endeksSerisi.update({ where: { kod: seriKodu }, data: veri }),
      this.olay("endeks_serisi_guncellendi", { kod: seriKodu, eski: { ad: eski.ad, etkin: eski.etkin, oncekiSeriKodu: eski.oncekiSeriKodu, sira: eski.sira }, yeni: veri }),
    ]);
    const zincir = g.oncekiSeriKodu !== undefined ? await zincirKatsayisiGuncelle(db, seriKodu) : undefined;
    return { kod: seriKodu, ...(zincir !== undefined ? { zincir } : {}) };
  }

  private async evds<T>(is: () => Promise<T>): Promise<T> {
    try { return await is(); } catch (hata) {
      if (hata instanceof EvdsHatasi) throw new BadGatewayException(hata.message);
      throw hata;
    }
  }

  /**
   * Seçici: EVDS veri grupları. Arama ad ve kodda, Türkçe harf duyarsız; arşiv
   * grupları istenmedikçe gizlenir. En çok 100 sonuç; aylık gruplar önce.
   */
  @Get("evds/gruplar")
  async evdsGruplari(@Query("ara") ara?: string, @Query("arsiv") arsiv?: string) {
    const gruplar = await this.evds(() => this.endeks.evdsGruplari());
    const norm = (v: string) => v.toLocaleLowerCase("tr-TR");
    const kelimeler = norm((ara ?? "").trim().slice(0, 100)).split(/\s+/).filter(Boolean);
    const uyan = gruplar.filter((g) => (arsiv === "1" || !g.arsiv) && kelimeler.every((k) => norm(`${g.ad} ${g.kod}`).includes(k)));
    uyan.sort((a, b) => Number(b.siklik === "AYLIK") - Number(a.siklik === "AYLIK") || a.ad.localeCompare(b.ad, "tr"));
    return { toplam: uyan.length, gruplar: uyan.slice(0, 100) };
  }

  /** Seçici: gruptaki seriler; katalogda kayıtlı olanlar işaretlenir. */
  @Get("evds/gruplar/:grup/seriler")
  async evdsGrupSerileri(@Param("grup") grup: string) {
    if (!/^[A-Za-z0-9_]{2,60}$/.test(grup)) throw new BadRequestException("Geçersiz EVDS grup kodu.");
    const [seriler, kayitli] = await Promise.all([
      this.evds(() => this.endeks.evdsGrupSerileri(grup)),
      this.platform.db.endeksSerisi.findMany({ select: { kod: true, evdsKodu: true } }),
    ]);
    const kayitliKod = new Map(kayitli.map((k) => [k.evdsKodu, k.kod]));
    return { seriler: seriler.map((s) => ({ ...s, kayitliKod: kayitliKod.get(s.kod.toUpperCase()) ?? null })) };
  }

  /** EVDS kodunu kayıt yazmadan sınar: son 24 ayın son değeri. */
  @Post("sina")
  async sina(@Body() govde: unknown) {
    try {
      const g = ayristir(sinaSemasi, govde);
      return await this.endeks.sina(g.evdsKodu, g.kaynakSiklik);
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
      degerler: degerler.map((d) => ({ donem: donemMetni(d.donem), deger: d.deger.toString(), kaynak: d.kaynak, aciklama: d.aciklama, alindiAt: d.alindiAt })),
      revizyonlar: revizyonlar.map((r) => ({ donem: donemMetni(r.donem), eskiDeger: r.eskiDeger.toString(), yeniDeger: r.yeniDeger.toString(), eskiKaynak: r.eskiKaynak, yeniKaynak: r.yeniKaynak, degistiAt: r.degistiAt, gorulduAt: r.gorulduAt })),
    };
  }

  /**
   * END-05: EVDS uzun süre erişilemezse bir dönemin değeri dayanağıyla elle
   * girilir. Yalnız tamamlanmış aylar; EVDS'den gelmiş değer elle ezilmez.
   * EVDS aynı dönemi farklı getirirse değer EVDS'ninkiyle değişir ve fark
   * "görülmedi" uyarısı olarak kalır.
   */
  @Post(":kod/elle")
  async elleGir(@Param("kod") seriKodu: string, @Body() govde: unknown) {
    const g = ayristir(elleSemasi, govde);
    const db = this.platform.db;
    const seri = await db.endeksSerisi.findUnique({ where: { kod: seriKodu }, select: { kod: true, sonDonem: true } });
    if (!seri) throw new NotFoundException("Seri bulunamadı");
    const donem = `${g.donem}-01`;
    if (donem >= buAy()) throw new BadRequestException("Yalnız tamamlanmış aylar elle girilebilir.");
    const mevcut = await db.endeksDegeri.findUnique({ where: { seriKodu_donem: { seriKodu, donem: donemTarihi(donem) } }, select: { kaynak: true, deger: true } });
    if (mevcut?.kaynak === "evds") throw new ConflictException(`Bu dönemin EVDS değeri var (${mevcut.deger.toString()}); elle değiştirilemez.`);
    await degerleriYaz(db, seriKodu, [{ donem, deger: g.deger }], "elle", null, g.aciklama);
    if (!seri.sonDonem || donemMetni(seri.sonDonem) < donem) await db.endeksSerisi.update({ where: { kod: seriKodu }, data: { sonDonem: donemTarihi(donem) } });
    await this.olay("endeks_degeri_elle_girildi", { kod: seriKodu, donem, deger: g.deger, aciklama: g.aciklama, onceki: mevcut ? mevcut.deger.toString() : null });
    return { kod: seriKodu, donem, deger: g.deger };
  }

  /** END-04/05: serinin görülmemiş revizyonlarını (elle–EVDS farkı dahil) görüldü işaretler. */
  @Post(":kod/revizyonlar/goruldu")
  async revizyonlarGoruldu(@Param("kod") seriKodu: string) {
    const db = this.platform.db;
    const r = await db.endeksDegerRevizyonu.updateMany({ where: { seriKodu, gorulduAt: null }, data: { gorulduAt: new Date() } });
    if (r.count) await this.olay("endeks_revizyonlari_goruldu", { kod: seriKodu, adet: r.count });
    return { adet: r.count };
  }
}
