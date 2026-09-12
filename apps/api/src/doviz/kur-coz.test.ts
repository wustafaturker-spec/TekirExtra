import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { kurCoz } from "./kur-coz";

const g = (t: string) => new Date(`${t}T00:00:00.000Z`);

/** Yalnız `dovizKuru.findFirst` kullanılır; sorgu koşulları da doğrulanır. */
function sahteTx(kayit: { dovizSatis: Prisma.Decimal } | null) {
  const cagrilar: unknown[] = [];
  const tx = { dovizKuru: { findFirst: (arg: unknown) => { cagrilar.push(arg); return Promise.resolve(kayit); } } };
  return { tx: tx as unknown as Prisma.TransactionClient, cagrilar };
}

describe("kurCoz", () => {
  it("TRY için sorgu yapmadan 1 döner", async () => {
    const { tx, cagrilar } = sahteTx(null);
    expect((await kurCoz(tx, "t1", "TRY", g("2026-09-12")))?.toString()).toBe("1");
    expect(cagrilar).toHaveLength(0);
  });

  it("belge tarihindeki ya da en yakın önceki günün satış kurunu verir", async () => {
    const { tx, cagrilar } = sahteTx({ dovizSatis: new Prisma.Decimal("41.2536") });
    expect((await kurCoz(tx, "t1", "USD", g("2026-09-12")))?.toString()).toBe("41.2536");
    expect(cagrilar[0]).toMatchObject({
      where: { tenantId: "t1", dovizCinsi: "USD", tarih: { lte: g("2026-09-12") } },
      orderBy: { tarih: "desc" },
    });
  });

  it("kur kaydı yoksa null döner; çağıran 1 varsaymamalıdır", async () => {
    const { tx } = sahteTx(null);
    expect(await kurCoz(tx, "t1", "EUR", g("2026-09-12"))).toBeNull();
  });
});
