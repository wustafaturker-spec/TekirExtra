import type { BordroMevzuatParametreleri } from "./bordro-hesaplama";

/**
 * PRS-11 (P1-5): sistemle gelen, kaynakları doğrulanmış bordro mevzuat
 * setleri. Kiracı seti tek adımda yükler; içerik burada sürümlenir, kiracının
 * parametre bilmesi gerekmez. Yeni dönem (ör. 2027) geldiğinde buraya yeni set
 * eklenir. Her sette en az bir kabul senaryosu bulunur; yükleme sırasında
 * çalıştırılır, tutmazsa set yüklenmez.
 *
 * 2026 kaynakları (2026-10-04 doğrulandı):
 * - Asgari ücret brüt 33.030,00 TL / net 28.075,50 TL (Asgari Ücret Tespit Komisyonu); Temmuz 2026'da ara zam yapılmadı.
 * - SGK tavanı brüt asgari ücretin 9 katı: 297.270,00 TL.
 * - İşçi SGK %14, işsizlik işçi %1; işveren SGK %21,75 (MYÖ işveren payı 1 puan arttı), işsizlik işveren %2.
 * - Hazine prim desteği: imalat 5 puan, diğer sektörler 2 puan (7566 s. K. m.23); azami 5, personel/dönem oranı ayrıca girilir.
 * - Gelir vergisi (ücret, GVK 103, 332 s. GV Genel Tebliği): 190.000 %15, 400.000 %20, 1.500.000 %27, 5.300.000 %35, üstü %40.
 * - Damga vergisi binde 7,59. Engellilik indirimi aylık 12.000 / 7.000 / 3.000 TL.
 * - Yemek: gelir vergisi istisnası günlük 300 TL; SGK istisnası 16.04.2026'ya kadar günlük brüt asgari ücretin %23,65'i
 *   (2022/323 YK kararı, 260,39 TL), 17.04.2026'dan itibaren 300 TL (7577 s. K. m.10, SGK Genelgesi 2026/12).
 */

export interface ResmiMevzuatSeti {
  kod: string;
  ad: string;
  yururlukBaslangic: string;
  yururlukBitis: string | null;
  kaynakNotu: string;
  parametreler: BordroMevzuatParametreleri & { engellilikIndirimi: { derece1: number; derece2: number; derece3: number } };
  kabulSenaryolari: { ad: string; girdiler: Record<string, unknown>; beklenen: Record<string, number> }[];
}

const ortak2026 = {
  asgariUcretBrut: 33030,
  sgkTavan: 297270,
  sgkIsciOrani: 14,
  issizlikIsciOrani: 1,
  sgkIsverenOrani: 21.75,
  issizlikIsverenOrani: 2,
  sgkTesvikAzamiOrani: 5,
  yemekGelirVergisiGunlukIstisna: 300,
  engellilikIndirimi: { derece1: 12000, derece2: 7000, derece3: 3000 },
  damgaVergisiOrani: 0.759,
  gelirVergisiDilimleri: [
    { ustSinir: 190000, oran: 15 },
    { ustSinir: 400000, oran: 20 },
    { ustSinir: 1500000, oran: 27 },
    { ustSinir: 5300000, oran: 35 },
    { ustSinir: null, oran: 40 },
  ],
};

const asgariUcretSenaryolari: ResmiMevzuatSeti["kabulSenaryolari"] = [
  {
    ad: "2026 asgari ücret: 33.030 brüt → 28.075,50 net, GV ve DV istisnalı",
    girdiler: { brutUcret: 33030, primGunu: 30, oncekiKumulatifMatrah: 0, oncekiAsgariKumulatifMatrah: 0 },
    beklenen: { sgkIsci: 4624.2, issizlikIsci: 330.3, gelirVergisi: 0, damgaVergisi: 0, netUcret: 28075.5, isverenSgk: 7184.03, isverenIssizlik: 660.6 },
  },
  {
    ad: "2026 asgari ücret, imalat 5 puan teşvik: işveren maliyeti 39.223,13",
    girdiler: { brutUcret: 33030, primGunu: 30, sgkTesvikOrani: 5, oncekiKumulatifMatrah: 0, oncekiAsgariKumulatifMatrah: 0 },
    beklenen: { isverenSgkTesvikIndirimi: 1651.5, isverenMaliyeti: 39223.13 },
  },
];

export const RESMI_MEVZUAT_SETLERI: ResmiMevzuatSeti[] = [
  {
    kod: "2026-1",
    ad: "2026/1 Resmî parametreler (Ocak–Nisan)",
    yururlukBaslangic: "2026-01-01",
    yururlukBitis: "2026-04-30",
    kaynakNotu: "Sistem seti 2026-1. Asgari ücret 33.030 brüt; SGK tavanı 297.270 (9 kat); işçi %14+%1, işveren %21,75+%2; teşvik azami 5 puan (imalat 5, diğer 2 — personel/dönemde girilir); GV ücret tarifesi 190.000/400.000/1.500.000/5.300.000 (%15–40); DV binde 7,59; engellilik 12.000/7.000/3.000; yemek GV istisnası 300 TL/gün, SGK istisnası 260,39 TL/gün (günlük brüt asgari ücretin %23,65'i). Not: SGK yemek istisnası 17.04.2026'da 300 TL'ye çıktı; bordro ay bazında hesaplandığından Nisan 2026 bu setle (eski tutarla) hesaplanır.",
    parametreler: { ...ortak2026, yemekSgkGunlukIstisna: 260.39 },
    kabulSenaryolari: asgariUcretSenaryolari,
  },
  {
    kod: "2026-2",
    ad: "2026/2 Resmî parametreler (Mayıs–Aralık)",
    yururlukBaslangic: "2026-05-01",
    yururlukBitis: "2026-12-31",
    kaynakNotu: "Sistem seti 2026-2. 2026-1 ile aynı; SGK yemek istisnası 7577 s. Kanun m.10 ve SGK Genelgesi 2026/12 ile 17.04.2026'dan itibaren günlük 300 TL (nakit ödemede de fiilî çalışılan güne göre).",
    parametreler: { ...ortak2026, yemekSgkGunlukIstisna: 300 },
    kabulSenaryolari: asgariUcretSenaryolari,
  },
];
