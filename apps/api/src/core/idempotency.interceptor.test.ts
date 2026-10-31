import { CallHandler, type ExecutionContext } from "@nestjs/common";
import { firstValueFrom, of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { istekBaglami } from "./istek-baglami";
import { IdempotencyInterceptor, TERK_SURESI_MS } from "./idempotency.interceptor";

function kur(anahtar?: string) {
  const aiAracIstegi = { create: vi.fn().mockResolvedValue({}), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({ count: 1 }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
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

  const baglam = { deger: { tenantId: "t", userId: "u", rol: "yonetici" as const } };
  const cakisma = () => new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
  /** İlk ayırma P2002 alır; mevcut kayıt verilen durum ve yaşta, aynı rota/özetle. */
  function mevcutKayit(k: ReturnType<typeof kur>, durum: string, yasMs: number) {
    const createdAt = new Date(Date.now() - yasMs);
    k.aiAracIstegi.create.mockImplementationOnce(async ({ data }: { data: { girdiOzeti: string } }) => {
      k.aiAracIstegi.findUnique.mockResolvedValue({ id: "kayit1", arac: "POST /api/v1/cari", girdiOzeti: data.girdiOzeti, durum, sonuc: null, createdAt });
      throw cakisma();
    });
    return createdAt;
  }

  it("işlem hata verirse ayırma bırakılır ve hata aynen döner; tamamlanmış sayılmaz", async () => {
    const k = kur("http-call-0003");
    const hata = new Error("Vomsis hareketleri alınamadı");
    (k.next.handle as ReturnType<typeof vi.fn>).mockReturnValue(throwError(() => hata));
    await expect(istekBaglami.run(baglam, async () => firstValueFrom(await k.interceptor.intercept(k.context, k.next)))).rejects.toBe(hata);
    expect(k.aiAracIstegi.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", userId: "u", kaynak: "http", istekAnahtari: "http-call-0003", durum: "calisiyor" } });
    expect(k.aiAracIstegi.update).not.toHaveBeenCalled();
  });

  it("bırakma yazımı da düşerse kullanıcı asıl hatayı görür", async () => {
    const k = kur("http-call-0004");
    const hata = new Error("asıl hata");
    k.aiAracIstegi.deleteMany.mockRejectedValue(new Error("db"));
    (k.next.handle as ReturnType<typeof vi.fn>).mockReturnValue(throwError(() => hata));
    await expect(istekBaglami.run(baglam, async () => firstValueFrom(await k.interceptor.intercept(k.context, k.next)))).rejects.toBe(hata);
  });

  it("tamamlama yazımı düşerse işlem olmuştur: ayırma silinmez", async () => {
    const k = kur("http-call-0005");
    k.aiAracIstegi.update.mockRejectedValue(new Error("db"));
    await expect(istekBaglami.run(baglam, async () => firstValueFrom(await k.interceptor.intercept(k.context, k.next)))).rejects.toThrow("db");
    expect(k.aiAracIstegi.deleteMany).not.toHaveBeenCalled();
  });

  it("yeni (10 dk'dan genç) çalışan kayıt hâlâ 409 alır ve işlem ikinci kez çalışmaz", async () => {
    const k = kur("http-call-0006");
    mevcutKayit(k, "calisiyor", 60_000);
    await expect(istekBaglami.run(baglam, async () => firstValueFrom(await k.interceptor.intercept(k.context, k.next)))).rejects.toThrow("halen işleniyor");
    expect(k.next.handle).not.toHaveBeenCalled();
    expect(k.aiAracIstegi.updateMany).not.toHaveBeenCalled();
  });

  it("terk edilmiş (10 dk'dan eski) çalışan kayıt koşullu devralınır ve işlem çalışıp tamamlanır", async () => {
    const k = kur("http-call-0007");
    const eski = mevcutKayit(k, "calisiyor", TERK_SURESI_MS + 60_000);
    const sonuc = await istekBaglami.run(baglam, async () => firstValueFrom(await k.interceptor.intercept(k.context, k.next)));
    expect(sonuc).toEqual({ id: "c1" });
    expect(k.aiAracIstegi.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "kayit1", durum: "calisiyor", createdAt: eski } }));
    expect(k.aiAracIstegi.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "tamamlandi" }) }));
  });

  it("terk edilmiş kaydı aynı anda başka istek devraldıysa 409", async () => {
    const k = kur("http-call-0008");
    mevcutKayit(k, "calisiyor", TERK_SURESI_MS + 60_000);
    k.aiAracIstegi.updateMany.mockResolvedValue({ count: 0 });
    await expect(istekBaglami.run(baglam, async () => firstValueFrom(await k.interceptor.intercept(k.context, k.next)))).rejects.toThrow("halen işleniyor");
    expect(k.next.handle).not.toHaveBeenCalled();
  });
});
