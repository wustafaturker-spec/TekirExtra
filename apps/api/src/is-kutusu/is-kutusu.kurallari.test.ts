import { describe, expect, it } from "vitest";
import { epostaGeriDonus, epostaKutudaMi, kapanisMetni, kapatSemasi } from "./is-kutusu.kurallari";

const ID = "00000000-0000-4000-8000-000000000001";
const BELGE = "00000000-0000-4000-8000-000000000002";

describe("AI-66 kapatma şeması", () => {
  it("üç neden e-posta talebinde geçer, not 300 karakterle sınırlı", () => {
    for (const neden of ["elle_yapildi", "iptal", "teklif_degil"]) expect(kapatSemasi.safeParse({ tur: "eposta", id: ID, neden }).success).toBe(true);
    expect(kapatSemasi.safeParse({ tur: "eposta", id: ID, neden: "iptal", not: "x".repeat(301) }).success).toBe(false);
  });

  it("Teklif talebi değil yanıt ve onayda sunulmaz", () => {
    expect(kapatSemasi.safeParse({ tur: "yanit", id: ID, neden: "teklif_degil" }).success).toBe(false);
    expect(kapatSemasi.safeParse({ tur: "onay", id: ID, neden: "teklif_degil" }).success).toBe(false);
    expect(kapatSemasi.safeParse({ tur: "yanit", id: ID, neden: "elle_yapildi" }).success).toBe(true);
  });

  it("teklif bağı yalnız e-posta + Elle yapıldı", () => {
    expect(kapatSemasi.safeParse({ tur: "eposta", id: ID, neden: "elle_yapildi", belgeId: BELGE }).success).toBe(true);
    expect(kapatSemasi.safeParse({ tur: "eposta", id: ID, neden: "iptal", belgeId: BELGE }).success).toBe(false);
    expect(kapatSemasi.safeParse({ tur: "yanit", id: ID, neden: "elle_yapildi", belgeId: BELGE }).success).toBe(false);
  });

  it("bilinmeyen alan reddedilir", () => {
    expect(kapatSemasi.safeParse({ tur: "eposta", id: ID, neden: "iptal", fazla: 1 }).success).toBe(false);
  });
});

describe("AI-68 kutuda mı", () => {
  it("kaldırılan işlem bağlı teklif olsa da kutuda değildir", () => {
    expect(epostaKutudaMi("kapatildi", "taslak")).toBe(false);
    expect(epostaKutudaMi("teklif_degil", null)).toBe(false);
  });
  it("cari seçimi, taslaksız incelenecek ve taslak hâlâ taslaksa kutudadır", () => {
    expect(epostaKutudaMi("cari_secimi", null)).toBe(true);
    expect(epostaKutudaMi("hata", null)).toBe(true);
    expect(epostaKutudaMi("taslak_hazir", "taslak")).toBe(true);
    expect(epostaKutudaMi("taslak_hazir", "onaylandi")).toBe(false);
    expect(epostaKutudaMi("incelenmeli", "onaylandi")).toBe(false);
  });
  it("kapanış metni neden ve notu taşır", () => {
    expect(kapanisMetni("elle_yapildi", "telefonla")).toBe("İş kutusundan kaldırıldı: Elle yapıldı — telefonla");
    expect(kapanisMetni("iptal")).toBe("İş kutusundan kaldırıldı: İptal / gerek yok");
  });
});

describe("AI-69 geri dönüş", () => {
  const onceki = { durum: "taslak_hazir", belgeId: BELGE, cariId: "c1", uyarilar: ["eski"] };
  it("silinen ya da iptal edilen taslağa dönülmez; incelenecek olur", () => {
    for (const sonuc of ["silindi", "iptal_edildi"]) {
      const h = epostaGeriDonus(onceki, sonuc);
      expect(h).toMatchObject({ durum: "incelenmeli", belgeId: null, cariId: "c1" });
    }
  });
  it("taslağa dokunulmadıysa önceki hâl aynen döner (bağlanan teklif çözülür)", () => {
    expect(epostaGeriDonus(onceki, null)).toEqual(onceki);
    expect(epostaGeriDonus({ durum: "incelenmeli", belgeId: null, cariId: null, uyarilar: [] }, null)).toMatchObject({ durum: "incelenmeli", belgeId: null });
  });
});
