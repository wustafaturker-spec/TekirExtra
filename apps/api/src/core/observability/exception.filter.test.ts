import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { bagHatasiMi, ObservabilityExceptionFilter, paketKotaHatasi } from "./exception.filter";

describe("ObservabilityExceptionFilter Zod doğrulaması", () => {
  it("ZodError hatasını alan mesajlarıyla HTTP 400'e dönüştürür", () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { "x-request-id": "req-1" }, method: "POST", path: "/test" }),
        getResponse: () => ({ status }),
      }),
    };
    const metrics = { increment: vi.fn() };
    const filter = new ObservabilityExceptionFilter(metrics as never);
    let hata: unknown;
    try {
      z.object({ ad: z.string().min(2) }).parse({ ad: "" });
    } catch (error) {
      hata = error;
    }

    filter.catch(hata, host as never);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      error: "Bad Request",
      message: [expect.stringContaining("ad:")],
    }));
    expect(metrics.increment).toHaveBeenCalledWith("errors_total", { status_code: "400" });
  });
});

describe("ObservabilityExceptionFilter havuz yoğunluğu (STK-35)", () => {
  const calistir = (hata: unknown) => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const setHeader = vi.fn();
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, method: "POST", path: "/stok/x/hareketler" }),
        getResponse: () => ({ status, setHeader }),
      }),
    };
    new ObservabilityExceptionFilter({ increment: vi.fn() } as never).catch(hata, host as never);
    return { status, json, setHeader };
  };
  const prismaHatasi = (code: string) => Object.assign(new Error("Unable to start a transaction in the given time."), { name: "PrismaClientKnownRequestError", code });

  it("P2028 ve P2024 hatalarını 503 + Retry-After'a çevirir", () => {
    for (const kod of ["P2028", "P2024", "P2034"]) {
      const { status, json, setHeader } = calistir(prismaHatasi(kod));
      expect(status).toHaveBeenCalledWith(503);
      expect(setHeader).toHaveBeenCalledWith("Retry-After", "3");
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("yeniden deneyin") }));
    }
  });

  it("başka Prisma hataları 500 kalır", () => {
    const { status, setHeader } = calistir(prismaHatasi("P2002"));
    expect(status).toHaveBeenCalledWith(500);
    expect(setHeader).not.toHaveBeenCalled();
  });
});

describe("paket DB hatasının güvenli sunumu", () => {
  it("kota ve modül hatalarını SQL ayrıntısı sızdırmadan çevirir", () => {
    const hata = (m: string) => Object.assign(new Error("SQL ve firma ayrıntısı"), { name: "PrismaClientKnownRequestError", meta: { message: m } });
    expect(paketKotaHatasi(hata("paket_kota_dolu:cari"))?.getStatus()).toBe(400);
    expect(paketKotaHatasi(hata("paket_modul_kapali:stok"))?.getStatus()).toBe(403);
    expect(JSON.stringify(paketKotaHatasi(hata("paket_kota_dolu:cari"))?.getResponse())).not.toContain("SQL");
    expect(paketKotaHatasi(new Error("paket_kota_dolu:cari"))).toBeNull();
  });
});

describe("ObservabilityExceptionFilter istek gövdesi hataları (SEC-04)", () => {
  const calistir = (hata: unknown, yol = "/auth/giris") => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = { switchToHttp: () => ({ getRequest: () => ({ headers: {}, method: "POST", path: yol, originalUrl: yol }), getResponse: () => ({ status }) }) };
    new ObservabilityExceptionFilter({ increment: vi.fn() } as never).catch(hata, host as never);
    return { status, json };
  };
  const govdeHatasi = (status: number, type: string, expose = true) => Object.assign(new Error("x"), { status, type, expose });

  it("sıkıştırılmış gövde 415, bozuk JSON 400, büyük gövde 413 döner", () => {
    const a = calistir(govdeHatasi(415, "encoding.unsupported"));
    expect(a.status).toHaveBeenCalledWith(415);
    expect(a.json).toHaveBeenCalledWith({ statusCode: 415, message: "Sıkıştırılmış istek gövdesi desteklenmiyor" });
    expect(calistir(govdeHatasi(400, "entity.parse.failed")).status).toHaveBeenCalledWith(400);
    expect(calistir(govdeHatasi(413, "entity.too.large")).status).toHaveBeenCalledWith(413);
  });

  it("XML yükleme ucunda büyük gövde sınırı söyleyen iletiyle döner (EBLG-158)", () => {
    const a = calistir(govdeHatasi(413, "entity.too.large"), "/api/v1/ebelge/gelen/xml-yukle?x=1");
    expect(a.json).toHaveBeenCalledWith({ statusCode: 413, message: "XML dosyası 10 MB sınırını aşıyor" });
    expect(calistir(govdeHatasi(413, "entity.too.large"), "/api/v1/fatura").json).toHaveBeenCalledWith({ statusCode: 413, message: "İstek gövdesi çok büyük" });
  });

  it("expose olmayan ya da 5xx durumlu hata 500 kalır, ayrıntı sızmaz", () => {
    const a = calistir(govdeHatasi(400, "x", false));
    expect(a.status).toHaveBeenCalledWith(500);
    expect(a.json).toHaveBeenCalledWith({ message: "Beklenmeyen sunucu hatası" });
    expect(calistir(govdeHatasi(503, "x")).status).toHaveBeenCalledWith(500);
  });
});

describe("yabancı anahtar hatası (P2003)", () => {
  it("yalnız Prisma P2003 bağ hatası sayılır", () => {
    const hata = Object.assign(new Error("x"), { name: "PrismaClientKnownRequestError", code: "P2003" });
    expect(bagHatasiMi(hata)).toBe(true);
    expect(bagHatasiMi(Object.assign(new Error("x"), { name: "PrismaClientKnownRequestError", code: "P2002" }))).toBe(false);
    expect(bagHatasiMi(Object.assign(new Error("x"), { code: "P2003" }))).toBe(false);
  });
});

describe("gruplu hata kaydı (PLT-118)", () => {
  const calistir = (hata: unknown, kaydet = vi.fn()) => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = { switchToHttp: () => ({ getRequest: () => ({ headers: { "x-request-id": "r9" }, method: "POST", path: "/api/v1/fatura/x/iptal", route: { path: "/fatura/:id/iptal" }, baseUrl: "/api/v1" }), getResponse: () => ({ status, setHeader: vi.fn() }) }) };
    new ObservabilityExceptionFilter({ increment: vi.fn() } as never, { kaydet } as never).catch(hata, host as never);
    return kaydet;
  };

  it("500 yanıtı rota kalıbı ve istek kimliğiyle kaydedilir", () => {
    const kaydet = calistir(new TypeError("x is undefined"));
    expect(kaydet).toHaveBeenCalledWith(expect.objectContaining({ kaynak: "api", ad: "TypeError", mesaj: "x is undefined", konum: "POST /api/v1/fatura/:id/iptal", istekId: "r9" }));
  });

  it("istemci hatası (4xx) kaydedilmez", () => {
    expect(calistir(new BadRequestException("eksik alan"))).not.toHaveBeenCalled();
  });
});
