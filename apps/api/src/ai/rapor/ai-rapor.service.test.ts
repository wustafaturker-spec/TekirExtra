import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../../core/istek-baglami";
import { MockAiProvider } from "../saglayici/mock-ai.provider";
import { TanimsizAiProvider } from "../saglayici/tanimsiz-ai.provider";
import { AiRaporService, yorumuSadelestir } from "./ai-rapor.service";

function kur(saglayici = new TanimsizAiProvider() as never) {
  const uc = {
    cagir: vi.fn(async (u: { yol: string }, arg: unknown[]) => {
      if (u.yol === "GET /rapor/ozet") return { nakitVarliklar: "1000.00", toplamAlacaklar: "500.00", toplamBorclar: "200.00", netVarlikDegeri: "1300.00", eksiStokSayisi: 2, kurEksik: [] };
      if (u.yol === "GET /rapor/gelir-gider") return { baslangicTarihi: arg[0], bitisTarihi: arg[1], karZarar: { netSatis: 900, brutKar: 300, netKar: -50 }, uyarilar: ["Maliyeti bilinmeyen 1 satış"] };
      if (u.yol === "GET /rapor/vadesi-gecenler") return { toplamAlacak: "120.00", alacakSayisi: 3, toplamBorc: "0.00" };
      return {};
    }),
  };
  const service = new AiRaporService({} as never, uc as never);
  service.saglayiciBul = async () => ({ saglayici });
  const calistir = () => istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: "muhasebe" } }, () => service.yoneticiOzeti());
  return { uc, calistir };
}

describe("yönetici özeti (AI-08)", () => {
  it("rakamları rapor uçlarından alır, dönemi ay başından bugüne yazar", async () => {
    const k = kur();
    const o = await k.calistir();
    expect(o.donem.baslangic).toMatch(/^\d{4}-\d{2}-01$/);
    expect(k.uc.cagir).toHaveBeenCalledWith(expect.objectContaining({ yol: "GET /rapor/gelir-gider" }), [o.donem.baslangic, o.donem.bitis]);
    expect(o.metrikler).toMatchObject({ netSatis: 900, netKar: -50, nakitVarliklar: 1000, netVarlik: 1300, vadesiGecenAlacak: 120, vadesiGecenAlacakSayisi: 3 });
  });

  it("uyarılar yalnız olgulardan; sağlayıcı yoksa yorum yok", async () => {
    const o = await kur().calistir();
    expect(o.uyarilar.join(" ")).toContain("vadesi geçmiş");
    expect(o.uyarilar.join(" ")).toContain("net zarar");
    expect(o.uyarilar.join(" ")).toContain("eksi stok");
    expect(o.uyarilar).toContain("Maliyeti bilinmeyen 1 satış");
    expect(o.yorum).toBeNull();
  });

  it("sağlayıcı varsa yorumu yalnız verilen rakamlarla ister", async () => {
    const saglayici = new MockAiProvider();
    const metinUret = vi.spyOn(saglayici, "metinUret").mockResolvedValue("Net zarar var.");
    const o = await kur(saglayici as never).calistir();
    expect(o.yorum).toBe("Net zarar var.");
    expect(metinUret.mock.calls[0][0].prompt).toContain("- Net kâr: -50,00 TL");
    expect(metinUret.mock.calls[0][0].prompt).toContain("Ay başından bugüne");
    expect(metinUret.mock.calls[0][0].sistemRol).toContain("brüt kâr ile net kârı");
    expect(metinUret.mock.calls[0][0].sistemRol).toContain("yeni rakam");
  });

  it("yorumu düz metne indirger ve 4 cümleyle sınırlar", () => {
    const uzun = "**Özet**\n\n---\n* **Net kâr:** 1 TL. İki. Üç! Dört? Beş. Altı.";
    expect(yorumuSadelestir(uzun)).toBe("Özet Net kâr: 1 TL. İki. Üç! Dört?");
  });

  it("binlik ayracında cümle bölmez", () => {
    expect(yorumuSadelestir("Net satış 611.640,44 TL. Kâr arttı.")).toBe("Net satış 611.640,44 TL. Kâr arttı.");
  });
});
