import { afterEach, describe, expect, it, vi } from "vitest";

const kilit = vi.hoisted(() => ({ uzayanKilitle: vi.fn(), pencereIsareti: vi.fn() }));
vi.mock("../redis-kilit", () => kilit);
import { nabizKaydediciAyarla, nabizla } from "./nabiz";

afterEach(() => { vi.clearAllMocks(); nabizKaydediciAyarla(null); });

describe("birden çok worker (BLD-18)", () => {
  const birak = vi.fn(async () => undefined);
  const kaydet = () => { const k = vi.fn(async () => undefined); nabizKaydediciAyarla(k); return k; };

  it("kilit alınınca çalışır, bitince bırakır", async () => {
    kilit.uzayanKilitle.mockResolvedValue(birak); kilit.pencereIsareti.mockResolvedValue(true);
    expect(await nabizla("a1", async () => 7, 300_000)).toBe(7);
    expect(kilit.pencereIsareti).toHaveBeenCalledWith("tekir:nabiz:tur:a1", 270);
    expect(birak).toHaveBeenCalledTimes(1);
  });
  it("iş hata verse de kilit bırakılır", async () => {
    kilit.uzayanKilitle.mockResolvedValue(birak); kilit.pencereIsareti.mockResolvedValue(true);
    const k = kaydet();
    await nabizla("a2", async () => { throw new Error("patladi"); }, 60_000);
    expect(birak).toHaveBeenCalledTimes(1);
    expect(k.mock.calls[0][0]).toMatchObject({ hata: "patladi" });
  });
  it("başka worker sürdürüyorsa çalışmaz, atlama olarak kaydedilir", async () => {
    kilit.uzayanKilitle.mockResolvedValue(null);
    const is = vi.fn(async () => 1), k = kaydet();
    expect(await nabizla("a3", is, 60_000)).toBeUndefined();
    expect(is).not.toHaveBeenCalled();
    expect(k.mock.calls[0][0]).toMatchObject({ atlandi: true });
  });
  it("tur bu pencerede yapıldıysa çalışmaz, alarm üretmez, kilidi bırakır", async () => {
    kilit.uzayanKilitle.mockResolvedValue(birak); kilit.pencereIsareti.mockResolvedValue(false);
    const is = vi.fn(async () => 1), k = kaydet();
    expect(await nabizla("a4", is, 60_000)).toBeUndefined();
    expect(is).not.toHaveBeenCalled();
    expect(k).not.toHaveBeenCalled();
    expect(birak).toHaveBeenCalledTimes(1);
  });
  it("açılış tetiği pencereye bakmaz", async () => {
    kilit.uzayanKilitle.mockResolvedValue(birak);
    expect(await nabizla("a5", async () => 2)).toBe(2);
    expect(kilit.pencereIsareti).not.toHaveBeenCalled();
  });
  it("Redis erişilemezse iş yine çalışır", async () => {
    kilit.uzayanKilitle.mockRejectedValue(new Error("Redis yanıt vermedi"));
    expect(await nabizla("a6", async () => 3, 60_000)).toBe(3);
  });
  it("kilit alındıktan sonra pencere okunamazsa iş çalışır ve kilit bırakılır", async () => {
    kilit.uzayanKilitle.mockResolvedValue(birak); kilit.pencereIsareti.mockRejectedValue(new Error("x"));
    expect(await nabizla("a7", async () => 4, 60_000)).toBe(4);
    expect(birak).toHaveBeenCalledTimes(1);
  });
  it("tetiği zaten tekil olan iş kilit almaz", async () => {
    expect(await nabizla("a8", async () => 5, 60_000, { tekSurec: false })).toBe(5);
    expect(kilit.uzayanKilitle).not.toHaveBeenCalled();
  });
});
