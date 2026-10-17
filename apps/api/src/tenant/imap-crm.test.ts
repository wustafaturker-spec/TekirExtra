import { describe, expect, it, vi } from "vitest";
import { ImapService } from "./imap.service";

const EPOSTA = { id: "e1", konu: "Fiyat teklifi talebi", gonderenAdi: "Ali", gonderenEposta: "ali@ornek.com", tarih: new Date("2026-10-17T10:00:00Z"), icerik: "Merhaba", cariId: null as string | null };

function kur(eposta = EPOSTA, aktifCari: { id: string } | null = { id: "c-secilen" }) {
  const tx = {
    cariHesap: { findFirst: vi.fn().mockResolvedValue(aktifCari) },
    crmFirsat: { create: vi.fn(async ({ data }: { data: { cariId: string; baslik: string } }) => ({ id: "f1", ...data })) },
    gelenEposta: { update: vi.fn() },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const service = new ImapService(prisma as never, {} as never, {} as never, {} as never);
  vi.spyOn(service, "getir").mockResolvedValue(eposta as never);
  return { service, tx };
}

describe("e-postadan CRM fırsatı — cari seçimi", () => {
  it("e-posta eşleşmemiş ve cari seçilmemişse fırsat açılmaz (eskiden ilk aktif cariye bağlanıyordu)", async () => {
    const k = kur();
    await expect(k.service.crmGorevOlustur("t1", "e1", "u1")).rejects.toThrow("cariyi seçin");
    expect(k.tx.cariHesap.findFirst).not.toHaveBeenCalled();
    expect(k.tx.crmFirsat.create).not.toHaveBeenCalled();
  });

  it("seçilen cari şirkette aktifse fırsat ona açılır", async () => {
    const k = kur();
    await k.service.crmGorevOlustur("t1", "e1", "u1", "c-secilen");
    expect(k.tx.cariHesap.findFirst).toHaveBeenCalledWith({ where: { id: "c-secilen", tenantId: "t1", aktif: true }, select: { id: true } });
    expect(k.tx.crmFirsat.create.mock.calls[0][0].data.cariId).toBe("c-secilen");
  });

  it("seçilen cari yoksa ya da pasifse reddedilir", async () => {
    const k = kur(EPOSTA, null);
    await expect(k.service.crmGorevOlustur("t1", "e1", "u1", "c-yok")).rejects.toThrow("bulunamadı ya da pasif");
    expect(k.tx.crmFirsat.create).not.toHaveBeenCalled();
  });

  it("seçim yoksa e-postanın eşleştiği cari kullanılır", async () => {
    const k = kur({ ...EPOSTA, cariId: "c-eslesen" });
    await k.service.crmGorevOlustur("t1", "e1", "u1");
    expect(k.tx.crmFirsat.create.mock.calls[0][0].data.cariId).toBe("c-eslesen");
  });
});
