import { HttpException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { retNedeniSiniflandir, type OnDenetimBulgusu } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { PrismaService } from "../core/prisma.service";
import { kiraciSaglayicisi } from "../ai/saglayici/kiraci-saglayici";
import type { IAiProvider } from "../ai/saglayici/ai-provider.interface";
import { AI_SISTEM_ROLU, AI_YANIT_SEMASI, aiBulgulari, aiIstemi, type AiDenetimGirdisi, type AiYaniti } from "./on-denetim-ai";

/**
 * AI-71: sihirbaz beklemez; bu sürede yanıt gelmezse sonuç gösterilmez.
 * 10 sn ilk denemede yetmedi: EVREN (deepseek-v4.1-flash, düşünme modu) yoğun
 * saatte 23 sn sürdü (2026-10-20). Kullanıcı beklemediği için süre bol tutulur.
 */
export const AI_DENETIM_SURESI_MS = 45_000;

export type AiDenetimDurumu = "tamam" | "kapali" | "zaman_asimi" | "hata";

export interface AiDenetimSonucu {
  durum: AiDenetimDurumu;
  /** Kapalı ya da hata durumunda kullanıcıya gösterilecek kısa neden. */
  mesaj?: string;
  bulgular: OnDenetimBulgusu[];
}

@Injectable()
export class OnDenetimAiService {
  private readonly logger = new Logger(OnDenetimAiService.name);
  /** Testlerde değiştirilebilir; çağrılar "ondenetim" özelliğiyle sayılır ve bütçeye tabidir. */
  saglayiciBul: (tenantId: string) => Promise<{ saglayici: IAiProvider }> = (tenantId) => kiraciSaglayicisi(this.prisma, tenantId, { ozellik: "ondenetim" });
  sureMs = AI_DENETIM_SURESI_MS;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly ayarlar?: AyarlarService,
  ) {}

  async girdiTopla(faturaId: string): Promise<AiDenetimGirdisi & { susturulan: Set<string> }> {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findFirst({
        where: { id: faturaId, tenantId },
        select: {
          senaryo: true, aciklama: true, cariId: true, cari: { select: { vknTckn: true } },
          satirlar: { select: { birim: true, kdvOrani: true, tevkifatKodu: true, gibIstisnaKodu: true, stok: { select: { ad: true, tip: true } }, varyant: { select: { ad: true } } } },
        },
      });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      const retler = await tx.ebelgeKayit.findMany({
        where: {
          tenantId, fatura: { cariId: fatura.cariId }, updatedAt: { gte: new Date(Date.now() - 365 * 86_400_000) },
          OR: [{ aliciYaniti: "ret" }, { faturaId, durum: { in: ["ret", "hata"] } }],
        },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { aliciYaniti: true, aliciYanitNotu: true, hataMesaji: true, fatura: { select: { no: true } } },
      });
      // EBLG-141: cari için susturulan kurallar burada da gösterilmez.
      const susturulan = new Set((await tx.onDenetimSusturma.findMany({ where: { tenantId, cariId: fatura.cariId }, select: { kod: true } })).map((k) => k.kod));
      return {
        susturulan,
        senaryo: fatura.senaryo,
        yurtDisi: fatura.cari.vknTckn === "2222222222" || fatura.satirlar.some((s) => s.gibIstisnaKodu === "301" || s.gibIstisnaKodu === "302"),
        satirlar: fatura.satirlar.map((s, i) => ({
          sira: i + 1,
          ad: s.varyant?.ad ? `${s.stok.ad} (${s.varyant.ad})` : s.stok.ad,
          tip: s.stok.tip,
          birim: s.birim,
          kdvOrani: Number(s.kdvOrani),
          tevkifat: s.tevkifatKodu,
          istisna: s.gibIstisnaKodu,
        })),
        aciklama: fatura.aciklama,
        // Anahtar sözcükle sınıflanabilenler EBLG-140'ta zaten gösterilir.
        siniflanmamisRetler: retler
          .map((r) => ({ no: r.fatura.no, metin: (r.aliciYaniti === "ret" ? r.aliciYanitNotu : r.hataMesaji)?.trim() ?? "" }))
          .filter((r) => r.metin && retNedeniSiniflandir(r.metin) === "diger"),
      };
    });
  }

  async denetle(faturaId: string): Promise<AiDenetimSonucu> {
    const girdi = await this.girdiTopla(faturaId);
    const gorunen = (bulgular: OnDenetimBulgusu[]) => bulgular.filter((b) => !girdi.susturulan.has(b.kod));
    const yalnizKurallar = (durum: AiDenetimDurumu, mesaj?: string): AiDenetimSonucu => ({ durum, mesaj, bulgular: gorunen(aiBulgulari(girdi, null)) });
    const ayar = this.ayarlar ? await this.ayarlar.getir("ebelge") : {};
    if (ayar.onDenetimYapayZeka === false) return yalnizKurallar("kapali", "Ön denetimde yapay zekâ Modül Ayarları › e-Belge'den kapatılmış.");
    const { saglayici } = await this.saglayiciBul(aktifBaglam().tenantId);
    if (saglayici.saglayiciAdi === "tanimsiz") return yalnizKurallar("kapali", "Yapay zekâ sağlayıcısı tanımlı değil ya da kullanım onayı yok.");
    let zamanlayici: NodeJS.Timeout | undefined;
    try {
      const yanit = await Promise.race([
        saglayici.yapilandirilmisUretim<AiYaniti>({ sistemRol: AI_SISTEM_ROLU, prompt: aiIstemi(girdi) }, AI_YANIT_SEMASI),
        new Promise<"sure">((coz) => { zamanlayici = setTimeout(() => coz("sure"), this.sureMs); }),
      ]);
      if (yanit === "sure") return yalnizKurallar("zaman_asimi", "Yapay zekâ zamanında yanıt vermedi; kontrol atlandı.");
      return { durum: "tamam", bulgular: gorunen(aiBulgulari(girdi, yanit)) };
    } catch (hata) {
      // Sınır, bütçe ve onay eksikliği kullanıcıya açık mesajla söylenir; gönderim yine durmaz.
      const mesaj = hata instanceof HttpException ? hata.message : "Yapay zekâ kontrolü yapılamadı.";
      this.logger.warn(`Ön denetim yapay zekâ çağrısı başarısız: ${hata instanceof Error ? hata.name : "BilinmeyenHata"}`);
      return yalnizKurallar("hata", mesaj);
    } finally {
      clearTimeout(zamanlayici);
    }
  }
}
