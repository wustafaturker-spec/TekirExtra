import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiOzellikKapaliHatasi, platformOnbelleginiSifirla } from "../ozellik-kapisi";
import { AiBosYanitHatasi } from "../saglayici/ai-bos-yanit";
import { AiSinirHatasi } from "../saglayici/ai-butce";
import { SaglayiciHatasi } from "../saglayici/aracli-ortak";
import { AsistanGorevService, yenidenDenenir } from "./asistan-gorev.service";

describe("arka plan görevi yeniden deneme kuralı (AI-105)", () => {
  it("sağlayıcı/model hatası ve çökme yeniden denenir", () => {
    expect(yenidenDenenir(new SaglayiciHatasi("503", "SAGLAYICI_HTTP_503" as never))).toBe(true);
    expect(yenidenDenenir(new AiBosYanitHatasi("boş" as never))).toBe(true);
    expect(yenidenDenenir(new Error("bağlantı koptu"))).toBe(true);
  });
  it("bütçe/sınır, yetki ve girdi hatası denenmez", () => {
    expect(yenidenDenenir(new AiSinirHatasi("bütçe doldu"))).toBe(false);
    expect(yenidenDenenir(new ForbiddenException("yetki yok"))).toBe(false);
    expect(yenidenDenenir(new BadRequestException("sohbet arşivlendi"))).toBe(false);
  });
});

describe("AI-109 arka plan görevi ve özellik kapısı", () => {
  beforeEach(() => platformOnbelleginiSifirla());
  const gorev = (id: string, tenantId: string) => ({ id, tenantId, userId: "u1", mesaj: "Analiz", durum: "kuyrukta", deneme: 0, oturumId: "o1", istekMesajId: "m1", baglam: null, kiraBitisAt: null, createdAt: new Date() });

  it("özelliği kapalı firmanın görevi sahiplenilmez (kuyrukta kalır), öteki firmanınki çalışır", async () => {
    const kapaliFirma = "11111111-1111-1111-1111-111111111111", acikFirma = "22222222-2222-2222-2222-222222222222";
    const db = { aiAsistanGorevi: { findMany: vi.fn().mockResolvedValue([gorev("g1", kapaliFirma), gorev("g2", acikFirma)]) } };
    const prisma = { tenantIslem: vi.fn((t: string, fn: (tx: unknown) => unknown) => fn({
      platformAiOzellikDurumu: { findMany: vi.fn().mockResolvedValue([]) },
      tenantAiAyari: { findUnique: vi.fn().mockResolvedValue({ kapaliOzellikler: t === kapaliFirma ? ["arka_plan_gorevi"] : [] }) },
    })) };
    const service = new AsistanGorevService(prisma as never, {} as never);
    const sahiplenilen: string[] = [];
    Object.assign(service as object, {
      yonetim: db,
      sahiplen: vi.fn(async (_db: unknown, g: { id: string }) => { sahiplenilen.push(g.id); return null; }),
    });
    await service.tara();
    expect(sahiplenilen).toEqual(["g2"]);
  });

  it("çalışırken özellik kapatılırsa görev deneme hakkı harcamadan kuyruğa döner", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const olay = vi.fn().mockResolvedValue({});
    const db = {
      aiAsistanGorevi: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ aiAsistanGorevi: { updateMany }, aiOlay: { create: olay } })),
    };
    const prisma = { tenantIslem: vi.fn((_t: string, fn: (tx: unknown) => unknown) => fn({ user: { findFirst: vi.fn().mockResolvedValue({ id: "u1", rol: "yonetici", aktif: true }) } })) };
    const ajan = { mesajiIsle: vi.fn().mockRejectedValue(new AiOzellikKapaliHatasi("arka_plan_gorevi", "platform", "durduruldu")) };
    const service = new AsistanGorevService(prisma as never, ajan as never);
    await service.calistir(db as never, { ...gorev("g1", "11111111-1111-1111-1111-111111111111"), durum: "calisiyor", deneme: 1, anahtar: "a1" } as never);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "g1", sahiplikAnahtari: "a1", durum: "calisiyor" }, data: { durum: "kuyrukta", sahiplikAnahtari: null, kiraBitisAt: null, deneme: { decrement: 1 } } });
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain('"hata"');
  });
});
