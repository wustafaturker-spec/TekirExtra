import { describe, expect, it, vi } from "vitest";
import { PersonelService } from "./personel.service";

const kisi = (id: string, ad: string, soyad: string, departman: string | null = null) => ({ id, ad, soyad, personelNo: `PRS-${id}`, departman, unvan: null, tckn: null, iban: null, cari: null });

describe("personel listesi (PRS-14)", () => {
  const tx = { personel: { findMany: vi.fn(async () => [kisi("1", "Işık", "Çelik", "Üretim"), kisi("2", "İsmail", "Şahin"), kisi("3", "Ayşe", "Öztürk", "Satış")]) } };
  const s = new PersonelService({ tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx) } as never);

  it("aksansız ve ı/İ katlamalı arama", async () => {
    expect((await s.listele("t1", "isik") as { id: string }[]).map((p) => p.id)).toEqual(["1"]);
    expect((await s.listele("t1", "ISMAIL") as { id: string }[]).map((p) => p.id)).toEqual(["2"]);
    expect((await s.listele("t1", "uretim") as { id: string }[]).map((p) => p.id)).toEqual(["1"]);
    expect((await s.listele("t1", "ozturk") as { id: string }[]).map((p) => p.id)).toEqual(["3"]);
  });

  it("Türkçe alfabe sırası", async () => {
    const tx2 = { personel: { findMany: vi.fn(async () => [kisi("a", "İnci", "X"), kisi("b", "Can", "X"), kisi("c", "Çağla", "X"), kisi("d", "Ilgaz", "X")]) } };
    const s2 = new PersonelService({ tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx2) } as never);
    expect((await s2.listele("t1") as { ad: string }[]).map((p) => p.ad)).toEqual(["Can", "Çağla", "Ilgaz", "İnci"]);
  });

  it("adet verilince sayfalı yanıt; çalışan süzgeci ayrılanları dışarıda bırakır", async () => {
    const ilk = await s.listele("t1", undefined, { adet: 2 }) as { kayitlar: { id: string }[]; sonrakiImlec: string | null; toplam: number };
    // Türkçe sıra: Ayşe, Işık, İsmail
    expect(ilk.kayitlar.map((p) => p.id)).toEqual(["3", "1"]);
    expect(ilk.sonrakiImlec).toBe("1");
    expect(ilk.toplam).toBe(3);
    const ikinci = await s.listele("t1", undefined, { adet: 2, imlec: "1" }) as { kayitlar: { id: string }[]; sonrakiImlec: string | null };
    expect(ikinci.kayitlar.map((p) => p.id)).toEqual(["2"]);
    expect(ikinci.sonrakiImlec).toBeNull();
    await s.listele("t1", undefined, { durum: "calisan" });
    expect(tx.personel.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ durum: { not: "isten_ayrildi" } }) }));
  });
});
