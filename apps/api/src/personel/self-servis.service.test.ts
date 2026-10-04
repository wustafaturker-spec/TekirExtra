import { describe, expect, it, vi } from "vitest";
import { SelfServisService } from "./self-servis.service";

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
