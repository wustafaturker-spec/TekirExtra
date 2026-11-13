import { describe, expect, it, vi } from "vitest";

const gonder = vi.fn(async (_c: unknown, kalemler: unknown[]) => ({ gonderilen: kalemler.length, islemIdleri: [] }));
vi.mock("./adaptor", () => ({ ADAPTORLU_SAGLAYICILAR: ["trendyol", "woocommerce"], adaptorCoz: () => ({ stokFiyatGonder: gonder }) }));
vi.mock("../core/kripto", () => ({ coz: () => "{}" }));

import { baglamlaCalistir } from "../core/istek-baglami";
import { kdvDahilFiyat } from "./eticaret-ortak";
import { PazaryeriService } from "./pazaryeri.service";

describe("stok/fiyat gönderimi KDV dahil fiyat", () => {
  it("kartın KDV hariç fiyatı kart oranıyla KDV dahile çevrilir; varyant fiyatı da", async () => {
    const tx = {
      baglanti: { findMany: vi.fn(async () => [{ id: "b1", saglayici: "trendyol", sifreliConfig: "x" }]) },
      stokKart: { findMany: vi.fn(async () => [
        { kod: "A", barkod: "1", satisFiyati: 100, kdvOrani: 20, mevcutMiktar: 5, rezerveMiktar: 1, varyantlar: [] },
        { kod: "B", barkod: "2", satisFiyati: 50, kdvOrani: 10, mevcutMiktar: 3, rezerveMiktar: 0, varyantlar: [{ kod: "B-K", barkod: "3", satisFiyati: 99.99, mevcutMiktar: 2, rezerveMiktar: 0 }] },
      ]) },
    };
    const servis = new PazaryeriService({ tenantIslem: (_t: string, fn: (x: unknown) => unknown) => fn(tx) } as never, {} as never);
    await baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "yonetici" } as never, () => servis.stokFiyatSenkronizeEt());
    expect(gonder.mock.calls[0][1]).toEqual([
      { sku: "A", barkod: "1", miktar: 4, fiyat: 120 },
      { sku: "B-K", barkod: "3", miktar: 2, fiyat: 109.99 },
    ]);
    expect(kdvDahilFiyat(100, 0)).toBe(100);
  });
});
