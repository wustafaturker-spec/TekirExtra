import { describe, expect, it, vi } from "vitest";
import { HataKayitService, ilkUygulamaSatiri, maskele, parmakIzi } from "./hata-kayit";

describe("hata kaydı (PLT-118)", () => {
  it("mesajdaki kişisel veriyi ve kimlikleri gizler", () => {
    const m = maskele("ali@firma.com.tr VKN 1234567890 TCKN 10000000078 TR33 0006 1005 1978 6457 8413 26 0532 123 45 67 kayıt 3fa85f64-5717-4562-b3fc-2c963f66afa6");
    expect(m).not.toMatch(/ali@|1234567890|10000000078|0006 1005|532|3fa85f64/);
    expect(m).toContain(":id");
  });

  it("yığının uygulamaya ait ilk satırını satır numarasız alır", () => {
    const yigin = "Error: x\n    at Object.f (/repo/node_modules/@prisma/client/index.js:10:5)\n    at FaturaService.iptal (/runtime/apps/api/dist/fatura/fatura.service.js:1203:19)\n    at async Y (node:internal/x:1:1)";
    expect(ilkUygulamaSatiri(yigin)).toBe("at FaturaService.iptal (/runtime/apps/api/dist/fatura/fatura.service.js");
  });

  it("değişen sayı ve kimlikler aynı gruba düşer; farklı yer ayrı gruptur", () => {
    const g = { kaynak: "api" as const, ad: "TypeError", yigin: "Error\n    at A (/x/a.js:1:1)", konum: "GET /fatura/:id" };
    expect(parmakIzi({ ...g, mesaj: "Fatura 123 bulunamadı" })).toBe(parmakIzi({ ...g, mesaj: "Fatura 98765 bulunamadı" }));
    expect(parmakIzi({ ...g, mesaj: "x" })).not.toBe(parmakIzi({ ...g, mesaj: "x", konum: "GET /cari/:id" }));
    expect(parmakIzi({ ...g, mesaj: "x" })).toHaveLength(64);
  });

  it("tek sorguyla birikerek yazar; yazamazsa fırlatmaz", async () => {
    process.env.HATA_KAYDI_TESTTE = "1";
    try {
      const executeRaw = vi.fn().mockResolvedValue(1);
      const servis = new HataKayitService({ $executeRaw: executeRaw } as never);
      await servis.kaydet({ kaynak: "api", ad: "Error", mesaj: "ali@x.com patladı", konum: "POST /fatura", tenantId: "3fa85f64-5717-4562-b3fc-2c963f66afa6", istekId: "r1" });
      const [sql, ...degerler] = executeRaw.mock.calls[0];
      expect(sql.join("?")).toContain("ON CONFLICT (parmak_izi) DO UPDATE");
      expect(degerler).toContain("***@*** patladı");
      expect(degerler).toContainEqual(["3fa85f64-5717-4562-b3fc-2c963f66afa6"]);
      executeRaw.mockRejectedValueOnce(new Error("bağlantı yok"));
      await expect(servis.kaydet({ kaynak: "web", ad: "Error", mesaj: "x", konum: "/panel" })).resolves.toBeUndefined();
    } finally { delete process.env.HATA_KAYDI_TESTTE; }
  });
});
