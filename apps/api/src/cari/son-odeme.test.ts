import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { gecersizOdemeler, sonTarihler, type OdemeHareketi } from "./son-odeme";

const h = (id: string, tip: "borc" | "alacak", tarih: string, kaynakTur: string, kaynakRef: string | null = null): OdemeHareketi =>
  ({ id, tip, tarih: new Date(tarih), kaynakTur, kaynakRef });

describe("son tahsilat / ödeme (CARI-34)", () => {
  it("çek, POS ve kredi kartı da sayılır; geri alınan ödeme ve ters kaydı sayılmaz", async () => {
    const hareketler = [
      h("pos", "alacak", "2026-09-10", "pos_tahsilat", "p1"),
      h("cek", "alacak", "2026-09-20", "cek_senet", "cs1"),
      h("cek-k", "alacak", "2026-09-25", "cek_senet", "cs2"), // karşılıksız çıktı
      h("kasa", "alacak", "2026-09-28", "kasa_banka", "kb1"), // ters kaydı kesildi
      h("kasa-ters", "borc", "2026-09-29", "kasa_banka", "kb1-ters"),
      h("kart", "borc", "2026-09-15", "kredi_karti", "kk1"),
      h("kart2", "borc", "2026-09-26", "kredi_karti", "kk2"), // geri alındı
      h("kart2-ters", "alacak", "2026-09-27", "kredi_karti", "kk2-ters"),
    ];
    const tx = {
      kasaBankaHareket: {
        findMany: async ({ where }: { where: { id?: { in: string[] }; kaynakRef?: { in: string[] } } }) =>
          where.id ? where.id.in.filter((id) => id === "kb1-ters").map((id) => ({ id })) : where.kaynakRef!.in.filter((r) => r === "kb1").map((r) => ({ kaynakRef: r })),
      },
      krediKartiHareket: {
        findMany: async ({ where }: { where: { id?: { in: string[] }; geriAlinanHareketId?: { in: string[] } } }) =>
          where.id ? where.id.in.filter((id) => id === "kk2-ters").map((id) => ({ id })) : where.geriAlinanHareketId!.in.filter((r) => r === "kk2").map((r) => ({ geriAlinanHareketId: r })),
      },
      cariHareket: { findMany: async () => [{ kaynakRef: "cs2" }] },
    } as unknown as Prisma.TransactionClient;

    const gecersiz = await gecersizOdemeler(tx, "m", hareketler);
    expect([...gecersiz].sort()).toEqual(["cek-k", "kart2", "kart2-ters", "kasa", "kasa-ters"]);
    const { sonTahsilat, sonOdeme } = sonTarihler(hareketler, gecersiz);
    expect(sonTahsilat?.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(sonOdeme?.toISOString().slice(0, 10)).toBe("2026-09-15");
  });

  it("ödeme yoksa boş döner", () => {
    expect(sonTarihler([], new Set())).toEqual({ sonTahsilat: null, sonOdeme: null });
  });
});
