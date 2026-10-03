import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { cariIslemDenetle, riskLimitiDenetle, type RiskDenetimi } from "./cari-islem-denetimi";

const D = (v: string | number) => new Prisma.Decimal(v);

vi.mock("../core/ayarlar/ayar-kayit", () => ({
  ayarTanimiAl: () => ({ varsayilanlar: { riskLimitiPolitikasi: "uyar" } }),
}));
/** Sahte risk: bakiye 800 TL; `teminat` CARI-39 teminatını verir. */
let teminat = 0;
vi.mock("./cari-risk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cari-risk")>()),
  cariRiskleri: vi.fn(async (_tx: unknown, _tenantId: string, ids: string[]) =>
    new Map(ids.map((id) => [id, { bakiyeTry: D(800), cekSenetRiski: D(0), mevcutRisk: D(800), teminatTry: D(teminat) }]))),
}));

function txOlustur(cari: Record<string, unknown> | null, politika?: string) {
  const auditLog = { create: vi.fn(async () => ({})) };
  const tx = {
    cariHesap: { findUnique: vi.fn(async () => cari) },
    modulAyar: { findUnique: vi.fn(async () => (politika ? { ayarlar: { riskLimitiPolitikasi: politika } } : null)) },
    auditLog,
  } as unknown as Prisma.TransactionClient;
  return { tx, auditLog };
}

describe("cariIslemDenetle (CARI-32)", () => {
  it("kara listedeki cariye yeni de mevcut da belge işlenmez; not mesaja eklenir", async () => {
    const { tx } = txOlustur({ unvan: "ABC", aktif: true, karaListe: true, karaListeNotu: "Karşılıksız çek" });
    await expect(cariIslemDenetle(tx, "c1", "siparis", "yeni")).rejects.toThrow(/sipariş oluşturulamaz — Karşılıksız çek/);
    await expect(cariIslemDenetle(tx, "c1", "fatura", "mevcut")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("pasif cariye yeni belge açılmaz, mevcut belgesi işlenir", async () => {
    const { tx } = txOlustur({ unvan: "ABC", aktif: false, karaListe: false, karaListeNotu: null });
    await expect(cariIslemDenetle(tx, "c1", "teklif", "yeni")).rejects.toThrow(/pasif; yeni teklif açılamaz/);
    await expect(cariIslemDenetle(tx, "c1", "teklif", "mevcut")).resolves.toBeUndefined();
  });

  it("cari yoksa bulunamadı der", async () => {
    const { tx } = txOlustur(null);
    await expect(cariIslemDenetle(tx, "c1", "fatura", "yeni")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("riskLimitiDenetle (CARI-32)", () => {
  const girdi = (ek: Partial<RiskDenetimi> = {}): RiskDenetimi => ({
    tenantId: "t1", userId: "u1", rol: "satis", cariId: "c1", ekTutarTry: D(300), belgeEtiketi: "bu sipariş", ...ek,
  });

  it("limit yoksa ya da aşılmıyorsa sessiz geçer", async () => {
    expect(await riskLimitiDenetle(txOlustur({ riskLimiti: null }).tx, girdi())).toBeNull();
    expect(await riskLimitiDenetle(txOlustur({ riskLimiti: D(1100) }).tx, girdi())).toBeNull();
  });

  it("uyar politikasında belge tutarı dahil aşımı metin olarak döner", async () => {
    const metin = await riskLimitiDenetle(txOlustur({ riskLimiti: D(1000) }).tx, girdi());
    expect(metin).toMatch(/risk 1100\.00 TL, limit 1000\.00 TL/);
  });

  it("engelle politikasında aşım hata verir", async () => {
    await expect(riskLimitiDenetle(txOlustur({ riskLimiti: D(1000) }, "engelle").tx, girdi())).rejects.toBeInstanceOf(ConflictException);
  });

  it("yönetici onayında yönetici olmayan geçemez, yönetici gerekçesiz geçemez", async () => {
    const { tx } = txOlustur({ riskLimiti: D(1000) }, "yonetici_onayi");
    await expect(riskLimitiDenetle(tx, girdi({ onayGerekcesi: "acil" }))).rejects.toThrow(/yönetici onayı gerekir$/);
    await expect(riskLimitiDenetle(tx, girdi({ rol: "yonetici", onayGerekcesi: "  " }))).rejects.toThrow(/gerekçe yazın/);
  });

  it("yönetici gerekçeyle geçer ve denetim izine yazılır", async () => {
    const { tx, auditLog } = txOlustur({ riskLimiti: D(1000) }, "yonetici_onayi");
    const metin = await riskLimitiDenetle(tx, girdi({ rol: "yonetici", onayGerekcesi: "Teminat mektubu geldi" }));
    expect(metin).toMatch(/yönetici onayıyla geçildi/);
    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ islem: "risk_asimi_onayi", varlikId: "c1", detay: expect.objectContaining({ gerekce: "Teminat mektubu geldi", risk: "1100.00" }) }),
    });
  });

  it("geçerli teminat limite eklenir; aşım metninde dökümü görünür (CARI-39)", async () => {
    teminat = 500;
    try {
      expect(await riskLimitiDenetle(txOlustur({ riskLimiti: D(1000) }, "engelle").tx, girdi())).toBeNull(); // 1100 ≤ 1000 + 500
      const metin = await riskLimitiDenetle(txOlustur({ riskLimiti: D(500) }).tx, girdi());
      expect(metin).toMatch(/limit 1000\.00 TL \(risk limiti 500\.00 \+ teminat 500\.00\)/);
    } finally {
      teminat = 0;
    }
  });
});
