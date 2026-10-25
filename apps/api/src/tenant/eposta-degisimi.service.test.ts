import * as argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../core/istek-baglami";
import type { KullaniciDurumService } from "../core/kullanici-durum.service";
import type { PrismaService } from "../core/prisma.service";
import { EpostaDegisimiService } from "./eposta-degisimi.service";
import type { EpostaService } from "./eposta.service";

const TENANT = "00000000-0000-0000-0000-0000000000aa";
const YONETICI = "00000000-0000-0000-0000-000000000001";
const HEDEF = "00000000-0000-0000-0000-000000000002";
const PAROLA = "MevcutParola2026";

interface Kullanici { id: string; eposta: string; adSoyad: string; aktif: boolean; parolaHash: string; epostaDogrulandi: boolean }
interface Degisim { id: string; userId: string; yeniEposta: string; tokenHash: string; gecerlilikSonu: Date; kullanildi: boolean; tenantId: string }

async function kur() {
  const parolaHash = await argon2.hash(PAROLA);
  const kullanicilar = new Map<string, Kullanici>([
    [YONETICI, { id: YONETICI, eposta: "yonetici@firma.com", adSoyad: "Yönetici", aktif: true, parolaHash, epostaDogrulandi: true }],
    [HEDEF, { id: HEDEF, eposta: "ayse@firma.com", adSoyad: "Ayşe", aktif: true, parolaHash, epostaDogrulandi: true }],
  ]);
  // auth_kimlikler: başka firmadaki bir hesap da adresi tutar.
  const kimlikler = new Map<string, string>([[YONETICI, "yonetici@firma.com"], [HEDEF, "ayse@firma.com"], ["baska", "Dolu@Baska.com"]]);
  const degisimler: Degisim[] = [];
  const denetim: { islem: string }[] = [];
  const kimlikGuncelle = vi.fn(async ({ where, data }: { where: { userId: string }; data: { eposta: string } }) => { kimlikler.set(where.userId, data.eposta); });
  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => kullanicilar.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Kullanici> }) => Object.assign(kullanicilar.get(where.id)!, data)),
    },
    authKimlik: { update: kimlikGuncelle },
    auditLog: { create: vi.fn(async ({ data }: { data: { islem: string } }) => { denetim.push(data); return data; }) },
  };
  const prisma = {
    tenantIslem: vi.fn(async (_t: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    authKimlik: {
      count: vi.fn(async ({ where }: { where: { eposta: { equals: string } } }) => [...kimlikler.values()].filter((e) => e.toLowerCase() === where.eposta.equals.toLowerCase()).length),
    },
    epostaDegisimi: {
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => degisimler.find((d) => d.tokenHash === where.tokenHash) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<Degisim, "id" | "kullanildi"> }) => { const d = { ...data, id: `d${degisimler.length + 1}`, kullanildi: false }; degisimler.push(d); return d; }),
      updateMany: vi.fn(async ({ where, data }: { where: { id?: string; userId?: string; kullanildi: boolean }; data: { kullanildi: boolean } }) => {
        const eslesen = degisimler.filter((d) => (where.id ? d.id === where.id : d.userId === where.userId) && d.kullanildi === where.kullanildi);
        eslesen.forEach((d) => (d.kullanildi = data.kullanildi));
        return { count: eslesen.length };
      }),
    },
  };
  const gonderilen: { tur: string; alici: string; link?: string }[] = [];
  const eposta = {
    epostaDegisimiDogrulamaGonder: vi.fn(async (alici: string, _ad: string, link: string) => { gonderilen.push({ tur: "dogrulama", alici, link }); return { messageId: null }; }),
    epostaDegisimiBilgilendir: vi.fn(async (alici: string) => { gonderilen.push({ tur: "bilgi", alici }); return { messageId: null }; }),
  };
  const durum = { unut: vi.fn() };
  const service = new EpostaDegisimiService(prisma as unknown as PrismaService, eposta as unknown as EpostaService, durum as unknown as KullaniciDurumService);
  const olarak = <T>(userId: string, is: () => Promise<T>) => baglamlaCalistir({ tenantId: TENANT, userId, rol: "yonetici" }, is);
  const token = () => new URL(gonderilen.find((g) => g.tur === "dogrulama")!.link!).searchParams.get("token")!;
  return { kullanicilar, kimlikler, degisimler, denetim, gonderilen, service, olarak, token, durum, kimlikGuncelle };
}

describe("giriş e-postası değişikliği (KLN-23)", () => {
  it("yönetici başlatır: yeni adrese bağlantı, eski adrese bilgi gider; bağlantı kullanılana kadar giriş adı değişmez", async () => {
    const t = await kur();
    const s = await t.olarak(YONETICI, () => t.service.yoneticiBaslat(HEDEF, { eposta: " ayse.yeni@firma.com " }));
    expect(s.gonderildi).toBe(true);
    expect(t.gonderilen.map((g) => [g.tur, g.alici])).toEqual([["dogrulama", "ayse.yeni@firma.com"], ["bilgi", "ayse@firma.com"]]);
    expect(t.kullanicilar.get(HEDEF)!.eposta).toBe("ayse@firma.com");
    expect(t.kimlikler.get(HEDEF)).toBe("ayse@firma.com");
    expect(t.denetim.map((d) => d.islem)).toEqual(["eposta_degisimi_istendi"]);

    const onay = await t.service.onayla({ token: t.token() });
    expect(onay.eposta).toBe("ayse.yeni@firma.com");
    expect(t.kullanicilar.get(HEDEF)!.eposta).toBe("ayse.yeni@firma.com");
    expect(t.kimlikler.get(HEDEF)).toBe("ayse.yeni@firma.com");
    expect(t.denetim.map((d) => d.islem)).toEqual(["eposta_degisimi_istendi", "eposta_degisti"]);
    expect(t.durum.unut).toHaveBeenCalledWith(HEDEF);
    // Bağlantı tek kullanımlık.
    await expect(t.service.onayla({ token: t.token() })).rejects.toThrow(/geçersiz/);
  });

  it("başka firmadaki hesabın adresi (büyük/küçük harf farkıyla da) alınamaz; aynı adres reddedilir", async () => {
    const t = await kur();
    await expect(t.olarak(YONETICI, () => t.service.yoneticiBaslat(HEDEF, { eposta: "dolu@baska.com" }))).rejects.toThrow(/başka bir hesapta/);
    await expect(t.olarak(YONETICI, () => t.service.yoneticiBaslat(HEDEF, { eposta: "AYSE@firma.com" }))).rejects.toThrow(/aynı/);
    await expect(t.olarak(YONETICI, () => t.service.yoneticiBaslat(HEDEF, { eposta: "gecersiz" }))).rejects.toThrow(/Geçerli/);
    expect(t.gonderilen).toEqual([]);
  });

  it("onaya kadar adres başkasınca alınırsa değişiklik olmaz; yeni istek eski bağlantıyı geçersiz kılar", async () => {
    const t = await kur();
    await t.olarak(YONETICI, () => t.service.yoneticiBaslat(HEDEF, { eposta: "ilk@firma.com" }));
    const ilk = t.token();
    t.gonderilen.length = 0;
    await t.olarak(YONETICI, () => t.service.yoneticiBaslat(HEDEF, { eposta: "ikinci@firma.com" }));
    await expect(t.service.onayla({ token: ilk })).rejects.toThrow(/geçersiz/);
    t.kimlikler.set("baska2", "ikinci@firma.com");
    await expect(t.service.onayla({ token: t.token() })).rejects.toThrow(/başka bir hesapta/);
    expect(t.kimlikGuncelle).not.toHaveBeenCalled();
    expect(t.kullanicilar.get(HEDEF)!.eposta).toBe("ayse@firma.com");
  });

  it("kullanıcı kendi adresini yalnız mevcut parolasıyla değiştirebilir; süresi dolan bağlantı geçmez", async () => {
    const t = await kur();
    await expect(t.olarak(HEDEF, () => t.service.kendiBaslat({ eposta: "ayse2@firma.com", mevcutParola: "yanlis" }))).rejects.toThrow(/parola hatalı/);
    await t.olarak(HEDEF, () => t.service.kendiBaslat({ eposta: "ayse2@firma.com", mevcutParola: PAROLA }));
    t.degisimler[0].gecerlilikSonu = new Date(Date.now() - 1000);
    await expect(t.service.onayla({ token: t.token() })).rejects.toThrow(/süresi dolmuş/);
  });

  it("pasif kullanıcının adresi değiştirilemez", async () => {
    const t = await kur();
    t.kullanicilar.get(HEDEF)!.aktif = false;
    await expect(t.olarak(YONETICI, () => t.service.yoneticiBaslat(HEDEF, { eposta: "yeni@firma.com" }))).rejects.toThrow(/Pasif/);
  });
});
