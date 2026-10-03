import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { cariRiskleri, riskOzetiGorunumu } from "./cari-risk";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Sahte işlem: çek süzgecini bellekteki kayıtlara uygular. */
function sahteTx(hareketler: Array<{ cariId: string; tip: "borc" | "alacak"; tutarTry: number }>, cekler: Array<{ cariId: string; yon: string; durum: string; vadeTarihi: string; tutarTry: number }>) {
  return {
    cariHareket: {
      groupBy: async () => {
        const g = new Map<string, { cariId: string; tip: string; _sum: { tutarTry: Prisma.Decimal } }>();
        for (const h of hareketler) {
          const k = `${h.cariId}:${h.tip}`;
          const v = g.get(k) ?? { cariId: h.cariId, tip: h.tip, _sum: { tutarTry: D(0) } };
          v._sum.tutarTry = v._sum.tutarTry.add(h.tutarTry);
          g.set(k, v);
        }
        return [...g.values()];
      },
    },
    cekSenet: {
      groupBy: async ({ where }: { where: { yon: string; OR: Array<{ durum: string | { in: string[] }; vadeTarihi?: { gte: Date } }> } }) => {
        const uygun = cekler.filter((c) => c.yon === where.yon && where.OR.some((k) =>
          (typeof k.durum === "string" ? c.durum === k.durum : k.durum.in.includes(c.durum)) && (!k.vadeTarihi || new Date(c.vadeTarihi) >= k.vadeTarihi.gte)));
        const g = new Map<string, Prisma.Decimal>();
        for (const c of uygun) g.set(c.cariId, (g.get(c.cariId) ?? D(0)).add(c.tutarTry));
        return [...g].map(([cariId, t]) => ({ cariId, _sum: { tutarTry: t } }));
      },
    },
  } as unknown as Prisma.TransactionClient;
}

describe("cari riski (CARI-30)", () => {
  it("bankadaki çek risktir; cirolu çek vadeden 30 gün sonra, tahsil edilen hiç sayılmaz", async () => {
    const tx = sahteTx(
      [{ cariId: "m", tip: "borc", tutarTry: 1000 }, { cariId: "m", tip: "alacak", tutarTry: 400 }],
      [
        { cariId: "m", yon: "alinan", durum: "portfoyde", vadeTarihi: "2026-11-01", tutarTry: 100 },
        { cariId: "m", yon: "alinan", durum: "tahsile_verildi", vadeTarihi: "2026-10-10", tutarTry: 200 },
        { cariId: "m", yon: "alinan", durum: "teminata_verildi", vadeTarihi: "2026-12-01", tutarTry: 300 },
        { cariId: "m", yon: "alinan", durum: "ciro_edildi", vadeTarihi: "2026-09-10", tutarTry: 50 }, // 23 gün önce: hâlâ risk
        { cariId: "m", yon: "alinan", durum: "ciro_edildi", vadeTarihi: "2026-08-01", tutarTry: 70 }, // 63 gün önce: düştü
        { cariId: "m", yon: "alinan", durum: "tahsil_edildi", vadeTarihi: "2026-09-01", tutarTry: 999 },
        { cariId: "m", yon: "verilen", durum: "portfoyde", vadeTarihi: "2026-11-01", tutarTry: 999 },
      ],
    );
    const r = (await cariRiskleri(tx, ["m"], new Date("2026-10-03T10:00:00Z"))).get("m")!;
    expect(r.bakiyeTry.toFixed(2)).toBe("600.00");
    expect(r.cekSenetRiski.toFixed(2)).toBe("650.00");
    expect(r.mevcutRisk.toFixed(2)).toBe("1250.00");
    expect(riskOzetiGorunumu(r, D(1000))).toMatchObject({ kalanLimit: "-250.00", asim: true });
  });

  it("alacaklı cari bakiyesi riski eksiltmez, yalnız çek riski kalır", async () => {
    const tx = sahteTx([{ cariId: "m", tip: "alacak", tutarTry: 500 }], [{ cariId: "m", yon: "alinan", durum: "portfoyde", vadeTarihi: "2026-11-01", tutarTry: 100 }]);
    const r = (await cariRiskleri(tx, ["m"], new Date("2026-10-03"))).get("m")!;
    expect(r.mevcutRisk.toFixed(2)).toBe("100.00");
    expect(riskOzetiGorunumu(r, null)).toMatchObject({ limit: null, kalanLimit: null, asim: false });
  });
});
