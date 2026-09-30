import { describe, expect, it, vi } from "vitest";
import { satirVaryantlariniDogrula } from "./varyant-secimi";

describe("satirVaryantlariniDogrula", () => {
  const tx = (varyantlar: { id: string; stokId: string }[]) => ({ stokVaryant: { findMany: vi.fn().mockResolvedValue(varyantlar) } }) as never;
  const varyantlar = [{ id: "v-siyah", stokId: "tisort" }, { id: "v-beyaz", stokId: "tisort" }];

  it("varyantlı ürünü varyantsız satırlatmaz", async () => {
    await expect(satirVaryantlariniDogrula(tx(varyantlar), [{ stokId: "kalem" }, { stokId: "tisort", varyantId: null }])).rejects.toThrow("2. satırda varyant seçilmedi");
  });

  it("başka ürünün ya da pasif varyantını kabul etmez", async () => {
    await expect(satirVaryantlariniDogrula(tx(varyantlar), [{ stokId: "kalem", varyantId: "v-siyah" }])).rejects.toThrow("1. satırdaki varyant bu ürüne ait değil ya da pasif");
  });

  it("varyantı seçilmiş ve varyantsız ürün satırlarını geçirir", async () => {
    await expect(satirVaryantlariniDogrula(tx(varyantlar), [{ stokId: "tisort", varyantId: "v-beyaz" }, { stokId: "kalem" }])).resolves.toBeUndefined();
  });
});
