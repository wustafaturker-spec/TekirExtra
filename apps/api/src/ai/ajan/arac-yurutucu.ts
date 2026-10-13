import { Injectable, Logger } from "@nestjs/common";
import type { Rol } from "@tekirextra/shared";
import { AiOnayService, type OnayTalebiGorunumu } from "../onay/ai-onay.service";
import { AJAN_ARACLARI, aracBul, type AjanAraci } from "./araclar";
import { UcCagirici } from "./uc-cagirici";

const ARAC_CIKTISI_SINIRI = 12_000;

export interface AracSonucu {
  icerik: string;
  hata?: boolean;
  talep?: OnayTalebiGorunumu;
}

export function hataMetni(hata: unknown): string {
  if (hata && typeof hata === "object" && "getResponse" in hata && typeof (hata as { getResponse: unknown }).getResponse === "function") {
    const yanit = (hata as { getResponse: () => unknown }).getResponse();
    if (typeof yanit === "string") return yanit;
    const mesaj = (yanit as { message?: unknown })?.message;
    if (Array.isArray(mesaj)) return mesaj.join("; ");
    if (typeof mesaj === "string") return mesaj;
  }
  return hata instanceof Error ? hata.message : "Araç çalışırken hata oluştu";
}

function jsonKisalt(deger: unknown): string {
  const metin = JSON.stringify(deger ?? null);
  return metin.length > ARAC_CIKTISI_SINIRI ? `${metin.slice(0, ARAC_CIKTISI_SINIRI)}… (kısaltıldı)` : metin;
}

/**
 * Asistan (AI-05) ve MCP (AI-09) için ortak araç yürütme: yetki süzgeci,
 * girdi doğrulaması, okuma/taslak araçlarını çalıştırma, onaya tabi araçta
 * yalnız talep açma. Kimlik ve rol aktif istek bağlamından gelir.
 */
@Injectable()
export class AracYurutucu {
  private readonly logger = new Logger(AracYurutucu.name);

  constructor(
    private readonly uc: UcCagirici,
    private readonly onay: AiOnayService,
  ) {}

  /** Rolün ekranda girebildiği uçların araçları (AI-02). */
  izinliAraclar(rol: Rol): AjanAraci[] {
    return AJAN_ARACLARI.filter((a) => this.uc.yetkiliMi(a.uc, rol));
  }

  async yurut(
    cagri: { ad: string; girdi: unknown },
    izinli: Map<string, AjanAraci>,
    secenek: { kaynak: "asistan" | "mcp"; oturumId?: string | null },
  ): Promise<AracSonucu> {
    const arac = izinli.get(cagri.ad);
    if (!arac) {
      if (aracBul(cagri.ad)) return { icerik: `Kullanıcının rolü "${cagri.ad}" işlemine yetkili değil; bu işlemi yapamazsın.`, hata: true };
      // Canlıda Gemini adı kesik yazdı ("belge_taslagi_olust"): en yakın adı önerip yeniden denetir.
      const oneri = [...izinli.keys()].find((ad) => cagri.ad && (ad.startsWith(cagri.ad) || cagri.ad.startsWith(ad)));
      return { icerik: `"${cagri.ad}" adlı araç yok.${oneri ? ` "${oneri}" aracını kastettiysen onu aynı parametrelerle yeniden çağır.` : " Yalnız sunulan araç adlarını kullan."}`, hata: true };
    }
    const ayristirma = arac.girdi.safeParse(cagri.girdi);
    if (!ayristirma.success) {
      return {
        icerik: `Geçersiz parametre: ${ayristirma.error.issues.map((s) => `${s.path.join(".")}: ${s.message}`).join("; ")}. ` +
          "Kimlik (…Id) alanları arama araçlarının döndürdüğü UUID olmalıdır; elinde belge numarası ya da ad varsa önce ilgili arama aracını çağır.",
        hata: true,
      };
    }
    const baglam = { uc: this.uc, kaynak: secenek.kaynak, arac: arac.ad };
    try {
      if (arac.sinif === "onay") {
        const ozet = await arac.ozetle!(baglam, ayristirma.data);
        // Ham girdi saklanır; onayda aynı şemayla yeniden doğrulanır.
        const talep = await this.onay.olustur({ arac: arac.ad, parametreler: cagri.girdi, ozet, kaynak: secenek.kaynak, oturumId: secenek.oturumId ?? null });
        return {
          icerik: jsonKisalt({
            durum: "onay_bekliyor", talepId: talep.id, ozet, adres: `/panel/ai?talep=${talep.id}`,
            not: secenek.kaynak === "mcp"
              ? "İşlem YAPILMADI. Kullanıcı TekirExtra panelindeki onay listesinden onaylayınca çalışacak."
              : "İşlem YAPILMADI. Kullanıcı sohbetteki Onayla düğmesine ya da adresteki onay listesine basınca çalışacak.",
          }),
          talep,
        };
      }
      return { icerik: jsonKisalt(await arac.calistir(baglam, ayristirma.data)) };
    } catch (hata) {
      this.logger.warn(`Araç ${arac.ad} hata verdi: ${String(hata)}`);
      return { icerik: `Hata: ${hataMetni(hata)}`, hata: true };
    }
  }
}
