import { beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { PersonelService } from "./personel.service";
import { hassasSifrele } from "./personel-hassas";

const D = (v: string) => new Prisma.Decimal(v);

function servis(bordrolar: unknown[]) {
  const auditLog = { create: vi.fn(async () => ({})) };
  const tx = { personelBordro: { findMany: vi.fn(async () => bordrolar) }, auditLog };
  const prisma = { tenantIslem: vi.fn((_t: string, cb: (tx: unknown) => unknown) => cb(tx)) };
  return { s: new PersonelService(prisma as never), tx, auditLog };
}

const bordro = (ad: string, iban: string | null, kalan: string) => ({
  kalanTutar: D(kalan),
  personel: { personelNo: `PRS-${ad}`, ad, soyad: "Test", tckn: hassasSifrele("10000000146"), iban: iban && hassasSifrele(iban) },
});

describe("banka maaş dosyası (P0-1)", () => {
  beforeAll(() => { process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "0".repeat(64); });

  it("TCKN ve IBAN çözülmüş yazılır, tutar kalan; denetim kaydı düşer", async () => {
    const { s, tx, auditLog } = servis([bordro("Ali", "TR330006100519786457841326", "12500.50")]);
    const sonuc = await s.bankaMaasDosyasiOlustur("t1", "u1", 2026, 9);
    expect(sonuc.dosyaIcerigi).toContain('"Ali Test";"10000000146";"TR330006100519786457841326";12500.50;"2026/09 Maaş Ödemesi"');
    expect(sonuc.dosyaIcerigi).not.toContain("enc:v1:");
    expect(sonuc.toplamTutar).toBe("12500.50");
    expect(tx.personelBordro.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ durum: { in: ["onaylandi", "kismen_odendi"] }, kalanTutar: { gt: 0 } }) }));
    expect(auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ islem: "HASSAS_VERI_TOPLU_DISA_AKTAR" }) });
  });

  it("IBAN'ı olmayan personel varsa dosya üretilmez ve kişi adıyla bildirilir", async () => {
    const { s } = servis([bordro("Ali", "TR330006100519786457841326", "100"), bordro("Veli", null, "200")]);
    await expect(s.bankaMaasDosyasiOlustur("t1", "u1", 2026, 9)).rejects.toThrow(/PRS-Veli Veli Test/);
  });
});
