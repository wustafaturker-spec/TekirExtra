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
