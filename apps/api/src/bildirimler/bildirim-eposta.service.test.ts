import { describe, expect, it, vi } from "vitest";
import { BildirimEpostaService, sessizSaatte } from "./bildirim-eposta.service";
import { IletiSiniriAsildi } from "../ileti/ileti-kurallari";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "yonetici" }) }));

function teslimat(ek: Record<string, unknown> = {}) {
  return {
    id: "d1",
    epostaDenemeSayisi: 0,
    bildirim: { baslik: "e-Belge reddedildi", aciklama: "SF2026000123 reddedildi", onem: "kritik", hedefYol: "/panel/fatura?ebelge=hata" },
    kullanici: { id: "u1", eposta: "muhasebe@deneme.local", adSoyad: "Ayşe Yılmaz", bildirimAyari: null },
    ...ek,
  };
}

function servisKur(bekleyenler: unknown[], gonderim: () => Promise<unknown> = async () => undefined) {
  const update = vi.fn();
  const tx = { bildirimTeslimati: { findMany: vi.fn().mockResolvedValue(bekleyenler), update } };
  const prisma = { tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)) } as never;
  const eposta = { iletiGonder: vi.fn(gonderim) };
  return { servis: new BildirimEpostaService(prisma, eposta as never), eposta, update };
}

describe("sessizSaatte", () => {
  it("gece yarısını aşan aralığı doğru değerlendirir", () => {
    expect(sessizSaatte(23 * 60, "22:00", "07:00")).toBe(true);
    expect(sessizSaatte(3 * 60, "22:00", "07:00")).toBe(true);
    expect(sessizSaatte(9 * 60, "22:00", "07:00")).toBe(false);
    expect(sessizSaatte(7 * 60, "22:00", "07:00")).toBe(false);
  });

  it("gün içi aralığı ve tanımsız aralığı ayırır", () => {
    expect(sessizSaatte(13 * 60, "12:00", "14:00")).toBe(true);
    expect(sessizSaatte(15 * 60, "12:00", "14:00")).toBe(false);
    expect(sessizSaatte(3 * 60, null, null)).toBe(false);
    expect(sessizSaatte(3 * 60, "22:00", null)).toBe(false);
  });
});

describe("BildirimEpostaService.bekleyenleriGonder", () => {
  it("gönderim başarılıysa teslimatı gönderildi olarak damgalar", async () => {
    const { servis, eposta, update } = servisKur([teslimat()]);
    const sonuc = await servis.bekleyenleriGonder();

    expect(sonuc).toEqual({ gonderilen: 1, ertelenen: 0, basarisiz: 0 });
    expect(eposta.iletiGonder).toHaveBeenCalledWith(
      expect.objectContaining({ alici: "muhasebe@deneme.local", konu: "TekirExtra — e-Belge reddedildi" }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ epostaDurumu: "gonderildi", epostaGonderildiAt: expect.any(Date) }) }),
    );
  });

  it("sessiz saatteki kullanıcıya göndermez, kaydı beklemede bırakır", async () => {
    const simdi = new Date();
    const bir = String(simdi.getHours()).padStart(2, "0");
    const { servis, eposta, update } = servisKur([
      teslimat({ kullanici: { ...teslimat().kullanici, bildirimAyari: { sessizBaslangic: `${bir}:00`, sessizBitis: "23:59" } } }),
    ]);

    const sonuc = await servis.bekleyenleriGonder();

    expect(sonuc).toEqual({ gonderilen: 0, ertelenen: 1, basarisiz: 0 });
    expect(eposta.iletiGonder).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("hata alınca deneme sayısını artırır ve tekrar denenmek üzere bekletir", async () => {
    const { servis, update } = servisKur([teslimat({ epostaDenemeSayisi: 1 })], async () => {
      throw new Error("SMTP bağlantısı reddedildi");
    });

    const sonuc = await servis.bekleyenleriGonder();

    expect(sonuc).toEqual({ gonderilen: 0, ertelenen: 0, basarisiz: 1 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ epostaDurumu: "beklemede", epostaDenemeSayisi: 2, epostaHatasi: "SMTP bağlantısı reddedildi" }) }),
    );
  });

  it("kalıcı SMTP hatasında tekrar denemez (ILT-04)", async () => {
    const { servis, update } = servisKur([teslimat()], async () => { throw Object.assign(new Error("adres yok"), { responseCode: 550 }); });
    await servis.bekleyenleriGonder();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ epostaDurumu: "hata", epostaDenemeSayisi: 1 }) }));
  });

  it("tavan doluysa turu durdurur, deneme harcamaz (ILT-14)", async () => {
    const { servis, eposta, update } = servisKur([teslimat(), teslimat({ id: "d2" })], async () => { throw new IletiSiniriAsildi("tavan", "gunluk"); });
    expect(await servis.bekleyenleriGonder()).toEqual({ gonderilen: 0, ertelenen: 1, basarisiz: 0 });
    expect(eposta.iletiGonder).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("tekrar sınırında sıradaki alıcıya geçer (ILT-14)", async () => {
    const { servis, eposta, update } = servisKur([teslimat(), teslimat({ id: "d2" })], async () => { throw new IletiSiniriAsildi("tekrar", "tekrar"); });
    expect(await servis.bekleyenleriGonder()).toEqual({ gonderilen: 0, ertelenen: 2, basarisiz: 0 });
    expect(eposta.iletiGonder).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });

  it("son denemede de başarısızsa kalıcı hata olarak kapatır", async () => {
    const { servis, update } = servisKur([teslimat({ epostaDenemeSayisi: 4 })], async () => {
      throw new Error("SMTP bağlantısı reddedildi");
    });

    await servis.bekleyenleriGonder();

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ epostaDurumu: "hata", epostaDenemeSayisi: 5 }) }));
  });
});

describe("sessiz saat Türkiye saatiyle (sunucu UTC olsa da)", () => {
  it("UTC 19:30 = TR 22:30 sayılır", async () => {
    const { trDakika } = await import("./bildirim-eposta.service");
    expect(trDakika(new Date("2026-11-12T19:30:00Z"))).toBe(22 * 60 + 30);
    expect(trDakika(new Date("2026-11-12T22:15:00Z"))).toBe(1 * 60 + 15);
  });
});
