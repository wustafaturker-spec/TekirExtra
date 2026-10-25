import { beforeEach, describe, expect, it, vi } from "vitest";

const posta = vi.hoisted(() => ({ gonderilen: [] as { to: string; subject: string; text: string }[] }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: async (m: { to: string; subject: string; text: string }) => { posta.gonderilen.push(m); } }) }));

import { firmaAlicilari, tahsilatDurumu, TahsilatHatirlatmaService, type TahsilatAdayi } from "./tahsilat-hatirlatma.service";

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
