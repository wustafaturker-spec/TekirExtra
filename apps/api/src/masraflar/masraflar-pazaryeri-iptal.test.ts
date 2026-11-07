import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { baglamlaCalistir } from "../core/istek-baglami";
import { MasraflarService } from "./masraflar.service";

describe("PZR-10 pazaryeri kesintisinden doğan masrafın iptali", () => {
  const kur = (kaynakTur: string) => {
    const kesintiGeri = vi.fn().mockResolvedValue({ count: 1 });
    const cariHareket = vi.fn();
    const tx = {
      masraf: {
        findUnique: vi.fn().mockResolvedValue({ id: "m1", durum: "onaylandi", odemeDurumu: "odenmedi", cariId: "c", toplam: new Prisma.Decimal(40), stopajTutari: null, dovizCinsi: "TRY", kur: new Prisma.Decimal(1), kaynakTur, belgeNo: "AMZ-9", saticiUnvan: "AMAZON", cari: { id: "c", unvan: "AMAZON" }, kategori: { ad: "Ceza" } }),
        update: vi.fn().mockResolvedValue({ id: "m1", durum: "iptal" }),
      },
      maliyetDagitimi: { count: vi.fn().mockResolvedValue(0) },
      cariHareket: { create: cariHareket },
      pazaryeriKesinti: { updateMany: kesintiGeri },
    };
    const servis = new MasraflarService({ tenantIslem: vi.fn((_t, fn) => fn(tx)) } as never, {} as never, {} as never);
    return { servis, kesintiGeri, cariHareket };
  };

  it("kesinti faturasıza döner; cariye ters hareket yazılır", async () => {
    const { servis, kesintiGeri, cariHareket } = kur("pazaryeri_kesinti");
    await baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, () => servis.iptal("m1"));
    expect(kesintiGeri).toHaveBeenCalledWith({ where: { masrafId: "m1", durum: "masrafa_donustu" }, data: { durum: "faturasiz", masrafId: null } });
    expect(cariHareket).toHaveBeenCalledWith({ data: expect.objectContaining({ tip: "borc", kaynakRef: "m1" }) });
  });

  it("elle girilmiş masrafta kesinti tablosuna dokunulmaz", async () => {
    const { servis, kesintiGeri } = kur("manuel");
    await baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, () => servis.iptal("m1"));
    expect(kesintiGeri).not.toHaveBeenCalled();
  });
});
