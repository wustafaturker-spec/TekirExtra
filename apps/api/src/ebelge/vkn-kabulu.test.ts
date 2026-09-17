import { describe, expect, it, vi } from "vitest";
import { ebelgeTestOrtamiMi, vknTcknKabulEdilebilirMi } from "./vkn-kabulu";
import { sifrele } from "../core/kripto";

process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "0".repeat(64);

// 5555554436: GİB test mükellefi — kontrol hanesi tutmaz.
const SENTETIK_VKN = "5555554436";
const GERCEK_VKN = "1230460944";

describe("vknTcknKabulEdilebilirMi (EBLG-47)", () => {
  it("kontrol hanesi tutan kimliği her ortamda kabul eder", () => {
    expect(vknTcknKabulEdilebilirMi(GERCEK_VKN, false)).toBe(true);
    expect(vknTcknKabulEdilebilirMi(GERCEK_VKN, true)).toBe(true);
  });

  it("sentetik kimliği yalnız test ortamında kabul eder", () => {
    expect(vknTcknKabulEdilebilirMi(SENTETIK_VKN, false)).toBe(false);
    expect(vknTcknKabulEdilebilirMi(SENTETIK_VKN, true)).toBe(true);
  });

  it("hane sayısını test ortamında da arar", () => {
    for (const bozuk of ["", "123", "123456789", "123456789012", "12345678a0"]) {
      expect(vknTcknKabulEdilebilirMi(bozuk, true)).toBe(false);
    }
  });

  it("kimliği olmayanı kabul etmez", () => {
    expect(vknTcknKabulEdilebilirMi(null, true)).toBe(false);
    expect(vknTcknKabulEdilebilirMi(undefined, true)).toBe(false);
  });
});

describe("ebelgeTestOrtamiMi (EBLG-47)", () => {
  const tx = (baglanti: { sifreliConfig: string } | null) => ({ baglanti: { findFirst: vi.fn().mockResolvedValue(baglanti) } });

  it("aktif e-belge bağlantısı yoksa hayır der", async () => {
    await expect(ebelgeTestOrtamiMi(tx(null), "t1")).resolves.toBe(false);
  });

  it("bağlantının test bayrağını okur", async () => {
    await expect(ebelgeTestOrtamiMi(tx({ sifreliConfig: sifrele(JSON.stringify({ testOrtami: true })) }), "t1")).resolves.toBe(true);
    await expect(ebelgeTestOrtamiMi(tx({ sifreliConfig: sifrele(JSON.stringify({ testOrtami: false })) }), "t1")).resolves.toBe(false);
  });

  it("yalnız kiracının aktif e-belge bağlantısına bakar", async () => {
    const istemci = tx(null);
    await ebelgeTestOrtamiMi(istemci, "t1");
    expect(istemci.baglanti.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "t1", aile: "ebelge", durum: "aktif" },
    }));
  });

  it("çözülemeyen yapılandırmayı test ortamı saymaz", async () => {
    await expect(ebelgeTestOrtamiMi(tx({ sifreliConfig: sifrele("düz metin") }), "t1")).resolves.toBe(false);
  });
});
