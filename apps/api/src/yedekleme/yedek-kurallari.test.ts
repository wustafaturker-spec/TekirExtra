import { describe, expect, it } from "vitest";
import { aylikDenemeGerekli, otomatikYedekGunu, silinecekYedekler, sonrakiOtomatikYedek, yedekSorunlari, type SaklamaYedegi, type YedekDurumu } from "./yedek-kurallari";

const an = (s: string) => new Date(s);
const gunKaydi = (g: string, durum: string) => ({ gun: an(`${g}T00:00:00Z`), durum });

describe("otomatik yedek planı", () => {
  it("04:00 İstanbul öncesi istemez, sonrası ister; kaçırılan saat sonra da yakalanır", () => {
    expect(otomatikYedekGunu(an("2026-11-08T00:59:00Z"), [])).toBeNull();
    expect(otomatikYedekGunu(an("2026-11-08T01:00:00Z"), [])).toBe("2026-11-08");
    expect(otomatikYedekGunu(an("2026-11-08T15:00:00Z"), [])).toBe("2026-11-08");
  });
  it("gün değişimini İstanbul takvimiyle yapar", () => {
    expect(otomatikYedekGunu(an("2026-11-08T22:30:00Z"), [gunKaydi("2026-11-08", "basarili")])).toBeNull();
    expect(otomatikYedekGunu(an("2026-11-09T01:30:00Z"), [gunKaydi("2026-11-08", "basarili")])).toBe("2026-11-09");
  });
  it("başarısız denemeden sonra en çok üç kez dener", () => {
    const hatali = gunKaydi("2026-11-08", "hatali");
    expect(otomatikYedekGunu(an("2026-11-08T05:00:00Z"), [hatali, hatali])).toBe("2026-11-08");
    expect(otomatikYedekGunu(an("2026-11-08T05:00:00Z"), [hatali, hatali, hatali])).toBeNull();
  });
  it("sonraki yedek saatini verir", () => {
    expect(sonrakiOtomatikYedek(an("2026-11-08T00:30:00Z")).toISOString()).toBe("2026-11-08T01:00:00.000Z");
    expect(sonrakiOtomatikYedek(an("2026-11-08T01:30:00Z")).toISOString()).toBe("2026-11-09T01:00:00.000Z");
  });
});

describe("aylık geri yükleme denemesi", () => {
  it("yalnız sessiz saatte ve ayda bir ister", () => {
    expect(aylikDenemeGerekli(an("2026-11-08T03:00:00Z"), null)).toBe(true);
    expect(aylikDenemeGerekli(an("2026-11-08T12:00:00Z"), null)).toBe(false);
    expect(aylikDenemeGerekli(an("2026-11-08T03:00:00Z"), an("2026-11-02T03:00:00Z"))).toBe(false);
    expect(aylikDenemeGerekli(an("2026-11-08T03:00:00Z"), an("2026-10-30T03:00:00Z"))).toBe(true);
  });
});

describe("saklama", () => {
  const simdi = an("2026-11-08T12:00:00Z");
  const yedek = (id: string, tarih: string, ek: Partial<SaklamaYedegi> = {}): SaklamaYedegi => ({ id, tur: "otomatik", tarih: an(tarih), korunuyor: false, ...ek });
  const gunluk = (adet: number) => Array.from({ length: adet }, (_, i) => yedek(`g${i}`, new Date(simdi.getTime() - i * 86_400_000).toISOString()));

  it("son yedekleri silmez; az yedek varken hiçbirine dokunmaz", () => {
    expect(silinecekYedekler(gunluk(7), simdi)).toEqual([]);
  });
  it("günlük pencerenin dışındaki aynı haftanın ara yedeklerini siler", () => {
    const silinen = silinecekYedekler(gunluk(40), simdi);
    expect(silinen).toContain("g9");
    expect(silinen).not.toContain("g0");
    expect(silinen).not.toContain("g6");
  });
  it("aynı günün eski otomatik yedeğini siler, her yılın son yedeğini tutar", () => {
    const aylar = Array.from({ length: 12 }, (_, i) => yedek(`a${i}`, `2025-${String(i + 1).padStart(2, "0")}-15T02:00:00Z`));
    const silinen = silinecekYedekler([yedek("son", "2026-11-08T02:00:00Z"), yedek("onceki", "2026-11-08T01:00:00Z"), ...aylar, yedek("y2020", "2020-12-31T02:00:00Z"), yedek("y2020b", "2020-06-01T02:00:00Z")], simdi);
    expect(silinen).toContain("onceki");
    expect(silinen).toContain("y2020b");
    expect(silinen).not.toContain("y2020");
  });
  it("elle yedeği 90 gün, korunanı süresiz tutar", () => {
    const silinen = silinecekYedekler([yedek("yeni", "2026-11-08T02:00:00Z"), yedek("e1", "2026-10-01T02:00:00Z", { tur: "elle" }), yedek("e2", "2026-01-01T02:00:00Z", { tur: "elle" }), yedek("e3", "2026-01-02T02:00:00Z", { tur: "elle", korunuyor: true })], simdi);
    expect(silinen).toEqual(["e2"]);
  });
});

describe("yedek alarmları", () => {
  const simdi = an("2026-11-08T12:00:00Z");
  const taban: YedekDurumu = { simdi, ilkTalepAt: an("2026-10-01T00:00:00Z"), sonBasariliAt: an("2026-11-08T02:00:00Z"), sonBiten: { durum: "basarili", hata: null }, aktif: null, ajan: { sonNabizAt: an("2026-11-08T11:59:00Z"), diskBosBayt: 100n * 10n ** 9n }, sonBoyutBayt: 10n ** 9n, sonDeneme: null };
  const anahtarlar = (d: Partial<YedekDurumu>) => yedekSorunlari({ ...taban, ...d }).map((s) => s.anahtar);

  it("sorun yokken ve servis hiç kurulmamışken sessizdir", () => {
    expect(anahtarlar({})).toEqual([]);
    expect(anahtarlar({ ilkTalepAt: null, sonBasariliAt: null, ajan: null })).toEqual([]);
  });
  it("26 saati aşan yedeği ve hiç başarılı olmamayı bildirir", () => {
    expect(anahtarlar({ sonBasariliAt: an("2026-11-07T09:00:00Z") })).toContain("yedek-eski");
    expect(anahtarlar({ sonBasariliAt: null })).toContain("yedek-eski");
  });
  it("hata, servis, disk, uzun süre ve deneme sorunlarını ayrı anahtarla bildirir", () => {
    expect(anahtarlar({ sonBiten: { durum: "hatali", hata: "x" } })).toContain("yedek-hata");
    expect(anahtarlar({ ajan: { sonNabizAt: an("2026-11-08T11:00:00Z"), diskBosBayt: 100n * 10n ** 9n } })).toContain("yedek-servis");
    expect(anahtarlar({ ajan: { sonNabizAt: an("2026-11-08T11:59:00Z"), diskBosBayt: 10n ** 9n } })).toContain("yedek-disk");
    expect(anahtarlar({ aktif: { durum: "calisiyor", baslangicAt: an("2026-11-08T05:00:00Z"), talepAt: an("2026-11-08T05:00:00Z") } })).toContain("yedek-uzun");
    expect(anahtarlar({ sonDeneme: { durum: "hatali", detay: "y" } })).toContain("yedek-deneme");
  });
});
