import { describe, expect, it, vi } from "vitest";
import { PersonelKuyrukService } from "./personel-kuyruk.service";

function kur(kadro: number, isciSayisi: number, mevcutDurum?: string) {
  const personel = { tahakkukKapsamSayisi: vi.fn(async () => kadro), bordroTopluTahakkuk: vi.fn(async () => ({ olusturulanSayi: kadro, toplamAktifPersonel: kadro, mevcutSayi: 0, hatalar: [] })) };
  const mevcut = mevcutDurum ? { getState: vi.fn(async () => mevcutDurum), remove: vi.fn(async () => undefined), data: { tenantId: "t1" } } : null;
  const kuyruk = { getWorkers: vi.fn(async () => Array(isciSayisi).fill({})), getJob: vi.fn(async () => mevcut), add: vi.fn(async () => ({})) };
  const s = new PersonelKuyrukService(personel as never);
  (s as unknown as { kuyrukAl: () => unknown }).kuyrukAl = () => kuyruk;
  return { s, personel, kuyruk, mevcut };
}

describe("bordro tahakkuk kuyruğu (PRS-20)", () => {
  const girdi = { donemYil: 2026, donemAy: 10 };

  it("küçük kadroda istek içinde çalışır", async () => {
    const { s, personel, kuyruk } = kur(5, 1);
    expect(await s.tahakkukBaslat("t1", "u1", "muhasebe", girdi)).toMatchObject({ arkaPlan: false, olusturulanSayi: 5 });
    expect(personel.bordroTopluTahakkuk).toHaveBeenCalled();
    expect(kuyruk.add).not.toHaveBeenCalled();
  });

  it("büyük kadroda worker varsa kuyruğa alınır; worker yoksa istek içinde", async () => {
    const a = kur(500, 1);
    expect(await a.s.tahakkukBaslat("t1", "u1", "muhasebe", girdi)).toEqual({ arkaPlan: true, isId: "bordro-tahakkuk-t1-2026-10", toplamAktifPersonel: 500 });
    expect(a.kuyruk.add).toHaveBeenCalledWith("bordro-tahakkuk", expect.objectContaining({ tenantId: "t1", donemYil: 2026, donemAy: 10 }), { jobId: "bordro-tahakkuk-t1-2026-10" });
    expect(a.personel.bordroTopluTahakkuk).not.toHaveBeenCalled();
    const b = kur(500, 0);
    expect(await b.s.tahakkukBaslat("t1", "u1", "muhasebe", girdi)).toMatchObject({ arkaPlan: false });
  });

  it("süren iş varsa yenisi açılmaz; biten iş kaldırılıp yeniden açılır", async () => {
    const a = kur(500, 1, "active");
    expect(await a.s.tahakkukBaslat("t1", "u1", "muhasebe", girdi)).toMatchObject({ arkaPlan: true });
    expect(a.kuyruk.add).not.toHaveBeenCalled();
    const b = kur(500, 1, "completed");
    await b.s.tahakkukBaslat("t1", "u1", "muhasebe", girdi);
    expect(b.mevcut!.remove).toHaveBeenCalled();
    expect(b.kuyruk.add).toHaveBeenCalled();
  });

  it("başka kiracının işi görünmez", async () => {
    const { s } = kur(500, 1, "active");
    await expect(s.isDurumu("t2", "bordro-tahakkuk-t1-2026-10")).rejects.toThrow(/bulunamadı/);
  });
});
