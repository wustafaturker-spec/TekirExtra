import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { Roller } from "../../auth/roller.decorator";
import { istekBaglami } from "../../core/istek-baglami";
import { EbelgeUygulamasi } from "../../ebelge/ebelge-uygulamasi.decorator";
import { UcCagirici } from "./uc-cagirici";

class OrnekDenetleyici {
  async oku(id: string) { return { id }; }
  @Roller("muhasebe")
  async yaz(id: string, govde: unknown) { return { id, govde }; }
  @Roller("muhasebe")
  @EbelgeUygulamasi("efatura")
  async gonder(id: string) { return { id }; }
}

function kur(ebelgeAcik = true) {
  const denetleyici = new OrnekDenetleyici();
  const uygulamalar = { uygulamalar: vi.fn().mockResolvedValue({ efatura: { acik: ebelgeAcik }, earsiv: { acik: false }, eirsaliye: { acik: false } }) };
  const moduleRef = { get: vi.fn((tip: unknown) => (tip === OrnekDenetleyici ? denetleyici : uygulamalar)) };
  const auditLog = { create: vi.fn().mockResolvedValue({}) };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (tx: unknown) => unknown) => fn({ auditLog })) };
  const uc = new UcCagirici(moduleRef as never, new Reflector(), prisma as never);
  const olarak = <T>(rol: string, fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: rol as never } }, fn);
  return { uc, auditLog, olarak };
}

const UC = {
  oku: { denetleyici: OrnekDenetleyici, yontem: "oku", yol: "GET /ornek/:id" },
  yaz: { denetleyici: OrnekDenetleyici, yontem: "yaz", yol: "POST /ornek/:id" },
  gonder: { denetleyici: OrnekDenetleyici, yontem: "gonder", yol: "POST /ornek/:id/gonder" },
};

describe("uç çağırıcı (AI-02)", () => {
  it("ucun @Roller kuralını ekranla aynı uygular", () => {
    const { uc } = kur();
    expect(uc.yetkiliMi(UC.oku, "depo")).toBe(true);
    expect(uc.yetkiliMi(UC.yaz, "depo")).toBe(false);
    expect(uc.yetkiliMi(UC.yaz, "muhasebe")).toBe(true);
    expect(uc.yetkiliMi(UC.yaz, "yonetici")).toBe(true);
    expect(uc.yetkiliMi(UC.oku, "calisan")).toBe(false);
  });

  it("yetkisiz rolün çağrısını çalıştırmadan reddeder", async () => {
    const { uc, auditLog, olarak } = kur();
    await expect(olarak("satis", () => uc.cagir(UC.yaz, ["1", {}], { kaynak: "asistan", arac: "x" }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it("yazan çağrıyı araç ve kaynakla denetim kaydına yazar; okuyanı yazmaz", async () => {
    const { uc, auditLog, olarak } = kur();
    expect(await olarak("muhasebe", () => uc.cagir(UC.yaz, ["1", { a: 1 }], { kaynak: "mcp", arac: "ornek", talepId: "t1", varlikId: "1" }))).toEqual({ id: "1", govde: { a: 1 } });
    await olarak("muhasebe", () => uc.cagir(UC.oku, ["1"], { kaynak: "mcp", arac: "ornek" }));
    expect(auditLog.create).toHaveBeenCalledTimes(1);
    expect(auditLog.create.mock.calls[0][0].data).toMatchObject({ islem: "AI POST /ornek/:id", varlik: "ornek", varlikId: "1", detay: { kaynak: "mcp", arac: "ornek", talepId: "t1" } });
  });

  it("e-Belge uygulaması kapalı firmada ucu reddeder", async () => {
    const kapali = kur(false);
    await expect(kapali.olarak("muhasebe", () => kapali.uc.cagir(UC.gonder, ["1"]))).rejects.toBeInstanceOf(ForbiddenException);
    const acik = kur(true);
    await expect(acik.olarak("muhasebe", () => acik.uc.cagir(UC.gonder, ["1"]))).resolves.toEqual({ id: "1" });
  });
});

describe("uç çağırıcı Nest kapsayıcısında", () => {
  it("başka modüldeki denetleyiciyi ModuleRef ile bulur (modül importu olmadan)", async () => {
    const { Controller, Inject, Injectable, Module } = await import("@nestjs/common");
    const { ModuleRef, NestFactory } = await import("@nestjs/core");

    @Injectable()
    class Bagimlilik { deger() { return 42; } }

    @Controller("ornek")
    class UzakDenetleyici {
      constructor(@Inject(Bagimlilik) private readonly b: Bagimlilik) {}
      async oku() { return this.b.deger(); }
    }

    @Module({ controllers: [UzakDenetleyici], providers: [Bagimlilik] })
    class UzakModul {}

    @Injectable()
    class Arayan {
      constructor(@Inject(ModuleRef) readonly moduleRef: InstanceType<typeof ModuleRef>) {}
    }

    @Module({ providers: [Arayan] })
    class AiBenzeri {}

    @Module({ imports: [UzakModul, AiBenzeri] })
    class Kok {}

    const app = await NestFactory.createApplicationContext(Kok, { logger: false });
    try {
      const arayan = app.get(Arayan);
      const uc = new UcCagirici(arayan.moduleRef, new Reflector(), { tenantIslem: vi.fn() } as never);
      const sonuc = await istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: "muhasebe" } }, () =>
        uc.cagir({ denetleyici: UzakDenetleyici, yontem: "oku", yol: "GET /ornek" }, []),
      );
      expect(sonuc).toBe(42);
    } finally {
      await app.close();
    }
  });
});
