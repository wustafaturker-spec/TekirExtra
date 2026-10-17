import { describe, expect, it, vi } from "vitest";
import { tahsilatBildirimiUret, tahsilatBildirimKapsami } from "./tahsilat-bildirimi";
function kur() {
  return {
    user: { findFirst: vi.fn().mockResolvedValue({ id: "u" }) },
    modulAyar: { findUnique: vi.fn().mockResolvedValue({ ayarlar: { mod: "pilot" } }) },
    bildirimTercihi: { findUnique: vi.fn().mockResolvedValue(null) },
    bildirim: { upsert: vi.fn().mockResolvedValue({ id: "b" }) },
    bildirimTeslimati: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}
const g = { tenantId: "t", takipId: "k", sorumluUserId: "u", zaman: new Date("2026-10-16T12:00:00Z") };
describe("F02 bildiriminin kanal ve erişim sınırı", () => {
  it("alıcı uygun değilse bildirim üretmez", async () => {
    const tx = kur(); tx.user.findFirst.mockResolvedValue(null);
    await tahsilatBildirimiUret(tx as never, g); expect(tx.bildirim.upsert).not.toHaveBeenCalled();
  });
  it("uygulama içi tercihi kapalıysa hiçbir kanal üretmez", async () => {
    const tx = kur(); tx.bildirimTercihi.findUnique.mockResolvedValue({ uygulamaIci: false } as never);
    await tahsilatBildirimiUret(tx as never, g); expect(tx.bildirimTeslimati.createMany).not.toHaveBeenCalled();
  });
  it("teslimatta e-posta kapalıdır ve aynı kullanıcı için tekrar tekillikle bastırılır", async () => {
    const tx = kur(); await tahsilatBildirimiUret(tx as never, g);
    expect(tx.bildirimTeslimati.createMany).toHaveBeenCalledWith({ data: [{ tenantId: "t", bildirimId: "b", userId: "u", epostaDurumu: "kapali" }], skipDuplicates: true });
  });
  it.each([null, { ayarlar: {} }, { ayarlar: { mod: "kapali" } }, { ayarlar: { mod: "acik", surum: 2 } }])("kapalı veya geçersiz ayarda yalnız F02 olayını gizler: %j", async (ayar) => {
    const tx = kur(); tx.modulAyar.findUnique.mockResolvedValue(ayar as never);
    expect(await tahsilatBildirimKapsami(tx as never, "t", "muhasebe", "u")).toEqual({ OR: [{ kaynakTur: null }, { kaynakTur: { not: "tahsilat_takibi" } }] });
  });
  it("eski yönetici tokenı güncel uygun kullanıcı olmadan yetki vermez", async () => {
    const tx = kur(); tx.user.findFirst.mockResolvedValue(null);
    expect(await tahsilatBildirimKapsami(tx as never, "t", "yonetici", "u")).toHaveProperty("OR");
  });
  it("yetkisiz rol kullanıcı sorgulamadan daraltılır", async () => {
    const tx = kur(); expect(await tahsilatBildirimKapsami(tx as never, "t", "satis", "u")).toHaveProperty("OR"); expect(tx.user.findFirst).not.toHaveBeenCalled();
  });
  it("güncel rol ve şirket modu uygunsa mevcut bildirime erişim korunur", async () => {
    const tx = kur(); expect(await tahsilatBildirimKapsami(tx as never, "t", "muhasebe", "u")).toEqual({});
  });
});
