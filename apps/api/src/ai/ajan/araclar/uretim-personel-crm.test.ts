import { describe, expect, it, vi } from "vitest";
import type { AracBaglami } from "./arac";
import { CRM_ARACLARI, PERSONEL_ARACLARI, URETIM_ARACLARI, maliyetToplamlari } from "./uretim-personel-crm";

const TUMU = [...CRM_ARACLARI, ...URETIM_ARACLARI, ...PERSONEL_ARACLARI];
const bul = (ad: string) => {
  const a = TUMU.find((x) => x.ad === ad);
  if (!a) throw new Error(ad);
  return a;
};

/** Uç çağrılarını metot adına göre yanıtlayan sahte bağlam. */
function baglam(yanitlar: Record<string, (...a: any[]) => unknown>) {
  const cagir = vi.fn(async (uc: { yontem: string }, argumanlar: unknown[]) => {
    const f = yanitlar[uc.yontem];
    if (!f) throw new Error(`beklenmeyen uç ${uc.yontem}`);
    return f(...argumanlar);
  });
  return { b: { uc: { cagir }, kaynak: "asistan", arac: "deneme" } as unknown as AracBaglami, cagir };
}

const PERSONEL = {
  id: "p1", personelNo: "P-001", ad: "Ayşe", soyad: "Yılmaz", departman: "Üretim", unvan: "Usta", durum: "aktif", aktif: true, calismaTipi: "tam_zamanli",
  girisTarihi: new Date("2024-03-01"), tckn: "12345678901", iban: "TR000000000000000000000000", adres: "Gizli sok.", telefon: "05550000000", eposta: "ayse@ornek.com",
  netMaas: "45000.00", brutMaas: "60000.00", engellilikDerecesi: 40, dogumTarihi: new Date("1990-01-01"),
};
const GIZLI = ["12345678901", "TR000000000000000000000000", "Gizli sok.", "05550000000", "ayse@ornek.com", "45000", "60000", "engellilik", "1990-01-01"];

describe("AI-87 personel gizliliği", () => {
  it("personel listesi ve kartı yalnız beyaz listedeki alanları verir", async () => {
    const { b } = baglam({ listele: () => ({ kayitlar: [PERSONEL], toplam: 1, sonrakiImlec: null }), getir: () => ({ ...PERSONEL, departmanKaydi: { ad: "Üretim" }, yonetici: { ad: "Can", soyad: "Ak" } }) });
    const liste = JSON.stringify(await bul("personel_ara").calistir(b, {}));
    const kart = JSON.stringify(await bul("personel_getir").calistir(b, { personelId: "p1" }));
    for (const metin of [liste, kart]) {
      expect(metin).toContain("Ayşe");
      for (const g of GIZLI) expect(metin, g).not.toContain(g);
    }
    expect(kart).toContain("Can Ak");
  });

  it("maliyet raporu kişi satırı vermez; tek küçük departman varsa çıkarmayla bulunmasın diye kırılım verilmez", () => {
    const s = (departman: string, brut: number) => ({ departman, brutUcret: brut, netUcret: brut * 0.7, isverenMaliyeti: brut * 1.2 });
    const r = maliyetToplamlari([s("Üretim", 100), s("Üretim", 200), s("Üretim", 300), s("Muhasebe", 1000)]) as any;
    expect(r.toplam).toMatchObject({ kisiSayisi: 4, toplamBrut: "1600.00" });
    expect(r.departmanlar).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/"1000|"600|Muhasebe/);
    const tam = maliyetToplamlari([s("Üretim", 100), s("Üretim", 200), s("Üretim", 300), s("Satış", 10), s("Satış", 20), s("Satış", 30)]) as any;
    expect(tam.departmanlar).toEqual([expect.objectContaining({ departman: "Üretim", kisiSayisi: 3, toplamBrut: "600.00", kisiBasiOrtalamaMaliyet: "240.00" }), expect.objectContaining({ departman: "Satış", kisiSayisi: 3 })]);
  });

  it("küçük departmanlar birlikte en az üç kişiyse 'Diğer' olarak birleşir; üç kişiden az bordroda tutar yok", () => {
    const s = (departman: string) => ({ departman, brutUcret: 100, netUcret: 70, isverenMaliyeti: 120 });
    const r = maliyetToplamlari([s("A"), s("A"), s("A"), s("B"), s("C"), s("C")]) as any;
    expect(r.departmanlar.map((d: any) => d.departman)).toEqual(["A", "Diğer (küçük departmanlar)"]);
    expect(maliyetToplamlari([s("A"), s("A")])).toEqual({ kisiSayisi: 2, not: expect.stringContaining("tutar verilmez") });
  });

  it("izin talebi açıklamasız döner; bilgi talebi yeni değerleri vermez", async () => {
    const { b } = baglam({
      listele: () => [{ id: "i1", personelId: "p1", durum: "talep", gunSayisi: "3", aciklama: "hastane kontrolü", kararNedeni: null, baslangicTarihi: new Date("2026-11-02"), bitisTarihi: new Date("2026-11-04"), personel: { ad: "Ayşe", soyad: "Yılmaz", personelNo: "P-001" }, izinTuru: { ad: "Yıllık izin" } }],
      bilgiTalepleri: () => [{ id: "t1", durum: "bekliyor", personel: { id: "p1", ad: "Ayşe", soyad: "Yılmaz", personelNo: "P-001" }, istenen: { iban: "TR111111111111111111111111", adres: "Yeni adres" }, mevcut: { iban: "TR00****", adres: "Eski" }, createdAt: new Date("2026-10-20") }],
    });
    const izin = JSON.stringify(await bul("izin_talepleri").calistir(b, { durum: "talep" }));
    expect(izin).toContain("Yıllık izin");
    expect(izin).not.toContain("hastane");
    const bilgi = JSON.stringify(await bul("bilgi_talepleri").calistir(b, {}));
    expect(bilgi).toContain('"istenenAlanlar":["iban","adres"]');
    expect(bilgi).not.toContain("TR111111");
    expect(bilgi).not.toContain("Yeni adres");
    expect(await bul("bilgi_talebini_onayla").ozetle!(b, { talepId: "t1" })).not.toContain("TR111111");
  });

  it("avans özeti kişi başı tutar vermez; az kişide toplam da yok", async () => {
    const av = (ad: string, kalan: string) => ({ durum: "onaylandi", kalanTutar: kalan, personel: { ad, soyad: "X", personelNo: null } });
    const iki = baglam({ avansListele: () => [av("A", "500"), av("B", "700")] });
    const r = await bul("avans_ozeti").calistir(iki.b, {}) as any;
    expect(r).toMatchObject({ acikAvansSayisi: 2, kisiler: ["A X", "B X"] });
    expect(JSON.stringify(r)).not.toMatch(/500|700|1200/);
    const uc = baglam({ avansListele: () => [av("A", "500"), av("B", "700"), av("C", "300"), { ...av("D", "0"), durum: "mahsup_edildi" }] });
    expect(await bul("avans_ozeti").calistir(uc.b, {})).toMatchObject({ acikAvansSayisi: 3, toplamKalan: "1500.00" });
  });

  it("personel özeti küçük departmanın ücret yükünü ne doğrudan ne çıkarmayla verir", async () => {
    const { b } = baglam({ ozet: () => ({ donem: { yil: 2026, ay: 10 }, toplamPersonel: 5, aktifPersonel: 5, durumlar: [], aylikSozlesmeYuku: "₺1", departmanlar: [{ ad: "Üretim", adet: 4, ucretYuku: "₺4", isverenMaliyeti: "₺5" }, { ad: "Muhasebe", adet: 1, ucretYuku: "₺9", isverenMaliyeti: "₺10" }], bordro: { acikAdet: 0 }, avans: { acikAdet: 0 }, izin: { bekleyen: 1 }, belgeler: { suresiDolmus: [], yaklasan: [] } }) });
    const r = await bul("personel_ozeti").calistir(b, {}) as any;
    // Tek kişilik departman toplamdan çıkarılarak bulunmasın diye hiçbir departmana tutar yazılmaz.
    expect(r.departmanlar).toEqual([{ ad: "Üretim", adet: 4 }, { ad: "Muhasebe", adet: 1 }]);
    expect(JSON.stringify(r)).not.toContain("ucretYuku");
    expect(JSON.stringify(r)).not.toContain("aylikSozlesmeYuku");
  });
});

describe("AI-85/86 üretim araçları", () => {
  it("emir taslağı depo verilmezse varsayılan depoyu kullanır", async () => {
    const olustur = vi.fn(async (g: any) => ({ id: "e1", no: null, durum: "taslak", planlananMiktar: g.planlananMiktar, stok: { id: "m1", kod: "M1", ad: "Masa", anaBirim: "adet" } }));
    const { b } = baglam({ listele: () => [{ id: "d1", ad: "Ana", varsayilan: false }, { id: "d2", ad: "Mamul", varsayilan: true }], emirOlustur: olustur });
    const r = await bul("uretim_emri_taslagi_olustur").calistir(b, { stokId: "m1", planlananMiktar: "10", tarih: "2026-10-22" }) as any;
    expect(olustur).toHaveBeenCalledWith(expect.objectContaining({ hedefDepoId: "d2", planlananMiktar: "10", tarih: "2026-10-22" }));
    expect(r).toMatchObject({ id: "e1", durum: "taslak", adres: "/panel/uretim/emirler/e1" });
  });

  it("varsayılan depo yoksa hangi depoların olduğunu söyler", async () => {
    const { b } = baglam({ listele: () => [{ id: "d1", ad: "Ana" }, { id: "d2", ad: "Mamul" }] });
    await expect(bul("uretim_emri_taslagi_olustur").calistir(b, { stokId: "m1", planlananMiktar: "10" })).rejects.toThrow(/Ana \(d1\).*Mamul \(d2\)/);
  });

  it("planlama onaylı araçtır; özet emri tanımlar", async () => {
    const a = bul("uretim_emrini_planla");
    expect(a.sinif).toBe("onay");
    const { b } = baglam({ emir: () => ({ id: "e1", no: "UE-7", durum: "taslak", planlananMiktar: "10", stok: { ad: "Masa", anaBirim: "adet" } }) });
    expect(await a.ozetle!(b, { emirId: "e1" })).toBe("Planlanacak: Üretim emri UE-7 · Masa · 10 adet · durum: taslak");
  });
});

describe("AI-89…91 CRM araçları", () => {
  const firsat = { id: "f1", baslik: "Okul mobilyası", cariId: "c1", tahminiTutar: "250000", asama: "pazarlik", kapanisTarihi: new Date("2026-12-01"), notlar: null, updatedAt: new Date("2026-10-21T10:00:00Z"), cari: { id: "c1", kod: "M-1", unvan: "KARSEL", vergiNo: "1" }, sorumlu: { adSoyad: "Ali" } };

  it("fırsat araması aşama, cari ve başlıkla süzer", async () => {
    const { b, cagir } = baglam({ listele: () => [firsat, { ...firsat, id: "f2", baslik: "Ofis", cariId: "c2", cari: { id: "c2", unvan: "Başka" } }] });
    const r = await bul("crm_firsat_ara").calistir(b, { asama: "pazarlik", arama: "okul" }) as any;
    expect(cagir.mock.calls[0][1]).toEqual(["pazarlik"]);
    expect(r.toplam).toBe(1);
    expect(r.veri[0]).toMatchObject({ id: "f1", asamaAdi: "Pazarlık", kapanisTarihi: "2026-12-01", cari: { kod: "M-1", unvan: "KARSEL" }, sorumlu: "Ali" });
  });

  it("aşama değişikliği onaylıdır ve önizlemede eski/yeni aşamayı gösterir", async () => {
    const a = bul("crm_firsat_asama_degistir");
    expect(a.sinif).toBe("onay");
    const { b } = baglam({ getir: () => firsat });
    expect(await a.onizle!(b, { firsatId: "f1", asama: "kazanildi" })).toMatchObject({ degisiklikler: [{ alan: "asama", once: "Pazarlık", sonra: "Kazanıldı" }] });
  });

  it("fırsattan teklif fırsatın carisine, güncel zaman damgasıyla açılır", async () => {
    const teklif = vi.fn(async () => ({ id: "b1", bagId: "bag1" }));
    const { b } = baglam({
      getir: (id: string) => (id === "f1" ? firsat : { id: "s1", ad: "Sıra", anaBirim: "adet", kdvOrani: "20" }),
      teklifOlustur: teklif,
    });
    const r = await bul("crm_firsattan_teklif").calistir(b, { firsatId: "f1", satirlar: [{ stokId: "s1", miktar: "40", birimFiyat: "1500" }] }) as any;
    expect(teklif).toHaveBeenCalledWith("f1", expect.objectContaining({
      beklenenFirsatZamani: "2026-10-21T10:00:00.000Z",
      belge: expect.objectContaining({ tur: "teklif", yon: "satis", cariId: "c1", dovizCinsi: "TRY", satirlar: [expect.objectContaining({ stokId: "s1", miktar: "40", birimFiyat: "1500", kdvOrani: "20" })] }),
    }));
    expect(r).toMatchObject({ belgeId: "b1", adres: "/panel/belgeler?odak=b1" });
  });
});
