import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { raporExcel } from "../demirbas/demirbas-dosya";
import { AracTakipService, KATEGORI_ADLARI } from "./arac-takip.service";
import { aracGuncelleSemasi, bakimSemasi, cezaSemasi, donemSemasi, giderBagSemasi, kmSemasi, yukumlulukSemasi } from "./arac-takip.semalar";

function ayristir<T extends z.ZodTypeAny>(sema: T, deger: unknown): z.infer<T> {
  const sonuc = sema.safeParse(deger);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

const TUR_ADLARI: Record<string, string> = { binek: "Binek", hafif_ticari: "Hafif ticari", agir_vasita: "Ağır vasıta", motosiklet: "Motosiklet", is_makinesi: "İş makinesi", diger: "Diğer" };

/** ARC-01…11: araç takibi. Muhasebe ve yönetici yazar; depo km ve bakım girer; salt okunur görür (ARC-11). */
@Controller("arac-takip")
@Roller("muhasebe", "salt_okunur", "depo")
export class AracTakipController {
  constructor(private readonly service: AracTakipService) {}

  @Get()
  listele(@Query("tumu") tumu?: string) {
    return this.service.listele(tumu === "1");
  }

  @Get("yaklasanlar")
  yaklasanlar() {
    return this.service.yaklasanlar();
  }

  @Get("rapor")
  rapor(@Query() sorgu: unknown) {
    const d = ayristir(donemSemasi, sorgu);
    return this.service.rapor(d.baslangic, d.bitis);
  }

  @Get("rapor/excel")
  async raporExcel(@Query() sorgu: unknown, @Res() res: Response) {
    const d = ayristir(donemSemasi, sorgu);
    const r = await this.service.rapor(d.baslangic, d.bitis);
    const satirlar = r.satirlar.map((s) => ({
      plaka: s.plaka, arac: [s.marka, s.model].filter(Boolean).join(" "), tur: s.tur ? TUR_ADLARI[s.tur] : "", ...s.kategoriler, toplam: s.toplam,
      yol: s.yol ?? "", kmBasi: s.kmBasi, tuketim: s.tuketim ?? "", kkeg: s.kkeg?.toplamKkeg ?? null, ceza: s.ceza,
    }));
    const buffer = await raporExcel(`Araç maliyeti ${d.baslangic}–${d.bitis}`.slice(0, 31), [
      { baslik: "Plaka", anahtar: "plaka", genislik: 12 }, { baslik: "Araç", anahtar: "arac", genislik: 24 }, { baslik: "Tür", anahtar: "tur", genislik: 12 },
      ...Object.entries(KATEGORI_ADLARI).map(([k, ad]) => ({ baslik: ad, anahtar: k, para: true })),
      { baslik: "Toplam", anahtar: "toplam", para: true }, { baslik: "Yol (km)", anahtar: "yol", genislik: 10 }, { baslik: "Km başı", anahtar: "kmBasi", para: true },
      { baslik: "L/100 km", anahtar: "tuketim", genislik: 10 }, { baslik: "Binek KKEG", anahtar: "kkeg", para: true }, { baslik: "Cezalar", anahtar: "ceza", para: true },
    ], satirlar, { toplam: r.toplam, kkeg: r.toplamKkeg });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="arac-maliyeti-${d.baslangic}-${d.bitis}.xlsx"`);
    res.send(buffer);
  }

  @Post("yukumluluk/:kayitId/sil")
  @Roller("muhasebe")
  yukumlulukSil(@Param("kayitId", ParseUUIDPipe) kayitId: string) {
    return this.service.yukumlulukSil(kayitId);
  }

  @Post("gider/:giderId/coz")
  @Roller("muhasebe")
  giderCoz(@Param("giderId", ParseUUIDPipe) giderId: string) {
    return this.service.giderCoz(giderId);
  }

  @Post("bakim/:kayitId/sil")
  @Roller("muhasebe", "depo")
  bakimSil(@Param("kayitId", ParseUUIDPipe) kayitId: string) {
    return this.service.kayitSil("bakim", kayitId);
  }

  @Post("ceza/:kayitId/sil")
  @Roller("muhasebe")
  cezaSil(@Param("kayitId", ParseUUIDPipe) kayitId: string) {
    return this.service.kayitSil("ceza", kayitId);
  }

  @Post("km/:kayitId/sil")
  @Roller("muhasebe", "depo")
  kmSil(@Param("kayitId", ParseUUIDPipe) kayitId: string) {
    return this.service.kayitSil("km", kayitId);
  }

  @Get(":id")
  getir(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.getir(id);
  }

  @Patch(":id")
  @Roller("muhasebe")
  guncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.guncelle(id, ayristir(aracGuncelleSemasi, govde));
  }

  @Get(":id/gider-adaylari")
  giderAdaylari(@Param("id", ParseUUIDPipe) id: string, @Query("ara") ara?: string, @Query("baslangic") baslangic?: string, @Query("bitis") bitis?: string) {
    for (const t of [baslangic, bitis]) if (t && !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new BadRequestException("Tarih YYYY-AA-GG biçiminde olmalıdır");
    return this.service.giderAdaylari(id, { ara, baslangic, bitis });
  }

  @Post(":id/yukumluluk")
  @Roller("muhasebe")
  yukumlulukEkle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.yukumlulukEkle(id, ayristir(yukumlulukSemasi, govde));
  }

  @Post(":id/gider")
  @Roller("muhasebe")
  giderBagla(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.giderBagla(id, ayristir(giderBagSemasi, govde));
  }

  @Post(":id/km")
  @Roller("muhasebe", "depo")
  kmEkle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.kmEkle(id, ayristir(kmSemasi, govde));
  }

  @Post(":id/bakim")
  @Roller("muhasebe", "depo")
  bakimEkle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.bakimEkle(id, ayristir(bakimSemasi, govde));
  }

  @Post(":id/ceza")
  @Roller("muhasebe")
  cezaEkle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.cezaEkle(id, ayristir(cezaSemasi, govde));
  }
}
