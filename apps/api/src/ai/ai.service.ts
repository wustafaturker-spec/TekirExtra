import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import {
  AiBelgeGirdi,
  FisFaturaOcrSonuc,
  CariIletisimCikarim,
  fisFaturaOcrSonucSemasi,
  cariIletisimCikarimSemasi,
} from "./ai.semalar";
import { fisFaturaDogrula, cariIletisimDogrula, DogrulamaSonucu } from "./ai.dogrulama";
import { IAiProvider } from "./saglayici/ai-provider.interface";
import { AiProviderFactory } from "./saglayici/ai-provider.factory";

export interface FisFaturaTaramaCiktisi {
  dogrulama: DogrulamaSonucu<FisFaturaOcrSonuc>;
  eslesenCari: { id: string; unvan: string; kod: string } | null;
  onerilenMasrafKategorisi: string | null;
}

export interface CariTaramaCiktisi {
  dogrulama: DogrulamaSonucu<CariIletisimCikarim>;
  mevcutCari: { id: string; unvan: string; kod: string } | null;
}

@Injectable()
export class AiService {
  private aiProvider: IAiProvider;

  constructor(private readonly prisma: PrismaService) {
    this.aiProvider = AiProviderFactory.uret();
  }

  /**
   * Test veya dinamik sağlayıcı değişimi için
   */
  setProvider(provider: IAiProvider) {
    this.aiProvider = provider;
  }

  /**
   * Fiş veya Fatura Görselini/Belgesini Multimodal AI ile Tarar,
   * Matematiksel ve VKN doğrulamalarını yapar, sistemdeki Carilerle eşleştirir.
   */
  async fisFaturaOcrTara(tenantId: string, girdi: AiBelgeGirdi): Promise<FisFaturaTaramaCiktisi> {
    if (!girdi.gorselBase64 && !girdi.hamMetin) {
      throw new BadRequestException("İşlem için görsel verisi (base64) veya belge metni zorunludur.");
    }

    const sistemRol = `
Sen Türkiye mevzuatına (VUK, KDV, e-Fatura/e-Arşiv) uzmanlaşmış bir muhasebe denetçisisin.
Görseli veya metni dikkatle inceleyerek satıcı bilgilerini, KDV oran ve matrahlarını, toplam tutarları kuruşu kuruşuna çıkar.
`.trim();

    const prompt = `
Aşağıdaki fiş/fatura belgesinden şu alanları çıkar:
- Belge türü (FIS, FATURA, E_ARSIV vb.)
- Belge no ve tarihi (YYYY-MM-DD)
- Satıcı ünvanı, VKN veya TCKN, vergi dairesi, adres, telefon, e-posta, IBAN
- Toplam matrah, toplam KDV, genel toplam ve KDV oran kırılımları (%1, %10, %20)
- Satır kalemleri (açıklama, miktar, birim fiyat, tutar)
${girdi.hamMetin ? `\nBelge Metni:\n${girdi.hamMetin}` : ""}
`.trim();

    // 1. Model-Agnostik Yapay Zeka Çıkarımı
    const hamSonuc = await this.aiProvider.yapilandirilmisUretim<FisFaturaOcrSonuc>(
      {
        sistemRol,
        prompt,
        gorselBase64: girdi.gorselBase64,
        mimeType: girdi.mimeType,
      },
      fisFaturaOcrSonucSemasi,
    );

    // 2. Sıfır Hata Toleransı: Matematiksel ve Mantıksal Çapraz Doğrulama
    const dogrulama = fisFaturaDogrula(hamSonuc);

    // 3. Veritabanında Kiracı Kapsamında Mevcut Cariyi Ara (RLS Korumalı)
    let eslesenCari: { id: string; unvan: string; kod: string } | null = null;
    if (dogrulama.veri.saticiVknTckn) {
      const vkn = dogrulama.veri.saticiVknTckn;
      const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariHesap.findFirst({
          where: { vknTckn: vkn, aktif: true },
          select: { id: true, unvan: true, kod: true },
        }),
      );
      if (cari) {
        eslesenCari = cari;
      }
    }

    // 4. Masraf Kategorisi Önerisi (Kapsamlı Akıllı Sınıflandırma)
    let onerilenMasrafKategorisi: string | null = null;
    const metinBirlestir = `${dogrulama.veri.saticiUnvan} ${dogrulama.veri.kalemler.map((k) => k.aciklama).join(" ")}`.toLowerCase();
    if (
      metinBirlestir.includes("akaryakıt") || metinBirlestir.includes("benzin") || metinBirlestir.includes("motorin") ||
      metinBirlestir.includes("lpg") || metinBirlestir.includes("petrol") || metinBirlestir.includes("opet") ||
      metinBirlestir.includes("shell") || metinBirlestir.includes("bp ") || metinBirlestir.includes("total") ||
      metinBirlestir.includes("aytemiz") || metinBirlestir.includes("po ") || metinBirlestir.includes("petrol ofisi")
    ) {
      onerilenMasrafKategorisi = "Akaryakıt / Ulaşım";
    } else if (
      metinBirlestir.includes("yemek") || metinBirlestir.includes("restoran") || metinBirlestir.includes("lokanta") ||
      metinBirlestir.includes("kafe") || metinBirlestir.includes("kahve") || metinBirlestir.includes("kebap") ||
      metinBirlestir.includes("döner") || metinBirlestir.includes("pasta") || metinBirlestir.includes("fırın") ||
      metinBirlestir.includes("adisyon") || metinBirlestir.includes("gıda") || metinBirlestir.includes("starbucks")
    ) {
      onerilenMasrafKategorisi = "Yemek / Temsil Ağırlama";
    } else if (
      metinBirlestir.includes("taksi") || metinBirlestir.includes("otopark") || metinBirlestir.includes("ispark") ||
      metinBirlestir.includes("hgs") || metinBirlestir.includes("ogs") || metinBirlestir.includes("otoyol") ||
      metinBirlestir.includes("köprü") || metinBirlestir.includes("bilet") || metinBirlestir.includes("havalimanı") ||
      metinBirlestir.includes("bitaksi") || metinBirlestir.includes("uber")
    ) {
      onerilenMasrafKategorisi = "Ulaşım / Yol";
    } else if (
      metinBirlestir.includes("kırtasiye") || metinBirlestir.includes("ofis") || metinBirlestir.includes("kağıt") ||
      metinBirlestir.includes("toner") || metinBirlestir.includes("kartuş") || metinBirlestir.includes("kalem")
    ) {
      onerilenMasrafKategorisi = "Ofis & Kırtasiye";
    } else if (
      metinBirlestir.includes("konaklama") || metinBirlestir.includes("otel") || metinBirlestir.includes("pansiyon") ||
      metinBirlestir.includes("butik otel")
    ) {
      onerilenMasrafKategorisi = "Konaklama / Seyahat";
    } else if (
      metinBirlestir.includes("kargo") || metinBirlestir.includes("kurye") || metinBirlestir.includes("nakliye") ||
      metinBirlestir.includes("yurtiçi kargo") || metinBirlestir.includes("aras kargo") || metinBirlestir.includes("mng")
    ) {
      onerilenMasrafKategorisi = "Kargo / Lojistik";
    } else if (
      metinBirlestir.includes("market") || metinBirlestir.includes("migros") || metinBirlestir.includes("bim") ||
      metinBirlestir.includes("a101") || metinBirlestir.includes("şok") || metinBirlestir.includes("carrefour")
    ) {
      onerilenMasrafKategorisi = "Mutfak & Sarf";
    }

    return {
      dogrulama,
      eslesenCari,
      onerilenMasrafKategorisi,
    };
  }

  /**
   * Kartvizit görseli, e-posta imza metni veya serbest iletişim bilgilerinden
   * otomatik Cari Hesap ve Yetkili Kişi taslağı çıkarır.
   */
  async cariBilgisiCikar(tenantId: string, girdi: AiBelgeGirdi): Promise<CariTaramaCiktisi> {
    if (!girdi.gorselBase64 && !girdi.hamMetin) {
      throw new BadRequestException("İşlem için görsel verisi veya iletişim metni zorunludur.");
    }

    const sistemRol = `
Sen bir kurumsal CRM ve cari hesap uzmanısın.
Verilen kartvizit görselinden, e-posta imzasından veya metinden firma veya kişinin cari bilgilerini eksiksiz çıkar.
`.trim();

    const prompt = `
Aşağıdaki içerikten firma ve cari iletişim bilgilerini yapılandırılmış olarak çıkar:
- Firma resmi ünvanı veya kişi adı soyadı
- Gerçek kişi mi tüzel kişi mi?
- VKN veya TCKN, Vergi dairesi, Ticaret sicil no
- E-posta, Telefon, Faks, Web sitesi
- Açık adres, İl, İlçe, Posta kodu
- Banka IBAN numarası, Sektör
- Yetkili kişi (Ad Soyad, Görev/Ünvan, Cep telefonu, E-posta)
${girdi.hamMetin ? `\nİletişim / E-posta Metni:\n${girdi.hamMetin}` : ""}
`.trim();

    // 1. Model-Agnostik Çıkarım
    const hamSonuc = await this.aiProvider.yapilandirilmisUretim<CariIletisimCikarim>(
      {
        sistemRol,
        prompt,
        gorselBase64: girdi.gorselBase64,
        mimeType: girdi.mimeType,
      },
      cariIletisimCikarimSemasi,
    );

    // 2. Doğrulama
    const dogrulama = cariIletisimDogrula(hamSonuc);

    // 3. Sistemde zaten bu VKN veya E-postaya sahip bir cari var mı kontrol et
    let mevcutCari: { id: string; unvan: string; kod: string } | null = null;
    if (dogrulama.veri.vknTckn || dogrulama.veri.eposta) {
      const filtre: any = { OR: [] };
      if (dogrulama.veri.vknTckn) filtre.OR.push({ vknTckn: dogrulama.veri.vknTckn });
      if (dogrulama.veri.eposta) filtre.OR.push({ eposta: dogrulama.veri.eposta });

      const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariHesap.findFirst({
          where: filtre,
          select: { id: true, unvan: true, kod: true },
        }),
      );
      if (cari) {
        mevcutCari = cari;
      }
    }

    return {
      dogrulama,
      mevcutCari,
    };
  }
}
