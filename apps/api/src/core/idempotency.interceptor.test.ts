import { CallHandler, type ExecutionContext } from "@nestjs/common";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { istekBaglami } from "./istek-baglami";
import { IdempotencyInterceptor } from "./idempotency.interceptor";

function kur(anahtar?: string) {
  const aiAracIstegi = { create: vi.fn().mockResolvedValue({}), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (tx: { aiAracIstegi: typeof aiAracIstegi }) => unknown) => fn({ aiAracIstegi })) };
  const request = { method: "POST", originalUrl: "/api/v1/cari", body: { unvan: "Kaya" }, get: vi.fn((ad: string) => ad === "idempotency-key" ? anahtar : undefined) };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  const next = { handle: vi.fn(() => of({ id: "c1" })) } as unknown as CallHandler;
  return { interceptor: new IdempotencyInterceptor(prisma as never), aiAracIstegi, context, next };
}

describe("HTTP idempotency interceptor", () => {
  it("başlık varsa isteği çalışmadan ayırır ve sonucu tamamlar", async () => {
    const k = kur("http-call-0001");
    const sonuc = await istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: "yonetici" } }, async () =>
      firstValueFrom(await k.interceptor.intercept(k.context, k.next)),
    );
    expect(sonuc).toEqual({ id: "c1" });
    expect(k.aiAracIstegi.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kaynak: "http", istekAnahtari: "http-call-0001", arac: "POST /api/v1/cari" }) }));
    expect(k.aiAracIstegi.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "tamamlandi", sonuc: { httpSonuc: { id: "c1" } } }) }));
  });

  it("başlık yoksa mevcut davranışı değiştirmez ve idempotency kaydı açmaz", async () => {
    const k = kur();
    await istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: "yonetici" } }, async () => firstValueFrom(await k.interceptor.intercept(k.context, k.next)));
    expect(k.aiAracIstegi.create).not.toHaveBeenCalled();
    expect(k.next.handle).toHaveBeenCalledOnce();
  });

  it("tamamlanmış tekrar isteğinde handlerı çalıştırmadan saklanan yanıtı döndürür", async () => {
    const k = kur("http-call-0002");
    k.aiAracIstegi.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }));
    k.aiAracIstegi.findUnique.mockResolvedValue({
      arac: "POST /api/v1/cari", girdiOzeti: "", durum: "tamamlandi", sonuc: { httpSonuc: { id: "onceki" } },
    });
    // İlk ayırma denemesinin üreteceği özeti kayda taklit et.
    k.aiAracIstegi.create.mockImplementationOnce(async ({ data }: { data: { girdiOzeti: string } }) => {
      k.aiAracIstegi.findUnique.mockResolvedValue({ arac: "POST /api/v1/cari", girdiOzeti: data.girdiOzeti, durum: "tamamlandi", sonuc: { httpSonuc: { id: "onceki" } } });
      throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
    });
    const sonuc = await istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: "yonetici" } }, async () => firstValueFrom(await k.interceptor.intercept(k.context, k.next)));
    expect(sonuc).toEqual({ id: "onceki" });
    expect(k.next.handle).not.toHaveBeenCalled();
    expect(k.aiAracIstegi.update).not.toHaveBeenCalled();
  });
});
