import * as argon2 from "argon2";
import { generateSync } from "otplib";
import { beforeAll, describe, expect, it } from "vitest";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";
import { PlatformKullanicilarService } from "./platform-kullanicilar.service";

process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "0".repeat(64);
// Gönderim düşer; bağlantı yöneticiye döner.
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "1";

type Kayit = Record<string, unknown> & { id: string; eposta: string; rol: string; aktif: boolean; davetTuru: string | null; davetAnahtarOzeti: string | null; parolaHash: string };
let hash: string;
beforeAll(async () => { hash = await argon2.hash("EskiParola2026"); });

function kur() {
  const kayitlar: Kayit[] = [];
  const olaylar: { olay: string; kullaniciId: string | null }[] = [];
  const eslesir = (k: Kayit, w: Record<string, unknown>) => Object.entries(w).every(([a, v]) => (v && typeof v === "object" && "not" in v ? k[a] !== (v as { not: unknown }).not : k[a] === v));
  const platformKullanici = {
    findUnique: async ({ where }: { where: Record<string, unknown> }) => { const k = kayitlar.find((x) => eslesir(x, where)); return k ? { ...k } : null; },
    findMany: async () => kayitlar,
    count: async ({ where }: { where: Record<string, unknown> }) => kayitlar.filter((k) => eslesir(k, where)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => { const k = { id: `p${kayitlar.length + 1}`, aktif: true, sonGiris: null, createdAt: new Date(), ...data } as Kayit; kayitlar.push(k); return k; },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(kayitlar.find((k) => k.id === where.id)!, data),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const s = kayitlar.filter((k) => eslesir(k, where)); s.forEach((k) => Object.assign(k, data)); return { count: s.length };
    },
  };
  const db = {
    platformKullanici,
    mevzuatOlay: { create: async ({ data }: { data: { olay: string; kullaniciId: string | null } }) => { olaylar.push(data); return data; } },
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  const servis = new PlatformKullanicilarService({ db } as never);
  const ekle = (k: Partial<Kayit>) => { const y = { id: `p${kayitlar.length + 1}`, eposta: `${kayitlar.length}@x.io`, adSoyad: "Kişi", rol: "yonetici", aktif: true, davetTuru: null, davetAnahtarOzeti: null, parolaHash: hash, totpSecretSifreli: "", ...k } as Kayit; kayitlar.push(y); return y; };
  const olarak = <T>(id: string, is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: id, eposta: "ben@x.io", rol: "yonetici" }, is);
  return { servis, kayitlar, olaylar, ekle, olarak };
}
const anahtarAl = (baglanti?: string) => new URL(baglanti!).searchParams.get("anahtar")!;

describe("platform kullanıcıları (PLT-07)", () => {
  it("davetle açılan hesap giriş bekler; bağlantıyla parola + 2FA kurulunca açılır, bağlantı ikinci kez çalışmaz", async () => {
    const t = kur();
    const ben = t.ekle({});
    const s = await t.olarak(ben.id, () => t.servis.olustur({ eposta: "Yeni@X.io ", adSoyad: "Yeni Kişi", rol: "mevzuat_editoru" }));
    expect(s.kullanici).toMatchObject({ eposta: "yeni@x.io", davetTuru: "hesap", rol: "mevzuat_editoru" });
    expect(s.davet.gonderildi).toBe(false);
    const anahtar = anahtarAl(s.davet.baglanti);
    const bilgi = await t.servis.davetBilgisi(anahtar);
    expect(bilgi).toMatchObject({ eposta: "yeni@x.io", tur: "hesap" });
    await expect(t.servis.davetTamamla(anahtar, { parola: "kisa", kod: generateSync({ secret: bilgi.secret }) })).rejects.toThrow(/10 karakter/);
    await expect(t.servis.davetTamamla(anahtar, { parola: "YeniParola2026", kod: "000000" })).rejects.toThrow(/kod/);
    await t.servis.davetTamamla(anahtar, { parola: "YeniParola2026", kod: generateSync({ secret: bilgi.secret }) });
    const k = t.kayitlar.find((x) => x.eposta === "yeni@x.io")!;
    expect(k.davetTuru).toBeNull();
    expect(await argon2.verify(k.parolaHash, "YeniParola2026")).toBe(true);
    await expect(t.servis.davetBilgisi(anahtar)).rejects.toThrow(/geçersiz/);
    expect(t.olaylar.map((o) => o.olay)).toEqual(["platform_kullanicisi_acildi", "platform_daveti_kabul_edildi"]);
  });

  it("aynı e-posta ikinci kez açılamaz", async () => {
    const t = kur();
    const ben = t.ekle({ eposta: "var@x.io" });
    await expect(t.olarak(ben.id, () => t.servis.olustur({ eposta: "var@x.io", adSoyad: "X Y", rol: "yonetici" }))).rejects.toThrow(/zaten var/);
  });

  it("kimse kendi rolünü/durumunu değiştiremez; son aktif yönetici düşürülemez, davet bekleyen yönetici sayılmaz", async () => {
    const t = kur();
    const ben = t.ekle({});
    const diger = t.ekle({});
    t.ekle({ davetTuru: "hesap" });
    await expect(t.olarak(ben.id, () => t.servis.guncelle(ben.id, { rol: "mevzuat_editoru" }))).rejects.toThrow(/Kendi rolünüzü/);
    await expect(t.olarak(ben.id, () => t.servis.guncelle(ben.id, { aktif: false }))).rejects.toThrow(/Kendi hesabınızı/);
    await t.olarak(ben.id, () => t.servis.guncelle(diger.id, { rol: "mevzuat_editoru" }));
    expect(diger.rol).toBe("mevzuat_editoru");
    // Artık tek kurulu yönetici "ben"; başkası onu pasife alamaz.
    await expect(t.olarak(diger.id, () => t.servis.guncelle(ben.id, { aktif: false }))).rejects.toThrow(/En az bir aktif platform yöneticisi/);
    expect(t.olaylar.map((o) => o.olay)).toEqual(["platform_rolu_degisti"]);
  });

  it("2FA sıfırlanınca hesap kurulum bekler; yeniden kurulum mevcut parolayı ister, parola değişmez", async () => {
    const t = kur();
    const ben = t.ekle({});
    const hedef = t.ekle({ rol: "mevzuat_editoru" });
    await expect(t.olarak(ben.id, () => t.servis.ikiAdimSifirla(ben.id))).rejects.toThrow(/Kendi 2FA/);
    const s = await t.olarak(ben.id, () => t.servis.ikiAdimSifirla(hedef.id));
    expect(hedef.davetTuru).toBe("iki_adim");
    const anahtar = anahtarAl(s.baglanti);
    const bilgi = await t.servis.davetBilgisi(anahtar);
    await expect(t.servis.davetTamamla(anahtar, { parola: "YanlisParola2026", kod: generateSync({ secret: bilgi.secret }) })).rejects.toThrow(/Parola hatalı/);
    await t.servis.davetTamamla(anahtar, { parola: "EskiParola2026", kod: generateSync({ secret: bilgi.secret }) });
    expect(hedef.davetTuru).toBeNull();
    expect(hedef.parolaHash).toBe(hash);
    expect(t.olaylar.map((o) => o.olay)).toEqual(["platform_2fa_sifirlandi", "platform_2fa_yeniden_kuruldu"]);
  });

  it("bağlantıyı yeniden göndermek öncekini geçersiz kılar; süresi dolan bağlantı çalışmaz", async () => {
    const t = kur();
    const ben = t.ekle({});
    const s = await t.olarak(ben.id, () => t.servis.olustur({ eposta: "z@x.io", adSoyad: "Z Z", rol: "yonetici" }));
    const ilk = anahtarAl(s.davet.baglanti);
    const yeni = anahtarAl((await t.olarak(ben.id, () => t.servis.davetYenile(s.kullanici.id))).baglanti);
    await expect(t.servis.davetBilgisi(ilk)).rejects.toThrow(/geçersiz/);
    t.kayitlar.find((k) => k.id === s.kullanici.id)!.davetSonGecerlilik = new Date(Date.now() - 1000);
    await expect(t.servis.davetBilgisi(yeni)).rejects.toThrow(/süresi dolmuş/);
  });
});
