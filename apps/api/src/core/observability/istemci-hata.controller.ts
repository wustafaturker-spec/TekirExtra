import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { DestekOturumundaAcik, SaltOkumadaAcik } from "../../auth/public.decorator";
import { aktifBaglam } from "../istek-baglami";
import { HataKayitService } from "./hata-kayit";

const istemciHataSemasi = z.object({
  ad: z.string().trim().max(200).optional(),
  mesaj: z.string().trim().min(1).max(1000),
  yigin: z.string().max(4000).optional(),
  sayfa: z.string().trim().max(300),
});

/** Kullanıcı başına dakikada en fazla bu kadar kayıt; döngüye giren sayfa tabloyu doldurmasın. */
export const DAKIKALIK_SINIR = 20;

/**
 * PLT-119: tarayıcıdaki yakalanmamış hatalar. Oturum açmış her rol gönderebilir (kendi
 * ekranının hatası); askıdaki firmada ve destek oturumunda da açıktır, firma verisi yazmaz.
 */
@Controller("istemci-hata")
export class IstemciHataController {
  private readonly sayac = new Map<string, { pencere: number; adet: number }>();

  constructor(private readonly hataKaydi: HataKayitService) {}

  @Post()
  @HttpCode(204)
  @SaltOkumadaAcik()
  @DestekOturumundaAcik()
  async bildir(@Body() govde: unknown): Promise<void> {
    const sonuc = istemciHataSemasi.safeParse(govde);
    if (!sonuc.success) return; // Bozuk bildirim sessizce atılır; istemci hata kaydı için uyarı almaz.
    const { tenantId, userId } = aktifBaglam();
    if (!this.izinli(userId ?? tenantId)) return;
    const g = sonuc.data;
    await this.hataKaydi.kaydet({
      kaynak: "web",
      ad: g.ad || "Error",
      mesaj: g.mesaj,
      yigin: g.yigin ?? null,
      // Sorgu dizesi ve parça atılır; kimlikler gruplamayı bölmesin diye maskelenir.
      konum: g.sayfa.split(/[?#]/)[0].replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}(?=\/|$)/gi, "/:id").replace(/\/\d+(?=\/|$)/g, "/:id"),
      tenantId,
    });
  }

  private izinli(anahtar: string): boolean {
    const pencere = Math.floor(Date.now() / 60_000);
    const s = this.sayac.get(anahtar);
    if (!s || s.pencere !== pencere) {
      if (this.sayac.size > 10_000) this.sayac.clear();
      this.sayac.set(anahtar, { pencere, adet: 1 });
      return true;
    }
    s.adet += 1;
    return s.adet <= DAKIKALIK_SINIR;
  }
}
