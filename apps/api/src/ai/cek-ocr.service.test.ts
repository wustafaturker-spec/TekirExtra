import { describe, expect, it, vi } from "vitest";
import { AiService } from "./ai.service";
import { AiController } from "./ai.controller";
import { baglamlaCalistir } from "../core/istek-baglami";
import type { IAiProvider } from "./saglayici/ai-provider.interface";
const girdi = { mimeType: "image/png" as const,
  gorselBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" };
const belge = { belgeTuru: "CEK", cekNo: "00123", banka: "Test", sube: null, hesapNo: "000123", borclu: "Test AŞ",
  kesideYeri: null, tarih: "2026-12-31", tutar: "100.01", paraBirimi: "TRY", yaziylaTutar: null, yaziylaTutarSayisal: null,
  guvenSkoru: 0.9, belirsizAlanlar: [] };
function kur() {
  const tx = { aiOcrDenetim: { create: vi.fn().mockResolvedValue({ id: "iz" }), update: vi.fn().mockResolvedValue({}) },
    cekSenet: { create: vi.fn() }, cariHesap: { create: vi.fn() } };
  const prisma = { tenantIslem: vi.fn(async (_tenant, fn) => fn(tx)) };
  const servis = new AiService(prisma as never);
  const provider = { saglayiciAdi: "ollama", modelAdi: "gorsel-model", yapilandirilmisUretim: vi.fn().mockResolvedValue(belge) };
  const resolver = vi.spyOn(servis as unknown as { getProviderForTenant: (id: string) => Promise<IAiProvider> }, "getProviderForTenant")
    .mockResolvedValue(provider as unknown as IAiProvider);
  const calistir = (veri = girdi) => baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, () => servis.cekOcrTara("t1", veri));
  return { servis, tx, prisma, provider, resolver, calistir };
}
describe("çek OCR servis güvenlik kapıları", () => {
  it("dosya imzasını sağlayıcı seçiminden önce doğrular", async () => {
    const { calistir, resolver } = kur();
    await expect(calistir({ ...girdi, gorselBase64: "data:image/png;base64,SGVsbG8=" })).rejects.toThrow("gerçek türü");
    expect(resolver).not.toHaveBeenCalled();
  });
  it("tenant sağlayıcısından yalnız öneri üretir; denetimde görsel/çek verisi saklamaz", async () => {
    const { calistir, resolver, tx } = kur();
    expect((await calistir()).veri.cekNo).toBe("00123"); expect(resolver).toHaveBeenCalledWith("t1");
    expect(tx.aiOcrDenetim.create.mock.calls[0][0].data).toMatchObject({ tenantId: "t1", userId: "u1", saglayici: "ollama", model: "gorsel-model" });
    expect(JSON.stringify(tx.aiOcrDenetim.create.mock.calls)).not.toMatch(/base64|00123|Test AŞ/);
    expect(tx.aiOcrDenetim.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "basarili" }) }));
    expect(tx.cekSenet.create).not.toHaveBeenCalled(); expect(tx.cariHesap.create).not.toHaveBeenCalled();
  });
  it("sağlayıcı/onay kapısı hata verince görüntüyü model çağrısına göndermez", async () => {
    const { calistir, resolver, provider, tx } = kur(); resolver.mockRejectedValue(new Error("Aktarım onayı yok"));
    await expect(calistir()).rejects.toThrow("Aktarım onayı yok"); expect(provider.yapilandirilmisUretim).not.toHaveBeenCalled();
    expect(tx.aiOcrDenetim.create).not.toHaveBeenCalled();
  });
  it("örnek sağlayıcıyla gerçek çek bilgisi uydurmaz", async () => {
    const { calistir, resolver, provider } = kur(); resolver.mockResolvedValue({ ...provider, saglayiciAdi: "mock" } as unknown as IAiProvider);
    await expect(calistir()).rejects.toThrow("Örnek veriyle"); expect(provider.yapilandirilmisUretim).not.toHaveBeenCalled();
  });
  it("sağlayıcı veya çıktı şeması hatasını denetime işler, kayıt oluşturmaz", async () => {
    const { calistir, provider, tx } = kur(); provider.yapilandirilmisUretim.mockResolvedValue({ tutar: 100 });
    await expect(calistir()).rejects.toThrow();
    expect(tx.aiOcrDenetim.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "hata" }) }));
    expect(tx.cekSenet.create).not.toHaveBeenCalled();
  });
  it("OCR ucunda muhasebe yetkisi ve katı görsel şeması vardır", async () => {
    const { servis } = kur(); const c = new AiController(servis);
    expect(Reflect.getMetadata("roller", AiController)).toEqual(["muhasebe"]);
    await expect(c.cekOku({ hamMetin: "100 TL" })).rejects.toThrow("çek görüntüsü");
  });
});
