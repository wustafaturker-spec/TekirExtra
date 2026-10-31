import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { bugunTR, MEVZUAT_TURLERI, takvimGunuMu } from "@tekirextra/shared";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { firmaTevkifatTablosu } from "../fatura/tevkifat-tablosu";
import { MevzuatService } from "./mevzuat.service";

const talepSemasi = z.object({
  tur: z.enum(MEVZUAT_TURLERI).optional().nullable(),
  anahtar: z.string().trim().max(40).optional().nullable(),
  aciklama: z.string().trim().min(10, "Lütfen eksik ya da hatalı gördüğünüz değeri ve dayanağını birkaç cümleyle yazın").max(2000),
});

/** Kiracı tarafı: Mevzuat Merkezi'ni salt okur (MVZ-07) ve talep açar (MVZ-09). */
@Controller("mevzuat")
export class MevzuatController {
  constructor(
    private readonly mevzuat: MevzuatService,
    private readonly ayarlar: AyarlarService,
  ) {}

  /** MVZ-11: formların KDV oranı ve kod listeleri — belge tarihindeki merkezi tablo. */
  @Get("kod-tablosu")
  kodTablosu(@Query("tarih") tarih?: string) {
    const gun = tarih ?? bugunTR();
    if (!takvimGunuMu(gun)) throw new BadRequestException("Tarih YYYY-MM-DD biçiminde geçerli bir takvim günü olmalıdır");
    return this.mevzuat.kodTablosu(gun);
  }

  /** MVZ-12: fatura formunun tevkifat listesi — belge tarihindeki merkezi tablo, firmanın gizledikleri işaretli. */
  @Get("tevkifat-tablosu")
  tevkifatTablosu(@Query("tarih") tarih?: string) {
    const gun = tarih ?? bugunTR();
    if (!takvimGunuMu(gun)) throw new BadRequestException("Tarih YYYY-MM-DD biçiminde geçerli bir takvim günü olmalıdır");
    return firmaTevkifatTablosu({ mevzuat: this.mevzuat, ayarlar: this.ayarlar }, gun);
  }

  @Get("kayitlar")
  async kayitlar(@Query("tur") tur: string, @Query("tarih") tarih?: string, @Query("gecmis") gecmis?: string) {
    const t = z.enum(MEVZUAT_TURLERI).safeParse(tur);
    if (!t.success) throw new BadRequestException("Geçersiz mevzuat türü");
    if (gecmis === "1") return this.mevzuat.tumKayitlar(t.data);
    const gun = tarih ?? bugunTR();
    if (!takvimGunuMu(gun)) throw new BadRequestException("Tarih YYYY-MM-DD biçiminde geçerli bir takvim günü olmalıdır");
    return this.mevzuat.yururluktekiler(t.data, gun);
  }

  @Get("degisiklikler")
  degisiklikler() {
    return this.mevzuat.yayinlananlar();
  }

  @Post("talepler")
  async talep(@Body() govde: unknown) {
    const sonuc = talepSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    await this.mevzuat.talepAc(sonuc.data);
    return { durum: "ok", mesaj: "Bildiriminiz Mevzuat Merkezi ekibine iletildi" };
  }
}
