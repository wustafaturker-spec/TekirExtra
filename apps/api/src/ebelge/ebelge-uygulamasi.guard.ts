import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { EBELGE_UYGULAMALARI, type EbelgeUygulamaKodu, uygulamaAcik } from "@tekirextra/shared";
import { baglamAl } from "../core/istek-baglami";
import { EbelgeUygulamalariService } from "./ebelge-uygulamalari.service";
import { EBELGE_UYGULAMASI_ANAHTAR } from "./ebelge-uygulamasi.decorator";

/**
 * EBLG-77: kapalı e-belge uygulamasının ucunu reddeder. Ekranları menüden
 * gizlemek yetmez — doğrudan URL ile girilen istek de durmalı, yoksa e-Arşiv
 * kullanıcısı e-Fatura akışlarını çalıştırmaya devam eder.
 */
@Injectable()
export class EbelgeUygulamasiGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly uygulamalar: EbelgeUygulamalariService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gerekli = this.reflector.getAllAndOverride<EbelgeUygulamaKodu[] | undefined>(
      EBELGE_UYGULAMASI_ANAHTAR,
      [context.getHandler(), context.getClass()],
    );
    if (!gerekli || gerekli.length === 0) return true;
    if (!baglamAl()) return true; // @Public uçlar — AuthGuard zaten karar verdi

    const durum = await this.uygulamalar.uygulamalar();
    if (gerekli.some((kod) => uygulamaAcik(durum, kod))) return true;

    const adlar = gerekli.map((kod) => EBELGE_UYGULAMALARI.find((u) => u.kod === kod)?.ad ?? kod);
    throw new ForbiddenException(
      `Firma ${adlar.join(" / ")} uygulamasına kayıtlı değil; bu işlem Ayarlar > Firma ekranından mükellefiyet belirtilene kadar kullanılamaz`,
    );
  }
}
