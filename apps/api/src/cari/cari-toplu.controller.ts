import { BadRequestException, Body, Controller, Get, Post, Query, Res } from "@nestjs/common";
import { Response } from "express";
import type { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { CariService } from "./cari.service";
import { CariTopluService } from "./cari-toplu.service";
import {
  TOPLU_EN_FAZLA, topluDurumSemasi, topluEkstreSemasi, topluEtiketSemasi, topluExcelSemasi, topluKaraListeSemasi, topluTemsilciSemasi,
} from "./cari-toplu";

const ayristir = <T>(sema: z.ZodType<T>, govde: unknown): T => {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
  return sonuc.data;
};

const siralamalar = ["kod", "unvan", "bakiye_azalan", "bakiye_artan"] as const;

/** CARI-40: cari listesinde seçilenlere toplu işlem. */
@Controller("cari/toplu")
export class CariTopluController {
  constructor(private readonly servis: CariTopluService, private readonly cari: CariService) {}

  /** Listenin süzgecine uyan bütün carilerin kimlikleri ("süzgecin tümünü seç"). */
  @Get("kimlikler")
  kimlikler(
    @Query("arama") arama?: string,
    @Query("tip") tip?: string,
    @Query("durum") durum?: string,
    @Query("bakiye") bakiye?: string,
    @Query("bakiyeMin") bakiyeMin?: string,
    @Query("bakiyeMax") bakiyeMax?: string,
    @Query("siralama") siralama?: string,
  ) {
    const sayi = (deger?: string) => {
      if (deger === undefined || deger.trim() === "") return undefined;
      const n = Number(deger.replace(",", "."));
      if (!Number.isFinite(n)) throw new BadRequestException("Bakiye sınırı sayı olmalıdır");
      return n;
    };
    if (siralama && !siralamalar.includes(siralama as (typeof siralamalar)[number])) throw new BadRequestException("Geçersiz sıralama");
    return this.cari.listeKimlikleri(arama, tip, durum, bakiye, {
      bakiyeMin: sayi(bakiyeMin), bakiyeMax: sayi(bakiyeMax), siralama: siralama as (typeof siralamalar)[number] | undefined,
    }, TOPLU_EN_FAZLA);
  }

  /** Toplu temsilci atamasında seçilecek etkin kullanıcılar (kart CRM sekmesindeki listeyle aynı). */
  @Get("temsilciler")
  @Roller("muhasebe")
  temsilciler() {
    return this.servis.temsilciler();
  }

  @Post("etiket")
  @Roller("muhasebe")
  etiket(@Body() govde: unknown) {
    return this.servis.etiket(ayristir(topluEtiketSemasi, govde));
  }

  @Post("durum")
  @Roller("muhasebe")
  durum(@Body() govde: unknown) {
    return this.servis.durum(ayristir(topluDurumSemasi, govde));
  }

  @Post("kara-liste")
  @Roller("muhasebe")
  karaListe(@Body() govde: unknown) {
    return this.servis.karaListe(ayristir(topluKaraListeSemasi, govde));
  }

  @Post("temsilci")
  @Roller("muhasebe")
  temsilci(@Body() govde: unknown) {
    return this.servis.temsilci(ayristir(topluTemsilciSemasi, govde));
  }

  @Post("ekstre-eposta")
  @Roller("muhasebe", "satis")
  ekstreEposta(@Body() govde: unknown) {
    return this.servis.ekstreEposta(ayristir(topluEkstreSemasi, govde));
  }

  @Post("excel")
  async excel(@Body() govde: unknown, @Res() res: Response) {
    const buffer = await this.servis.excel(ayristir(topluExcelSemasi, govde).cariIdler);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=cariler-${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.send(buffer);
  }
}
