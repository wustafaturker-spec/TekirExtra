import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AiProviderFactory } from "../src/ai/saglayici/ai-provider.factory";
import { aracBul, aracTanimi } from "../src/ai/ajan/araclar";
import { ilkTurHatasi, KALITE_SENARYOLARI, sonTurHatasi } from "../src/ai/kalite/kalite-senaryolari";

const canli = process.env.AI_KALITE_CANLI === "1";
if (canli && existsSync(resolve(__dirname, "../.env"))) process.loadEnvFile(resolve(__dirname, "../.env"));

describe.skipIf(!canli)("gerçek model kalite ölçümü — yalnız yapay veri, ERP işlemi çalıştırılmaz", () => {
  for (const senaryo of KALITE_SENARYOLARI) for (let deneme = 1; deneme <= 2; deneme++) {
    it(`${senaryo.id} / deneme ${deneme}`, async () => {
      const saglayici = process.env.AI_KALITE_SAGLAYICI, model = process.env.AI_KALITE_MODEL;
      if (!saglayici || !["openai", "anthropic", "gemini", "ollama"].includes(saglayici) || !model) throw new Error("AI_KALITE_SAGLAYICI ve AI_KALITE_MODEL açıkça seçilmelidir.");
      const provider = AiProviderFactory.uret({ saglayici, modelAdi: model });
      if (provider.saglayiciAdi === "tanimsiz") throw new Error("Seçilen sağlayıcı anahtarı/yerel sunucu tanımlı değil.");
      const sistemRol = "TekirExtra ön muhasebe asistanısın. Veriyi yalnız araçlardan al. Belirsiz carilerde kullanıcıya seçim sor. Hiçbir kayıt değiştirme. Negatif değerlerin işaretini ve para birimini aynen koru. Kısa Türkçe yanıt ver.";
      const mesajlar = [{ rol: "kullanici" as const, metin: senaryo.talimat }];
      const araclar = KALITE_SENARYOLARI.map(s => aracTanimi(aracBul(s.arac)!));
      const baslangic = Date.now();
      let girisToken = 0, cikisToken = 0, tokenBiliniyor = true;
      const tokenSay = (onceki: typeof provider.sonKullanim) => { if (provider.sonKullanim === onceki || provider.sonKullanim?.girisToken == null || provider.sonKullanim.cikisToken == null) tokenBiliniyor = false; else { girisToken += provider.sonKullanim.girisToken; cikisToken += provider.sonKullanim.cikisToken; } };
      let hata: string | null = null;
      try {
        const onceki = provider.sonKullanim;
        const ilk = await provider.aracliSohbet({ sistemRol, mesajlar, araclar }); tokenSay(onceki);
        hata = ilkTurHatasi(senaryo, ilk);
        if (!hata) {
          const ikinciOnceki = provider.sonKullanim;
          const son = await provider.aracliSohbet({ sistemRol, araclar, mesajlar: [...mesajlar, { rol: "asistan", metin: ilk.metin, aracCagrilari: ilk.aracCagrilari, ham: ilk.ham }, { rol: "arac_sonucu", cagriId: ilk.aracCagrilari[0].id, ad: senaryo.arac, icerik: JSON.stringify(senaryo.sonuc) }] });
          tokenSay(ikinciOnceki); hata = sonTurHatasi(senaryo, son);
        }
      } catch (e) { tokenBiliniyor = false; hata = e instanceof Error ? e.message : "Sağlayıcı hatası"; }
      const girisFiyati = process.env.AI_KALITE_GIRIS_MILYON_USD ? Number(process.env.AI_KALITE_GIRIS_MILYON_USD) : NaN;
      const cikisFiyati = process.env.AI_KALITE_CIKIS_MILYON_USD ? Number(process.env.AI_KALITE_CIKIS_MILYON_USD) : NaN;
      const maliyetUsd = tokenBiliniyor && Number.isFinite(girisFiyati) && Number.isFinite(cikisFiyati) && girisFiyati >= 0 && cikisFiyati >= 0 ? (girisToken * girisFiyati + cikisToken * cikisFiyati) / 1_000_000 : null;
      console.info(JSON.stringify({ senaryo: senaryo.id, deneme, saglayici, model, basarili: !hata, sureMs: Date.now() - baslangic, girisToken: tokenBiliniyor ? girisToken : null, cikisToken: tokenBiliniyor ? cikisToken : null, maliyetUsd }));
      expect(hata).toBeNull();
    });
  }
});
