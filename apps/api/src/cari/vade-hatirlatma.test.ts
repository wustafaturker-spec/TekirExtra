import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { hatirlatmaIletisi, siklikEngeli, vadesiGecmisKalemler, type VadesiGecmisKalem } from "./vade-hatirlatma";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const bugun = new Date("2026-10-04T09:00:00Z");

describe("vadesi geçmiş kalemler (CARI-38)", () => {
  it("döviz başına FIFO; vadesi gelmemiş ve iptal edilmiş fatura listeye girmez; fatura numarası eklenir", async () => {
    const h = (tip: "borc" | "alacak", dovizCinsi: string, tutar: number, vade: string, kaynakRef: string | null, kaynakTur = "fatura") =>
      ({ cariId: "m", tip, dovizCinsi, tutar: D(tutar), vadeTarihi: new Date(vade), tarih: new Date(vade), aciklama: null, kaynakTur, kaynakRef });
    const tx = {
      cariHareket: {
        findMany: async () => [
          h("borc", "TRY", 1000, "2026-08-01", "f1"),
          h("borc", "TRY", 2000, "2026-09-01", "f2"),
          h("alacak", "TRY", 1500, "2026-09-10", null, "kasa_banka"), // f1'i kapatır, f2'den 500 düşer
          h("borc", "TRY", 700, "2026-10-20", "f3"), // vadesi gelmedi
          h("borc", "USD", 300, "2026-09-15", "f4"),
          h("borc", "TRY", 999, "2026-07-01", "f5"), // iptal edildi
          h("alacak", "TRY", 999, "2026-07-02", "f5"),
        ],
      },
      fatura: {
        findMany: async ({ where }: { where: { id: { in: string[] }; durum?: string } }) =>
          where.durum === "iptal" ? where.id.in.filter((id) => id === "f5").map((id) => ({ id })) : where.id.in.map((id) => ({ id, no: `NO-${id}` })),
      },
    } as unknown as Prisma.TransactionClient;
    const liste = (await vadesiGecmisKalemler(tx, ["m"], bugun)).get("m")!;
    expect(liste.map((k) => [k.belgeNo, k.dovizCinsi, k.acik, k.gecikmeGun])).toEqual([
      ["NO-f2", "TRY", 1500, 33],
      ["NO-f4", "USD", 300, 19],
    ]);
  });
});

describe("hatırlatma iletisi (CARI-38)", () => {
  const kalemler: VadesiGecmisKalem[] = [
    { belgeNo: "K07-1", aciklama: null, tarih: new Date("2026-08-01"), vade: new Date("2026-08-31"), gecikmeGun: 34, dovizCinsi: "TRY", acik: 1500 },
    { belgeNo: null, aciklama: "Açılış bakiyesi", tarih: new Date("2026-09-01"), vade: new Date("2026-09-15"), gecikmeGun: 19, dovizCinsi: "USD", acik: 300 },
  ];

  it("alanları doldurur, fatura tablosunu yerine koyar, dövizleri ayrı toplar", () => {
    const i = hatirlatmaIletisi({ konu: "Hatırlatma — {firma}", metin: "Sayın {unvan},\n\n{enEskiVade} vadeli {toplam} ({faturaSayisi} kalem).\n\n{faturalar}\n\n{firma}" }, { unvan: "ABC Ltd", firma: "Tekir", kalemler });
    expect(i.konu).toBe("Hatırlatma — Tekir");
    expect(i.toplam).toBe("1.500,00 TL + 300,00 USD");
    expect(i.metin).toContain("31.08.2026 vadeli 1.500,00 TL + 300,00 USD (2 kalem).");
    expect(i.metin).toContain("- K07-1 · tarih 01.08.2026 · vade 31.08.2026 · 34 gün gecikmiş · 1.500,00 TL");
    expect(i.metin).toContain("- Açılış bakiyesi");
    expect(i.html).toContain("<table");
    expect(i.html.indexOf("<table")).toBeLessThan(i.html.indexOf("Tekir</p>"));
  });

  it("şablonda {faturalar} yoksa tablo sona eklenir; not tablodan sonra gelir; HTML kaçışlanır", () => {
    const i = hatirlatmaIletisi({ konu: "K", metin: "Sayın {unvan} <b>dikkat</b>" }, { unvan: "A & B <Ltd>", firma: "F", kalemler, not: "Lütfen <ödeyin>" });
    expect(i.html).toContain("A &amp; B &lt;Ltd&gt; &lt;b&gt;dikkat&lt;/b&gt;");
    expect(i.html).toContain("Lütfen &lt;ödeyin&gt;");
    expect(i.metin.endsWith("Not: Lütfen <ödeyin>")).toBe(true);
  });
});

describe("sıklık sınırı (CARI-38)", () => {
  it("son 7 günde gönderilmişse engeller", () => {
    expect(siklikEngeli(undefined, bugun)).toBe(false);
    expect(siklikEngeli(new Date("2026-09-28T10:00:00Z"), bugun)).toBe(true);
    expect(siklikEngeli(new Date("2026-09-27T08:00:00Z"), bugun)).toBe(false);
  });
});
