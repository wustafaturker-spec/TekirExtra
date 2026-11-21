import { ForbiddenException } from "@nestjs/common";
import { generateSecret, generateSync } from "otplib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { GirisDenemeSayaci } from "../../auth/giris-deneme-sayaci";
import { istekBaglami } from "../../core/istek-baglami";
import { AiOnayService } from "./ai-onay.service";

/** AI-108: Telegram'dan finansal onayda ek doğrulama. */
const TENANT = "11111111-1111-1111-1111-111111111111";
const KULLANICI = "22222222-2222-2222-2222-222222222222";
const MASRAF_ID = "7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d";
const SECRET = generateSecret();
let sifreli = "";

beforeAll(async () => {
  process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "0".repeat(64);
  const { sifrele } = await import("../../core/kripto");
  sifreli = sifrele(SECRET);
});

function talep(arac: string, parametreler: Record<string, unknown>) {
  return {
    id: "talep-1", tenantId: TENANT, userId: KULLANICI, oturumId: null, kaynak: "asistan", arac, parametreler,
    ozet: `${arac} talebi`, onizleme: null, durum: "bekliyor", surum: 1, parametreOzeti: null, hedefOzeti: null,
    gecerlilikSonu: new Date(Date.now() + 3_600_000), kararAt: null, sonuc: null, hata: null, createdAt: new Date(),
  };
}

function kur(arac: string, secenek: { kip?: "totp" | "kapali"; totpAktif?: boolean; denemeler?: GirisDenemeSayaci } = {}) {
  const kayit = arac === "masraf_tamamla" ? talep(arac, { masrafId: MASRAF_ID }) : talep(arac, { belgeId: MASRAF_ID });
  const tx = {
    aiOnayTalebi: {
      findUnique: vi.fn().mockResolvedValue(kayit),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...kayit, ...data })),
    },
    aiOlay: { create: vi.fn(async () => ({})) },
    aiOnayKarari: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data) },
    modulAyar: { findUnique: vi.fn().mockResolvedValue({ ayarlar: { etkin: true, tutarGoster: true, sesEtkin: false, sesOnayAt: null, finansalOnay: secenek.kip ?? "totp" } }) },
    user: { findUnique: vi.fn().mockResolvedValue({ totpAktif: secenek.totpAktif ?? true, totpSecretSifreli: (secenek.totpAktif ?? true) ? sifreli : null }) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const uc = { cagir: vi.fn(async () => ({ id: MASRAF_ID, durum: "onaylandi" })) };
  const service = new AiOnayService(prisma as never, uc as never, {} as never, secenek.denemeler ?? GirisDenemeSayaci.bellekte());
  const olarak = <T>(fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: TENANT, userId: KULLANICI, rol: "yonetici" as never } }, fn);
  return { service, tx, uc, olarak };
}

const kodu = async (p: Promise<unknown>) => {
  const hata = await p.then(() => null, (e: unknown) => e);
  expect(hata).toBeInstanceOf(ForbiddenException);
  return ((hata as ForbiddenException).getResponse() as { kod: string }).kod;
};

describe("AI-108 Telegram finansal onay", () => {
  it("finansal talep Telegram'dan kodsuz onaylanamaz; işlem başlamaz, karar yazılmaz", async () => {
    const k = kur("masraf_tamamla");
    expect(await kodu(k.olarak(() => k.service.onayla("talep-1", { kanal: "TELEGRAM" })))).toBe("KOD_GEREKLI");
    expect(k.tx.aiOnayTalebi.updateMany).not.toHaveBeenCalled();
    expect(k.tx.aiOnayKarari.create).not.toHaveBeenCalled();
    expect(k.uc.cagir).not.toHaveBeenCalled();
  });

  it("TOTP'si kapalı kullanıcı ya da 'kapalı' firma ayarı web'e yönlendirilir (kod verse de)", async () => {
    const totpsuz = kur("masraf_tamamla", { totpAktif: false });
    expect(await kodu(totpsuz.olarak(() => totpsuz.service.onayla("talep-1", { kanal: "TELEGRAM", dogrulamaKodu: "123456" })))).toBe("WEB_GEREKLI");
    const kapali = kur("masraf_tamamla", { kip: "kapali" });
    expect(await kodu(kapali.olarak(() => kapali.service.onayla("talep-1", { kanal: "TELEGRAM", dogrulamaKodu: generateSync({ secret: SECRET }) })))).toBe("WEB_GEREKLI");
    expect(kapali.uc.cagir).not.toHaveBeenCalled();
  });

  it("doğru kodla onaylanır ve karar kaydına ek doğrulama yazılır", async () => {
    const k = kur("masraf_tamamla");
    const sonuc = await k.olarak(() => k.service.onayla("talep-1", { kanal: "TELEGRAM", dogrulamaKodu: generateSync({ secret: SECRET }) }));
    expect(sonuc.risk).toBe("finansal");
    expect(k.tx.aiOnayKarari.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kanal: "TELEGRAM", ekDogrulama: true, karar: "onaylandi" }) });
    expect(k.uc.cagir).toHaveBeenCalled();
  });

  it("yanlış kod 5 denemede kilitlenir; kilitliyken doğru kod da geçmez ve kilit denetime yazılır", async () => {
    const denemeler = GirisDenemeSayaci.bellekte();
    const k = kur("masraf_tamamla", { denemeler });
    const dogru = generateSync({ secret: SECRET });
    const yanlis = ["000000", "111111", "222222", "333333", "444444", "555555"].find((x) => x !== dogru)!;
    for (let i = 0; i < 4; i++) expect(await kodu(k.olarak(() => k.service.onayla("talep-1", { kanal: "TELEGRAM", dogrulamaKodu: yanlis })))).toBe("KOD_GECERSIZ");
    expect(await kodu(k.olarak(() => k.service.onayla("talep-1", { kanal: "TELEGRAM", dogrulamaKodu: yanlis })))).toBe("KILITLI");
    expect(k.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ islem: "ai_onay_kodu_kilitlendi", varlikId: "talep-1" }) });
    expect(await kodu(k.olarak(() => k.service.onayla("talep-1", { kanal: "TELEGRAM", dogrulamaKodu: dogru })))).toBe("KILITLI");
    expect(k.uc.cagir).not.toHaveBeenCalled();
  });

  it("düşük riskli talep Telegram'da kodsuz, finansal talep web'de kodsuz onaylanır", async () => {
    const dusuk = kur("belge_onayla");
    await dusuk.olarak(() => dusuk.service.onayla("talep-1", { kanal: "TELEGRAM" }));
    expect(dusuk.tx.aiOnayKarari.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kanal: "TELEGRAM", ekDogrulama: false }) });
    const web = kur("masraf_tamamla");
    await web.olarak(() => web.service.onayla("talep-1", { kanal: "WEB" }));
    expect(web.tx.aiOnayKarari.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kanal: "WEB", ekDogrulama: false }) });
    expect(web.tx.user.findUnique).not.toHaveBeenCalled();
  });

  it("reddetme her kanalda kodsuzdur", async () => {
    const k = kur("masraf_tamamla");
    await k.olarak(() => k.service.reddet("talep-1", { kanal: "TELEGRAM" }));
    expect(k.tx.aiOnayKarari.create).toHaveBeenCalledWith({ data: expect.objectContaining({ karar: "reddedildi" }) });
  });
});
