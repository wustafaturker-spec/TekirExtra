import { HttpException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { OnDenetimBulgusu } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { PrismaService } from "../core/prisma.service";
import { gonderenCariSec } from "../cari/tedarikci-cari";
import { kiraciSaglayicisi } from "../ai/saglayici/kiraci-saglayici";
import type { IAiProvider } from "../ai/saglayici/ai-provider.interface";
import { gelenFaturaTipi } from "./gelen-fatura";
import { faturaUblOku } from "./ubl-oku";
import {
  eslesmeImzasi,
  GELEN_AI_SISTEM_ROLU,
  GELEN_AI_YANIT_SEMASI,
  gelenAiBulgulari,
  gelenAiIstemi,
  type GelenAiGirdisi,
  type GelenAiYaniti,
} from "./gelen-denetim-ai";
import { AI_DENETIM_SURESI_MS, type AiDenetimDurumu } from "./on-denetim-ai.service";

export interface GelenAiSonucu {
  durum: AiDenetimDurumu;
  mesaj?: string;
  bulgular: OnDenetimBulgusu[];
  /** Saklanan sonuç döndü; model çağrılmadı. */
  onbellek?: boolean;
  zaman?: string;
}

type Eslesme = { siraNo: number; stokId: string; varyantId?: string | null };

/**
 * AI-72: gelen alış faturası açılınca yapay zekâ kontrolü. Sonuç belgeyle ve
 * kullanılan eşleştirmeyle saklanır; aynı eşleştirmeyle yeniden açılınca model
 * çağrılmaz ("Yeniden sor" zorlar). İşleme bunu beklemez, onay istemez.
 */
@Injectable()
export class GelenDenetimAiService {
  private readonly logger = new Logger(GelenDenetimAiService.name);
  /** Testlerde değiştirilebilir; çağrılar "gelendenetim" özelliğiyle sayılır ve bütçeye tabidir. */
  saglayiciBul: (tenantId: string) => Promise<{ saglayici: IAiProvider }> = (tenantId) => kiraciSaglayicisi(this.prisma, tenantId, { ozellik: "gelendenetim" });
  sureMs = AI_DENETIM_SURESI_MS;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly ayarlar?: AyarlarService,
  ) {}

  async denetle(id: string, eslesmeler: Eslesme[], yeniden = false): Promise<GelenAiSonucu> {
    const { tenantId } = aktifBaglam();
    const imza = eslesmeImzasi(eslesmeler);
    const veri = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.gelenEbelge.findUnique({ where: { id }, select: { gonderenVkn: true, xmlIcerik: true, aiDenetim: true } });
      if (!kayit) throw new NotFoundException("Gelen belge bulunamadı");
      const ubl = faturaUblOku(kayit.xmlIcerik);
      const tip = gelenFaturaTipi(ubl);
      const { cari } = await gonderenCariSec(tx, tenantId, kayit.gonderenVkn, tip === "satis_iade" ? "musteri" : "tedarikci");
      const susturulan = cari
        ? new Set((await tx.onDenetimSusturma.findMany({ where: { tenantId, cariId: cari.id }, select: { kod: true } })).map((k) => k.kod))
        : new Set<string>();
      const kartlar = await tx.stokKart.findMany({
        where: { tenantId, id: { in: eslesmeler.map((e) => e.stokId) } },
        select: { id: true, ad: true, tip: true, varyantlar: { select: { id: true, ad: true } } },
      });
      const eslesme = new Map(eslesmeler.map((e) => [e.siraNo, e]));
      const girdi: GelenAiGirdisi = {
        faturaTipi: ubl.faturaTipKodu,
        doviz: ubl.dovizCinsi,
        genelToplam: ubl.toplamlar.genelToplam,
        vadeTarihi: ubl.vadeTarihi ?? null,
        odemeHesaplari: ubl.odemeHesaplari,
        istisnaKodlari: ubl.istisnaKodlari,
        notlar: ubl.notlar,
        satirlar: ubl.satirlar.map((s) => {
          const e = eslesme.get(s.siraNo);
          const kart = e ? kartlar.find((k) => k.id === e.stokId) : undefined;
          const varyant = kart?.varyantlar.find((v) => v.id === e?.varyantId);
          return {
            sira: s.siraNo, ad: s.ad, miktar: s.miktar, birim: s.birim, birimFiyat: s.birimFiyat, kdvOrani: s.kdvOrani,
            tevkifat: s.tevkifat?.kod ?? null,
            kart: kart ? { ad: varyant ? `${kart.ad} (${varyant.ad})` : kart.ad, tip: kart.tip } : null,
          };
        }),
      };
      return { tip, girdi, susturulan, saklanan: kayit.aiDenetim as { imza: string; sonuc: GelenAiSonucu } | null };
    });
    const gorunen = (bulgular: OnDenetimBulgusu[]) => bulgular.filter((b) => !veri.susturulan.has(b.kod));

    if (veri.tip !== "alis") return { durum: "kapali", mesaj: "Yapay zekâ kontrolü yalnız alış faturalarında yapılır.", bulgular: [] };
    if (!yeniden && veri.saklanan?.imza === imza) {
      return { ...veri.saklanan.sonuc, bulgular: gorunen(veri.saklanan.sonuc.bulgular), onbellek: true };
    }
    const ayar = this.ayarlar ? await this.ayarlar.getir("ebelge") : {};
    if (ayar.gelenDenetimYapayZeka === false) return { durum: "kapali", mesaj: "Gelen alış denetiminde yapay zekâ Modül Ayarları › e-Belge'den kapatılmış.", bulgular: [] };
    const { saglayici } = await this.saglayiciBul(tenantId);
    if (saglayici.saglayiciAdi === "tanimsiz") return { durum: "kapali", mesaj: "Yapay zekâ sağlayıcısı tanımlı değil ya da kullanım onayı yok.", bulgular: [] };

    let zamanlayici: NodeJS.Timeout | undefined;
    try {
      const yanit = await Promise.race([
        saglayici.yapilandirilmisUretim<GelenAiYaniti>({ sistemRol: GELEN_AI_SISTEM_ROLU, prompt: gelenAiIstemi(veri.girdi), dusunmeKapali: true }, GELEN_AI_YANIT_SEMASI),
        new Promise<"sure">((coz) => { zamanlayici = setTimeout(() => coz("sure"), this.sureMs); }),
      ]);
      if (yanit === "sure") return { durum: "zaman_asimi", mesaj: "Yapay zekâ zamanında yanıt vermedi; kontrol atlandı.", bulgular: [] };
      const sonuc: GelenAiSonucu = { durum: "tamam", bulgular: gelenAiBulgulari(veri.girdi, yanit), zaman: new Date().toISOString() };
      // Yalnız başarılı sonuç saklanır; zaman aşımı ve hata bir sonraki açılışta yeniden denenir.
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.gelenEbelge.update({ where: { id }, data: { aiDenetim: { imza, sonuc } as unknown as Prisma.InputJsonValue } }));
      return { ...sonuc, bulgular: gorunen(sonuc.bulgular) };
    } catch (hata) {
      const mesaj = hata instanceof HttpException ? hata.message : "Yapay zekâ kontrolü yapılamadı.";
      this.logger.warn(`Gelen alış denetimi yapay zekâ çağrısı başarısız: ${hata instanceof Error ? hata.name : "BilinmeyenHata"}`);
      return { durum: "hata", mesaj, bulgular: [] };
    } finally {
      clearTimeout(zamanlayici);
    }
  }
}
