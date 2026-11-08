import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { YedeklemeService } from "./yedekleme.service";

vi.mock("../core/istek-baglami", () => ({ aktifPlatformBaglam: () => ({ kullaniciId: "p1" }) }));
vi.mock("../core/kripto", () => ({ coz: (s: string) => s }));
const totp = vi.hoisted(() => ({ dogru: true }));
vi.mock("../auth/totp-dogrula", () => ({ totpDogrula: () => totp.dogru }));

function kur() {
  const tx = { platformYedek: { create: vi.fn().mockResolvedValue({ id: "y1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, mevzuatOlay: { create: vi.fn() } };
  const db = {
    platformKullanici: { findUnique: vi.fn().mockResolvedValue({ totpSecretSifreli: "s" }) },
    platformYedek: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _max: { denemeAt: new Date() } }), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
    mevzuatOlay: { create: vi.fn() },
    $transaction: (f: (t: typeof tx) => unknown) => f(tx),
  };
  const denemeler = { kilitliMi: vi.fn().mockResolvedValue(false), hataKaydet: vi.fn(), temizle: vi.fn() };
  return { servis: new YedeklemeService({ db } as never, denemeler as never), db, tx, denemeler };
}

describe("elle yedek", () => {
  beforeEach(() => { totp.dogru = true; });
  it("doğru kodla talep ve olay kaydı yazar", async () => {
    const { servis, tx } = kur();
    await expect(servis.talepEt("yayın öncesi", "123456")).resolves.toMatchObject({ id: "y1" });
    expect(tx.platformYedek.create).toHaveBeenCalledWith(expect.objectContaining({ data: { tur: "elle", neden: "yayın öncesi", baslatanId: "p1" } }));
    expect(tx.mevzuatOlay.create).toHaveBeenCalledWith({ data: expect.objectContaining({ olay: "yedek_talep_edildi" }) });
  });
  it("hatalı kodu reddeder, sayaca yazar, talep açmaz", async () => {
    totp.dogru = false;
    const { servis, tx, denemeler } = kur();
    await expect(servis.talepEt("yayın öncesi", "000000")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(denemeler.hataKaydet).toHaveBeenCalledWith("platform", "platform-yedek:p1");
    expect(tx.platformYedek.create).not.toHaveBeenCalled();
  });
  it("çalışan yedek varken çakışma döner", async () => {
    const { servis, tx } = kur();
    tx.platformYedek.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "6" }));
    await expect(servis.talepEt("yayın öncesi", "123456")).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("planlayıcı", () => {
  it("04:00 sonrası otomatik yedek ister; çakışmada hata vermez", async () => {
    const { servis, db } = kur();
    db.platformYedek.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "6" }));
    await expect(servis.planla(new Date("2026-11-08T02:00:00Z"))).resolves.toBeUndefined();
    expect(db.platformYedek.create).toHaveBeenCalledWith({ data: { tur: "otomatik", gun: new Date("2026-11-08T00:00:00Z") } });
  });
});
