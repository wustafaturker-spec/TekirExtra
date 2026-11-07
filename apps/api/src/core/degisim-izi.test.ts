import { afterEach, describe, expect, it } from "vitest";
import { degismeyenleriAyikla } from "./aktif-firmalar";
import { DEGISIM_PENCERESI_MS, degisimDenetlenmeli, degisimIziniSifirla, degisimKaydet, TaramaDurumu, taramaYazimiyla } from "./degisim-izi";

const DK = 60_000;
const simdi = Date.UTC(2026, 10, 7, 9, 0, 0);

describe("BLD-14 değişmeyen firmayı atlama", () => {
  const sonTarama = new Map([["a", simdi - 5 * DK], ["b", simdi - 5 * DK], ["c", simdi - 56 * DK], ["d", simdi - 5 * DK]]);
  const degisim = new Map([
    ["a", simdi - 30 * DK],                              // taramadan önce yazdı → atla
    ["b", simdi - 2 * DK],                               // taramadan sonra yazdı → tara
    ["c", 0],                                            // değişmedi ama 55 dk'yı geçti → zorunlu tara
    ["d", simdi - 5 * DK - DEGISIM_PENCERESI_MS + 1000], // pencere payı içinde → tara
  ]);

  it("yalnız son taramadan beri yazmayan ve saatlik süresi dolmamış firmayı atlar", () => {
    expect(degismeyenleriAyikla(["a", "b", "c", "d", "yeni"], sonTarama, degisim, 5 * DK, simdi)).toEqual({ taranacak: ["b", "c", "d", "yeni"], degismeyen: 1 });
  });

  it("iz okunamadıysa herkesi tarar", () => {
    expect(degismeyenleriAyikla(["a", "b"], sonTarama, null, 5 * DK, simdi)).toEqual({ taranacak: ["a", "b"], degismeyen: 0 });
  });

  it("15 dakikalık taramada zorunlu tarama 45. dakikadan sonra gelir (saatte bir)", () => {
    const son = new Map([["x", simdi - 44 * DK], ["y", simdi - 45 * DK]]);
    expect(degismeyenleriAyikla(["x", "y"], son, new Map(), 15 * DK, simdi).taranacak).toEqual(["y"]);
  });
});

describe("BLD-14 değişim izi", () => {
  afterEach(() => degisimIziniSifirla());

  it("tarama yazımında denetlemez; pencere içinde aynı firmayı ikinci kez denetlemez", async () => {
    degisimIziniSifirla(true);
    expect(degisimDenetlenmeli("t1", simdi)).toBe(true);
    expect(await taramaYazimiyla(async () => degisimDenetlenmeli("t1", simdi))).toBe(false);
    degisimKaydet("t1", simdi);
    expect(degisimDenetlenmeli("t1", simdi + DEGISIM_PENCERESI_MS - 1)).toBe(false);
    expect(degisimDenetlenmeli("t1", simdi + DEGISIM_PENCERESI_MS)).toBe(true);
    expect(degisimDenetlenmeli("t2", simdi)).toBe(true);
  });

  it("kapalıyken (test ortamı, Redis yok) hiç denetlemez", () => {
    expect(degisimDenetlenmeli("t1", simdi)).toBe(false);
  });
});

describe("BLD-17 tarama durumu", () => {
  it("Redis yokken süreç belleğinde tutar; bilinmeyen firma haritada yer almaz (hiç taranmadı sayılır)", async () => {
    const d = new TaramaDurumu("deneme");
    await d.yaz("t1", 123);
    expect(await d.oku(["t1", "t2"])).toEqual(new Map([["t1", 123]]));
  });
});
