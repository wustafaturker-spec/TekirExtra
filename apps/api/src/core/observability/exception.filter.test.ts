import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { ObservabilityExceptionFilter } from "./exception.filter";

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
    for (const kod of ["P2028", "P2024"]) {
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
