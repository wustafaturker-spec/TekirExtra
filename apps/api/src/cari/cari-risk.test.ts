import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { cariRiskleri, dovizBazliYaslandir, riskOzetiGorunumu, vadesiGecmis } from "./cari-risk";
import type { GuncelKurlar } from "./doviz-degerleme";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

type Hareket = { cariId: string; tip: "borc" | "alacak"; tutarTry: number; dovizCinsi?: string; tutar?: number };
type Cek = { cariId: string; yon: string; durum: string; vadeTarihi: string; tutarTry: number; dovizCinsi?: string; tutar?: number };

/** Sahte işlem: gruplamayı ve çek süzgecini bellekteki kayıtlara uygular; TCMB kurları `kurlar`dan gelir. */
type Teminat = { cariId: string; durum?: string; tutar: number; dovizCinsi?: string; baslangicTarihi?: string | null; bitisTarihi?: string | null };

function sahteTx(hareketler: Hareket[], cekler: Cek[], kurlar: Record<string, { alis: number; satis: number }> = {}, teminatlar: Teminat[] = []) {
  const topla = <T extends { tutarTry: number; dovizCinsi?: string; tutar?: number }>(kayitlar: T[], anahtar: (k: T) => Record<string, string>) => {
    const g = new Map<string, Record<string, unknown> & { _sum: { tutar: Prisma.Decimal; tutarTry: Prisma.Decimal } }>();
    for (const k of kayitlar) {
      const alanlar = { ...anahtar(k), dovizCinsi: k.dovizCinsi ?? "TRY" };
      const id = JSON.stringify(alanlar);
      const v = g.get(id) ?? { ...alanlar, _sum: { tutar: D(0), tutarTry: D(0) } };
      v._sum.tutar = v._sum.tutar.add(k.tutar ?? k.tutarTry);
      v._sum.tutarTry = v._sum.tutarTry.add(k.tutarTry);
      g.set(id, v);
    }
    return [...g.values()];
  };
  return {
    cariHareket: { groupBy: async () => topla(hareketler, (h) => ({ cariId: h.cariId, tip: h.tip })) },
    cekSenet: {
      groupBy: async ({ where }: { where: { yon: string; OR: Array<{ durum: string | { in: string[] }; vadeTarihi?: { gte: Date } }> } }) => {
        const uygun = cekler.filter((c) => c.yon === where.yon && where.OR.some((k) =>
          (typeof k.durum === "string" ? c.durum === k.durum : k.durum.in.includes(c.durum)) && (!k.vadeTarihi || new Date(c.vadeTarihi) >= k.vadeTarihi.gte)));
        return topla(uygun, (c) => ({ cariId: c.cariId }));
      },
    },
    elleKur: { findMany: async () => [] },
    cariTeminat: {
      findMany: async () => teminatlar.map((t) => ({
        cariId: t.cariId, durum: t.durum ?? "aktif", tutar: D(t.tutar), dovizCinsi: t.dovizCinsi ?? "TRY",
        baslangicTarihi: t.baslangicTarihi ? new Date(t.baslangicTarihi) : null, bitisTarihi: t.bitisTarihi ? new Date(t.bitisTarihi) : null,
      })),
    },
    tcmbKuru: {
      findMany: async () => Object.entries(kurlar).map(([dovizCinsi, k]) => ({
        dovizCinsi, tarih: new Date("2026-10-02"), dovizAlis: D(k.alis), dovizSatis: D(k.satis), kaynak: "TCMB_XML", alindiAt: new Date("2026-10-02"),
      })),
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
    const r = (await cariRiskleri(tx, "t1", ["m"], new Date("2026-10-03T10:00:00Z"))).get("m")!;
    expect(r.bakiyeTry.toFixed(2)).toBe("600.00");
    expect(r.cekSenetRiski.toFixed(2)).toBe("650.00");
    expect(r.mevcutRisk.toFixed(2)).toBe("1250.00");
    expect(riskOzetiGorunumu(r, D(1000))).toMatchObject({ kalanLimit: "-250.00", asim: true });
  });

  it("alacaklı cari bakiyesi riski eksiltmez, yalnız çek riski kalır", async () => {
    const tx = sahteTx([{ cariId: "m", tip: "alacak", tutarTry: 500 }], [{ cariId: "m", yon: "alinan", durum: "portfoyde", vadeTarihi: "2026-11-01", tutarTry: 100 }]);
    const r = (await cariRiskleri(tx, "t1", ["m"], new Date("2026-10-03"))).get("m")!;
    expect(r.mevcutRisk.toFixed(2)).toBe("100.00");
    expect(riskOzetiGorunumu(r, null)).toMatchObject({ limit: null, kalanLimit: null, asim: false });
  });
});

describe("güncel kurla değerleme (CARI-33)", () => {
  it("dövizli bakiye ve dövizli çek güncel satış kuruyla TL'ye çevrilir; tarihî TL ayrı kalır", async () => {
    const tx = sahteTx(
      [
        { cariId: "m", tip: "borc", dovizCinsi: "USD", tutar: 1000, tutarTry: 35000 }, // kesildiğinde kur 35
        { cariId: "m", tip: "alacak", dovizCinsi: "USD", tutar: 400, tutarTry: 14400 }, // tahsilde kur 36
        { cariId: "m", tip: "alacak", tutarTry: 5000 }, // TL tahsilat
      ],
      [{ cariId: "m", yon: "alinan", durum: "portfoyde", vadeTarihi: "2026-11-01", dovizCinsi: "EUR", tutar: 100, tutarTry: 4500 }],
      { USD: { alis: 41, satis: 41.5 }, EUR: { alis: 48, satis: 48.5 } },
    );
    const r = (await cariRiskleri(tx, "t1", ["m"], new Date("2026-10-03"))).get("m")!;
    expect(r.bakiyeTry.toFixed(2)).toBe("19900.00"); // 600 × 41,5 − 5000
    expect(r.tarihiBakiyeTry.toFixed(2)).toBe("15600.00");
    expect(r.cekSenetRiski.toFixed(2)).toBe("4850.00"); // 100 × 48,5
    expect(r.mevcutRisk.toFixed(2)).toBe("24750.00");
    expect(r.kurEksik).toEqual([]);
  });

  it("güncel kuru olmayan dövizde tarihî TL kullanılır ve döviz işaretlenir", async () => {
    const tx = sahteTx([{ cariId: "m", tip: "borc", dovizCinsi: "GBP", tutar: 100, tutarTry: 5000 }], []);
    const r = (await cariRiskleri(tx, "t1", ["m"], new Date("2026-10-03"))).get("m")!;
    expect(r.bakiyeTry.toFixed(2)).toBe("5000.00");
    expect(r.kurEksik).toEqual(["GBP"]);
    expect(riskOzetiGorunumu(r, null).kurEksik).toEqual(["GBP"]);
  });
});

describe("teminat (CARI-39)", () => {
  it("geçerli teminat güncel kurla limite eklenir; başlamamış ve süresi dolmuş sayılmaz", async () => {
    const tx = sahteTx(
      [{ cariId: "m", tip: "borc", tutarTry: 1500 }],
      [],
      { USD: { alis: 41, satis: 41.5 } },
      [
        { cariId: "m", tutar: 300 },
        { cariId: "m", tutar: 10, dovizCinsi: "USD", bitisTarihi: "2026-10-03" }, // bugün son gün: geçerli
        { cariId: "m", tutar: 999, baslangicTarihi: "2026-11-01" },
        { cariId: "m", tutar: 999, bitisTarihi: "2026-10-02" },
      ],
    );
    const r = (await cariRiskleri(tx, "t1", ["m"], new Date("2026-10-03T10:00:00Z"))).get("m")!;
    expect(r.teminatTry.toFixed(2)).toBe("715.00");
    expect(riskOzetiGorunumu(r, D(1000))).toMatchObject({ limit: "1000.00", teminat: "715.00", kullanilabilirLimit: "1715.00", kalanLimit: "215.00", asim: false });
    // Limit tanımlı değilse teminat tek başına denetim başlatmaz.
    expect(riskOzetiGorunumu(r, null)).toMatchObject({ kullanilabilirLimit: null, kalanLimit: null, asim: false });
  });
});

describe("döviz bazlı iki yönlü yaşlandırma (CARI-33)", () => {
  const bugun = new Date("2026-10-03");
  const kurlar: GuncelKurlar = new Map([["USD", { alis: D(41), satis: D(41.5), kurTarihi: bugun, kaynak: "TCMB_XML", alindiAt: bugun }]]);
  const h = (tip: "borc" | "alacak", dovizCinsi: string, tutar: number, tutarTry: number, vade: string) =>
    ({ cariId: "m", tip, dovizCinsi, tutar: D(tutar), tutarTry: D(tutarTry), vadeTarihi: new Date(vade), tarih: new Date(vade) });

  it("dövizler birbirini kapatmaz; TL kovaları güncel kurla", () => {
    const y = dovizBazliYaslandir([
      h("borc", "USD", 1000, 35000, "2026-08-01"), // 63 gün gecikmiş
      h("borc", "USD", 500, 20000, "2026-10-20"), // vadesi gelmemiş
      h("alacak", "USD", 300, 12000, "2026-09-01"), // en eski USD borcundan düşer
      h("alacak", "TRY", 50000, 50000, "2026-09-15"), // USD borcunu kapatmaz
    ], kurlar, bugun, "alacaklarimiz");
    expect(y.dovizler).toEqual([expect.objectContaining({ dovizCinsi: "USD", kur: 41.5, gun61_90: 700, guncel: 500, toplam: 1200 })]);
    expect(y.gun61_90).toBe(29050);
    expect(y.guncel).toBe(20750);
    expect(y.toplam).toBe(49800);
    expect(vadesiGecmis(y)).toBe(29050);
  });

  it("borçlarımız yönünde tedarikçiye açık alacak kayıtları yaşlanır, ödemeler en eskiyi kapatır", () => {
    const hareketler = [
      h("alacak", "TRY", 1000, 1000, "2026-09-20"), // 13 gün gecikmiş
      h("alacak", "TRY", 2000, 2000, "2026-06-01"), // 124 gün gecikmiş
      h("borc", "TRY", 1500, 1500, "2026-07-01"), // ödeme
    ];
    const borclar = dovizBazliYaslandir(hareketler, kurlar, bugun, "borclarimiz");
    expect(borclar).toMatchObject({ gun0_30: 1000, gun90Ustu: 500, toplam: 1500 });
    expect(dovizBazliYaslandir(hareketler, kurlar, bugun, "alacaklarimiz").toplam).toBe(0);
  });

  it("güncel kuru olmayan dövizde ortalama tarihî kur kullanılır", () => {
    const y = dovizBazliYaslandir([h("borc", "GBP", 100, 5000, "2026-10-20")], kurlar, bugun, "alacaklarimiz");
    expect(y.kurEksik).toEqual(["GBP"]);
    expect(y.dovizler[0]).toMatchObject({ kur: 50, kurEksik: true });
    expect(y.toplam).toBe(5000);
  });
});
