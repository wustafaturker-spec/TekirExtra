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
  const gorevler: { id: string; baslik: string; kapsam: string; durum: string; sorumluId: string | null; surum: number }[] = [];
  const olaylar: { olay: string; kullaniciId: string | null; detay?: Record<string, unknown> }[] = [];
  const eslesir = (k: Record<string, unknown>, w: Record<string, unknown>) => Object.entries(w).every(([a, v]) => (v && typeof v === "object" && "not" in v ? k[a] !== (v as { not: unknown }).not
    : v && typeof v === "object" && "in" in v ? (v as { in: unknown[] }).in.includes(k[a]) : k[a] === v));
  const platformKullanici = {
    findUnique: async ({ where }: { where: Record<string, unknown> }) => { const k = kayitlar.find((x) => eslesir(x, where)); return k ? { ...k } : null; },
    findMany: async () => kayitlar,
    findFirst: async ({ where }: { where: Record<string, unknown> }) => { const k = kayitlar.find((x) => eslesir(x, where)); return k ? { ...k } : null; },
    count: async ({ where }: { where: Record<string, unknown> }) => kayitlar.filter((k) => eslesir(k, where)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => { const k = { id: `p${kayitlar.length + 1}`, aktif: true, sonGiris: null, createdAt: new Date(), ...data } as Kayit; kayitlar.push(k); return k; },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(kayitlar.find((k) => k.id === where.id)!, data),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const s = kayitlar.filter((k) => eslesir(k, where)); s.forEach((k) => Object.assign(k, data)); return { count: s.length };
    },
  };
  const db = {
    platformKullanici,
    mevzuatOlay: { create: async ({ data }: { data: { olay: string; kullaniciId: string | null; detay?: Record<string, unknown> } }) => { olaylar.push(data); return data; } },
    platformGorev: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => gorevler.filter((g) => eslesir(g, where)).map((g) => ({ ...g })),
      update: async ({ where, data }: { where: { id: string }; data: { sorumluId: string; surum: { increment: number } } }) => { const g = gorevler.find((x) => x.id === where.id)!; g.sorumluId = data.sorumluId; g.surum += data.surum.increment; return { ...g }; },
      groupBy: async ({ where }: { where: Record<string, unknown> }) => {
        const sayi = new Map<string | null, number>();
        for (const g of gorevler.filter((x) => eslesir(x, where))) sayi.set(g.sorumluId, (sayi.get(g.sorumluId) ?? 0) + 1);
        return [...sayi].map(([sorumluId, n]) => ({ sorumluId, _count: { _all: n } }));
      },
    },
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  const servis = new PlatformKullanicilarService({ db } as never);
  const ekle = (k: Partial<Kayit>) => { const y = { id: `p${kayitlar.length + 1}`, eposta: `${kayitlar.length}@x.io`, adSoyad: "Kişi", rol: "yonetici", aktif: true, davetTuru: null, davetAnahtarOzeti: null, parolaHash: hash, totpSecretSifreli: "", ...k } as Kayit; kayitlar.push(y); return y; };
  const olarak = <T>(id: string, is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: id, eposta: "ben@x.io", rol: "yonetici" }, is);
  const gorevEkle = (sorumluId: string, kapsam = "platform", durum = "acik") => { const g = { id: `g${gorevler.length + 1}`, baslik: `Görev ${gorevler.length + 1}`, kapsam, durum, sorumluId, surum: 1 }; gorevler.push(g); return g; };
  return { servis, kayitlar, olaylar, gorevler, ekle, gorevEkle, olarak };
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

describe("rol düşürmede platform görevi aktarımı (PLT-31)", () => {
  it("açık platform görevi olan yönetici, aktarım hedefi verilmeden editöre düşürülemez", async () => {
    const t = kur();
    const ben = t.ekle({}); const ayse = t.ekle({});
    t.gorevEkle(ayse.id); t.gorevEkle(ayse.id, "platform", "devam_ediyor");
    await expect(t.olarak(ben.id, () => t.servis.guncelle(ayse.id, { rol: "mevzuat_editoru" }))).rejects.toThrow(/2 açık platform görevi/);
    expect(ayse.rol).toBe("yonetici");
    expect(t.olaylar).toEqual([]);
  });

  it("hedefle düşürülünce yalnız açık platform görevleri aktarılır, sürüm artar ve her aktarım olaya yazılır", async () => {
    const t = kur();
    const ben = t.ekle({}); const ayse = t.ekle({}); const mehmet = t.ekle({});
    const a = t.gorevEkle(ayse.id); const b = t.gorevEkle(ayse.id, "platform", "devam_ediyor");
    const kapali = t.gorevEkle(ayse.id, "platform", "tamamlandi"); const mevzuat = t.gorevEkle(ayse.id, "mevzuat");
    await t.olarak(ben.id, () => t.servis.guncelle(ayse.id, { rol: "mevzuat_editoru", gorevAktarimHedefiId: mehmet.id }));
    expect(ayse.rol).toBe("mevzuat_editoru");
    expect([a, b].map((g) => [g.sorumluId, g.surum])).toEqual([[mehmet.id, 2], [mehmet.id, 2]]);
    expect([kapali.sorumluId, mevzuat.sorumluId]).toEqual([ayse.id, ayse.id]);
    const aktarim = t.olaylar.filter((o) => o.olay === "platform_gorevi_guncellendi");
    expect(aktarim.map((o) => o.detay)).toEqual([a, b].map((g) => ({ gorevId: g.id, baslik: g.baslik, neden: "rol_dusurme_aktarimi", oncekiSorumluId: ayse.id, yeniSorumluId: mehmet.id, surum: 2 })));
    expect(t.olaylar.find((o) => o.olay === "platform_rolu_degisti")?.detay).toMatchObject({ aktarilanGorev: 2, gorevAktarimHedefiId: mehmet.id });
  });

  it("hedef kendisi, editör, pasif ya da kurulumu bitmemiş yönetici olamaz", async () => {
    const t = kur();
    const ben = t.ekle({}); const ayse = t.ekle({});
    const editor = t.ekle({ rol: "mevzuat_editoru" }); const pasif = t.ekle({ aktif: false }); const kurulum = t.ekle({ davetTuru: "iki_adim" });
    t.gorevEkle(ayse.id);
    for (const hedef of [ayse.id, editor.id, pasif.id, kurulum.id, "00000000-0000-0000-0000-000000000000"]) {
      await expect(t.olarak(ben.id, () => t.servis.guncelle(ayse.id, { rol: "mevzuat_editoru", gorevAktarimHedefiId: hedef }))).rejects.toThrow(/başka bir aktif platform yöneticisine/);
    }
    expect(ayse.rol).toBe("yonetici");
  });

  it("açık platform görevi yoksa hedef istenmez; pasife alma görev olsa da engellenmez", async () => {
    const t = kur();
    const ben = t.ekle({}); const ayse = t.ekle({}); const mehmet = t.ekle({});
    t.gorevEkle(ayse.id, "platform", "tamamlandi");
    await t.olarak(ben.id, () => t.servis.guncelle(ayse.id, { rol: "mevzuat_editoru" }));
    expect(ayse.rol).toBe("mevzuat_editoru");
    const g = t.gorevEkle(mehmet.id);
    await t.olarak(ben.id, () => t.servis.guncelle(mehmet.id, { aktif: false }));
    expect([mehmet.aktif, g.sorumluId]).toEqual([false, mehmet.id]);
  });

  it("liste her kullanıcının açık platform görevi sayısını taşır", async () => {
    const t = kur();
    const ben = t.ekle({}); const ayse = t.ekle({});
    t.gorevEkle(ayse.id); t.gorevEkle(ayse.id, "platform", "devam_ediyor"); t.gorevEkle(ayse.id, "platform", "iptal"); t.gorevEkle(ayse.id, "mevzuat");
    const liste = await t.olarak(ben.id, () => t.servis.listele());
    expect(liste.map((k) => k.acikPlatformGorevi)).toEqual([0, 2]);
  });
});
