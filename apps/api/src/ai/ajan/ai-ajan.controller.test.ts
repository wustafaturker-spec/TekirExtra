import { HttpException } from "@nestjs/common";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { AKIS_NABIZ_MS, AiAjanController } from "./ai-ajan.controller";

/** Express yanıtının akış için kullanılan kısmı. */
function sahteYanit() {
  const r = Object.assign(new EventEmitter(), {
    yazilan: [] as string[], writableEnded: false,
    status: vi.fn(), setHeader: vi.fn(), flushHeaders: vi.fn(),
    write: vi.fn((x: string) => { r.yazilan.push(x); return true; }),
    end: vi.fn(() => { r.writableEnded = true; r.emit("close"); }),
  });
  return r;
}

describe("asistan akış ucu (AI-82)", () => {
  it("adımları ve sonu SSE olayları olarak yazar, sonra kapatır", async () => {
    const servis = { mesajiIsle: vi.fn(async (_m, _r, _e, _ek, s: any) => { s.olay({ tur: "dusunuyor", adim: 1 }); return { cevap: "Tamam" }; }) };
    const res = sahteYanit();
    await new AiAjanController(servis as never).mesajAkis({ mesaj: "x", derin: true }, res as never);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream; charset=utf-8");
    expect(res.yazilan).toEqual(['event: adim\ndata: {"tur":"dusunuyor","adim":1}\n\n', 'event: son\ndata: {"cevap":"Tamam"}\n\n']);
    expect(servis.mesajiIsle.mock.calls[0][4]).toMatchObject({ derin: true });
    expect(res.end).toHaveBeenCalled();
  });

  it("hata olayı mesajla yazılır; istemci ayrılırsa durdurma sinyali verilir", async () => {
    let sinyal: AbortSignal | undefined;
    const res = sahteYanit();
    const servis = { mesajiIsle: vi.fn(async (_m, _r, _e, _ek, s: any) => { sinyal = s.sinyal; res.emit("close"); throw new HttpException("Bu ayın yapay zekâ bütçesi doldu", 429); }) };
    await new AiAjanController(servis as never).mesajAkis({ mesaj: "x" }, res as never);
    expect(sinyal?.aborted).toBe(true);
    expect(res.yazilan.at(-1)).toBe('event: hata\ndata: {"mesaj":"Bu ayın yapay zekâ bütçesi doldu","durum":429}\n\n');
  });

  it("uzun sessizlikte canlılık satırı yazar, bitince durur", async () => {
    vi.useFakeTimers();
    try {
      let bitir!: (v: unknown) => void;
      const servis = { mesajiIsle: vi.fn(() => new Promise((r) => { bitir = r; })) };
      const res = sahteYanit();
      const is = new AiAjanController(servis as never).mesajAkis({ mesaj: "x" }, res as never);
      await vi.advanceTimersByTimeAsync(AKIS_NABIZ_MS * 2 + 10);
      expect(res.yazilan).toEqual([": canli\n\n", ": canli\n\n"]);
      bitir({ cevap: "Tamam" });
      await is;
      await vi.advanceTimersByTimeAsync(AKIS_NABIZ_MS * 2);
      expect(res.yazilan.filter((x) => x.startsWith(":"))).toHaveLength(2);
      expect(res.yazilan.at(-1)).toBe('event: son\ndata: {"cevap":"Tamam"}\n\n');
    } finally { vi.useRealTimers(); }
  });
});
