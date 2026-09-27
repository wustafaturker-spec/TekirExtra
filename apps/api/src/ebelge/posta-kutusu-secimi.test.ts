import { describe, expect, it, vi } from "vitest";
import { postaKutusuSecimi } from "./posta-kutusu-secimi";

const NES = "urn:mail:defaultpk@nes.com.tr";
const NILVERA = "urn:mail:defaultpk@nilvera.com";
const TICARI = "urn:mail:defaultpki@ticari1as_edesp.com.tr";
const tx = {
  gibMukellef: {
    findMany: vi.fn().mockResolvedValue([
      { postaKutusu: NES, kutuKayitZamani: new Date("2025-07-30"), tur: "OZEL" },
      { postaKutusu: NILVERA, kutuKayitZamani: new Date("2025-02-04"), tur: "OZEL" },
      { postaKutusu: TICARI, kutuKayitZamani: new Date("2025-02-05"), tur: "OZEL" },
    ]),
  },
} as never;
const GB = "urn:mail:defaultgb@nes.com.tr";

describe("postaKutusuSecimi canlı liste (EBLG-110)", () => {
  it("canlı liste yokken toplu listeye göre kendi entegratörümüzün kutusunu seçer", async () => {
    const s = await postaKutusuSecimi(tx, "1234567801", "eirsaliye", null, GB);
    expect(s.secilen).toBe(NES);
    expect(s.entegratordeYok).toEqual([]);
  });

  it("canlı listede olmayan kutuyu seçmez, işaretler; elle seçilmişse geçersiz sayar", async () => {
    const s = await postaKutusuSecimi(tx, "1234567801", "eirsaliye", NES, GB, [NILVERA, TICARI, "urn:mail:baska@x"]);
    expect(s.entegratordeYok).toEqual([NES]);
    expect(s.elleSecilenGecersiz).toBe(true);
    expect(s.secilen).toBe(NILVERA);
    expect(s.kuralSecimi).toBe(NILVERA);
  });

  it("canlıdaki elle seçimi korur", async () => {
    const s = await postaKutusuSecimi(tx, "1234567801", "eirsaliye", TICARI, GB, [NILVERA, TICARI]);
    expect(s).toMatchObject({ secilen: TICARI, elleSecilenGecersiz: false });
  });

  it("canlı liste toplu listeyle hiç kesişmiyorsa ona güvenmez", async () => {
    const s = await postaKutusuSecimi(tx, "1234567801", "eirsaliye", null, GB, ["urn:mail:baska@x"]);
    expect(s).toMatchObject({ secilen: NES, entegratordeYok: [] });
  });
});
