import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { FiyatEndeksService, urunSorgusuSemasi } from "./fiyat-endeks.service";

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
