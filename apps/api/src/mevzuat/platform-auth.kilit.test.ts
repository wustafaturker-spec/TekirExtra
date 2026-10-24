import * as argon2 from "argon2";
import { HttpException } from "@nestjs/common";
import { generateSecret } from "otplib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { GirisDenemeSayaci } from "../auth/giris-deneme-sayaci";
import { PlatformAuthService } from "./platform-auth.service";

let hash: string;
beforeAll(async () => {
  process.env.PLATFORM_JWT_SECRET = "platform-test-anahtari-0123456789";
  process.env.JWT_SECRET = "kiraci-test-anahtari-0123456789ab";
  process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "0123456789abcdef".repeat(4);
  hash = await argon2.hash("PlatformParola2026");
});

describe("platform girişi deneme sınırı (platform P1-2)", { timeout: 30_000 }, () => {
  it("5 hatadan sonra doğru bilgiler de 429 alır; her hata nedeniyle olay kaydına yazılır", async () => {
    const { sifrele } = await import("../core/kripto");
    const olaylar: { olay: string; detay: unknown }[] = [];
    const kullanici = { id: "p1", eposta: "ekip@tekirextra.com", adSoyad: "Ekip", aktif: true, parolaHash: hash, totpSecretSifreli: sifrele(generateSecret()) };
    const db = {
      platformKullanici: { findUnique: vi.fn(async ({ where }: { where: { eposta: string } }) => (where.eposta === kullanici.eposta ? kullanici : null)), update: vi.fn(async () => kullanici) },
      mevzuatOlay: { create: vi.fn(async ({ data }: { data: { olay: string; detay: unknown } }) => { olaylar.push(data); return data; }) },
    };
    const servis = new PlatformAuthService({ db } as never, { signAsync: async () => "t" } as never, GirisDenemeSayaci.bellekte());
    const kod = (p: Promise<unknown>) => p.then(() => 200, (h: unknown) => (h instanceof HttpException ? h.getStatus() : 500));
    expect(await kod(servis.giris("yok@tekirextra.com", "x", "000000"))).toBe(401);
    for (let i = 0; i < 5; i++) expect(await kod(servis.giris("Ekip@TekirExtra.com", "yanlis", "000000"))).toBe(401);
    expect(await kod(servis.giris("ekip@tekirextra.com", "PlatformParola2026", "000000"))).toBe(429);
    expect(olaylar.map((o) => (o.detay as { neden: string }).neden)).toEqual(["hesap_yok", "parola", "parola", "parola", "parola", "parola"]);
    expect(olaylar.every((o) => o.olay === "giris_basarisiz")).toBe(true);
  });
});
