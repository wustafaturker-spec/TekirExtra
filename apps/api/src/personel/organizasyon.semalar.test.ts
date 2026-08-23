import { describe, expect, it } from "vitest";
import { departmanOlusturSemasi, personelOrganizasyonAtaSemasi } from "./organizasyon.semalar";
describe("Organizasyon şemaları", () => {
  it("organizasyon kodunu güvenli biçimle sınırlar", () => {
    expect(departmanOlusturSemasi.safeParse({ isyeriId: "01010101-0101-4101-8101-010101010101", kod: "bilgi_islem", ad: "Bilgi İşlem" }).success).toBe(true);
    expect(departmanOlusturSemasi.safeParse({ isyeriId: "01010101-0101-4101-8101-010101010101", kod: "Bilgi İşlem", ad: "Bilgi İşlem" }).success).toBe(false);
  });
  it("işyeri olmadan personel organizasyon atamasını reddeder", () => {
    expect(personelOrganizasyonAtaSemasi.safeParse({ departmanId: "02020202-0202-4202-8202-020202020202" }).success).toBe(false);
  });
});
