import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { butceDurumuHesapla, enDusukTeklifler, onayYetkisi, onaylayabilecekRoller, talepAcabilirMi, teklifHesapla, teklifSuresiDolduMu, tumTalepleriGorurMu, yenidenOnayNedeni, yenidenOnaySiniri } from "./satin-alma.hesap";

const D = (v: string) => new Prisma.Decimal(v);

describe("satın alma yetkileri (SAT-02, SAT-03)", () => {
  it("salt okunur, mali müşavir ve bayi dışındaki roller talep açar", () => {
    for (const rol of ["yonetici", "muhasebe", "satis", "depo", "uretim_operatoru", "kalite"]) expect(talepAcabilirMi(rol)).toBe(true);
    for (const rol of ["salt_okunur", "mali_musavir", "b2b_bayi"]) expect(talepAcabilirMi(rol)).toBe(false);
    expect(tumTalepleriGorurMu("muhasebe")).toBe(true);
    expect(tumTalepleriGorurMu("depo")).toBe(false);
  });

  it("eşik dahil muhasebe, eşiğin üstünde yalnız yönetici onaylar", () => {
    expect(onaylayabilecekRoller(25_000, 25_000)).toEqual(["muhasebe", "yonetici"]);
    expect(onaylayabilecekRoller(25_000.01, 25_000)).toEqual(["yonetici"]);
    const ortak = { userId: "u2", talepEdenUserId: "u1", esik: 25_000 };
    expect(onayYetkisi({ ...ortak, rol: "muhasebe", tutar: 10_000 })).toBeNull();
    expect(onayYetkisi({ ...ortak, rol: "muhasebe", tutar: 30_000 })).toMatch("yalnız yönetici");
    expect(onayYetkisi({ ...ortak, rol: "yonetici", tutar: 30_000 })).toBeNull();
    expect(onayYetkisi({ ...ortak, rol: "satis", tutar: 10 })).toMatch("yetkiniz yok");
  });

  it("talep eden, yönetici dahil, kendi talebini onaylayamaz", () => {
    expect(onayYetkisi({ rol: "yonetici", userId: "u1", talepEdenUserId: "u1", tutar: 1, esik: 25_000 })).toMatch("Kendi talebinizi");
  });
});

describe("bütçe durumu (SAT-04)", () => {
  it("kalanı bütçeden gerçekleşeni ve diğer onaylı talepleri düşerek bulur", () => {
    expect(butceDurumuHesapla({ butce: 100_000, gerceklesen: 60_000, digerTalepler: 25_000, talep: 10_000 })).toMatchObject({ tanimli: true, kalan: 15_000, asim: 0 });
    expect(butceDurumuHesapla({ butce: 100_000, gerceklesen: 60_000, digerTalepler: 25_000, talep: 20_000 })).toMatchObject({ kalan: 15_000, asim: 5_000 });
  });

  it("gerçekleşen bütçeyi zaten aştıysa talebin tamamı aşım sayılır ve fazlası da eklenir", () => {
    expect(butceDurumuHesapla({ butce: 1_000, gerceklesen: 1_500, digerTalepler: 0, talep: 200 })).toMatchObject({ kalan: -500, asim: 700 });
  });

  it("onaylı bütçe yoksa aşım aramaz", () => {
    expect(butceDurumuHesapla({ butce: null, gerceklesen: 5_000, digerTalepler: 0, talep: 50_000 })).toMatchObject({ tanimli: false, asim: 0 });
  });
});

describe("teklifler (SAT-05)", () => {
  it("TL toplamı en düşük teklifleri, eşitlik varsa hepsini döndürür", () => {
    expect([...enDusukTeklifler([{ id: "a", toplamTry: 120 }, { id: "b", toplamTry: 100 }, { id: "c", toplamTry: 100 }])].sort()).toEqual(["b", "c"]);
    expect(enDusukTeklifler([]).size).toBe(0);
  });

  it("toplamı talep miktarlarıyla, TL karşılığını teklifin kuruyla hesaplar", () => {
    const kalemler = [{ id: "k1", miktar: D("10") }, { id: "k2", miktar: D("2.5") }];
    const sonuc = teklifHesapla(kalemler, [{ talepKalemiId: "k1", birimFiyat: "3.25" }, { talepKalemiId: "k2", birimFiyat: "8" }], "34.5");
    expect(sonuc.toplam.toString()).toBe("52.5");
    expect(sonuc.toplamTry.toString()).toBe("1811.25");
  });

  it("eksik, fazladan ya da tekrarlanan kalem kabul etmez", () => {
    const kalemler = [{ id: "k1", miktar: D("1") }, { id: "k2", miktar: D("1") }];
    expect(() => teklifHesapla(kalemler, [{ talepKalemiId: "k1", birimFiyat: "1" }], "1")).toThrow("tüm kalemlerine");
    expect(() => teklifHesapla(kalemler, [{ talepKalemiId: "k1", birimFiyat: "1" }, { talepKalemiId: "k2", birimFiyat: "1" }, { talepKalemiId: "x", birimFiyat: "1" }], "1")).toThrow("talepte bulunmayan");
    expect(() => teklifHesapla(kalemler, [{ talepKalemiId: "k1", birimFiyat: "1" }, { talepKalemiId: "k1", birimFiyat: "2" }], "1")).toThrow("birden çok fiyat");
  });
});

describe("yeniden onay (SAT-09)", () => {
  const esik = 25_000;

  it("%10 marjın içindeki teklif yeniden onay istemez; sınır dahildir", () => {
    expect(yenidenOnayNedeni({ onaylanan: 10_000, yeni: 10_999.99, esik })).toBeNull();
    expect(yenidenOnayNedeni({ onaylanan: 10_000, yeni: 11_000, esik })).toBeNull();
    expect(yenidenOnayNedeni({ onaylanan: 10_000, yeni: 9_000, esik })).toBeNull();
  });

  it("marjın bir kuruş üstü yeniden onay ister", () => {
    expect(yenidenOnayNedeni({ onaylanan: 10_000, yeni: 11_000.01, esik })).toMatch(/%10 marjın üstünde/);
  });

  it("kayan nokta hatası sınırı kaydırmaz", () => {
    // 0.1 + 0.2 benzeri: 1.10 × 30.03 = 33.033 → sınır 33.03
    expect(yenidenOnayNedeni({ onaylanan: 30.03, yeni: 33.03, esik })).toBeNull();
    expect(yenidenOnayNedeni({ onaylanan: 30.03, yeni: 33.04, esik })).not.toBeNull();
  });

  it("eşik altında verilmiş onay, marj içinde kalsa da eşiği aşan teklife taşınmaz", () => {
    expect(yenidenOnayNedeni({ onaylanan: 24_000, yeni: 25_000, esik })).toBeNull();
    expect(yenidenOnayNedeni({ onaylanan: 24_000, yeni: 25_000.01, esik })).toMatch(/yönetici onayı/);
  });

  it("yönetici zaten eşik üstünde onayladıysa yalnız marj uygulanır", () => {
    expect(yenidenOnayNedeni({ onaylanan: 30_000, yeni: 33_000, esik })).toBeNull();
    expect(yenidenOnayNedeni({ onaylanan: 30_000, yeni: 33_000.01, esik })).not.toBeNull();
  });

  it("0 TL onaylanmış eski talepte her pozitif teklif yeniden onay ister", () => {
    expect(yenidenOnayNedeni({ onaylanan: 0, yeni: 0.01, esik })).not.toBeNull();
  });

  it("arayüz sınırı marj ile eşiğin küçüğüdür", () => {
    expect(yenidenOnaySiniri(10_000, esik)).toBe(11_000);
    expect(yenidenOnaySiniri(24_000, esik)).toBe(25_000);
    expect(yenidenOnaySiniri(30_000, esik)).toBe(33_000);
  });

  it("teklifi seçip yeniden onaya düşüren kullanıcı onaylayamaz", () => {
    const ortak = { rol: "yonetici", talepEdenUserId: "a", tutar: 50_000, esik };
    expect(onayYetkisi({ ...ortak, userId: "b", yenidenGonderenUserId: "b" })).toMatch(/yeniden onaya gönderen/);
    expect(onayYetkisi({ ...ortak, userId: "c", yenidenGonderenUserId: "b" })).toBeNull();
    expect(onayYetkisi({ ...ortak, userId: "c", yenidenGonderenUserId: null })).toBeNull();
  });

  it("geçerlilik tarihi bugün dahil geçerlidir", () => {
    expect(teklifSuresiDolduMu("2026-10-24", "2026-10-24")).toBe(false);
    expect(teklifSuresiDolduMu("2026-10-23", "2026-10-24")).toBe(true);
    expect(teklifSuresiDolduMu(null, "2026-10-24")).toBe(false);
  });
});
