import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { istekBaglami } from "../../core/istek-baglami";
import { MockAiProvider } from "../saglayici/mock-ai.provider";
import { TanimsizAiProvider } from "../saglayici/tanimsiz-ai.provider";
import { CariDurumOzetService } from "./cari-durum-ozet.service";
import { durumOlgulari, ozetiKur, type CariDurumYaniti } from "./cari-durum-ozeti";

const DURUM: CariDurumYaniti = {
  hesaplandiAt: "2026-10-17T10:00:00.000Z",
  gostergeler: { bakiyeTry: "319000.00", riskKullanimOrani: 44, odemeDavranisi: "gecikmeli", tahminiGecikmeGun: 15, guven: "orta" },
  bulgular: [
    { kod: "vadesi_gecmis", onem: "kritik", mesaj: "319.000,00 TL alacağın vadesi geçti; en eskisi 40 gündür bekliyor." },
    { kod: "teklif_bitiyor", onem: "bilgi", mesaj: "TKF2026000001 teklifinin geçerliliği 20.10.2026'da bitiyor." },
  ],
};

describe("cari durum özeti olguları (CARI-47)", () => {
  it("bulgular önce, sonra bulguyla tekrar etmeyen göstergeler; tutarı uygulama yazar", () => {
    const o = durumOlgulari(DURUM);
    expect(o.map((x) => x.id)).toEqual(["b1", "b2", "g-bakiye", "g-risk", "g-davranis"]);
    expect(o.find((x) => x.id === "g-bakiye")!.metin).toBe("Cariden 319.000,00 TL alacak bakiyesi var.");
    expect(o.find((x) => x.id === "g-davranis")!.metin).toContain("15 gün gecikmeyle");
    expect(o.find((x) => x.id === "g-davranis")!.metin).toContain("güven: orta");
  });

  it("risk %80 ve üstündeyse bulgu olarak geldiği için gösterge tekrar edilmez; veri yetersizse davranış yok", () => {
    const o = durumOlgulari({ ...DURUM, gostergeler: { ...DURUM.gostergeler!, riskKullanimOrani: 85, odemeDavranisi: "veri_yetersiz" } });
    expect(o.map((x) => x.id)).toEqual(["b1", "b2", "g-bakiye"]);
    expect(durumOlgulari({ ...DURUM, gostergeler: { ...DURUM.gostergeler!, riskKullanimOrani: 0 } }).map((x) => x.id)).not.toContain("g-risk");
  });

  it("borç bakiyesi tedarikçi yönüyle yazılır; finans bölümü yoksa (CARI-46) yalnız bulgular", () => {
    expect(durumOlgulari({ ...DURUM, bulgular: [], gostergeler: { ...DURUM.gostergeler!, bakiyeTry: "-1250.50" } })[0].metin).toBe("Cariye 1.250,50 TL borç bakiyesi var.");
    expect(durumOlgulari({ ...DURUM, gostergeler: null }).map((x) => x.id)).toEqual(["b1", "b2"]);
  });

  it("geçerli seçim modelin sırasıyla paragraf olur", () => {
    const s = ozetiKur(DURUM, { olguIdleri: ["g-davranis", "b1"] });
    expect(s.durum).toBe("dogrulandi");
    expect(s.paragraf).toBe("Ödemeler ortalama 15 gün gecikmeyle geliyor (güven: orta). 319.000,00 TL alacağın vadesi geçti; en eskisi 40 gündür bekliyor.");
  });

  it("bilinmeyen, tekrarlanan kimlik ya da fazladan alan seçimi bütünüyle reddeder", () => {
    for (const secim of [{ olguIdleri: ["b1", "x9"] }, { olguIdleri: ["b1", "b1"] }, { olguIdleri: ["b1"], metin: "uydurma 5.000 TL" }, { olguIdleri: [] }, "b1", null]) {
      const s = ozetiKur(DURUM, secim);
      expect(s.durum).toBe("guvenli_ozet");
      expect(s.neden).toBe("model_yaniti_gecersiz");
      expect(s.secilenOlguIdleri).toEqual(["b1", "b2", "g-bakiye", "g-risk"]);
      expect(s.paragraf).not.toContain("uydurma");
    }
  });

  it("olgu yoksa sabit cümle", () => {
    const s = ozetiKur({ ...DURUM, gostergeler: null, bulgular: [] }, null);
    expect(s).toMatchObject({ durum: "guvenli_ozet", neden: "olgu_yok", paragraf: "Bu cari için dikkat gerektiren bir durum görünmüyor." });
  });
});

function kur(saglayici: unknown, durum: CariDurumYaniti = DURUM) {
  const uc = { cagir: vi.fn(async () => durum) };
  const service = new CariDurumOzetService({} as never, uc as never);
  service.saglayiciBul = async () => ({ saglayici: saglayici as never });
  const calistir = <T>(fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: "satis" } }, fn);
  return { uc, service, calistir };
}

describe("cari durum özeti servisi (CARI-47)", () => {
  it("sağlayıcı yoksa düğme gösterilmez", async () => {
    const k = kur(new TanimsizAiProvider());
    expect(await k.calistir(() => k.service.kullanilabilir())).toEqual({ kullanilabilir: false });
    const m = kur(new MockAiProvider());
    expect(await m.calistir(() => m.service.kullanilabilir())).toEqual({ kullanilabilir: true });
  });

  it("panel verisini kullanıcının rolüyle ekran ucundan okur; modele cari adı değil yalnız olgular gider", async () => {
    const saglayici = new MockAiProvider();
    const uret = vi.spyOn(saglayici, "yapilandirilmisUretim").mockResolvedValue({ olguIdleri: ["b1", "g-bakiye"] });
    const k = kur(saglayici);
    const s = await k.calistir(() => k.service.ozetle("c1"));
    expect(k.uc.cagir).toHaveBeenCalledWith(expect.objectContaining({ yol: "GET /cari/:id/durum" }), ["c1"]);
    expect(s.durum).toBe("dogrulandi");
    expect(JSON.parse(uret.mock.calls[0][0].prompt)).toHaveLength(5);
  });

  it("şemaya uymayan yanıt güvenli özete, sağlayıcı hatası model hatasına düşer", async () => {
    const gecersiz = new MockAiProvider();
    vi.spyOn(gecersiz, "yapilandirilmisUretim").mockRejectedValue(new z.ZodError([]));
    const a = kur(gecersiz);
    expect(await a.calistir(() => a.service.ozetle("c1"))).toMatchObject({ durum: "guvenli_ozet", neden: "model_yaniti_gecersiz" });
    const bozuk = new MockAiProvider();
    vi.spyOn(bozuk, "yapilandirilmisUretim").mockRejectedValue(new Error("ağ"));
    const b = kur(bozuk);
    expect(await b.calistir(() => b.service.ozetle("c1"))).toMatchObject({ durum: "guvenli_ozet", neden: "model_hatasi" });
  });

  it("günlük sınır (AI-15) ve onay eksikliği (AI-14) açık hata olarak döner", async () => {
    const saglayici = new MockAiProvider();
    vi.spyOn(saglayici, "yapilandirilmisUretim").mockRejectedValue(new HttpException("Günlük yapay zekâ çağrı sınırına (1000) ulaşıldı.", 429));
    const k = kur(saglayici);
    await expect(k.calistir(() => k.service.ozetle("c1"))).rejects.toThrow("çağrı sınırına");
    const t = kur(new TanimsizAiProvider("Onay yok"));
    await expect(t.calistir(() => t.service.ozetle("c1"))).rejects.toThrow("Onay yok");
  });

  it("tek olgu varsa modele gidilmez", async () => {
    const saglayici = new MockAiProvider();
    const uret = vi.spyOn(saglayici, "yapilandirilmisUretim");
    const k = kur(saglayici, { ...DURUM, gostergeler: null, bulgular: [DURUM.bulgular[0]] });
    const s = await k.calistir(() => k.service.ozetle("c1"));
    expect(uret).not.toHaveBeenCalled();
    expect(s).toMatchObject({ durum: "dogrulandi", secilenOlguIdleri: ["b1"] });
  });
});
