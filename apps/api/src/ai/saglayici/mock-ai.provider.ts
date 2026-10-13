import { z } from "zod";
import { IAiProvider, AiMultimodalGirdi, AiProviderTuru, AiAracliSohbetGirdisi, AiAracliYanit } from "./ai-provider.interface";

/**
 * Mock / Test Yapay Zeka Sağlayıcısı (CI/CD ve API Anahtarsız Ortamlar İçin)
 */
export class MockAiProvider implements IAiProvider {
  readonly saglayiciAdi: AiProviderTuru = "mock";

  async yapilandirilmisUretim<T>(
    girdi: AiMultimodalGirdi,
    sema: z.ZodType<T>,
  ): Promise<T> {
    const promptLower = (girdi.prompt || "").toLowerCase();
    if (
      promptLower.includes("fis") ||
      promptLower.includes("fiş") ||
      promptLower.includes("fatura") ||
      (girdi.gorselBase64 && !promptLower.includes("cari"))
    ) {
      const ornekFis = {
        belgeTuru: "FIS",
        belgeNo: "00124",
        tarih: "2026-10-10",
        saticiUnvan: "MİGROS TİCARET A.Ş.",
        saticiVknTckn: "6220084503",
        saticiVergiDairesi: "Büyük Mükellefler",
        saticiAdres: "Ataşehir / İstanbul",
        saticiTelefon: "08502004000",
        saticiEposta: "iletisim@migros.com.tr",
        saticiIban: null,
        paraBirimi: "TRY",
        toplamKdv: 20.0,
        toplamMatrah: 100.0,
        genelToplam: 120.0,
        kdvKirilimi: [{ oran: 20, matrah: 100.0, kdvTutari: 20.0 }],
        kalemler: [
          {
            aciklama: "Kırtasiye / A4 Kağıt",
            miktar: 1,
            birim: "ADET",
            birimFiyat: 120.0,
            toplamTutar: 120.0,
            kdvOrani: 20,
          },
        ],
        guvenSkoru: 0.98,
      };
      return sema.parse(ornekFis);
    }

    // Cari / İletişim Formu Örneği
    const ornekCari = {
      unvan: "KAYA ENDÜSTRİYEL MALZEMELER SAN. TİC. LTD. ŞTİ.",
      kisiTipi: "tuzel",
      ad: null,
      soyad: null,
      vknTckn: "5320501234",
      vergiDairesi: "Kozyatağı",
      ticaretSicilNo: "123456",
      eposta: "muhasebe@kayametal.com.tr",
      telefon: "02164440123",
      faks: null,
      webSitesi: "https://kayametal.com.tr",
      adres: "İmes Sanayi Sitesi E Blok No: 12",
      il: "İstanbul",
      ilce: "Ümraniye",
      postaKodu: "34775",
      iban: "TR120006200000001234567890",
      sektor: "Metal & İmalat",
      yetkiliKisi: {
        adSoyad: "Ahmet Kaya",
        unvan: "Genel Müdür",
        telefon: "05321112233",
        eposta: "ahmet@kayametal.com.tr",
      },
      guvenSkoru: 0.95,
    };
    return sema.parse(ornekCari);
  }

  async metinUret(girdi: AiMultimodalGirdi): Promise<string> {
    return `[Mock AI Yanıtı]: "${girdi.prompt.slice(0, 50)}..." talebiniz başarıyla simüle edildi.`;
  }

  async aracliSohbet(_girdi: AiAracliSohbetGirdisi): Promise<AiAracliYanit> {
    return { metin: "[Örnek sağlayıcı] Gerçek yapay zekâ sağlayıcısı tanımlı değil; araç çağrılmadı.", aracCagrilari: [] };
  }
}

/**
 * Testler için senaryolu sağlayıcı: `aracliSohbet` sıradaki yanıtı döner ve
 * aldığı girdileri saklar.
 */
export class SenaryoAiProvider extends MockAiProvider {
  readonly girdiler: AiAracliSohbetGirdisi[] = [];

  constructor(private readonly yanitlar: AiAracliYanit[]) {
    super();
  }

  override async aracliSohbet(girdi: AiAracliSohbetGirdisi): Promise<AiAracliYanit> {
    this.girdiler.push(structuredClone(girdi));
    return this.yanitlar.shift() ?? { metin: "", aracCagrilari: [] };
  }
}
