import { describe, expect, it } from "vitest";
import { kdvBeyanSatirlari, kdvBeyanToplami } from "./kdv-beyan";

const satir = (oran: number, matrah: number, kdv: number, tevkifat = 0, ekVergiler: unknown = null) => ({ kdvOrani: oran, matrah, kdvTutari: kdv, tevkifatTutari: tevkifat, netKdvTutari: kdv - tevkifat, ekVergiler });
const ft = (tip: string, satirlar: ReturnType<typeof satir>[], ek: Record<string, unknown> = {}) => ({ tip, kur: 1, ihracKayitliKodu: null, toplamNetKdv: satirlar.reduce((t, s) => t + s.netKdvTutari, 0), satirlar, ...ek });

describe("KDV beyan hesabı (RPR-13)", () => {
  it("tevkifatlı alışın tam KDV'si indirilecek, kestiğimiz kısım KDV-2; satışta satıcı payı hesaplanan", () => {
    const s = kdvBeyanSatirlari([ft("alis", [satir(20, 1000, 200, 100)]), ft("satis", [satir(20, 2000, 400, 200)])]);
    expect(kdvBeyanToplami(s, "indirilecek_alis")).toBe(200);
    expect(kdvBeyanToplami(s, "kdv2_tevkifat")).toBe(100);
    expect(kdvBeyanToplami(s, "hesaplanan_satis")).toBe(200);
    expect(kdvBeyanToplami(s, "bilgi_alici_tevkifati")).toBe(200);
  });

  it("iadeler karşı tarafta artı; oran kırılımı; ÖTV KDV matrahına dahil", () => {
    const otv = [{ kod: "0071", tutar: "100.00", stopaj: false, kdvMatrahinaDahil: true }];
    const s = kdvBeyanSatirlari([
      ft("satis", [satir(20, 1000, 220, 0, otv), satir(10, 500, 50)]),
      ft("satis_iade", [satir(20, 100, 20)]),
      ft("alis_iade", [satir(20, 50, 10)]),
    ]);
    expect(s.find((x) => x.yon === "hesaplanan_satis" && x.kdvOrani === 20)).toMatchObject({ matrah: expect.anything() });
    expect(s.find((x) => x.yon === "hesaplanan_satis" && x.kdvOrani === 20)!.matrah.toNumber()).toBe(1100);
    expect(kdvBeyanToplami(s, "hesaplanan_alis_iade")).toBe(10);
    expect(kdvBeyanToplami(s, "indirilecek_satis_iade")).toBe(20);
  });

  it("özel matrah KDV'si belgeden; ihraç kayıtlı bilgi satırında; dövizli kurla", () => {
    const s = kdvBeyanSatirlari([
      { ...ft("satis", [satir(0, 5000, 0)]), toplamNetKdv: 180, ozelMatrahKodu: "801", ozelMatrahTutari: 1000, ozelMatrahOrani: 18 },
      ft("alis", [{ ...satir(20, 100, 20), netKdvTutari: 0 }], { ihracKayitliKodu: "701" }),
      ft("satis", [satir(20, 10, 2)], { kur: 40 }),
    ]);
    expect(s.find((x) => x.yon === "hesaplanan_satis" && x.kdvOrani === 18)!.kdv.toNumber()).toBe(180);
    expect(kdvBeyanToplami(s, "bilgi_ihrac_kayitli_alis")).toBe(20);
    expect(kdvBeyanToplami(s, "indirilecek_alis")).toBe(0);
    expect(s.find((x) => x.yon === "hesaplanan_satis" && x.kdvOrani === 20)!.kdv.toNumber()).toBe(80);
  });
});
