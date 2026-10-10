import { describe, expect, it } from "vitest";
import { EARSIV_ELEKTRONIK_IBARESI, faturaPdfHtml, profilAdi, type FaturaPdfVerisi } from "./fatura-pdf";

const fatura: FaturaPdfVerisi = {
  tip: "satis",
  durum: "kesin",
  no: "SNC2026000000004",
  tarih: "2026-09-11",
  vadeTarihi: null,
  dovizCinsi: "TRY",
  kur: "1",
  toplamBrut: "100.00",
  toplamSatirIskontosu: "0.00",
  genelIskontoToplam: "0.00",
  toplamMatrah: "100.00",
  toplamKdv: "20.00",
  toplamTevkifat: "0.00",
  genelToplam: "120.00",
  aciklama: null,
  cari: { kod: "C-1", unvan: "Ayşe Yılmaz", vknTckn: "10000000078" },
  satirlar: [],
};
const firma = { unvan: "Satıcı A.Ş.", vkn: "1234567801", vergiDairesi: null };

describe("faturaPdfHtml — e-Arşiv ibaresi (EBLG-26)", () => {
  it("teslim yerini başlıkta yazar; yarım adreste yazmaz (FTR-30)", () => {
    const html = faturaPdfHtml({ ...fatura, teslimatAdres: "Liman Cd. 5", teslimatIl: "İzmir", teslimatIlce: "Konak", teslimatPostaKodu: "35250" }, firma);
    expect(html).toContain("Teslim Yeri: Liman Cd. 5 35250 Konak/İzmir");
    expect(faturaPdfHtml({ ...fatura, teslimatAdres: "Liman Cd. 5" }, firma)).not.toContain("Teslim Yeri");
  });

  it("elektronik iletilen e-Arşivde ibareyi yazar", () => {
    const html = faturaPdfHtml({ ...fatura, ebelge: { tur: "earsiv" }, earsivGonderimSekli: "elektronik" }, firma);
    expect(html).toContain(EARSIV_ELEKTRONIK_IBARESI);
  });

  it("kâğıt teslim edilen e-Arşivde ibareyi yazmaz", () => {
    const html = faturaPdfHtml({ ...fatura, ebelge: { tur: "earsiv" }, earsivGonderimSekli: "kagit" }, firma);
    expect(html).not.toContain(EARSIV_ELEKTRONIK_IBARESI);
  });

  it("e-Fatura ve henüz gönderilmemiş faturada ibareyi yazmaz", () => {
    expect(faturaPdfHtml({ ...fatura, ebelge: { tur: "efatura" }, earsivGonderimSekli: "elektronik" }, firma)).not.toContain(EARSIV_ELEKTRONIK_IBARESI);
    expect(faturaPdfHtml({ ...fatura, ebelge: null }, firma)).not.toContain(EARSIV_ELEKTRONIK_IBARESI);
  });
});

describe("faturaPdfHtml — e-belge kimliği (EBLG-30)", () => {
  const kimlikli = {
    ...fatura,
    id: "11111111-1111-4111-8111-111111111111",
    senaryo: "TEVKIFAT",
    efaturaProfili: "ticari",
  };

  it("gönderilen belgede ETTN, senaryo ve profili yazar", () => {
    const html = faturaPdfHtml({ ...kimlikli, ebelge: { tur: "efatura" } }, firma);
    expect(html).toContain("ETTN: 11111111-1111-4111-8111-111111111111");
    expect(html).toContain("TEVKIFAT");
    expect(html).toContain("TICARIFATURA");
  });

  it("e-Arşiv kanalında profil EARSIVFATURA'dır", () => {
    expect(profilAdi({ ebelge: { tur: "earsiv" }, efaturaProfili: "ticari" })).toBe("EARSIVFATURA");
    expect(profilAdi({ ebelge: { tur: "efatura" }, efaturaProfili: "temel" })).toBe("TEMELFATURA");
  });

  it("gönderilmemiş faturada kimlik satırı yoktur — ETTN'in henüz anlamı yok", () => {
    const html = faturaPdfHtml({ ...kimlikli, ebelge: null }, firma);
    expect(html).not.toContain("ETTN");
    expect(profilAdi({ ebelge: null })).toBeNull();
  });
});

describe("faturaPdfHtml — TL karşılığı (EBLG-57)", () => {
  it("dövizli faturada kuru ve toplamların TL karşılığını yazar", () => {
    const html = faturaPdfHtml({ ...fatura, dovizCinsi: "USD", kur: "48.5343", toplamBrut: "18878.00", toplamMatrah: "18878.00", toplamKdv: "0.00", genelToplam: "18878.00" }, firma);
    expect(html).toContain("18.878,00 USD");
    expect(html).toContain("48,5343 TL");
    // İhracat örneğindeki (M012026000000169) TL toplamıyla aynı sonuç.
    expect(html).toContain("Genel Toplam (TL)");
    expect(html).toContain("916.230,52 TL");
  });

  it("TL faturada TL karşılığı bloğu yoktur", () => {
    const html = faturaPdfHtml(fatura, firma);
    expect(html).not.toContain("(TL)");
    expect(html).not.toContain("Döviz Kuru");
  });
});

describe("faturaPdfHtml — firma adresi ve iletişim (EBLG-62)", () => {
  it("firma kartındaki adresi, iletişimi ve MERSİS/sicili yazar", () => {
    const html = faturaPdfHtml(fatura, {
      ...firma, vergiDairesi: "Davutpaşa", adres: "Maltepe Mh. No:7", ilce: "Zeytinburnu", il: "İstanbul", postaKodu: "34010",
      telefon: "2124819113", eposta: "info@firma.test", mersisNo: "0524000463400019", ticaretSicilNo: "325632",
    });
    expect(html).toContain("Maltepe Mh. No:7");
    expect(html).toContain("34010 Zeytinburnu / İstanbul");
    expect(html).toContain("Tel: 2124819113 · info@firma.test");
    expect(html).toContain("MERSİS: 0524000463400019 · Tic. Sicil: 325632");
  });

  it("kart boşsa fazladan satır üretmez", () => {
    expect(faturaPdfHtml(fatura, firma)).not.toContain("Tel:");
  });
});

describe("faturaPdfHtml — ihraç kayıtlı (EBLG-60)", () => {
  it("KDV satırını ve belge altını tahsil edilmez diye yazar", () => {
    const html = faturaPdfHtml({ ...fatura, ihracKayitliKodu: "701", toplamKdv: "10.00", genelToplam: "100.00" }, firma);
    expect(html).toContain("Hesaplanan KDV (tahsil edilmez — 701)");
    expect(html).toContain("ihraç edilmek şartıyla teslim edildiğinden KDV tahsil edilmemiştir");
  });

  it("normal satışta ibare yoktur", () => {
    expect(faturaPdfHtml(fatura, firma)).not.toContain("tahsil edilmez");
  });
});

describe("faturaPdfHtml — KAMU senaryosu", () => {
  const kamu = {
    ...fatura,
    efaturaProfili: "ticari",
    kamuHarcamaBirimiVkn: "2222222105",
    kamuHarcamaBirimiAdi: "Destek Hizmetleri Daire Başkanlığı",
    kamuIban: "TR330006100519786457841326",
  };

  it("harcama birimini ve IBAN'ı belge altına, profili KAMU yazar", () => {
    const html = faturaPdfHtml({ ...kamu, ebelge: { tur: "efatura" } }, firma);
    expect(html).toContain("Ödemeyi yapacak harcama birimi: <strong>Destek Hizmetleri Daire Başkanlığı (VKN 2222222105)</strong>");
    expect(html).toContain("Ödemenin yapılacağı IBAN: <strong>TR33 0006 1005 1978 6457 8413 26</strong>");
    expect(profilAdi({ ebelge: { tur: "efatura" }, efaturaProfili: "ticari", kamuIban: kamu.kamuIban })).toBe("KAMU");
    // Senaryo iç kodla değil GİB'in UBL koduyla yazılır.
    expect(faturaPdfHtml({ ...kamu, id: "x", senaryo: "satis", ebelge: { tur: "efatura" } }, firma)).toContain("Senaryo: SATIS");
  });

  it("KAMU bilgisi olmayan faturada blok yoktur", () => {
    expect(faturaPdfHtml({ ...fatura, ebelge: { tur: "efatura" } }, firma)).not.toContain("harcama birimi");
  });
});

describe("faturaPdfHtml — yolcu beraberi (tax-free)", () => {
  const yolcuFaturasi = {
    ...fatura,
    yolcuBeraberi: {
      yolcu: { ad: "John", soyad: "Doe", uyruk: "GB", pasaportNo: "P1234567", sehir: "London", ulke: "GB" },
      araciKurum: { vkn: "1111111111", etiket: "urn:mail:yolcuberaberpk@arefund.com.tr", unvan: "A Refund Turkey A.Ş." },
    },
  };

  it("yolcuyu, aracı kurumu ve istisna sebebini yazar; profil YOLCUBERABERFATURA'dır", () => {
    const html = faturaPdfHtml({ ...yolcuFaturasi, ebelge: { tur: "efatura" } }, firma);
    expect(html).toContain("Yolcu: <strong>John Doe</strong>");
    expect(html).toContain("Pasaport no: P1234567");
    expect(html).toContain("İkamet: London / Birleşik Krallık");
    expect(html).toContain("KDV iadesini yapacak aracı kurum: A Refund Turkey A.Ş. (VKN 1111111111)");
    expect(html).toContain("501");
    expect(profilAdi({ ebelge: { tur: "efatura" }, yolcuBeraberi: yolcuFaturasi.yolcuBeraberi })).toBe("YOLCUBERABERFATURA");
    // Belgenin GİB tipi ISTISNA'dır; iç senaryo kodu (satis) yazılmaz.
    expect(faturaPdfHtml({ ...yolcuFaturasi, id: "x", senaryo: "satis", ebelge: { tur: "efatura" } }, firma)).toContain("Senaryo: ISTISNA");
  });

  it("yolcu bilgisi olmayan faturada blok yoktur", () => {
    expect(faturaPdfHtml({ ...fatura, ebelge: { tur: "efatura" } }, firma)).not.toContain("Yolcu:");
  });
});

describe("faturaPdfHtml — özel matrah", () => {
  // Saha örneği: 92.000'e alınan araç 95.500'e satılır; satır KDV hariç.
  const ozelMatrahFaturasi = {
    ...fatura,
    ozelMatrahKodu: "812", ozelMatrahTutari: "3465.35", ozelMatrahOrani: "1.00",
    toplamBrut: "95465.35", toplamMatrah: "95465.35", toplamKdv: "34.65", genelToplam: "95500.00",
  };

  it("kodu, matrahı ve hesaplanan KDV'yi belge altına yazar", () => {
    const html = faturaPdfHtml(ozelMatrahFaturasi, firma);
    expect(html).toContain("812 — KDV Uygulanmadan Alınan İkinci El Motorlu Kara Taşıtı veya Taşınmaz Teslimi");
    expect(html).toContain("matrah 3.465,35 TL, oran %1, hesaplanan KDV 34,65 TL");
  });

  it("toplam kutusunda mal/hizmet toplamını ve özel matrah KDV'sini gösterir", () => {
    const html = faturaPdfHtml(ozelMatrahFaturasi, firma);
    // "KDV Matrahı 95.465,35" demek belgenin matrahını yanlış anlatıyordu.
    expect(html).toContain("Mal/Hizmet Toplamı");
    expect(html).toContain("Hesaplanan KDV (özel matrah %1)");
    expect(html).toContain("95.500,00 TL");
    expect(html).not.toContain("<td style=\"padding:3px 8px\">KDV Matrahı</td>");
  });

  it("özel matrahsız faturada blok yoktur", () => {
    const html = faturaPdfHtml(fatura, firma);
    expect(html).not.toContain("Özel matrah");
    expect(html).toContain("KDV Matrahı");
  });
});

describe("faturaPdfHtml — SGK faturası", () => {
  it("grubu, Kurum'daki kodu/adını, dosya noyu ve dönemi belge altına yazar", () => {
    const html = faturaPdfHtml({
      ...fatura,
      sgkIlaveFaturaTipi: "SAGLIK_ECZ", sgkMukellefKodu: "15425689", sgkMukellefAdi: "DENEME ECZANESİ",
      sgkDosyaNo: "798564", sgkDonemBaslangic: "2026-09-01", sgkDonemBitis: "2026-09-30",
    }, firma);
    expect(html).toContain("SAGLIK_ECZ — Eczane");
    expect(html).toContain("Eczane sicil numarası: <strong>15425689</strong>");
    expect(html).toContain("Evrak no: <strong>798564</strong>");
    expect(html).toContain("01.09.2026 – 30.09.2026");
  });

  it("gruba girmeyen alanları basmaz", () => {
    const html = faturaPdfHtml({ ...fatura, sgkIlaveFaturaTipi: "MAL_HIZMET", sgkDosyaNo: "1136", sgkMukellefKodu: "yazılmamalı" }, firma);
    expect(html).toContain("MAL_HIZMET — Mal / hizmet alımı");
    expect(html).not.toContain("yazılmamalı");
    expect(html).not.toContain("Dönem:");
  });

  it("SGK dışındaki faturada blok yoktur", () => {
    expect(faturaPdfHtml(fatura, firma)).not.toContain("SGK faturası");
  });
});

describe("faturaPdfHtml — KDV dışı vergilerin sırası (EBLG-130)", () => {
  const satir = (ekVergiler: NonNullable<FaturaPdfVerisi["satirlar"][number]["ekVergiler"]>) => ({
    stokKod: "S1", stokAd: "Buzdolabı", miktar: "1", birim: "adet", birimFiyat: "1000.00", iskontoOrani: "0", iskontoTutari: "0.00",
    matrah: "1000.00", kdvOrani: "20", kdvTutari: "250.00", toplamTutar: "1500.00", ekVergiler,
  }) as unknown as FaturaPdfVerisi["satirlar"][number];
  const sira = (html: string, ...etiketler: string[]) => etiketler.map((e) => html.indexOf(`>${e}</td>`));

  it("ÖTV KDV matrahından önce; KDV matrahı ÖTV dahil; stopaj ve konaklama KDV'den sonra", () => {
    const html = faturaPdfHtml({
      ...fatura, toplamBrut: "1000.00", toplamMatrah: "1000.00", toplamKdv: "250.00", toplamEkVergi: "270.00", toplamStopaj: "100.00", genelToplam: "1420.00",
      satirlar: [satir([
        { kod: "0074", ad: "ÖTV IV. Liste", tutar: "250.00", stopaj: false, kdvMatrahinaDahil: true },
        { kod: "0059", ad: "Konaklama Vergisi", tutar: "20.00", stopaj: false, kdvMatrahinaDahil: false },
        { kod: "0003", ad: "Gelir Vergisi Stopajı", tutar: "100.00", stopaj: true, kdvMatrahinaDahil: false },
      ])],
    }, firma);
    const [mal, otv, matrah, kdv, konaklama, stopaj] = sira(html, "Mal/Hizmet Toplamı", "ÖTV IV. Liste", "KDV Matrahı", "Hesaplanan KDV", "Konaklama Vergisi", "Gelir Vergisi Stopajı (stopaj)");
    expect([mal, otv, matrah, kdv, konaklama, stopaj].every((x) => x > 0)).toBe(true);
    expect(mal < otv && otv < matrah && matrah < kdv && kdv < konaklama && konaklama < stopaj).toBe(true);
    expect(html).toMatch(/>KDV Matrahı<\/td>\s*<td class="sag"[^>]*>1\.250,00/);
    expect(html).not.toContain(">KDV Dışı Vergiler<");
  });

  it("vergisiz faturada eski düzen: KDV Matrahı doğrudan matrah", () => {
    const html = faturaPdfHtml(fatura, firma);
    expect(html).toMatch(/>KDV Matrahı<\/td>\s*<td class="sag"[^>]*>100,00/);
    expect(html).not.toContain("Mal/Hizmet Toplamı");
  });
});
