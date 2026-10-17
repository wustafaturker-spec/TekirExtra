import { beforeEach, describe, expect, it, vi } from "vitest";
import { nakitSozleriniOku } from "./nakit-sozu-kaynak";
import { odemeSozuKaynaklariniOku } from "../cari/odeme-sozu-kaynak";

const baglam = vi.hoisted(() => ({ tenantId: "t", rol: "muhasebe" }));
vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => baglam }));
vi.mock("../cari/odeme-sozu-kaynak", () => ({ odemeSozuKaynaklariniOku: vi.fn() }));
const bugun = "2026-10-16";
function kur() {
  const tx = { modulAyar: { findUnique: vi.fn().mockResolvedValue({ ayarlar: { surum: 1, mod: "pilot" } }) }, odemeSozu: { findMany: vi.fn().mockResolvedValue([{ cariId: "c" }]) } };
  return { tx, oku: () => nakitSozleriniOku(tx as never, "t", bugun) };
}
const s = { id: "s", faturaId: "f", cariId: "c", dovizCinsi: "TRY", sozTarihi: "2026-10-20", kayitDurumu: "aktif", gerceklesme: { durum: "kismen_gerceklesti", kalan: "600.00" } };
beforeEach(() => { vi.clearAllMocks(); baglam.rol = "muhasebe"; vi.mocked(odemeSozuKaynaklariniOku).mockResolvedValue({ sozler: [s] } as never); });
describe("Nakit ödeme sözü kaynak kapısı", () => {
  it.each([null, { ayarlar: {} }, { ayarlar: { mod: "kapali" } }, { ayarlar: { mod: "bozuk" } }])("kapalı veya bozuk ayarda kaynak okumaz: %j", async (ayar) => {
    const { tx, oku } = kur(); tx.modulAyar.findUnique.mockResolvedValue(ayar as never);
    expect((await oku()).size).toBe(0); expect(tx.odemeSozu.findMany).not.toHaveBeenCalled();
  });
  it.each(["satis", "depo", "salt_okunur"])("rol %s için kaynak okumaz", async (rol) => {
    baglam.rol = rol; const { tx, oku } = kur(); expect((await oku()).size).toBe(0); expect(tx.modulAyar.findUnique).not.toHaveBeenCalled();
  });
  it("istenen tenant bağlamdan farklıysa kaynak okumaz", async () => {
    const { tx } = kur(); expect((await nakitSozleriniOku(tx as never, "baska", bugun)).size).toBe(0);
    expect(tx.modulAyar.findUnique).not.toHaveBeenCalled();
  });
  it("net kalan ve ufuk dışındaki gelecekteki söz tarihini korur", async () => {
    const { tx, oku } = kur();
    vi.mocked(odemeSozuKaynaklariniOku).mockResolvedValue({ sozler: [{ ...s, sozTarihi: "2027-01-01" }] } as never);
    expect((await oku()).get("f")).toMatchObject({ tarih: "2027-01-01", kalan: "600.00" });
    expect(odemeSozuKaynaklariniOku).toHaveBeenCalledWith(tx, "t", "c");
    expect(tx.odemeSozu.findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: "t", kayitDurumu: "aktif" }, take: 101 });
  });
  it.each([
    { kayitDurumu: "iptal" }, { kayitDurumu: "revize" }, { sozTarihi: "2026-10-15" },
    { gerceklesme: { durum: "gerceklesti", kalan: "0.00" } }, { gerceklesme: { durum: "kaynak_gecersiz", kalan: "600.00" } }, { gerceklesme: undefined },
  ])("uygun olmayan sözü taşımaz: %j", async (fark) => {
    vi.mocked(odemeSozuKaynaklariniOku).mockResolvedValue({ sozler: [{ ...s, ...fark }] } as never);
    expect((await kur().oku()).size).toBe(0);
  });
  it("kaynak sınırında kısmi sonucu başarı gibi sunmaz", async () => {
    const { tx, oku } = kur(); tx.odemeSozu.findMany.mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ cariId: `c${i}` })));
    await expect(oku()).rejects.toThrow("kısmi tahmin"); expect(odemeSozuKaynaklariniOku).not.toHaveBeenCalled();
  });
  it("uzlaştırma hatasını gizleyip eski vadeden tahmin üretmez", async () => {
    vi.mocked(odemeSozuKaynaklariniOku).mockRejectedValue(new Error("Kapama kapasitesi tutarsız"));
    await expect(kur().oku()).rejects.toThrow("Kapama kapasitesi");
  });
  it("aynı faturadaki çelişkili aktif sözleri reddeder", async () => {
    vi.mocked(odemeSozuKaynaklariniOku).mockResolvedValue({ sozler: [s, { ...s, id: "s2" }] } as never);
    await expect(kur().oku()).rejects.toThrow("birden fazla");
  });
});
