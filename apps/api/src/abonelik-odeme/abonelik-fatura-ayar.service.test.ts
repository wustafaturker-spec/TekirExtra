import { describe, expect, it, vi } from "vitest";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";
import { AbonelikFaturaAyarService } from "./abonelik-fatura-ayar.service";

const hesaplar = [
  { tur: "banka", id: "b1", ad: "Ziraat (TL)", doviz: "TRY", saglayici: null },
  { tur: "pos", id: "iyz", ad: "İyzico (iyzico)", doviz: "TRY", saglayici: "iyzico" },
  { tur: "pos", id: "ptr", ad: "PayTR (paytr)", doviz: "TRY", saglayici: "paytr" },
];

function kur(etkin: string | null = "iyzico") {
  const db = {
    $queryRaw: vi.fn(async (parcalar: TemplateStringsArray) => (parcalar.join("?").includes("platform_firma_adlari") ? [{ tenant_id: "f1", unvan: "Faturalayan" }] : hesaplar)),
    abonelikSaglayiciAyari: { findFirst: vi.fn(async () => (etkin ? { saglayici: etkin } : null)) },
    abonelikFaturaAyari: { findUnique: vi.fn(async () => ({ faturalayanTenantId: "f1" })), upsert: vi.fn() },
    mevzuatOlay: { create: vi.fn() },
    $transaction: vi.fn(async () => []),
  };
  return { s: new AbonelikFaturaAyarService({ db } as never), db };
}
const olarak = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: "p1", eposta: "p@x", rol: "yonetici" }, is);

describe("PLT-38 kart tahsilat hesabı", () => {
  it("yalnız etkin sağlayıcının POS hesabını kabul eder", async () => {
    const { s, db } = kur("iyzico");
    await expect(olarak(() => s.kaydet({ faturalayanTenantId: "f1", kartHesap: { tur: "banka", id: "b1" }, elleHesap: null }))).rejects.toThrow("bir POS hesabı olmalı");
    await expect(olarak(() => s.kaydet({ faturalayanTenantId: "f1", kartHesap: { tur: "pos", id: "ptr" }, elleHesap: null }))).rejects.toThrow("etkin abonelik sağlayıcısının (iyzico)");
    await expect(olarak(() => s.kaydet({ faturalayanTenantId: "f1", kartHesap: { tur: "pos", id: "iyz" }, elleHesap: { tur: "banka", id: "b1" } }))).resolves.toMatchObject({ mesaj: expect.any(String) });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("etkin sağlayıcı yoksa herhangi bir POS hesabı seçilebilir; getir etkin sağlayıcıyı döner", async () => {
    const { s } = kur(null);
    await expect(olarak(() => s.kaydet({ faturalayanTenantId: "f1", kartHesap: { tur: "pos", id: "ptr" }, elleHesap: null }))).resolves.toBeTruthy();
    const { s: s2, db } = kur("iyzico");
    db.abonelikFaturaAyari.findUnique.mockResolvedValue({ faturalayanTenantId: "f1", kartHesapTur: "pos", kartHesapId: "iyz" } as never);
    (db as unknown as { abonelikFaturasi: unknown }).abonelikFaturasi = { findMany: vi.fn(async () => []) };
    await expect(s2.getir()).resolves.toMatchObject({ etkinSaglayici: "iyzico", hesaplar: expect.arrayContaining([expect.objectContaining({ saglayici: "iyzico" })]) });
  });
});
