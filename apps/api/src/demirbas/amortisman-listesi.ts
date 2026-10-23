/**
 * DMR-01: VUK amortisman oranları listesinden sık kullanılan genel kalemler
 * (333, 339, 365, 389, 399, 418, 439, 458 Sıra No VUK GT; 01.01.2004'ten sonra
 * aktife girenler). Kaynak: TÜRMOB "Amortisman Oranları 2020" derlemesi,
 * genel sınıflandırma bölümleri. Sektörel kalemler listede yok; kartta ömür
 * elle girilir. Normal oran = 1 / ömür.
 */
export interface AmortismanListeKalemi {
  kod: string;
  ad: string;
  omur: number;
  sinif: "bina" | "tesis_makine" | "tasit" | "demirbas" | "hak" | "ozel_maliyet";
  binekOto?: boolean;
  teblig: string;
}

export const AMORTISMAN_LISTESI: readonly AmortismanListeKalemi[] = [
  { kod: "1.1.1", ad: "İdare, ticari ve hizmet binaları (beton, kargir, demir, çelik)", omur: 50, sinif: "bina", teblig: "333" },
  { kod: "1.2.1", ad: "Fabrika, atölye, depo, garaj binaları (beton, kargir, demir, çelik)", omur: 40, sinif: "bina", teblig: "333" },
  { kod: "1.1.5", ad: "Prefabrik yapılar, şantiye binaları, muvakkat barakalar", omur: 10, sinif: "bina", teblig: "333" },
  { kod: "2", ad: "Tesis ve arazi düzenlemeleri (otopark, ihata duvarı, soğuk hava tesisi…)", omur: 15, sinif: "tesis_makine", teblig: "333" },
  { kod: "3.1", ad: "Mobilya, masa, sandalye, dolap ve ofis demirbaşları", omur: 5, sinif: "demirbas", teblig: "365" },
  { kod: "3.2", ad: "Televizyonlar", omur: 5, sinif: "demirbas", teblig: "333" },
  { kod: "3.3", ad: "Cep telefonu ve araç kiti", omur: 3, sinif: "demirbas", teblig: "365" },
  { kod: "3.9.5", ad: "Pencere, duvar ve salon tipi klimalar", omur: 15, sinif: "demirbas", teblig: "333" },
  { kod: "3.10.4", ad: "Buzdolabı, derin dondurucu ve soğutma dolapları", omur: 10, sinif: "demirbas", teblig: "333" },
  { kod: "3.12", ad: "Asansörler", omur: 10, sinif: "tesis_makine", teblig: "333" },
  { kod: "3.14.1", ad: "Jeneratörler", omur: 10, sinif: "tesis_makine", teblig: "333" },
  { kod: "3.14.2", ad: "Kesintisiz güç kaynakları (UPS)", omur: 10, sinif: "demirbas", teblig: "333" },
  { kod: "3.23", ad: "Depolama raf sistemleri", omur: 10, sinif: "demirbas", teblig: "333" },
  { kod: "3.26", ad: "Elektronik güvenlik sistemleri", omur: 5, sinif: "demirbas", teblig: "333" },
  { kod: "3.27", ad: "POS cihazları", omur: 5, sinif: "demirbas", teblig: "333" },
  { kod: "3.28", ad: "Yangın söndürme cihazları", omur: 5, sinif: "demirbas", teblig: "333" },
  { kod: "3.34", ad: "Projeksiyon cihazı", omur: 5, sinif: "demirbas", teblig: "333" },
  { kod: "3.35", ad: "Fotoğraf makinesi ve kamera", omur: 5, sinif: "demirbas", teblig: "333" },
  { kod: "3.41", ad: "Kompresörler ve pnömatik makineler", omur: 6, sinif: "tesis_makine", teblig: "339" },
  { kod: "3.42", ad: "Takım tezgahları, talaşlı ve talaşsız kesme makineleri", omur: 6, sinif: "tesis_makine", teblig: "339" },
  { kod: "3.44", ad: "Metal işleme araçları (torna, freze, taşlama…)", omur: 10, sinif: "tesis_makine", teblig: "339" },
  { kod: "3.45", ad: "Taşınabilir elektrikli makine ve el aletleri", omur: 10, sinif: "tesis_makine", teblig: "339" },
  { kod: "3.59", ad: "Elektronik kantar", omur: 5, sinif: "demirbas", teblig: "339" },
  { kod: "3.93", ad: "Dijital baskı makinesi", omur: 10, sinif: "tesis_makine", teblig: "458" },
  { kod: "3.95", ad: "Diğer sınıflarda sayılmayan demirbaşlar", omur: 5, sinif: "demirbas", teblig: "458" },
  { kod: "4.1", ad: "Kişisel bilgisayar, dizüstü, sunucu", omur: 4, sinif: "demirbas", teblig: "333" },
  { kod: "4.2", ad: "Bilgisayar donanımı (yazıcı, terminal, disk…)", omur: 4, sinif: "demirbas", teblig: "333" },
  { kod: "4.3", ad: "Bilgisayar yazılımları", omur: 3, sinif: "hak", teblig: "333" },
  { kod: "4.4", ad: "Router, switch, data kablolaması", omur: 5, sinif: "demirbas", teblig: "365" },
  { kod: "5", ad: "Fotokopi, faks, hesap ve para sayma makineleri", omur: 5, sinif: "demirbas", teblig: "333" },
  { kod: "5.1", ad: "Ödeme kaydedici cihazlar (yazar kasa)", omur: 5, sinif: "demirbas", teblig: "333" },
  { kod: "6.1", ad: "Otomobil ve taksi (jip, arazi taşıtı dahil)", omur: 5, sinif: "tasit", binekOto: true, teblig: "333" },
  { kod: "6.2", ad: "Otobüs, minibüs, midibüs", omur: 5, sinif: "tasit", teblig: "333" },
  { kod: "6.3", ad: "Hafif kamyon (6 tona kadar) ve kamyonet", omur: 4, sinif: "tasit", teblig: "333" },
  { kod: "6.4", ad: "Ağır yük kamyonu (6 ton ve üzeri)", omur: 5, sinif: "tasit", teblig: "333" },
  { kod: "6.5", ad: "Motosiklet, moped, triportör", omur: 4, sinif: "tasit", teblig: "333" },
  { kod: "6.7", ad: "Forklift ve kaldırma tertibatlı yük arabaları", omur: 4, sinif: "tasit", teblig: "333" },
  { kod: "6.8", ad: "Çekiciler (transpalet dahil)", omur: 5, sinif: "tasit", teblig: "333" },
  { kod: "54", ad: "İlk tesis ve taazzuv giderleri", omur: 5, sinif: "hak", teblig: "333" },
  { kod: "55", ad: "Haklar (franchising, patent, lisans, telif, know-how…)", omur: 15, sinif: "hak", teblig: "365" },
  { kod: "55.1", ad: "Peştemallık", omur: 5, sinif: "hak", teblig: "365" },
  { kod: "56", ad: "Özel maliyetler (kira süresi belli olmayan)", omur: 5, sinif: "ozel_maliyet", teblig: "333" },
];

export function listeKalemi(kod: string | null | undefined) {
  return kod ? AMORTISMAN_LISTESI.find((k) => k.kod === kod) : undefined;
}
