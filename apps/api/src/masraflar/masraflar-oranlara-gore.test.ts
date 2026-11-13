import { describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../core/istek-baglami";
import { MasraflarService } from "./masraflar.service";
import { oranlaraGoreMasrafSemasi } from "./masraflar.semalar";

const KAT = "00000000-0000-4000-8000-00000000000a";
const OCR = "00000000-0000-4000-8000-00000000000b";

function kur() {
  let n = 0;
  const tx = {
    masrafKategori: { findUnique: vi.fn(async () => ({ id: KAT })) },
    cariHesap: { findUnique: vi.fn(async () => null) },
    masraf: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `m${++n}`, ...data })), count: vi.fn(async () => 2) },
    belgeOcrKaydi: { findUnique: vi.fn(async () => ({ olusanKayitlar: null })), update: vi.fn(async () => ({})) },
  };
  const donemKilidi = { tarihDogrula: vi.fn(async () => undefined) };
  const mevzuat = { kdvOranlariniDogrula: vi.fn(async () => undefined) };
  const servis = new MasraflarService({ tenantIslem: vi.fn((_t: string, fn: (x: unknown) => unknown) => fn(tx)) } as never, donemKilidi as never, {} as never, mevzuat as never);
  return { servis, tx, mevzuat };
}
const calistir = <T>(fn: () => Promise<T>) => baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" } as never, fn);

const ortak = { kategoriId: KAT, belgeTuru: "fis", belgeNo: "F-12", tarih: "2026-11-10", saticiUnvan: "Market", aciklama: "Mutfak", dovizCinsi: "TRY", kur: 1 };

describe("oran başına masraf taslağı (AI-13)", () => {
  it("her oran ayrı taslak; ortak alanlar aynı, tarama kaydı bağlanır", async () => {
    const { servis, tx, mevzuat } = kur();
    const g = oranlaraGoreMasrafSemasi.parse({ ortak, ocrKayitId: OCR, oranlar: [{ kdvOrani: 10, matrah: 300, kdvTutari: 30 }, { kdvOrani: 20, matrah: 700, kdvTutari: 140 }] });
    const r = await calistir(() => servis.oranlaraGoreOlustur(g));
    expect(r).toHaveLength(2);
    const veriler = tx.masraf.create.mock.calls.map((c) => (c as unknown as [{ data: Record<string, { toString(): string } | string> }])[0].data);
    expect(veriler.map((v) => [String(v.kdvOrani), String(v.matrah), String(v.toplam), v.belgeNo, v.saticiUnvan, v.aciklama])).toEqual([
      ["10", "300", "330", "F-12", "Market", "Mutfak · KDV %10 kısmı"],
      ["20", "700", "840", "F-12", "Market", "Mutfak · KDV %20 kısmı"],
    ]);
    expect(mevzuat.kdvOranlariniDogrula).toHaveBeenCalledWith([10, 20], expect.any(Date));
    expect(tx.belgeOcrKaydi.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: OCR }, data: expect.objectContaining({ olusanKayitlar: { masrafIdler: ["m1", "m2"] } }) }));
  });

  it("tek oran ya da tekrarlanan oran reddedilir; dövizli taslakta kur zorunlu", async () => {
    expect(oranlaraGoreMasrafSemasi.safeParse({ ortak, oranlar: [{ kdvOrani: 10, matrah: 1, kdvTutari: 0.1 }] }).success).toBe(false);
    expect(oranlaraGoreMasrafSemasi.safeParse({ ortak, oranlar: [{ kdvOrani: 10, matrah: 1, kdvTutari: 0.1 }, { kdvOrani: 10, matrah: 2, kdvTutari: 0.2 }] }).success).toBe(false);
    const { servis, tx } = kur();
    const g = oranlaraGoreMasrafSemasi.parse({ ortak: { ...ortak, dovizCinsi: "EUR", kur: 1 }, oranlar: [{ kdvOrani: 10, matrah: 300, kdvTutari: 30 }, { kdvOrani: 20, matrah: 700, kdvTutari: 140 }] });
    await expect(calistir(() => servis.oranlaraGoreOlustur(g))).rejects.toThrow(/kur/);
    expect(tx.masraf.create).not.toHaveBeenCalled();
  });
});
