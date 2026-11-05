import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAKET_MODUL_KODLARI } from "@tekirextra/shared";

const posta = vi.hoisted(() => ({ gonderilen: [] as { to: string; subject: string; text: string }[] }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: async (m: { to: string; subject: string; text: string }) => { posta.gonderilen.push(m); } }) }));

import { baglantiAnahtariDogrula } from "../abonelik-odeme/baglanti-anahtari";
import { firmaAlicilari, odemeBaglantisi, tahsilatDurumu, TahsilatHatirlatmaService, type TahsilatAdayi } from "./tahsilat-hatirlatma.service";

const simdi = new Date("2026-10-25T09:00:00Z");
const gun = (n: number) => new Date(simdi.getTime() + n * 24 * 3600 * 1000);
const aday = (id: string, donemSonu: Date, ek: Partial<TahsilatAdayi> = {}): TahsilatAdayi => ({
  tenant_id: id, unvan: `Firma ${id} `, plan_kodu: "baslangic", durum: "aktif", donem_sonu: donemSonu, fatura_epostasi: `fatura@${id}.com`, yonetici_epostalari: [`yonetici@${id}.com`], ...ek,
});

describe("elle tahsilat hatırlatması (PLT-09)", () => {
  it("7 gün içinde bitecekler hatırlatılır; 15 günden fazla gecikenler askı listesine düşer", () => {
    const d = tahsilatDurumu([aday("a", gun(3)), aday("b", gun(8)), aday("c", gun(-2)), aday("d", gun(-16)), aday("e", gun(7))], simdi);
    expect(d.yaklasan.map((a) => a.tenant_id)).toEqual(["a", "e"]);
    expect(d.geciken.map((a) => a.tenant_id)).toEqual(["d"]);
  });

  it("firma alıcıları fatura e-postası + yöneticiler; tekrar ve boş adres atılır", () => {
    expect(firmaAlicilari({ fatura_epostasi: "Muhasebe@x.com", yonetici_epostalari: ["muhasebe@x.com", "ali@x.com"] })).toEqual(["Muhasebe@x.com", "ali@x.com"]);
    expect(firmaAlicilari({ fatura_epostasi: null, yonetici_epostalari: [] })).toEqual([]);
  });

  describe("çalıştırma", () => {
    let olaylar: { olay: string; detay: { anahtar: string } }[];
    let adaylar: TahsilatAdayi[];
    const servis = () => new TahsilatHatirlatmaService({ db: {
      $queryRaw: async () => adaylar,
      mevzuatOlay: {
        findMany: async () => olaylar.map((o) => ({ detay: o.detay })),
        create: async ({ data }: { data: { olay: string; detay: { anahtar: string } } }) => { olaylar.push(data); },
      },
      platformKullanici: { findMany: async ({ where }: { where: { rol: string } }) => (where.rol === "yonetici" ? [{ eposta: "ekip@tekirextra.com" }] : []) },
    } } as never);
    beforeEach(() => { posta.gonderilen.length = 0; olaylar = []; adaylar = [aday("a", gun(3)), aday("d", gun(-20))]; });

    it("firmaya ve platform yöneticisine bir kez gider; gün içinde ikinci tur sessizdir", async () => {
      await expect(servis().calistir(simdi)).resolves.toEqual({ firma: 1, ozet: true });
      expect(posta.gonderilen.map((m) => m.to)).toEqual(["fatura@a.com, yonetici@a.com", "ekip@tekirextra.com"]);
      expect(posta.gonderilen[0].text).toMatch(/Firma a firmasının .* dönemi 28\.10\.2026 tarihinde bitiyor/);
      expect(posta.gonderilen[1].text).toMatch(/Dönemi 7 gün içinde bitecek[\s\S]*Firma a[\s\S]*Askıya alınacaklar[\s\S]*Firma d/);
      expect(posta.gonderilen[1].text).toMatch(/Otomatik askı yoktur/);
      posta.gonderilen.length = 0;
      await expect(servis().calistir(new Date(simdi.getTime() + 3600_000))).resolves.toEqual({ firma: 0, ozet: false });
      expect(posta.gonderilen).toEqual([]);
    });

    it("ertesi gün yalnız askı özeti yeniden gider; ödeme dönemi uzatınca firma listeden çıkar", async () => {
      await servis().calistir(simdi);
      posta.gonderilen.length = 0;
      await servis().calistir(gun(1));
      expect(posta.gonderilen.map((m) => m.subject)).toEqual(["TekirExtra tahsilat özeti: askıya alınacak firmalar"]);
      posta.gonderilen.length = 0;
      adaylar = [aday("a", gun(3)), aday("d", gun(40))]; // d için ödeme işaretlendi
      await servis().calistir(gun(2));
      expect(posta.gonderilen).toEqual([]);
    });
  });
});

describe("hatırlatmadaki ödeme bağlantısı (PLT-13)", () => {
  it("etkin sağlayıcı ve fiyatlı planda imzalı bağlantı; aksi hâlde yok", () => {
    process.env.JWT_SECRET ??= "test-sirri";
    const tenantId = "3f1c2a4e-1b2c-4d5e-8f90-1234567890ab";
    const baglanti = odemeBaglantisi({ tenant_id: tenantId, plan_kodu: "baslangic" }, true, simdi)!;
    expect(baglanti).toMatch(/\/api\/v1\/abonelik-odeme\/baglanti\/[^/]+$/);
    expect(baglantiAnahtariDogrula(baglanti.split("/").pop()!, simdi)).toBe(tenantId);
    expect(odemeBaglantisi({ tenant_id: tenantId, plan_kodu: "kurumsal" }, true, simdi)).toBeNull();
    expect(odemeBaglantisi({ tenant_id: tenantId, plan_kodu: "baslangic" }, false, simdi)).toBeNull();
  });

  it("eski plana eşlenmeyen fiyatlı katalog aboneliğine de ödeme bağlantısı verir", () => {
    process.env.JWT_SECRET ??= "test-sirri";
    const tenantId = "3f1c2a4e-1b2c-4d5e-8f90-1234567890ab";
    const kosullar = {
      semaSurumu: 2, kaynak: "katalog_atamasi", planKodu: "ozel_paket", planAdi: "Özel Paket",
      limitler: { kullanici: 5, cari: 100, stok: 200, aylikFatura: 50 },
      fiyatlandirma: { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20", donemler: [{ aySayisi: 1, matrah: "100.00" }] },
      kapsamSozlesmesi: { semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: { kullanici: { sinir: 5, uyariYuzdesi: 80 }, cari: { sinir: 100, uyariYuzdesi: 80 }, stok: { sinir: 200, uyariYuzdesi: 80 }, aylikFatura: { sinir: 50, uyariYuzdesi: 80 } } },
    };
    const baglanti = odemeBaglantisi({ tenant_id: tenantId, plan_kodu: "ozel_paket", paket_surumu_id: "3f1c2a4e-1b2c-4d5e-8f90-1234567890ac", paket_kosullari: kosullar }, true, simdi);
    expect(baglanti).toMatch(/\/api\/v1\/abonelik-odeme\/baglanti\/[^/]+$/);
  });
});
