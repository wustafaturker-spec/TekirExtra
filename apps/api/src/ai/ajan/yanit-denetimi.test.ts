import { describe, expect, it } from "vitest";
import { uydurmaNedeni } from "./yanit-denetimi";

const BOS = { aracCiktilari: [], talepSayisi: 0, baglamMetni: "teklif hazırla" };

describe("yanıt denetimi (AI-05)", () => {
  it("araç çalışmadan işlem yapıldı denmesini yakalar (canlıda görülen durum)", () => {
    expect(uydurmaNedeni("Teklif taslağı oluşturuldu. Toplam 590,00 TRY.", BOS)).toMatch(/hiçbir araç/);
    expect(uydurmaNedeni("Kayıt açıldı.", BOS)).toMatch(/hiçbir araç/);
  });

  it("araç sonuçlarında olmayan kayıt kimliğini yakalar", () => {
    const cevap = "Adres: /panel/belge/a1b2c3d4-e5f6-7890-1234-567890abcdef";
    expect(uydurmaNedeni(cevap, { ...BOS, aracCiktilari: ['{"id":"7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d"}'] })).toMatch(/kimliği/);
    expect(uydurmaNedeni("Kayıt: 7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d", { ...BOS, aracCiktilari: ['{"id":"7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d"}'] })).toBeNull();
  });

  it("araç sonuçlarında olmayan ekran adresini yakalar", () => {
    const tur = { ...BOS, talepSayisi: 1, aracCiktilari: ['{"talepId":"497b5995-43fb-457e-8204-c1ea176c454e","adres":"/panel/ai?talep=497b5995-43fb-457e-8204-c1ea176c454e"}'] };
    expect(uydurmaNedeni("Onaylamak için: /panel/onay?id=497b5995-43fb-457e-8204-c1ea176c454e", tur)).toMatch(/adresi/);
    expect(uydurmaNedeni("Onaylamak için: /panel/ai?talep=497b5995-43fb-457e-8204-c1ea176c454e.", tur)).toBeNull();
  });

  it("talep açılmadan onaya sunuldu denmesini yakalar", () => {
    expect(uydurmaNedeni("Onayınıza sunulmuştur.", { ...BOS, aracCiktilari: ["{}"] })).toMatch(/onay talebi/);
    expect(uydurmaNedeni("Onayınıza sunulmuştur.", { ...BOS, aracCiktilari: ["{}"], talepSayisi: 1 })).toBeNull();
    // Canlıda kaçan ifade (araç çağrısı yok, talep yok):
    expect(uydurmaNedeni("Teklifin iptali için onayınız gerekiyor. Onayladığınızda teklif iptal edilecek.", BOS)).toMatch(/onay talebi/);
    expect(uydurmaNedeni("Teklif e-postayla gönderilecek.", { ...BOS, aracCiktilari: ["{}"] })).toMatch(/onay talebi/);
  });

  it("okuma sonucu aktaran ve soru soran yanıtlara dokunmaz", () => {
    expect(uydurmaNedeni("TKF2026000001 teklifi onaylandı durumunda.", { ...BOS, aracCiktilari: ['{"durum":"onaylandi"}'] })).toBeNull();
    expect(uydurmaNedeni("Hangi cariyi kastettiniz?", BOS)).toBeNull();
    expect(uydurmaNedeni("Teklif oluşturamadım: stok bulunamadı.", BOS)).toBeNull();
    expect(uydurmaNedeni("Taslağı onaylamak isterseniz onayınıza sunabilirim.", { ...BOS, aracCiktilari: ["{}"] })).toBeNull();
  });

  it("AI-74: onay bekleyen kayıt listelenince 'onayınızı bekleyen' iş durumu sayılır", () => {
    const tur = { ...BOS, aracCiktilari: ['{"veri":[{"no":"SAT-1","durum":"onay_bekliyor"}]}'] };
    expect(uydurmaNedeni("Onayınızı bekleyen 1 satın alma talebi var: SAT-1.", tur)).toBeNull();
    // Kaynakta onay bekleyen kayıt yoksa eski kural geçerli.
    expect(uydurmaNedeni("Onayınızı bekleyen 1 satın alma talebi var.", { ...BOS, aracCiktilari: ['{"veri":[]}'] })).toMatch(/onay talebi açılmadığı/);
    // Aynı yanıtta başka bir onay iddiası varsa yine yakalanır.
    expect(uydurmaNedeni("Onayınızı bekleyen talep var; onay talebi açıldı.", tur)).toMatch(/onay talebi açılmadığı/);
  });
});
