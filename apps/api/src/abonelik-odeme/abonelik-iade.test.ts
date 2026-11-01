import { BadGatewayException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";
import { AbonelikFaturaService } from "./abonelik-fatura.service";
import { PlatformAbonelikIadeService } from "./platform-abonelik-iade.service";

const D = (v: string) => new Prisma.Decimal(v);

function faturaKur(o: { bag?: Record<string, unknown> | null; posKaydi?: boolean; posHata?: Error; deneme?: number; faturaNo?: string | null } = {}) {
  const iade = {
    id: "i1", odemeId: "o1", tutar: D("100.00"), neden: "Kısmi indirim", saglayiciyaGonderildi: true, saglayiciIadeRef: "HOST-1",
    faturalayanDurumu: "bekliyor", faturalayanDeneme: o.deneme ?? 0,
    odeme: { tutar: D("3596.40"), iadeler: [{ tutar: D("100.00") }] }, tenant: { unvan: "DENEME FİRMASI 3 " },
  };
  const tx = {
    abonelikIadesi: { findUnique: vi.fn(async () => iade), update: vi.fn(async () => ({})) },
    posTahsilat: { findFirst: vi.fn(async () => (o.posKaydi === false ? null : { id: "pt1" })) },
    fatura: { findUnique: vi.fn(async () => ({ id: "f1", no: o.faturaNo === undefined ? "SNC2026000000052" : o.faturaNo, durum: "kesin" })) },
  };
  const prisma = {
    tenantIslem: vi.fn(async (_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    abonelikFaturasi: {
      findUnique: vi.fn(async () => (o.bag === null ? null : { odemeId: "o1", faturalayanTenantId: "faturalayan", faturaId: "f1", tahsilatHareketId: "h1", faturaNo: null, ...o.bag })),
      update: vi.fn(async () => ({})),
    },
  };
  const pos = { abonelikIadesiYaz: vi.fn(async () => { if (o.posHata) throw o.posHata; return {}; }) };
  const bildirimler = { uret: vi.fn(async () => ({ bildirimId: "b1", yeniTeslimat: 1 })) };
  const s = new AbonelikFaturaService(prisma as never, {} as never, { kesinlesinceCalistir: vi.fn() } as never, {} as never, {} as never, {} as never, pos as never, bildirimler as never);
  return { s, tx, prisma, pos, bildirimler };
}

describe("PLT-44/45 faturalayan tarafı", () => {
  it("abonelik POS kaydına iade yazar, fatura iade toplamını günceller, belge için bildirim düşer", async () => {
    const { s, pos, prisma, bildirimler, tx } = faturaKur();
    expect(await s.iadeyiIsle("i1", "odeyen")).toBe(true);
    expect(pos.abonelikIadesiYaz).toHaveBeenCalledWith("faturalayan", "pt1", expect.objectContaining({ tutar: "100.00", neden: "Abonelik iadesi — Kısmi indirim" }), { saglayiciyaGonderildi: true, saglayiciIadeRef: "HOST-1" });
    expect(prisma.abonelikFaturasi.update).toHaveBeenCalledWith({ where: { odemeId: "o1" }, data: expect.objectContaining({ iadeTutari: D("100.00") }) });
    const b = bildirimler.uret.mock.calls[0][0] as { baslik: string; aciklama: string; hedefYol: string; roller: string[] };
    expect(b.baslik).toBe("Abonelik ödemesi kısmen iade edildi: DENEME FİRMASI 3");
    expect(b.aciklama).toContain("SNC2026000000052 faturası için iptal ya da iade belgesi düzenleyin. POS iadesi kaydedildi.");
    expect(b).toMatchObject({ hedefYol: "/panel/fatura?faturaId=f1", roller: ["yonetici", "muhasebe"] });
    expect(tx.abonelikIadesi.update).toHaveBeenLastCalledWith({ where: { id: "i1" }, data: { faturalayanDurumu: "yazildi", faturalayanHata: null } });
  });

  it("POS dışı tahsilatta para hareketi yazmaz, kasa/banka kaydı için uyarır", async () => {
    const { s, pos, bildirimler } = faturaKur({ posKaydi: false });
    await s.iadeyiIsle("i1", "odeyen");
    expect(pos.abonelikIadesiYaz).not.toHaveBeenCalled();
    expect((bildirimler.uret.mock.calls[0][0] as { aciklama: string }).aciklama).toContain("para iadesinin kasa/banka kaydını girin");
  });

  it("faturası açılmamış ödemede 'gerekmiyor' olur", async () => {
    const { s, tx, bildirimler } = faturaKur({ bag: null });
    await s.iadeyiIsle("i1", "odeyen");
    expect(tx.abonelikIadesi.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { faturalayanDurumu: "gerekmiyor", faturalayanHata: null } });
    expect(bildirimler.uret).not.toHaveBeenCalled();
  });

  it("hata deneme sayar; üçüncüde 'hata' olur", async () => {
    const a = faturaKur({ posHata: new Error("dönem kapalı") });
    expect(await a.s.iadeyiIsle("i1", "odeyen")).toBe(false);
    expect(a.tx.abonelikIadesi.update).toHaveBeenLastCalledWith({ where: { id: "i1" }, data: { faturalayanDurumu: "bekliyor", faturalayanHata: "dönem kapalı", faturalayanDeneme: 1 } });
    const b = faturaKur({ posHata: new Error("dönem kapalı"), deneme: 2 });
    await b.s.iadeyiIsle("i1", "odeyen");
    expect(b.tx.abonelikIadesi.update).toHaveBeenLastCalledWith({ where: { id: "i1" }, data: { faturalayanDurumu: "hata", faturalayanHata: "dönem kapalı", faturalayanDeneme: 3 } });
  });
});

function iadeKur(o: { kaydetHata?: Error; iadeHata?: Error } = {}) {
  const sorgular: string[] = [];
  const hazir = { tenant_id: "t1", unvan: "A", tutar: D("1198.80"), iade_toplami: D("0"), kaynak: "saglayici", saglayici: "iyzico", ay_sayisi: 1, saglayici_odeme_id: "PAY1", ortam: "test", tekrar: false };
  const db = {
    $queryRaw: vi.fn(async (p: TemplateStringsArray) => { const m = p.join("?"); sorgular.push(m); return m.includes("iade_hazirla") ? [hazir] : []; }),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      if (o.kaydetHata) throw o.kaydetHata;
      return fn({ $queryRaw: vi.fn(async () => [{ iade_id: "i1", tam_iade: true, onceki_donem_sonu: new Date("2026-12-01T00:00:00Z"), yeni_donem_sonu: new Date("2026-11-01T00:00:00Z"), tekrar: false }]), mevzuatOlay: { create: vi.fn() } });
    }),
  };
  const fatura = { iadeyiIsle: vi.fn(async () => true) };
  const s = new PlatformAbonelikIadeService({ db } as never, { etkin: vi.fn(async () => ({ saglayici: "iyzico", ortam: "test", config: { apiKey: "a", secretKey: "s" } })) } as never, fatura as never);
  s.iyzico = { odemeAyrintisi: vi.fn(async () => ({ odemeIslemNolari: ["PTX"] })), iadeEt: vi.fn(async () => { if (o.iadeHata) throw o.iadeHata; return { ref: "R1", tutar: "1198.80" }; }) } as never;
  return { s, sorgular, fatura };
}
const olarak = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: "p1", eposta: "p@x", rol: "yonetici" }, is);
const girdi = { tutar: "1198.80", neden: "İptal", saglayiciyaGonder: true, islemAnahtari: "ANAHTAR-0123456789" };

describe("PLT-42 platform iadesi hata yolları", () => {
  it("sağlayıcı reddederse kayıt yazılmaz, kilit açılır (502)", async () => {
    const { s, sorgular } = iadeKur({ iadeHata: new Error("Refund not allowed") });
    await expect(olarak(() => s.iadeEt("o1", girdi))).rejects.toBeInstanceOf(BadGatewayException);
    expect(sorgular.some((m) => m.includes("iade_kilidi_ac"))).toBe(true);
    expect(sorgular.some((m) => m.includes("iade_kaydet"))).toBe(false);
  });

  it("sağlayıcı onaylayıp kayıt yazılamazsa kilit kalır, ref ile 409", async () => {
    const { s, sorgular } = iadeKur({ kaydetHata: new Error("bağlantı koptu") });
    await expect(olarak(() => s.iadeEt("o1", girdi))).rejects.toThrow(ConflictException);
    await expect(olarak(() => iadeKur({ kaydetHata: new Error("bağlantı koptu") }).s.iadeEt("o1", girdi))).rejects.toThrow(/ref R1.*yeniden göndermeyin/);
    expect(sorgular.some((m) => m.includes("iade_kilidi_ac"))).toBe(false);
  });

  it("başarıda faturalayan tarafı hemen işlenir; mesaj dönem değişimini söyler", async () => {
    const { s, fatura } = iadeKur();
    const r = await olarak(() => s.iadeEt("o1", girdi));
    expect(fatura.iadeyiIsle).toHaveBeenCalledWith("i1", "t1");
    expect(r).toMatchObject({ tamIade: true, ref: "R1" });
    expect(r.mesaj).toMatch(/1\.198,80 TL tam iade kaydedildi; para iyzico üzerinden iade edildi \(ref R1\)\. Dönem sonu/);
  });
});
