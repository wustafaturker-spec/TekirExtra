import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { FiyatEndeksService, oneriSorgusuSemasi, urunSorgusuSemasi } from "./fiyat-endeks.service";

const liste = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

/**
 * END-11: ürün ekranının uçları. Rol sınırı uçta değil, yöneticinin modül
 * ayarındadır (END-23); plan özelliği ve özel rol (raporlar kutusu) ayrıca denetlenir.
 */
@Controller("fiyat-endeks")
export class FiyatEndeksController {
  constructor(private readonly servis: FiyatEndeksService) {}

  @Get("secenekler")
  secenekler() {
    return this.servis.secenekler();
  }

  /** END-21: endeks/kur serisinin aylık değerleri ve değişimi (asistan aracı bu ucu çağırır). */
  @Get("endeks/:kod")
  endeks(@Param("kod") kod: string, @Query("baslangic") baslangic: string, @Query("bitis") bitis: string) {
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(kod)) throw new BadRequestException("Geçersiz endeks kodu");
    return this.servis.endeks(kod, { baslangic: baslangic ?? "", bitis: bitis ?? "" });
  }

  /** END-16: fiyat listesi için endekse göre güncelleme önizlemesi (yazmaz). */
  @Get("fiyat-onerisi")
  fiyatOnerisi(@Query() q: Record<string, string | undefined>) {
    const sonuc = oneriSorgusuSemasi.safeParse({ listeId: q.listeId, endeks: q.endeks, yuvarlama: q.yuvarlama || undefined, varsayilanBazAy: q.varsayilanBazAy || undefined, stokIdler: liste(q.stokIdler) });
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.servis.fiyatOnerisi(sonuc.data);
  }

  @Get("urun/:stokId")
  urun(@Param("stokId", ParseUUIDPipe) stokId: string, @Query() q: Record<string, string | undefined>) {
    const sonuc = urunSorgusuSemasi.safeParse({
      baslangic: q.baslangic, bitis: q.bitis, baz: q.baz || undefined,
      endeksler: liste(q.endeksler), satisKapsami: q.satisKapsami || undefined,
      listeler: liste(q.listeler), alis: q.alis === "1", varyantId: q.varyantId || undefined, cizgiler: liste(q.cizgiler),
    });
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.servis.urun(stokId, sonuc.data);
  }
}
