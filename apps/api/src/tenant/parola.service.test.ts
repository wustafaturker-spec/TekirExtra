import { createHash } from "node:crypto";
import * as argon2 from "argon2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../core/istek-baglami";
import type { PrismaService } from "../core/prisma.service";
import type { EpostaService } from "./eposta.service";
import { ParolaService, SIFIRLAMA_ISTEK_YANITI } from "./parola.service";

const TENANT = "00000000-0000-0000-0000-0000000000aa";
const YONETICI = "00000000-0000-0000-0000-000000000001";
const HEDEF = "00000000-0000-0000-0000-000000000002";
const ESKI_PAROLA = "EskiParola2026";
const ozet = (t: string) => createHash("sha256").update(t).digest("hex");

interface Kullanici { id: string; eposta: string; adSoyad: string; rol: string; aktif: boolean; parolaHash: string; epostaDogrulandi: boolean }
interface Sifirlama { id: string; tenantId: string; userId: string; tokenHash: string; gecerlilikSonu: Date; kullanildi: boolean; createdAt: Date }

function kur() {
  const kullanicilar = new Map<string, Kullanici>();
  const oturumlar: { userId: string; refreshTokenHash: string }[] = [];
  const sifirlamalar: Sifirlama[] = [];
  const denetim: { islem: string; userId: string; varlikId: string }[] = [];
  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => kullanicilar.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Kullanici> }) => Object.assign(kullanicilar.get(where.id)!, data)),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: { islem: string; userId: string; varlikId: string } }) => { denetim.push(data); return data; }) },
  };
  const prisma = {
    tenantIslem: vi.fn(async (_t: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    authKimlik: {
      findUnique: vi.fn(async ({ where }: { where: { eposta: string } }) => {
        const k = [...kullanicilar.values()].find((u) => u.eposta === where.eposta);
        return k ? { tenantId: TENANT, userId: k.id, eposta: k.eposta } : null;
      }),
    },
    oturum: {
      deleteMany: vi.fn(async ({ where }: { where: { userId: string; NOT?: { refreshTokenHash: string } } }) => {
        const once = oturumlar.length;
        for (let i = oturumlar.length - 1; i >= 0; i--) {
          const o = oturumlar[i];
          if (o.userId === where.userId && o.refreshTokenHash !== where.NOT?.refreshTokenHash) oturumlar.splice(i, 1);
        }
        return { count: once - oturumlar.length };
      }),
    },
    parolaSifirlama: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; kullanildi: boolean; createdAt: { gt: Date } } }) =>
        sifirlamalar.find((s) => s.userId === where.userId && !s.kullanildi && s.createdAt > where.createdAt.gt) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => sifirlamalar.find((s) => s.tokenHash === where.tokenHash) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<Sifirlama, "id" | "kullanildi" | "createdAt"> }) => {
        const s = { ...data, id: `s${sifirlamalar.length + 1}`, kullanildi: false, createdAt: new Date() };
        sifirlamalar.push(s);
        return s;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id?: string; userId?: string; kullanildi: boolean }; data: { kullanildi: boolean } }) => {
        const eslesen = sifirlamalar.filter((s) => (where.id ? s.id === where.id : s.userId === where.userId) && s.kullanildi === where.kullanildi);
        eslesen.forEach((s) => (s.kullanildi = data.kullanildi));
        return { count: eslesen.length };
      }),
    },
  };
  const gonderilen: { alici: string; link: string }[] = [];
  const eposta = { parolaSifirlamaGonder: vi.fn(async (alici: string, _ad: string, link: string) => { gonderilen.push({ alici, link }); return { messageId: null }; }) };
  const service = new ParolaService(prisma as unknown as PrismaService, eposta as unknown as EpostaService);
  const olarak = <T>(userId: string, is: () => Promise<T>) => baglamlaCalistir({ tenantId: TENANT, userId, rol: "yonetici" }, is);
  return { kullanicilar, oturumlar, sifirlamalar, denetim, gonderilen, eposta, service, olarak };
}

async function kullaniciEkle(k: ReturnType<typeof kur>, id: string, eposta: string, aktif = true) {
  k.kullanicilar.set(id, { id, eposta, adSoyad: `Kişi ${id.slice(-1)}`, rol: "muhasebe", aktif, parolaHash: await argon2.hash(ESKI_PAROLA), epostaDogrulandi: false });
  k.oturumlar.push({ userId: id, refreshTokenHash: ozet(`yenileme-${id}-1`) }, { userId: id, refreshTokenHash: ozet(`yenileme-${id}-2`) });
}

describe("yönetici parola sıfırlaması (KLN-10)", () => {
  let k: ReturnType<typeof kur>;
  beforeEach(async () => { k = kur(); await kullaniciEkle(k, YONETICI, "yonetici@ornek.com"); await kullaniciEkle(k, HEDEF, "hedef@ornek.com"); });

  it("yeni parolayı kaydeder, hedefin oturumlarını kapatır ve denetim kaydı yazar", async () => {
    await k.olarak(YONETICI, () => k.service.yoneticiSifirla(HEDEF, { parola: "GeciciParola1" }));
    expect(await argon2.verify(k.kullanicilar.get(HEDEF)!.parolaHash, "GeciciParola1")).toBe(true);
    expect(k.oturumlar.filter((o) => o.userId === HEDEF)).toHaveLength(0);
    expect(k.oturumlar.filter((o) => o.userId === YONETICI)).toHaveLength(2);
    expect(k.denetim).toEqual([expect.objectContaining({ islem: "kullanici_parolasi_sifirlandi", userId: YONETICI, varlikId: HEDEF })]);
  });

  it("parola politikasına uymayan geçici parolayı reddeder", async () => {
    await expect(k.olarak(YONETICI, () => k.service.yoneticiSifirla(HEDEF, { parola: "kisa1" }))).rejects.toThrow(/en az 10/);
    await expect(k.olarak(YONETICI, () => k.service.yoneticiSifirla(HEDEF, { parola: "sadeceharfler" }))).rejects.toThrow(/rakam/);
  });

  it("yönetici kendi parolasını bu yoldan sıfırlayamaz", async () => {
    await expect(k.olarak(YONETICI, () => k.service.yoneticiSifirla(YONETICI, { parola: "GeciciParola1" }))).rejects.toThrow(/Hesap Güvenliği/);
  });

  it("başka kiracıdaki (RLS'in göstermediği) kullanıcı bulunamaz", async () => {
    await expect(k.olarak(YONETICI, () => k.service.yoneticiSifirla("00000000-0000-0000-0000-00000000dead", { parola: "GeciciParola1" }))).rejects.toThrow(/bulunamadı/);
  });
});

describe("kendi parolasını değiştirme (KLN-11)", () => {
  let k: ReturnType<typeof kur>;
  beforeEach(async () => { k = kur(); await kullaniciEkle(k, HEDEF, "hedef@ornek.com"); });

  it("mevcut parola doğruysa değiştirir; bu oturum açık kalır, diğerleri kapanır", async () => {
    await k.olarak(HEDEF, () => k.service.degistir({ mevcutParola: ESKI_PAROLA, yeniParola: "YeniParola2026" }, `yenileme-${HEDEF}-1`));
    expect(await argon2.verify(k.kullanicilar.get(HEDEF)!.parolaHash, "YeniParola2026")).toBe(true);
    expect(k.oturumlar).toEqual([{ userId: HEDEF, refreshTokenHash: ozet(`yenileme-${HEDEF}-1`) }]);
    expect(k.denetim[0]).toMatchObject({ islem: "parola_degistirildi", userId: HEDEF });
  });

  it("mevcut parola yanlışsa 400 ile reddeder ve hiçbir şeyi değiştirmez", async () => {
    await expect(k.olarak(HEDEF, () => k.service.degistir({ mevcutParola: "Yanlis2026xx", yeniParola: "YeniParola2026" }, undefined))).rejects.toMatchObject({ status: 400 });
    expect(await argon2.verify(k.kullanicilar.get(HEDEF)!.parolaHash, ESKI_PAROLA)).toBe(true);
    expect(k.oturumlar).toHaveLength(2);
  });

  it("yeni parola eskisiyle aynı olamaz", async () => {
    await expect(k.olarak(HEDEF, () => k.service.degistir({ mevcutParola: ESKI_PAROLA, yeniParola: ESKI_PAROLA }, undefined))).rejects.toThrow(/farklı/);
  });
});

describe("şifremi unuttum (KLN-12)", () => {
  let k: ReturnType<typeof kur>;
  beforeEach(async () => { k = kur(); await kullaniciEkle(k, HEDEF, "hedef@ornek.com"); await kullaniciEkle(k, YONETICI, "pasif@ornek.com", false); });

  const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;

  it("kayıtlı, kayıtsız ve pasif adreslere aynı yanıtı verir; yalnız etkin hesaba bağlantı gider", async () => {
    const yanitlar = await Promise.all(["hedef@ornek.com", "yok@ornek.com", "pasif@ornek.com"].map((eposta) => k.service.sifirlamaIste({ eposta })));
    expect(yanitlar.every((y) => y.mesaj === SIFIRLAMA_ISTEK_YANITI)).toBe(true);
    expect(k.gonderilen.map((g) => g.alici)).toEqual(["hedef@ornek.com"]);
    expect(k.sifirlamalar).toHaveLength(1);
    // Veritabanında yalnız özet durur.
    expect(k.sifirlamalar[0].tokenHash).toBe(ozet(tokenOf(k.gonderilen[0].link)));
  });

  it("iki dakika içinde ikinci istek yeni bağlantı göndermez", async () => {
    await k.service.sifirlamaIste({ eposta: "hedef@ornek.com" });
    await k.service.sifirlamaIste({ eposta: "hedef@ornek.com" });
    expect(k.gonderilen).toHaveLength(1);
  });

  it("e-posta gönderilemese de yanıt değişmez", async () => {
    k.eposta.parolaSifirlamaGonder.mockRejectedValueOnce(new Error("SMTP kapalı"));
    await expect(k.service.sifirlamaIste({ eposta: "hedef@ornek.com" })).resolves.toEqual({ mesaj: SIFIRLAMA_ISTEK_YANITI });
  });

  it("bağlantıyla yeni parola belirler, adresi doğrulanmış sayar, tüm oturumları kapatır", async () => {
    await k.service.sifirlamaIste({ eposta: "hedef@ornek.com" });
    await k.service.sifirla({ token: tokenOf(k.gonderilen[0].link), parola: "YeniParola2026" });
    const u = k.kullanicilar.get(HEDEF)!;
    expect(await argon2.verify(u.parolaHash, "YeniParola2026")).toBe(true);
    expect(u.epostaDogrulandi).toBe(true);
    expect(k.oturumlar.filter((o) => o.userId === HEDEF)).toHaveLength(0);
    expect(k.denetim.at(-1)).toMatchObject({ islem: "parola_baglantiyla_sifirlandi", userId: HEDEF });
  });

  it("bağlantı yalnız bir kez kullanılabilir", async () => {
    await k.service.sifirlamaIste({ eposta: "hedef@ornek.com" });
    const token = tokenOf(k.gonderilen[0].link);
    await k.service.sifirla({ token, parola: "YeniParola2026" });
    await expect(k.service.sifirla({ token, parola: "BaskaParola2026" })).rejects.toThrow(/geçersiz/);
    expect(await argon2.verify(k.kullanicilar.get(HEDEF)!.parolaHash, "YeniParola2026")).toBe(true);
  });

  it("süresi dolmuş ya da uydurma bağlantıyı reddeder", async () => {
    await k.service.sifirlamaIste({ eposta: "hedef@ornek.com" });
    k.sifirlamalar[0].gecerlilikSonu = new Date(Date.now() - 1000);
    await expect(k.service.sifirla({ token: tokenOf(k.gonderilen[0].link), parola: "YeniParola2026" })).rejects.toThrow(/süresi dolmuş/);
    await expect(k.service.sifirla({ token: "x".repeat(43), parola: "YeniParola2026" })).rejects.toThrow(/geçersiz/);
  });

  it("parola başka yoldan değişince açıkta kalan sıfırlama bağlantısı geçersizleşir", async () => {
    await k.service.sifirlamaIste({ eposta: "hedef@ornek.com" });
    await k.olarak(HEDEF, () => k.service.degistir({ mevcutParola: ESKI_PAROLA, yeniParola: "YeniParola2026" }, undefined));
    await expect(k.service.sifirla({ token: tokenOf(k.gonderilen[0].link), parola: "BaskaParola2026" })).rejects.toThrow(/geçersiz/);
  });
});
