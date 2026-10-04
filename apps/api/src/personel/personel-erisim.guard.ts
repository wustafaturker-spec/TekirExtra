import { CanActivate, ForbiddenException, Injectable } from "@nestjs/common";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { baglamAl } from "../core/istek-baglami";

/**
 * PRS-17 (P2-8): maaş ve özlük verisi muhasebe rolüne kapatılabilir
 * (personel.maasMuhasebeyeAcik = false). Yönetici ve İK rolü her zaman
 * erişir; denetleyicideki @Roller ilk süzgeçtir, bu guard ikinci.
 */
@Injectable()
export class PersonelErisimGuard implements CanActivate {
  constructor(private readonly ayarlar: AyarlarService) {}

  async canActivate(): Promise<boolean> {
    const baglam = baglamAl();
    if (!baglam || baglam.rol !== "muhasebe") return true;
    const ayar = await this.ayarlar.getir("personel");
    if (ayar.maasMuhasebeyeAcik === false) throw new ForbiddenException("Personel ve maaş verisi muhasebe rolüne kapalı (Ayarlar > Modüller > Personel); yönetici ya da İK rolü gerekir");
    return true;
  }
}
