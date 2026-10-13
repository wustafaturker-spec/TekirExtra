import { z } from "zod";
import { IAiProvider, AiMultimodalGirdi, AiProviderTuru, AiAracliSohbetGirdisi, AiAracliYanit } from "./ai-provider.interface";
import { aracGirdisiniAyristir, saglayiciIstegi } from "./aracli-ortak";

/**
 * Google Gemini Multimodal / Structured Outputs Sağlayıcısı
 */
export class GeminiAiProvider implements IAiProvider {
  readonly saglayiciAdi: AiProviderTuru = "gemini";
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || "";
    let secilenModel = (model || "gemini-2.5-flash").trim();
    if (secilenModel.startsWith("models/")) {
      secilenModel = secilenModel.replace(/^models\//, "");
    }
    // Kullanımdan kalkmış 1.5 modellerini güncel 2.5 sürümüne otomatik eşle
    if (secilenModel === "gemini-1.5-flash") {
      secilenModel = "gemini-2.5-flash";
    } else if (secilenModel === "gemini-1.5-pro") {
      secilenModel = "gemini-2.5-pro";
    }
    this.model = secilenModel;
  }

  async yapilandirilmisUretim<T>(
    girdi: AiMultimodalGirdi,
    sema: z.ZodType<T>,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY tanımlanmamış. Lütfen API anahtarınızı girin.");
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const parts: any[] = [];
    if (girdi.gorselBase64) {
      const temizBase64 = girdi.gorselBase64.replace(/^data:[^;]+;base64,/, "");
      parts.push({
        inlineData: {
          mimeType: girdi.mimeType || "image/jpeg",
          data: temizBase64,
        },
      });
    }

    const sistemTalimati = girdi.sistemRol
      ? `${girdi.sistemRol}\nLütfen yanıtı SADECE geçerli JSON olarak ver, markdown tırnakları (codeblocks) ekleme.`
      : "Lütfen yanıtı SADECE geçerli JSON olarak ver, markdown tırnakları ekleme.";

    parts.push({ text: `${sistemTalimati}\n\nİstek: ${girdi.prompt}` });

    const istekGovdesi = {
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    };

    const yanit = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(istekGovdesi),
    });

    if (!yanit.ok) {
      const hataMetni = await yanit.text();
      let mesaj = `Gemini API Hatası (${yanit.status}): ${hataMetni}`;
      try {
        const parsed = JSON.parse(hataMetni);
        if (parsed.error?.message) mesaj = `Gemini Hatası: ${parsed.error.message}`;
      } catch {}
      throw new Error(mesaj);
    }

    const veri = (await yanit.json()) as any;
    let hamMetin = veri.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!hamMetin) {
      throw new Error("Gemini API'den boş yanıt döndü.");
    }

    // Markdown ```json ... ``` tırnakları varsa temizle
    hamMetin = hamMetin.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();

    const parsedJson = JSON.parse(hamMetin);

    // Eğer model snake_case veya içiçe yapıda döndüyse şema doğrulaması öncesi normalize et
    const normalizeObject = (obj: any): any => {
      if (typeof obj !== "object" || obj === null) return obj;
      if (Array.isArray(obj)) return obj.map(normalizeObject);

      // Fiş / Belge modeli için snake_case -> camelCase dönüşüm köprüsü
      if ("belge_turu" in obj || "satici_unvani" in obj || ("satici" in obj && typeof obj.satici === "object")) {
        const saticiObj = typeof obj.satici === "object" && obj.satici !== null ? obj.satici : {};
        const toplamlarObj = typeof obj.toplamlar === "object" && obj.toplamlar !== null ? obj.toplamlar : {};
        return {
          belgeTuru: obj.belgeTuru || obj.belge_turu || "FIS",
          belgeNo: obj.belgeNo || obj.belge_no || null,
          tarih: obj.tarih || obj.belge_tarihi || null,
          saticiUnvan: obj.saticiUnvan || saticiObj.unvan || obj.satici_unvani || obj.firma_unvani || "",
          saticiVknTckn: obj.saticiVknTckn || saticiObj.vkn_tckn || saticiObj.vkn || obj.satici_vkn || null,
          saticiVergiDairesi: obj.saticiVergiDairesi || saticiObj.vergi_dairesi || null,
          saticiAdres: obj.saticiAdres || saticiObj.adres || null,
          saticiTelefon: obj.saticiTelefon || saticiObj.telefon || null,
          saticiEposta: obj.saticiEposta || saticiObj.e_posta || saticiObj.eposta || null,
          saticiIban: obj.saticiIban || saticiObj.iban || null,
          paraBirimi: obj.paraBirimi || obj.para_birimi || "TRY",
          toplamKdv: obj.toplamKdv ?? toplamlarObj.kdv ?? obj.kdv_tutari ?? 0,
          toplamMatrah: obj.toplamMatrah ?? toplamlarObj.matrah ?? obj.matrah ?? 0,
          genelToplam: obj.genelToplam ?? toplamlarObj.genel_toplam ?? obj.toplam_tutar ?? 0,
          kdvKirilimi: obj.kdvKirilimi || obj.kdv_kirilimi || [],
          kalemler: (obj.kalemler || obj.satir_kalemleri || []).map((k: any) => ({
            aciklama: k.aciklama || k.kalem_aciklamasi || k.urun_adi || "",
            miktar: k.miktar ?? 1,
            birim: k.birim || "ADET",
            birimFiyat: k.birimFiyat ?? k.birim_fiyat ?? 0,
            toplamTutar: k.toplamTutar ?? k.toplam_tutar ?? k.tutar ?? 0,
            kdvOrani: k.kdvOrani ?? k.kdv_orani ?? null,
          })),
          guvenSkoru: obj.guvenSkoru ?? 0.95,
        };
      }

      // Cari modeli için dönüşüm köprüsü
      if ("kisi_tipi" in obj || "yetkili_kisi" in obj || "vergi_dairesi" in obj) {
        const yetkili = typeof obj.yetkili_kisi === "object" && obj.yetkili_kisi !== null ? obj.yetkili_kisi : {};
        return {
          unvan: obj.unvan || obj.firma_unvani || obj.adSoyad || "",
          kisiTipi: obj.kisiTipi || obj.kisi_tipi || "tuzel",
          ad: obj.ad || null,
          soyad: obj.soyad || null,
          vknTckn: obj.vknTckn || obj.vkn_tckn || obj.vkn || null,
          vergiDairesi: obj.vergiDairesi || obj.vergi_dairesi || null,
          ticaretSicilNo: obj.ticaretSicilNo || obj.ticaret_sicil_no || null,
          eposta: obj.eposta || obj.e_posta || null,
          telefon: obj.telefon || null,
          faks: obj.faks || null,
          webSitesi: obj.webSitesi || obj.web_sitesi || null,
          adres: obj.adres || null,
          il: obj.il || null,
          ilce: obj.ilce || null,
          postaKodu: obj.postaKodu || obj.posta_kodu || null,
          iban: obj.iban || null,
          sektor: obj.sektor || null,
          yetkiliKisi: obj.yetkiliKisi || {
            adSoyad: yetkili.ad_soyad || yetkili.adSoyad || null,
            gorev: yetkili.gorev || yetkili.unvan || null,
            telefon: yetkili.telefon || null,
            eposta: yetkili.eposta || yetkili.e_posta || null,
          },
        };
      }

      return obj;
    };

    const normalizeEdilmis = normalizeObject(parsedJson);
    return sema.parse(normalizeEdilmis);
  }

  async metinUret(girdi: AiMultimodalGirdi): Promise<string> {
    // Sistem talimatı ayrı gider (önceden yalnız istem gönderiliyordu, talimat yok sayılıyordu).
    const veri = await saglayiciIstegi("Gemini", `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, { "x-goog-api-key": this.apiKey }, {
      ...(girdi.sistemRol ? { systemInstruction: { parts: [{ text: girdi.sistemRol }] } } : {}),
      contents: [{ role: "user", parts: [{ text: girdi.prompt }] }],
    });
    const parcalar: any[] = veri.candidates?.[0]?.content?.parts ?? [];
    return parcalar.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("").trim();
  }

  async aracliSohbet(girdi: AiAracliSohbetGirdisi): Promise<AiAracliYanit> {
    const contents: Array<{ role: "user" | "model"; parts: any[] }> = [];
    for (const m of girdi.mesajlar) {
      if (m.rol === "kullanici") contents.push({ role: "user", parts: [{ text: m.metin }] });
      else if (m.rol === "asistan") contents.push((m.ham as { role: "model"; parts: any[] }) ?? { role: "model", parts: [{ text: m.metin }] });
      else {
        const parca = { functionResponse: { name: m.ad, response: { sonuc: m.icerik, ...(m.hata ? { hata: true } : {}) } } };
        const son = contents[contents.length - 1];
        if (son?.role === "user" && son.parts[0]?.functionResponse) son.parts.push(parca);
        else contents.push({ role: "user", parts: [parca] });
      }
    }
    // Anahtar URL'de değil başlıkta gider (AI-11).
    const veri = await saglayiciIstegi("Gemini", `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, { "x-goog-api-key": this.apiKey }, {
      systemInstruction: { parts: [{ text: girdi.sistemRol }] },
      contents,
      tools: [{ functionDeclarations: girdi.araclar.map((a) => ({ name: a.ad, description: a.aciklama, parameters: a.girdiSemasi })) }],
      generationConfig: { temperature: 0.2 },
    });
    const icerik = veri.candidates?.[0]?.content ?? { role: "model", parts: [] };
    const parcalar: any[] = Array.isArray(icerik.parts) ? icerik.parts : [];
    return {
      metin: parcalar.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("\n").trim(),
      aracCagrilari: parcalar.filter((p) => p.functionCall).map((p, i) => ({
        id: p.functionCall.id ?? `${p.functionCall.name}-${i}`,
        ad: p.functionCall.name,
        girdi: aracGirdisiniAyristir(p.functionCall.args),
      })),
      ham: { role: "model", parts: parcalar },
    };
  }
}
