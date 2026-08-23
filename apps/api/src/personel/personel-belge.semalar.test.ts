import { describe, expect, it } from "vitest";
import { personelBelgeMetaSemasi } from "./personel-belge.semalar";

describe("personel belge metadatası", () => {
  it("geçerli belge bilgisini kabul eder", () => {
    expect(personelBelgeMetaSemasi.parse({ tur: "is_sozlesmesi", belgeTarihi: "2026-08-01", gecerlilikTarihi: "2027-08-01" }).tur).toBe("is_sozlesmesi");
  });
  it("belge tarihinden önceki süre sonunu reddeder", () => {
    expect(() => personelBelgeMetaSemasi.parse({ tur: "sertifika", belgeTarihi: "2026-08-20", gecerlilikTarihi: "2026-08-19" })).toThrow();
  });
});
