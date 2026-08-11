import { describe, expect, it, vi } from "vitest";
import { OdemeTalimatiService } from "./odeme-talimati.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "tenant", userId: "onaylayan", rol: "muhasebe" }) }));

describe("OdemeTalimatiService", () => {
  it("oluşturan kullanıcının kendi talimatını onaylamasını reddeder", async () => {
    const prisma = { tenantIslem: vi.fn((_t, cb) => cb({ bankaOdemeTalimati: { findUnique: vi.fn().mockResolvedValue({ id: "x", olusturanUserId: "onaylayan", durum: "onay_bekliyor" }) } })) } as any;
    const auth = { kritikIslemTotpDogrula: vi.fn() } as any;
    await expect(new OdemeTalimatiService(prisma, auth).onayla("x", "123456")).rejects.toThrow("oluşturan kullanıcı onaylayamaz");
    expect(auth.kritikIslemTotpDogrula).not.toHaveBeenCalled();
  });

  it("ikinci kullanıcıyı TOTP ile doğrulayıp talimatı atomik onaylar", async () => {
    const tx = { bankaOdemeTalimati: { findUnique: vi.fn().mockResolvedValue({ id: "x", olusturanUserId: "baska", durum: "onay_bekliyor" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const prisma = { tenantIslem: vi.fn((_t, cb) => cb(tx)) } as any;
    const auth = { kritikIslemTotpDogrula: vi.fn().mockResolvedValue(undefined) } as any;
    const sonuc = await new OdemeTalimatiService(prisma, auth).onayla("x", "123456");
    expect(auth.kritikIslemTotpDogrula).toHaveBeenCalledWith("123456");
    expect(tx.bankaOdemeTalimati.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ durum: "onay_bekliyor", onaylayanUserId: null }), data: expect.objectContaining({ durum: "onaylandi", onaylayanUserId: "onaylayan" }) }));
    expect(sonuc.durum).toBe("onaylandi");
  });
});
