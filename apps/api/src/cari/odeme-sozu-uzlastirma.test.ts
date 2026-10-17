import { describe, expect, it } from "vitest";
import { odemeSozleriniUzlastir, type OdemeSozuUzlastirmaGirdisi } from "./odeme-sozu-uzlastirma";

const id = (n: number) => `11111111-1111-4111-8111-${n.toString().padStart(12, "0")}`;
const tenantId = id(1), cariId = id(2), faturaId = id(3);
function fixture(): OdemeSozuUzlastirmaGirdisi {
  return {
    tenantId, simdi: "2026-10-15T09:00:00Z",
    faturalar: [{ id: faturaId, tenantId, cariId, dovizCinsi: "TRY", tip: "satis", durum: "kesin" }],
    sozler: [{ id: id(4), tenantId, cariId, faturaId, dovizCinsi: "TRY", tutar: "1000.00", verildigiZaman: "2026-10-14T09:00:00Z", sozTarihi: "2026-10-15", kayitDurumu: "aktif" }],
    kapamalar: [],
  };
}
function kapama(n = 10, tutar = "400.00"): OdemeSozuUzlastirmaGirdisi["kapamalar"][number] {
  return { id: id(n), tenantId, cariId, faturaId, dovizCinsi: "TRY", tutar, kaynakId: id(n + 100), kaynakTuru: "kasa_banka", kaynakYon: "tahsilat", islemZamani: "2026-10-15T08:00:00Z", islemZamaniHassasiyeti: "an", kaynakKayitZamani: "2026-10-15T08:00:01Z" };
}
const ilk = (g: OdemeSozuUzlastirmaGirdisi) => odemeSozleriniUzlastir(g)[0];

describe("F02 ödeme sözü güncel kaynak uzlaştırması", () => {
  it("F02-K1: 400 + 600, tekrar ve 400 geri alma güncel kaynaktan türetilir", () => {
    const g = fixture();
    expect(ilk(g)).toMatchObject({ durum: "aktif", gerceklesen: "0.00", kalan: "1000.00" });
    g.kapamalar = [kapama()];
    expect(ilk(g)).toMatchObject({ durum: "kismen_gerceklesti", gerceklesen: "400.00", kalan: "600.00" });
    g.kapamalar.push(kapama(11, "600.00"));
    expect(ilk(g)).toMatchObject({ durum: "gerceklesti", gerceklesen: "1000.00", kalan: "0.00" });
    g.kapamalar.push(kapama());
    expect(ilk(g).gerceklesen).toBe("1000.00");
    g.kapamalar = [kapama(11, "600.00")];
    expect(ilk(g)).toMatchObject({ durum: "kismen_gerceklesti", gerceklesen: "600.00", kalan: "400.00" });
  });

  it.each(["islemZamani", "kaynakKayitZamani"] as const)("Söz öncesi %s yeni kapama kimliğiyle gerçekleşme olmaz", (alan) => {
    const g = fixture();
    g.kapamalar = [{ ...kapama(), [alan]: "2026-10-14T08:59:59Z" }];
    expect(ilk(g).gerceklesen).toBe("0.00");
  });
  it.each(["islemZamani", "kaynakKayitZamani"] as const)("Eşit %s belirsizliği gerçekleşme sayılmaz", (alan) => {
    const g = fixture();
    g.kapamalar = [{ ...kapama(), [alan]: g.sozler[0].verildigiZaman }];
    expect(ilk(g).gerceklesen).toBe("0.00");
  });
  it.each(["islemZamani", "kaynakKayitZamani"] as const)("Gelecek %s gerçekleşme sayılmaz", (alan) => {
    const g = fixture();
    g.kapamalar = [{ ...kapama(), [alan]: "2026-10-16T00:00:00Z" }];
    expect(ilk(g).gerceklesen).toBe("0.00");
  });
  it.each([{ tenantId: id(90) }, { cariId: id(90) }, { faturaId: id(90) }, { dovizCinsi: "USD" }])("F02-K2: yabancı kapsamı dışlar %j", (fark) => {
    const g = fixture();
    g.kapamalar = [{ ...kapama(), ...fark }];
    expect(ilk(g)).toMatchObject({ gerceklesen: "0.00", kaynaklar: [] });
  });
  it.each(["kredi_karti", "cek_senet", "iade_fatura"] as const)("%s ilk sürümde nakit gerçekleşmesi değildir", (kaynakTuru) => {
    const g = fixture(); g.kapamalar = [{ ...kapama(), kaynakTuru }];
    expect(ilk(g).gerceklesen).toBe("0.00");
  });
  it("Tediye tahsilat sayılmaz", () => {
    const g = fixture(); g.kapamalar = [{ ...kapama(), kaynakYon: "tediye" }];
    expect(ilk(g).gerceklesen).toBe("0.00");
  });
  it("Otomatik kapama kimliği yenilense de kaynak payı ve gerçekleşme değişmez", () => {
    const g = fixture(); g.kapamalar = [kapama()];
    const once = ilk(g);
    g.kapamalar[0].id = id(999);
    expect(ilk(g)).toMatchObject({ durum: once.durum, gerceklesen: once.gerceklesen, kalan: once.kalan });
    expect(ilk(g).kaynaklar[0].kaynakId).toBe(once.kaynaklar[0].kaynakId);
  });
  it("Elle ve otomatik kapamanın aynı kaynak paylarını birlikte sayar", () => {
    const g = fixture();
    g.kapamalar = [kapama(), { ...kapama(), id: id(11), tutar: "200.00" }];
    expect(ilk(g)).toMatchObject({ gerceklesen: "600.00", kaynaklar: [{ tutar: "600.00", kapamaIdleri: [id(10), id(11)] }] });
  });
  it("Aynı ödeme iki söze tam yazılamaz; eski söz önce pay alır", () => {
    const g = fixture();
    g.sozler.push({ ...g.sozler[0], id: id(5), verildigiZaman: "2026-10-14T10:00:00Z" });
    g.kapamalar = [kapama(10, "1500.00")];
    g.sozler.reverse();
    expect(odemeSozleriniUzlastir(g).map((s) => [s.sozId, s.gerceklesen, s.kalan])).toEqual([[id(4), "1000.00", "0.00"], [id(5), "500.00", "500.00"]]);
  });
  it("Sözler aynı zamanda ise kimlik sırası sonucu sabit tutar", () => {
    const g = fixture();
    g.sozler.unshift({ ...g.sozler[0], id: id(5) }); g.kapamalar = [kapama()];
    expect(odemeSozleriniUzlastir(g).map((s) => s.gerceklesen)).toEqual(["400.00", "0.00"]);
  });
  it.each(["iptal", "revize"] as const)("%s söz pay tüketmez; eski ödeme yeni revizyona taşınmaz", (kayitDurumu) => {
    const g = fixture(); g.sozler[0].kayitDurumu = kayitDurumu;
    g.sozler.push({ ...g.sozler[0], id: id(5), kayitDurumu: "aktif", verildigiZaman: "2026-10-15T08:30:00Z" });
    g.kapamalar = [kapama()];
    expect(odemeSozleriniUzlastir(g).map((s) => [s.durum, s.gerceklesen])).toEqual([[kayitDurumu, "0.00"], ["aktif", "0.00"]]);
  });
  it.each(["taslak", "iptal"] as const)("Fatura %s ise söz gerçekleşmesi kalkar", (durum) => {
    const g = fixture(); g.faturalar[0].durum = durum; g.kapamalar = [kapama(10, "1000.00")];
    expect(ilk(g)).toMatchObject({ durum: "kaynak_gecersiz", gerceklesen: "0.00", kalan: "1000.00" });
  });
  it("Türkiye gece yarısında kısmi söz gecikir, tam gerçekleşen gecikmez", () => {
    const g = fixture(); g.simdi = "2026-10-15T21:00:00Z"; g.kapamalar = [kapama()];
    expect(ilk(g)).toMatchObject({ durum: "gecikti", gerceklesen: "400.00", kalan: "600.00" });
    g.kapamalar.push(kapama(11, "600.00"));
    expect(ilk(g).durum).toBe("gerceklesti");
  });
  it("Büyük tutarda bir kuruş kaybolmaz ve söz tutarı aşılmaz", () => {
    const g = fixture(); g.sozler[0].tutar = "9999999999999.99";
    g.kapamalar = [kapama(10, "9999999999999.98")];
    expect(ilk(g).kalan).toBe("0.01");
    g.kapamalar.push(kapama(11, "100.00"));
    expect(ilk(g)).toMatchObject({ kalan: "0.00", gerceklesen: "9999999999999.99" });
  });
  it("Aynı kaynak farklı faturalardaki kendi kapama paylarıyla sınırlıdır", () => {
    const g = fixture(); g.faturalar.push({ ...g.faturalar[0], id: id(6) });
    g.sozler.push({ ...g.sozler[0], id: id(5), faturaId: id(6) });
    g.kapamalar = [kapama(), { ...kapama(), id: id(11), faturaId: id(6), tutar: "600.00" }];
    expect(odemeSozleriniUzlastir(g).map((s) => s.gerceklesen)).toEqual(["400.00", "600.00"]);
  });
  it("Çelişkili duplicate kapamayı reddeder", () => {
    const g = fixture(); g.kapamalar = [kapama(), kapama(10, "500.00")];
    expect(() => ilk(g)).toThrow("çelişkili");
  });
  it("Aynı kaynak için çelişkili işlem zamanını reddeder", () => {
    const g = fixture(); g.kapamalar = [kapama(), { ...kapama(), id: id(11), islemZamani: "2026-10-15T07:00:00Z" }];
    expect(() => ilk(g)).toThrow("çelişkili");
  });
  it.each([{ tenantId: id(99) }, { cariId: id(99) }, { dovizCinsi: "USD" }, { faturaId: id(99) }])("Söz kapsamı uyuşmazlığını reddeder %j", (fark) => {
    const g = fixture(); Object.assign(g.sozler[0], fark);
    expect(() => ilk(g)).toThrow("kapsamı geçersiz");
  });
  it.each(["0.00", "-1.00", "1.001", "1e3", "NaN", "10000000000000.00"])("Geçersiz söz tutarı %s reddedilir", (tutar) => {
    const g = fixture(); g.sozler[0].tutar = tutar;
    expect(() => ilk(g)).toThrow();
  });
  it.each(["2026-02-30", "2026-10-13"])("Geçersiz veya sözden önceki gün %s reddedilir", (sozTarihi) => {
    const g = fixture(); g.sozler[0].sozTarihi = sozTarihi;
    expect(() => ilk(g)).toThrow();
  });
  it("Gelecekte verilmiş söz reddedilir", () => {
    const g = fixture(); g.sozler[0].verildigiZaman = "2026-10-15T10:00:00Z";
    expect(() => ilk(g)).toThrow("zamanı geçersiz");
  });
  it("Tekrarlanan söz kimliği reddedilir", () => {
    const g = fixture(); g.sozler.push({ ...g.sozler[0] });
    expect(() => ilk(g)).toThrow("kimlik kapsamı geçersiz");
  });
  it("Girdi değiştirilmez ve tekrar aynı sonucu verir", () => {
    const g = fixture(); g.kapamalar = [kapama()];
    const kopya = JSON.stringify(g); const sonuc = odemeSozleriniUzlastir(g);
    expect(JSON.stringify(g)).toBe(kopya);
    expect(odemeSozleriniUzlastir(g)).toEqual(sonuc);
  });
  it("Gün hassasiyetindeki aynı gün ödeme, sonradan kaydedilse de kanıtlanmış yeni tahsilat sayılmaz", () => {
    const g = fixture(); g.sozler[0].verildigiZaman = "2026-10-15T07:00:00Z";
    g.kapamalar = [{ ...kapama(), islemZamani: "2026-10-15T00:00:00Z", islemZamaniHassasiyeti: "gun" }];
    expect(ilk(g).gerceklesen).toBe("0.00");
  });
  it("Gün hassasiyetinde sözün Türkiye gününden sonraki ödeme sayılır", () => {
    const g = fixture();
    g.kapamalar = [{ ...kapama(), islemZamani: "2026-10-15T00:00:00Z", islemZamaniHassasiyeti: "gun" }];
    expect(ilk(g).gerceklesen).toBe("400.00");
    g.sozler[0].verildigiZaman = "2026-10-14T21:00:00Z";
    expect(ilk(g).gerceklesen).toBe("0.00");
  });
  it("Gün hassasiyeti için saat veya ofset uydurulamaz", () => {
    const g = fixture(); g.kapamalar = [{ ...kapama(), islemZamaniHassasiyeti: "gun" }];
    expect(() => ilk(g)).toThrow("UTC gece yarısı");
  });
  it("Türkiye gününe yeni girildiğinde gün hassasiyetli kaynak gelecekte sanılmaz", () => {
    const g = fixture(); g.simdi = "2026-10-14T21:30:00Z";
    g.kapamalar = [{ ...kapama(), islemZamani: "2026-10-15T00:00:00Z", islemZamaniHassasiyeti: "gun", kaynakKayitZamani: "2026-10-14T21:10:00Z" }];
    expect(ilk(g).gerceklesen).toBe("400.00");
  });
  it("Yabancı şirket faturası ve tekrarlanan fatura reddedilir", () => {
    const g = fixture(); g.faturalar[0].tenantId = id(99);
    expect(() => ilk(g)).toThrow("Fatura kapsamı");
    g.faturalar[0].tenantId = tenantId; g.faturalar.push({ ...g.faturalar[0] });
    expect(() => ilk(g)).toThrow("Fatura kapsamı");
  });
  it("Alış faturası tahsilat sözü hedefi olamaz", () => {
    const g = fixture(); g.faturalar[0].tip = "alis";
    expect(() => ilk(g)).toThrow("satış faturası");
  });
  it("Eksik kapsamla sessiz sonuç üretmek yerine okuma sınırı aşımı reddedilir", () => {
    const g = fixture(); g.kapamalar = Array.from({ length: 5001 }, (_, n) => kapama(n + 1000));
    expect(() => ilk(g)).toThrow();
  });
});
