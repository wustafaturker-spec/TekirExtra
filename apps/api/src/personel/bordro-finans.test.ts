import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { bordroGideri } from "../rapor/tahakkuk";
import { bordroYasalTutarlari, bordroYasalVade } from "../nakit-akisi/nakit-akisi.hesap";
import { PersonelService } from "./personel.service";

const D = (v: string | number) => new Prisma.Decimal(v);

describe("bordronun finansa yansıması (PRS-05)", () => {
  it("personel gideri mevzuatlıda işveren maliyeti, net ücretlide kazanç toplamı; avans mahsubu gideri düşürmez", () => {
    expect(bordroGideri({ isverenMaliyeti: "48250.40" }, [])).toBe(48250.4);
    expect(bordroGideri(null, [{ tip: "kazanc", tutar: "30000" }, { tip: "kazanc", tutar: "2500" }, { tip: "kesinti", tutar: "5000" }])).toBe(32500);
  });

  it("SGK ve muhtasar ertesi ayın 26'sında, hafta sonunda pazartesiye kayar", () => {
    expect(bordroYasalVade(2026, 9)).toBe("2026-10-26"); // pazartesi
    expect(bordroYasalVade(2026, 8)).toBe("2026-09-28"); // 26 Eylül cumartesi
    expect(bordroYasalVade(2026, 12)).toBe("2027-01-26");
  });

  it("SGK = işçi + işsizlik işçi + işveren (teşvik sonrası) + işsizlik işveren; muhtasar = gelir + damga", () => {
    expect(bordroYasalTutarlari({ sgkIsci: "4200", issizlikIsci: "300", isverenSgkNet: "5550", isverenIssizlik: "600", gelirVergisi: "3100.25", damgaVergisi: "120.10" })).toEqual({ sgk: 10650, vergi: 3220.35 });
    expect(bordroYasalTutarlari(null)).toBeNull();
    expect(bordroYasalTutarlari({ netUcret: "1" })).toBeNull();
  });

  it("onayda cari tahakkuku dönem sonu tarihlidir; dönem kapalıysa onay reddedilir", async () => {
    const tx = {
      personelBordro: {
        findFirst: vi.fn(async () => ({ id: "b1", durum: "onay_bekliyor", olusturanUserId: "h", donemYil: 2026, donemAy: 9, odenecekTutar: D(30000), kalemler: [], odemeler: [], personel: { id: "p1", cariId: "c1" } })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      cariHareket: { create: vi.fn(async () => ({})) },
    };
    const kilit = { tarihDogrula: vi.fn(async () => undefined) };
    const s = new PersonelService({ tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx) } as never, kilit as never);
    await s.bordroOnayla("t1", "b1", "o");
    expect(kilit.tarihDogrula).toHaveBeenCalledWith("t1", new Date("2026-09-30T00:00:00Z"), "bordro onayı");
    expect(tx.cariHareket.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tarih: new Date("2026-09-30T00:00:00Z") }) });
    kilit.tarihDogrula.mockRejectedValueOnce(new Error("Eylül 2026 dönemi kapalı"));
    await expect(s.bordroOnayla("t1", "b1", "o")).rejects.toThrow("kapalı");
  });
});
