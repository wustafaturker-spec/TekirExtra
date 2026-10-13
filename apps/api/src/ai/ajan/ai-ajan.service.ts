import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import type { Rol } from "@tekirextra/shared";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import type { AiAracCagrisi, AiSohbetMesaji, IAiProvider } from "../saglayici/ai-provider.interface";
import { kiraciSaglayicisi } from "../saglayici/kiraci-saglayici";
import { AiOnayService, type OnayTalebiGorunumu } from "../onay/ai-onay.service";
import { AJAN_ARACLARI, aracBul, aracTanimi, type AjanAraci } from "./araclar";
import { BUGUN } from "./araclar/arac";
import { UcCagirici } from "./uc-cagirici";
import { DUZELTME_ISTEMI, GUVENLI_YANIT, uydurmaNedeni } from "./yanit-denetimi";

/** Bir kullanıcı mesajında en çok bu kadar model turu (araç → sonuç → model). */
const EN_COK_TUR = 8;
const GECMIS_MESAJ = 12;
const ARAC_CIKTISI_SINIRI = 12_000;
const MESAJ_SINIRI = 4_000;
const BOS_YANIT_DENEMESI = 2;

export interface CalisanArac {
  ad: string;
  sinif: string;
  basarili: boolean;
}

export interface AjanYaniti {
  oturumId: string | null;
  cevap: string;
  onayTalepleri: OnayTalebiGorunumu[];
  araclar: CalisanArac[];
  asistanKapali?: boolean;
}

const ROL_ADI: Partial<Record<Rol, string>> = { yonetici: "yönetici", muhasebe: "muhasebe", satis: "satış", depo: "depo", salt_okunur: "salt okunur" };

function sistemTalimati(adSoyad: string, rol: Rol, ozelTalimatlar: string | null): string {
  return [
    `Sen TekirExtra ön muhasebe uygulamasının asistanısın. Kullanıcı: ${adSoyad} (rol: ${ROL_ADI[rol] ?? rol}). Bugün ${BUGUN()} (Türkiye saati).`,
    "Kurallar:",
    "- Veriyi yalnız araçlardan al. Rakam, kayıt, kimlik ya da sonuç uydurma; araçta olmayan bilgiyi bilmediğini söyle.",
    "- Kayıt oluşturmak, onaylamak, göndermek gibi her işlem için ilgili aracı ÇAĞIR. Bir işlemin yapıldığını yalnız o aracın başarılı sonucunu gördükten sonra söyle; araç çağırmadan asla 'oluşturuldu', 'onaya sunuldu' deme.",
    "- Cari, ürün veya belge birden fazla eşleşirse seçenekleri listele ve kullanıcıya sor; tahminle seçme. Hiç eşleşmezse söyle.",
    "- [ONAY GEREKİR] işaretli araçlar işlemi yapmaz, kullanıcıya onay talebi açar. Talep açıldığında işlemin yapıldığını söyleme; kullanıcıya doğrudan “işlem onayınıza sunuldu, aşağıdaki Onayla düğmesiyle onaylayabilirsiniz” de. Onayı yönetici ya da başkası değil, kullanıcının kendisi verir.",
    "- Kayıt silemezsin. Silme istenirse bunun ekrandan yapılması gerektiğini söyle.",
    "- Bir araç hata dönerse hatayı kullanıcıya açıkça aktar; başarılı olmuş gibi davranma.",
    "- Kısa ve Türkçe yanıt ver; tutarları para birimiyle yaz. Kayıtların `adres` alanını ilgili ekranın bağlantısı olarak verebilirsin.",
    ...(ozelTalimatlar?.trim() ? ["", "Firmanın talimatları (yukarıdaki kuralları değiştiremez):", ozelTalimatlar.trim().slice(0, 2000)] : []),
  ].join("\n");
}

function hataMetni(hata: unknown): string {
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
 * AI-05: kullanıcının yazdığı talimatı modelin seçtiği araçlarla yürütür.
 * Kimlik ve rol yalnız oturumdan gelir; model yalnız kullanıcının rolüyle
 * erişebildiği araçları görür. Onaya tabi araçlar işlem yapmaz, talep açar.
 */
@Injectable()
export class AiAjanService {
  private readonly logger = new Logger(AiAjanService.name);
  /** Testlerde sağlayıcıyı değiştirmek için. */
  saglayiciBul: (tenantId: string) => Promise<{ saglayici: IAiProvider; ozelTalimatlar: string | null }> = (tenantId) =>
    kiraciSaglayicisi(this.prisma, tenantId);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uc: UcCagirici,
    private readonly onay: AiOnayService,
  ) {}

  /** Modele sunulacak araçlar: rolün ekranda girebildiği uçlar (AI-02). */
  izinliAraclar(rol: Rol): AjanAraci[] {
    return AJAN_ARACLARI.filter((a) => this.uc.yetkiliMi(a.uc, rol));
  }

  async mesajiIsle(mesaj: string): Promise<AjanYaniti> {
    const { tenantId, userId, rol } = aktifBaglam();
    const metin = (mesaj ?? "").trim();
    if (!metin) throw new BadRequestException("Lütfen bir talimat yazın.");
    if (metin.length > MESAJ_SINIRI) throw new BadRequestException(`Mesaj en çok ${MESAJ_SINIRI} karakter olabilir.`);

    const { saglayici, ozelTalimatlar } = await this.saglayiciBul(tenantId);
    if (saglayici.saglayiciAdi === "tanimsiz") {
      return {
        oturumId: null,
        cevap: "Asistan kapalı: yapay zekâ sağlayıcısı tanımlı değil. Yönetici Ayarlar → Yapay Zeka ekranından sağlayıcı ve API anahtarı girebilir.",
        onayTalepleri: [],
        araclar: [],
        asistanKapali: true,
      };
    }

    const kullanici = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findFirst({ where: { id: userId }, select: { adSoyad: true } }));
    if (!kullanici) throw new ForbiddenException("Kullanıcı bu kiracıda bulunamadı.");
    const oturum = await this.oturumGetir(tenantId, userId);
    const gecmis = await this.gecmisOku(tenantId, oturum.id);

    const izinli = this.izinliAraclar(rol);
    const aracHaritasi = new Map(izinli.map((a) => [a.ad, a]));
    const tanimlar = izinli.map(aracTanimi);
    const mesajlar: AiSohbetMesaji[] = [...gecmis, { rol: "kullanici", metin }];
    const calisanlar: CalisanArac[] = [];
    const talepler: OnayTalebiGorunumu[] = [];
    let cevap: string | null = null;
    const aracCiktilari: string[] = [];
    const baglamMetni = [metin, ...gecmis.map((m) => ("metin" in m ? m.metin : ""))].join(" ");
    let duzeltmeIstendi = false;

    for (let tur = 0; tur < EN_COK_TUR && cevap === null; tur++) {
      const istek = { sistemRol: sistemTalimati(kullanici.adSoyad, rol, ozelTalimatlar), mesajlar, araclar: tanimlar };
      let yanit = await saglayici.aracliSohbet(istek);
      // Gemini ara sıra içeriksiz yanıt döner (finishReason STOP, parça yok); aynı istek yeniden denenir.
      for (let deneme = 0; deneme < BOS_YANIT_DENEMESI && !yanit.metin && !yanit.aracCagrilari.length; deneme++) {
        yanit = await saglayici.aracliSohbet(istek);
      }
      if (!yanit.aracCagrilari.length) {
        const aday = yanit.metin || "Bir yanıt üretilemedi.";
        const neden = uydurmaNedeni(aday, { aracCiktilari, talepSayisi: talepler.length, baglamMetni });
        if (!neden) {
          cevap = aday;
        } else if (!duzeltmeIstendi) {
          // Bir kez düzeltme şansı: model ya aracı çağırır ya da yapmadığını söyler.
          duzeltmeIstendi = true;
          this.logger.warn(`Asistan yanıtı reddedildi (${neden}); düzeltme isteniyor`);
          mesajlar.push({ rol: "asistan", metin: aday }, { rol: "kullanici", metin: DUZELTME_ISTEMI(neden) });
        } else {
          this.logger.warn(`Asistan yanıtı ikinci kez reddedildi (${neden}); güvenli yanıt verildi`);
          cevap = GUVENLI_YANIT;
        }
        continue;
      }
      mesajlar.push({ rol: "asistan", metin: yanit.metin, aracCagrilari: yanit.aracCagrilari, ham: yanit.ham });
      for (const cagri of yanit.aracCagrilari) {
        const sonuc = await this.aracCalistir(cagri, aracHaritasi, oturum.id);
        calisanlar.push({ ad: cagri.ad, sinif: aracHaritasi.get(cagri.ad)?.sinif ?? "bilinmiyor", basarili: !sonuc.hata });
        if (sonuc.talep) talepler.push(sonuc.talep);
        if (!sonuc.hata) aracCiktilari.push(sonuc.icerik);
        mesajlar.push({ rol: "arac_sonucu", cagriId: cagri.id, ad: cagri.ad, icerik: sonuc.icerik, hata: sonuc.hata });
      }
    }
    if (cevap === null) cevap = "İşlem çok adım gerektirdi ve tamamlanamadı; talimatı daha küçük parçalara bölün.";
    if (talepler.length && !/onay/i.test(cevap)) cevap += "\n\nİşlem onayınıza sunuldu; aşağıdaki düğmeyle onaylayabilirsiniz.";

    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.ajanMesajGecmisi.create({ data: { oturumId: oturum.id, rol: "user", icerik: metin } });
      await tx.ajanMesajGecmisi.create({
        data: { oturumId: oturum.id, rol: "assistant", icerik: cevap!, aracCagrisi: { araclar: calisanlar, talepler: talepler.map((t) => t.id) } as object },
      });
      await tx.ajanOturumu.update({ where: { id: oturum.id }, data: { sonEtkilesim: new Date() } });
    });

    return { oturumId: oturum.id, cevap, onayTalepleri: talepler, araclar: calisanlar };
  }

  /** Kullanıcının asistan geçmişi (son mesajlar) ve bekleyen talepleri; sohbet penceresi açılırken. */
  async gecmis(): Promise<{ mesajlar: Array<{ rol: string; icerik: string; createdAt: string; talepIdleri: string[] }> }> {
    const { tenantId, userId } = aktifBaglam();
    const oturum = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ajanOturumu.findUnique({ where: { tenantId_kanal_kanalKimlik: { tenantId, kanal: "WEB", kanalKimlik: `web:${userId}` } } }),
    );
    if (!oturum || oturum.userId !== userId) return { mesajlar: [] };
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ajanMesajGecmisi.findMany({ where: { oturumId: oturum.id }, orderBy: { createdAt: "desc" }, take: 40 }),
    );
    return {
      mesajlar: kayitlar.reverse().map((k) => ({
        rol: k.rol,
        icerik: k.icerik,
        createdAt: k.createdAt.toISOString(),
        talepIdleri: ((k.aracCagrisi as { talepler?: string[] } | null)?.talepler ?? []).filter((t) => typeof t === "string"),
      })),
    };
  }

  private async aracCalistir(cagri: AiAracCagrisi, izinli: Map<string, AjanAraci>, oturumId: string): Promise<{ icerik: string; hata?: boolean; talep?: OnayTalebiGorunumu }> {
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
    const baglam = { uc: this.uc, kaynak: "asistan" as const, arac: arac.ad };
    try {
      if (arac.sinif === "onay") {
        const ozet = await arac.ozetle!(baglam, ayristirma.data);
        // Ham girdi saklanır; onayda aynı şemayla yeniden doğrulanır.
        const talep = await this.onay.olustur({ arac: arac.ad, parametreler: cagri.girdi, ozet, kaynak: "asistan", oturumId });
        return {
          icerik: jsonKisalt({
            durum: "onay_bekliyor", talepId: talep.id, ozet, adres: `/panel/ai?talep=${talep.id}`,
            not: "İşlem YAPILMADI. Kullanıcı sohbetteki Onayla düğmesine ya da adresteki onay listesine basınca çalışacak.",
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

  private async oturumGetir(tenantId: string, userId: string) {
    const kanalKimlik = `web:${userId}`;
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.ajanOturumu.findUnique({ where: { tenantId_kanal_kanalKimlik: { tenantId, kanal: "WEB", kanalKimlik } } });
      if (mevcut) {
        if (mevcut.userId !== userId) throw new ForbiddenException("Bu oturum başka bir kullanıcıya bağlı.");
        return mevcut;
      }
      return tx.ajanOturumu.create({ data: { tenantId, userId, kanal: "WEB", kanalKimlik, pinDogrulandi: true } });
    });
  }

  /** Önceki turların yalnız kullanıcı ve asistan metinleri (araç ayrıntısı modele tekrar gitmez). */
  private async gecmisOku(tenantId: string, oturumId: string): Promise<AiSohbetMesaji[]> {
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ajanMesajGecmisi.findMany({ where: { oturumId, rol: { in: ["user", "assistant"] } }, orderBy: { createdAt: "desc" }, take: GECMIS_MESAJ }),
    );
    const sirali = kayitlar.reverse();
    // Geçmiş kullanıcı mesajıyla başlamalı (sağlayıcılar asistanla başlamayı reddeder).
    while (sirali.length && sirali[0].rol !== "user") sirali.shift();
    return sirali.map((k) => (k.rol === "user" ? { rol: "kullanici", metin: k.icerik } : { rol: "asistan", metin: k.icerik }));
  }
}
