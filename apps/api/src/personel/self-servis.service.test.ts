import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { SelfServisService } from "./self-servis.service";
import { hassasCoz } from "./personel-hassas";

const PID = "11111111-1111-4111-8111-111111111111";

function kur(ek: { kullanici?: unknown; kimlik?: unknown; userBagi?: unknown; bordro?: unknown } = {}) {
  const tx = {
    personel: { findFirst: vi.fn(async () => ({ id: PID, ad: "Ali", soyad: "Veli", eposta: "Ali@Ornek.com", durum: "aktif", kullanici: ek.kullanici ?? null })) },
    user: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), findUnique: vi.fn(async () => ek.userBagi ?? null), findFirst: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 1 })) },
    personelBordro: { findFirst: vi.fn(async () => ek.bordro ?? null) },
    auditLog: { create: vi.fn(async () => ({})) },
    tenant: { findUnique: vi.fn(async () => ({ unvan: "Firma" })) },
  };
  const prisma = { tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx), authKimlik: { findUnique: vi.fn(async () => ek.kimlik ?? null), create: vi.fn(async () => ({})) } };
  const eposta = { iletiGonder: vi.fn(async () => undefined) };
  const pusula = { pdfUret: vi.fn(async () => ({ buffer: Buffer.from("x"), dosyaAdi: "p.pdf" })) };
  const s = new SelfServisService(prisma as never, eposta as never, pusula as never, {} as never);
  return { s, tx, prisma, eposta, pusula };
}

describe("self-servis (PRS-21)", () => {
  it("davet: çalışan rolünde hesap açar, e-posta küçük harf; e-posta istenmezse bağlantı İK'ya döner", async () => {
    const { s, tx, prisma, eposta } = kur();
    const r = await s.davetEt("t1", PID, "u1", { epostaGonder: false });
    expect(tx.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ rol: "calisan", eposta: "ali@ornek.com", personelId: PID, davetAnahtarOzeti: expect.any(String) }) });
    expect(prisma.authKimlik.create).toHaveBeenCalled();
    expect(eposta.iletiGonder).not.toHaveBeenCalled();
    expect(r.davetAdresi).toMatch(/\/davet\/t1\/[A-Za-z0-9_-]{43}$/);
  });

  it("davet: e-posta gidince bağlantı İK'ya gösterilmez; kullanılan hesap yeniden davet edilmez; başka hesabın e-postası reddedilir", async () => {
    const a = kur();
    expect((await a.s.davetEt("t1", PID, "u1", {})).davetAdresi).toBeNull();
    expect(a.eposta.iletiGonder).toHaveBeenCalled();
    await expect(kur({ kullanici: { id: "k", eposta: "x", aktif: true, davetAnahtarOzeti: null } }).s.davetEt("t1", PID, "u1", {})).rejects.toThrow(/zaten kullanıyor/);
    await expect(kur({ kimlik: { userId: "baska" } }).s.davetEt("t1", PID, "u1", {})).rejects.toThrow(/başka bir kullanıcı/);
  });

  it("çalışan yalnız kendi onaylı pusulasını indirir; kartı olmayan hesap reddedilir", async () => {
    await expect(kur({ userBagi: { personelId: null } }).s.pusulalar("t1", "u1")).rejects.toThrow(/personel kartına bağlı değil/);
    const yok = kur({ userBagi: { personelId: PID } });
    await expect(yok.s.pusulaPdf("t1", "u1", "b1")).rejects.toThrow(/bulunamadı/);
    expect(yok.tx.personelBordro.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "b1", personelId: PID }) }));
    const var_ = kur({ userBagi: { personelId: PID }, bordro: { id: "b1" } });
    await var_.s.pusulaPdf("t1", "u1", "b1");
    expect(var_.pusula.pdfUret).toHaveBeenCalledWith("b1");
  });

  it("parola belirleme biçimsiz anahtarı reddeder ve parola kuralını uygular", async () => {
    const { s } = kur();
    await expect(s.parolaBelirle("t1", "kisa", { parola: "Gecerli12345" })).rejects.toThrow(/geçersiz/);
    await expect(s.parolaBelirle("t1", "a".repeat(43), { parola: "kisa" })).rejects.toThrow();
  });
});

describe("self-servis talepleri (PRS-22)", () => {
  const IBAN = "TR330006100519786457841326";
  function kur2(ek: { acikAvans?: number; talep?: unknown; createHata?: unknown; guncelleHata?: unknown } = {}) {
    const tx = {
      user: { findUnique: vi.fn(async () => ({ personelId: PID })) },
      personelAvans: { count: vi.fn(async () => ek.acikAvans ?? 0) },
      personelBilgiTalebi: {
        create: vi.fn(async (a: { data: { alanlar: unknown } }) => { if (ek.createHata) throw ek.createHata; return { id: "bt", durum: "bekliyor", alanlar: a.data.alanlar }; }),
        findFirst: vi.fn(async () => ek.talep ?? null), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({})),
      },
    };
    const prisma = { tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx) };
    const personel = { avansVer: vi.fn(async () => ({ id: "a1" })), guncelle: vi.fn(async () => { if (ek.guncelleHata) throw ek.guncelleHata; return {}; }) };
    return { s: new SelfServisService(prisma as never, {} as never, {} as never, {} as never, personel as never), tx, personel };
  }

  it("avans talebi kendi kartına talep olarak açılır; açık talep varken yenisi reddedilir", async () => {
    const a = kur2();
    await a.s.avansTalebi("t1", "u1", { tutar: 5000, aciklama: "kira" });
    expect(a.personel.avansVer).toHaveBeenCalledWith("t1", "u1", expect.objectContaining({ personelId: PID, tutar: 5000, aciklama: "kira" }));
    await expect(kur2({ acikAvans: 1 }).s.avansTalebi("t1", "u1", { tutar: 100 })).rejects.toThrow(/Onay bekleyen avans/);
  });

  it("bilgi talebi: IBAN şifreli saklanır, maskeli döner; boş talep ve açık ikinci talep reddedilir", async () => {
    const a = kur2();
    const r = await a.s.bilgiTalebi("t1", "u1", { iban: "tr33 0006 1005 1978 6457 8413 26", telefon: "0555" });
    const kayitli = (a.tx.personelBilgiTalebi.create.mock.calls[0][0] as { data: { alanlar: { iban: string; telefon: string } } }).data.alanlar;
    expect(kayitli.iban).not.toContain("TR33");
    expect(hassasCoz(kayitli.iban)).toBe(IBAN);
    expect(r.alanlar).toEqual({ telefon: "0555", iban: "TR33 •••• •••• 1326" });
    await expect(a.s.bilgiTalebi("t1", "u1", {})).rejects.toThrow(/En az bir alan/);
    await expect(a.s.bilgiTalebi("t1", "u1", { iban: "TR12" })).rejects.toThrow(/TR IBAN/);
    const cift = kur2({ createHata: new Prisma.PrismaClientKnownRequestError("tekil", { code: "P2002", clientVersion: "x" }) });
    await expect(cift.s.bilgiTalebi("t1", "u1", { telefon: "1" })).rejects.toThrow(/Onay bekleyen bilgi/);
  });

  it("onay alanları personel güncellemesinden geçirir (IBAN açık); güncelleme düşerse talep beklemeye döner", async () => {
    const { hassasSifrele } = await import("./personel-hassas");
    const talep = { id: "bt", personelId: PID, alanlar: { iban: hassasSifrele(IBAN), adres: "Yeni adres" } };
    const a = kur2({ talep });
    await a.s.bilgiOnayla("t1", "bt", "ik1");
    expect(a.personel.guncelle).toHaveBeenCalledWith("t1", PID, { adres: "Yeni adres", iban: IBAN }, "ik1");
    const b = kur2({ talep, guncelleHata: new Error("cari güncellenemedi") });
    await expect(b.s.bilgiOnayla("t1", "bt", "ik1")).rejects.toThrow(/cari/);
    expect(b.tx.personelBilgiTalebi.update).toHaveBeenCalledWith({ where: { id: "bt" }, data: { durum: "bekliyor", kararVerenUserId: null, kararTarihi: null } });
    const kendi = kur2({ talep: { ...talep, olusturanUserId: "ik1" } });
    await expect(kendi.s.bilgiOnayla("t1", "bt", "ik1")).rejects.toThrow(/Kendi bilgi/);
    expect(kendi.personel.guncelle).not.toHaveBeenCalled();
  });
});
