import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { bankaOnerisiHesapla } from "./banka-oneri-girdisi";

const D = (x: string | number) => new Prisma.Decimal(x);
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const TENANT = "11111111-1111-1111-1111-111111111111";

/** 757 aktif cari (demo firmadaki sayı); aranan cari listenin sonunda. */
function sahteTx(g: { ekIban?: { cariId: string; iban: string }[]; faturalar?: any[]; cariler?: any[] } = {}) {
  const cariler = g.cariler ?? Array.from({ length: 757 }, (_, i) => ({ id: uuid(i + 1), kod: `C${i + 1}`, unvan: `Firma ${i + 1} Ticaret`, vknTckn: String(1000000000 + i), iban: null, tip: "musteri" }));
  const faturaFindMany = vi.fn(async (a: any) => {
    const ors: any[] = a.where.OR ?? [];
    return (g.faturalar ?? []).filter((f) => ors.some((o) => (o.cariId?.in?.includes(f.cariId)) || (o.genelToplam && D(o.genelToplam).equals(f.genelToplam)) || o.no?.in?.includes(f.no) || o.id?.in?.includes(f.id)));
  });
  const tx = {
    cariHesap: { findMany: vi.fn(async () => cariler) },
    cariBankaHesap: { findMany: vi.fn(async (a: any) => (g.ekIban ?? []).filter((h) => h.iban === a.where.iban)) },
    bankaEkstreSatir: { findMany: vi.fn(async () => []), update: vi.fn() },
    fatura: { findMany: faturaFindMany },
  };
  return { tx, faturaFindMany };
}
const satir = (ek: Partial<{ aciklama: string; karsiIban: string | null; karsiUnvan: string | null; tutar: Prisma.Decimal }> = {}) => ({
  id: "s1", tarih: new Date("2026-11-10"), tutar: D("1500.00"), aciklama: "HAVALE", karsiIban: null, karsiUnvan: null, dekontNo: null, bankaHesapId: "b1", ...ek,
});
const fatura = (cariId: string, genelToplam: string, no = "SF2026000000001") => ({
  id: uuid(9000), no, cariId, tarih: new Date("2026-10-01"), vadeTarihi: null, dovizCinsi: "TRY", genelToplam: D(genelToplam), durum: "kesin", kapamalar: [], iadeKapamalari: [],
});

describe("AI-119 banka önerisi girdisi", () => {
  it("757 carili firmada listenin sonundaki cari ek banka hesabındaki IBAN'la bulunur", async () => {
    const son = uuid(757);
    const { tx } = sahteTx({ ekIban: [{ cariId: son, iban: "TR330006100519786457841326" }] });
    const r = await bankaOnerisiHesapla(tx as never, TENANT, satir({ karsiIban: "TR33 0006 1005 1978 6457 8413 26" }), "TRY");
    expect(r.onerilenCari?.id).toBe(son);
    expect(r.sinyaller.map((s) => s.tur)).toContain("iban");
    expect(r).not.toHaveProperty("adayCariIdleri");
  });

  it("VKN ve unvanla son cari bulunur; ikinci aşamada yalnız aday carilerin açık faturaları okunur ve tutar sinyali eklenir", async () => {
    const son = uuid(757);
    const { tx, faturaFindMany } = sahteTx({ faturalar: [fatura(son, "1500.00")] });
    const r = await bankaOnerisiHesapla(tx as never, TENANT, satir({ aciklama: "FIRMA 757 TICARET 1000000756 FATURA ODEMESI" }), "TRY");
    expect(r.onerilenCari?.id).toBe(son);
    expect(r.sinyaller.map((s) => s.tur)).toEqual(expect.arrayContaining(["vkn_tckn", "tutar"]));
    const ikinci = faturaFindMany.mock.calls.at(-1)![0];
    expect(ikinci.where.OR[0]).toEqual({ cariId: { in: expect.arrayContaining([son]) } });
    expect(ikinci.where).toMatchObject({ durum: "kesin", dovizCinsi: "TRY", tip: { in: ["satis", "alis_iade"] } });
  });

  it("ödenmiş fatura açık sayılmaz", async () => {
    const son = uuid(757);
    const odenmis = { ...fatura(son, "1500.00"), kapamalar: [{ tutar: D("1500.00") }] };
    const { tx } = sahteTx({ faturalar: [odenmis] });
    const r = await bankaOnerisiHesapla(tx as never, TENANT, satir({ aciklama: "1000000756" }), "TRY");
    expect(r.sinyaller.map((s) => s.tur)).not.toContain("tutar");
  });

  it("satıra yazmaz", async () => {
    const { tx } = sahteTx();
    await bankaOnerisiHesapla(tx as never, TENANT, satir({ aciklama: "1000000001" }), "TRY");
    expect(tx.bankaEkstreSatir.update).not.toHaveBeenCalled();
  });

  it("aynı unvanlı iki cari yakın aday olur: belirsiz, alternatiflerle", async () => {
    const cariler = [
      { id: uuid(1), kod: "C1", unvan: "Deneme Otomotiv Ltd", vknTckn: null, iban: null, tip: "musteri" },
      { id: uuid(2), kod: "C2", unvan: "Deneme Otomotiv Ltd", vknTckn: null, iban: null, tip: "musteri" },
    ];
    const { tx } = sahteTx({ cariler });
    const r = await bankaOnerisiHesapla(tx as never, TENANT, satir({ karsiUnvan: "DENEME OTOMOTIV LTD" }), "TRY");
    expect(r.oneriTuru).toBe("belirsiz");
    expect(r.alternatifAdaylar).toHaveLength(2);
  });
});
