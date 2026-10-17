import { HttpException, Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { UC } from "../ajan/araclar/uclar";
import { UcCagirici } from "../ajan/uc-cagirici";
import { kiraciSaglayicisi } from "../saglayici/kiraci-saglayici";
import type { IAiProvider } from "../saglayici/ai-provider.interface";
import { durumOlgulari, ozetiKur, ozetSecimSemasi, ozetTalimati, type CariDurumOzeti, type CariDurumYaniti } from "./cari-durum-ozeti";

/**
 * CARI-47: Cari Durum Paneli'nin "Özetle" düğmesi. Panel verisi ekranın
 * kendi ucundan (rol süzmesiyle, CARI-46) okunur; model yalnız olgu seçer,
 * paragrafı uygulama kurar. Sağlayıcı, onay (AI-14) ve sayaç (AI-15)
 * `kiraciSaglayicisi`nden gelir.
 */
@Injectable()
export class CariDurumOzetService {
  private readonly logger = new Logger(CariDurumOzetService.name);
  /** Testlerde sağlayıcıyı değiştirmek için. */
  saglayiciBul: (tenantId: string) => Promise<{ saglayici: IAiProvider }> = (tenantId) => kiraciSaglayicisi(this.prisma, tenantId, { ozellik: "ozet" });

  constructor(
    private readonly prisma: PrismaService,
    private readonly uc: UcCagirici,
  ) {}

  /** Düğme yalnız kullanılabilir bir sağlayıcı varken görünür; model çağrılmaz, sayılmaz. */
  async kullanilabilir(): Promise<{ kullanilabilir: boolean }> {
    const { saglayici } = await this.saglayiciBul(aktifBaglam().tenantId);
    return { kullanilabilir: saglayici.saglayiciAdi !== "tanimsiz" };
  }

  async ozetle(cariId: string): Promise<CariDurumOzeti> {
    const durum = await this.uc.cagir<CariDurumYaniti>(UC.cariDurum, [cariId]);
    const olgular = durumOlgulari(durum);
    // Seçilecek bir şey yoksa modele gidilmez.
    if (olgular.length <= 1) return ozetiKur(durum, { olguIdleri: olgular.map((o) => o.id) }, false, false);
    const { saglayici } = await this.saglayiciBul(aktifBaglam().tenantId);
    try {
      const secim = await saglayici.yapilandirilmisUretim(ozetTalimati(olgular), ozetSecimSemasi);
      return ozetiKur(durum, secim);
    } catch (hata) {
      // Sınır aşımı ve onay eksikliği kullanıcıya açık mesajla döner (AI-14/15).
      if (hata instanceof HttpException) throw hata;
      this.logger.warn(`Cari durum özeti modelden alınamadı: ${hata instanceof Error ? hata.name : "BilinmeyenHata"}`);
      // Ayrıştırılamayan/şemaya uymayan yanıt "geçersiz", diğerleri "model hatası" sayılır.
      return ozetiKur(durum, null, !(hata instanceof z.ZodError || hata instanceof SyntaxError));
    }
  }
}
