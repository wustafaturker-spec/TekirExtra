import { describe, expect, it, vi } from "vitest";
import { coz, sifrele } from "../core/kripto";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";
import { SaglayiciAyarlariService } from "./saglayici-ayarlari.service";

process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "a".repeat(64);

function kur(mevcut: Record<string, { ortam: string; etkin: boolean; config: Record<string, string> }> = {}) {
  const yazilan: any[] = [];
  const db = {
    abonelikSaglayiciAyari: {
      findMany: vi.fn(async () => Object.entries(mevcut).map(([saglayici, k]) => ({ saglayici, ortam: k.ortam, etkin: k.etkin, sifreliConfig: sifrele(JSON.stringify(k.config)), updatedAt: new Date() }))),
      findUnique: vi.fn(async ({ where }: any) => (mevcut[where.saglayici] ? { sifreliConfig: sifrele(JSON.stringify(mevcut[where.saglayici].config)) } : null)),
      findFirst: vi.fn(async () => {
        const e = Object.entries(mevcut).find(([, k]) => k.etkin);
        return e ? { saglayici: e[0], ortam: e[1].ortam, sifreliConfig: sifrele(JSON.stringify(e[1].config)) } : null;
      }),
      updateMany: vi.fn((x: any) => ({ islem: "updateMany", ...x })),
      upsert: vi.fn((x: any) => ({ islem: "upsert", ...x })),
    },
    mevzuatOlay: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (islemler: any[]) => { yazilan.push(...islemler); }),
  };
  const servis = new SaglayiciAyarlariService({ db } as any);
  const olarak = <T>(fn: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: "p1", eposta: "p@ornek.invalid", rol: "yonetici" } as any, fn);
  return { servis, db, yazilan, olarak };
}

describe("abonelik ödeme sağlayıcısı ayarı (PLT-11)", () => {
  it("gizli alanlar listede görünmez, yalnız dolu olduğu söylenir", async () => {
    const { servis } = kur({ paytr: { ortam: "canli", etkin: false, config: { magazaId: "123", merchantKey: "SIR-DEGER-1", merchantSalt: "SIR-DEGER-2" } } });
    const liste = await servis.listele();
    const paytr = liste.find((l) => l.saglayici === "paytr")!;
    expect(paytr.alanlar.find((a) => a.anahtar === "magazaId")).toMatchObject({ dolu: true, deger: "123" });
    expect(paytr.alanlar.find((a) => a.anahtar === "merchantKey")).toMatchObject({ dolu: true, deger: undefined });
    expect(JSON.stringify(liste)).not.toContain("SIR-DEGER");
  });

  it("boş bırakılan gizli alan kayıtlı değeri korur; etkinleştirme diğer sağlayıcıyı kapatır", async () => {
    const { servis, yazilan, db, olarak } = kur({ iyzico: { ortam: "test", etkin: false, config: { apiKey: "eski-api", secretKey: "eski-gizli" } } });
    await olarak(() => servis.kaydet("iyzico", { ortam: "canli", etkin: true, alanlar: { apiKey: "yeni-api", secretKey: "" } }));
    const upsert = yazilan.find((y) => y.islem === "upsert");
    expect(JSON.parse(coz(upsert.update.sifreliConfig))).toEqual({ apiKey: "yeni-api", secretKey: "eski-gizli" });
    expect(upsert.update).toMatchObject({ ortam: "canli", etkin: true, guncelleyenId: "p1" });
    expect(yazilan.find((y) => y.islem === "updateMany")).toMatchObject({ where: { etkin: true, saglayici: { not: "iyzico" } }, data: { etkin: false } });
    // Olay kaydına gizli değer yazılmaz.
    expect(JSON.stringify(db.mevzuatOlay.create.mock.calls)).not.toContain("yeni-api");
  });

  it("eksik alanla etkinleştirilemez; PayTR bildirim adresini gösterir", async () => {
    const { servis, olarak } = kur();
    await expect(olarak(() => servis.kaydet("iyzico", { ortam: "test", etkin: true, alanlar: { apiKey: "a" } }))).rejects.toThrow(/Gizli anahtar/);
    await expect(olarak(() => servis.kaydet("paytr", { ortam: "test", etkin: true, alanlar: { magazaId: "1", merchantKey: "k" } }))).rejects.toThrow(/merchant salt/);
    await olarak(() => servis.kaydet("paytr", { ortam: "test", etkin: true, alanlar: { magazaId: "1", merchantKey: "k", merchantSalt: "s" } }));
    expect((await servis.listele()).find((l) => l.saglayici === "paytr")?.bildirimAdresi).toMatch(/\/api\/v1\/abonelik-odeme\/paytr\/bildirim$/);
  });

  it("etkin sağlayıcı yoksa ya da platform bağlantısı tanımsızsa null (elle tahsilat sürer)", async () => {
    const eski = process.env.DATABASE_URL_PLATFORM;
    process.env.DATABASE_URL_PLATFORM = "postgresql://x";
    expect(await kur().servis.etkin()).toBeNull();
    expect(await kur({ iyzico: { ortam: "test", etkin: true, config: { apiKey: "a", secretKey: "b" } } }).servis.etkin()).toEqual({ saglayici: "iyzico", ortam: "test", config: { apiKey: "a", secretKey: "b" } });
    delete process.env.DATABASE_URL_PLATFORM;
    expect(await kur({ iyzico: { ortam: "test", etkin: true, config: {} } }).servis.etkin()).toBeNull();
    if (eski) process.env.DATABASE_URL_PLATFORM = eski;
  });
});
