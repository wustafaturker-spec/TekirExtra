import { beforeEach, describe, expect, it, vi } from "vitest";
import { panelWidgetSemasi } from "@tekirextra/shared";
import { api } from "../../lib/api";
import { widgetGorunumleri, widgetTutarBicimle, widgetVerisiniAl } from "./panel-widget-verisi";

vi.mock("../../lib/api", () => ({ api: vi.fn() }));
const istek = vi.mocked(api);
const kimlik = { id: "cc066e71-be6e-4ddd-8cde-4a063ac90a32", baslik: "Vade" };
const signal = new AbortController().signal;

describe("Panel widget sayıları", () => {
  beforeEach(() => istek.mockReset());

  it("gecikmiş alacak tutarını sınırlı listeden hesaplamaz", async () => {
    istek.mockResolvedValue({ toplamAlacak: "9007199254740993.19", alacakSayisi: 42, alacaklar: [] });
    await expect(widgetVerisiniAl({ ...kimlik, kaynak: "vade", filtre: "alacak", gorunum: "tutar" }, signal))
      .resolves.toMatchObject({ tutar: "9007199254740993.19" });
    expect(widgetTutarBicimle("9007199254740993.19")).toBe("₺9.007.199.254.740.993,19");
    expect(widgetTutarBicimle("-0.05")).toBe("-₺0,05");
  });

  it("aylık borç widget’ı vade aralığını ve kaynak toplamını kullanır", async () => {
    istek.mockResolvedValue({ donem: "bu_ay", baslangic: "2026-11-01", bitis: "2026-11-30", toplamBorc: "951.40", borcSayisi: 4 });
    await expect(widgetVerisiniAl({ ...kimlik, kaynak: "vade", filtre: "borc_bu_ay", gorunum: "tutar" }, signal))
      .resolves.toEqual({ tutar: "951.40", aciklama: "01.11.2026 – 30.11.2026 · Vadesi bu aralıkta olan açık borçlar" });
    expect(istek).toHaveBeenCalledWith("/rapor/vade-donemi?donem=bu_ay", { signal });
  });

  it("eksik değer hata verir, gerçek sıfır gösterilebilir", async () => {
    const widget = { ...kimlik, kaynak: "stok", filtre: "kritik", gorunum: "sayi" } as const;
    istek.mockResolvedValueOnce({}).mockResolvedValueOnce({ kritikStok: 0 });
    await expect(widgetVerisiniAl(widget, signal)).rejects.toThrow("Geçersiz kayıt adedi");
    await expect(widgetVerisiniAl(widget, signal)).resolves.toMatchObject({ adet: 0 });
  });

  it("tahsilat widget’ında sunucunun dönemini ve kuruşlu tutarını gösterir", async () => {
    const widget = { ...kimlik, kaynak: "tahsilat", filtre: "bu_hafta", gorunum: "tutar" } as const;
    const veri = { donem: "bu_hafta", baslangic: "2026-11-16", bitis: "2026-11-19", toplam: "345.67", adet: 2 };
    istek.mockResolvedValueOnce(veri).mockResolvedValueOnce({ ...veri, donem: "dun" });
    await expect(widgetVerisiniAl(widget, signal))
      .resolves.toEqual({ tutar: "345.67", aciklama: "16.11.2026 – 19.11.2026 · Çek ve senet dahil" });
    expect(istek).toHaveBeenCalledWith("/rapor/tahsilat-donemi?donem=bu_hafta", { signal });
    await expect(widgetVerisiniAl(widget, signal)).rejects.toThrow("Rapor dönemi uyuşmuyor");
  });

  it("günlük trendi yalnız haftalık ve aylık tahsilat için açar", () => {
    const widget = { ...kimlik, kaynak: "tahsilat", gorunum: "trend" };
    expect(widgetGorunumleri("tahsilat", "bugun")).not.toContain("trend");
    expect(widgetGorunumleri("tahsilat", "bu_ay")).toContain("trend");
    expect(panelWidgetSemasi.safeParse({ ...widget, filtre: "dun" }).success).toBe(false);
    expect(panelWidgetSemasi.safeParse({ ...widget, filtre: "bu_hafta" }).success).toBe(true);
  });

  it("trendde eksik günleri ve toplam farkını reddeder", async () => {
    const widget = { ...kimlik, kaynak: "tahsilat", filtre: "bu_hafta", gorunum: "trend" } as const;
    const gunler = [{ tarih: "2026-11-16", tutar: "9007199254740993.19" }, { tarih: "2026-11-17", tutar: "0.01" }];
    const ozet = { donem: "bu_hafta", baslangic: "2026-11-16", bitis: "2026-11-17", toplam: "9007199254740993.20" };
    istek.mockResolvedValueOnce({ ...ozet, gunler })
      .mockResolvedValueOnce({ ...ozet, gunler: gunler.slice(0, 1) })
      .mockResolvedValueOnce({ ...ozet, toplam: "9007199254740993.19", gunler });
    await expect(widgetVerisiniAl(widget, signal)).resolves.toMatchObject({ tutar: ozet.toplam, gunler });
    await expect(widgetVerisiniAl(widget, signal)).rejects.toThrow("Günlük tahsilat verisi eksik");
    await expect(widgetVerisiniAl(widget, signal)).rejects.toThrow("Günlük tahsilat toplamı uyuşmuyor");
  });

  it("Sabah Onay adedini liste yerine sayım ucundan okur", async () => {
    istek.mockResolvedValue({ adet: 127 });
    await expect(widgetVerisiniAl({ ...kimlik, kaynak: "sabah", filtre: "bekleyen", gorunum: "sayi" }, signal))
      .resolves.toMatchObject({ adet: 127 });
    expect(istek).toHaveBeenCalledWith("/ai/hazirlik/bekleyen-sayisi", { signal });
  });
});
