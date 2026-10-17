/**
 * FTR-42: Belge Görünümü önizlemesinin örnek belgeleri. Her tür gerçek model
 * üretecinden (teklif/sipariş/irsaliye, fatura/proforma, makbuz) geçer; bu
 * yüzden kullanıcı önizlemede ne görürse basımda onu alır. Veri uydurmadır,
 * hiçbir kiracı kaydına dokunmaz.
 */
import type { BelgeDili } from "@tekirextra/shared";
import { belgePdfModeli, type BelgePdfVerisi } from "../../belgeler/belge-pdf";
import { faturaPdfModeli } from "../../fatura/fatura-pdf";
import { makbuzPdfModeli } from "../../kasa-banka/makbuz-pdf";
import type { TicariBelgeTuru } from "./belge-gorunumu";
import type { TicariBelgeModeli } from "./ticari-belge";

const URUNLER = [
  { kod: "PMP-200", ad: "Santrifüj pompa 2,2 kW", yabanci: { en: "Centrifugal pump 2.2 kW", de: "Kreiselpumpe 2,2 kW", ar: "مضخة طرد مركزي 2.2 كيلوواط", ru: "Центробежный насос 2,2 кВт" }, miktar: 4, birim: "adet", fiyat: 420, isk: 5 },
  { kod: "VLF-050", ad: "Küresel vana DN50 PN16", yabanci: { en: "Ball valve DN50 PN16", de: "Kugelhahn DN50 PN16", ar: "صمام كروي DN50 PN16", ru: "Шаровой кран DN50 PN16" }, miktar: 24, birim: "adet", fiyat: 38.5, isk: 0 },
  { kod: "SRV-01", ad: "Yerinde devreye alma hizmeti", yabanci: { en: "On-site commissioning", de: "Inbetriebnahme vor Ort", ar: "خدمة التشغيل في الموقع", ru: "Пусконаладка на объекте" }, miktar: 8, birim: "saat", fiyat: 45, isk: 0 },
];

const BANKA = [{ bankaAdi: "Örnek Bankası", sube: "Merkez Şube", iban: "TR00 0000 0000 0000 0000 0000 00", swift: "ORNKTRIS", doviz: "USD" }];

function satirlar(dil: BelgeDili, kdv: number) {
  return URUNLER.map((u) => {
    const net = Math.round(u.miktar * u.fiyat * (1 - u.isk / 100) * 100) / 100;
    return {
      stokKod: u.kod, stokAd: u.ad, yabanciAd: dil === "tr" ? null : u.yabanci[dil],
      miktar: String(u.miktar), birim: u.birim, birimFiyat: String(u.fiyat), iskontoOrani: String(u.isk),
      kdvOrani: String(kdv), matrah: net.toFixed(2), kdvTutari: (net * kdv / 100).toFixed(2),
      toplamTutar: (net * (1 + kdv / 100)).toFixed(2), mensei: "Türkiye", gtipKodu: "841370210000",
    };
  });
}

function toplamlar(kdv: number) {
  const brut = URUNLER.reduce((t, u) => t + u.miktar * u.fiyat, 0);
  const net = URUNLER.reduce((t, u) => t + Math.round(u.miktar * u.fiyat * (1 - u.isk / 100) * 100) / 100, 0);
  const kdvTutari = Math.round(net * kdv) / 100;
  return { toplamBrut: brut.toFixed(2), toplamSatirIskontosu: (brut - net).toFixed(2), genelIskontoToplam: "0", toplamMatrah: net.toFixed(2), toplamKdv: kdvTutari.toFixed(2), genelToplam: (net + kdvTutari).toFixed(2) };
}

const bugun = () => new Date().toISOString().slice(0, 10);
const gunSonra = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Seçilen tür ve dilde örnek belgenin modeli. Yabancı dilde ihracat (USD, KDV 0) örneklenir. */
export function ornekBelgeModeli(tur: TicariBelgeTuru, dil: BelgeDili, ciftDil: boolean): TicariBelgeModeli {
  const yabanci = dil !== "tr";
  const kdv = yabanci ? 0 : 20;
  const doviz = yabanci ? "USD" : "TRY";
  const cari = yabanci
    ? { kod: "MUS-IHR", unvan: "EXAMPLE TRADING LLC", vknTckn: "100000000000000", adres: { adres: "Plot 18, Industrial Area 4", il: "Dubai", ulke: "AE" } }
    : { kod: "MUS-042", unvan: "ÖRNEK MÜŞTERİ TİCARET A.Ş.", vknTckn: "1234567890", vergiDairesi: "Kozyatağı", adres: { adres: "Atatürk Mah. Sanayi Cad. No: 7", ilce: "Ataşehir", il: "İstanbul", postaKodu: "34750", ulke: "TR" } };

  if (tur === "makbuz") {
    return makbuzPdfModeli({
      id: "ornek", tip: "tahsilat", tarih: bugun(), makbuzNo: "THS2026000001", aciklama: yabanci ? "Invoice payment" : "Fatura tahsilatı",
      tutar: "2500.00", tutarTry: yabanci ? "104625.00" : null, kur: yabanci ? "41.85" : null, dovizCinsi: doviz,
      bankaHesap: { ad: yabanci ? "Örnek Bankası USD" : "Örnek Bankası TL" },
      cari: { kod: cari.kod, unvan: cari.unvan, belgeDili: dil, belgeCiftDil: ciftDil }, fatura: { no: "TKR2026000000042" },
    });
  }

  if (tur === "fatura" || tur === "proforma") {
    return faturaPdfModeli({
      tip: tur === "proforma" ? "proforma" : "satis", durum: "kesin", no: tur === "proforma" ? "PRF2026000000007" : "TKR2026000000042",
      tarih: bugun(), vadeTarihi: gunSonra(30), dovizCinsi: doviz, kur: yabanci ? "41.85" : "1", ...toplamlar(kdv), toplamTevkifat: "0",
      aciklama: yabanci ? "Prices exclude freight and insurance." : "Örnek açıklama: ödeme banka havalesiyle yapılır.",
      belgeDili: dil, ciftDil, ihracatTeslimSarti: yabanci ? "FOB" : null, ihracatTasimaSekli: yabanci ? "1" : null,
      cari, satirlar: satirlar(dil, kdv).map((s) => ({ ...s, gibIstisnaKodu: kdv === 0 ? "301" : null, ihracatKapAdet: yabanci ? 2 : null, ihracatKapCinsi: yabanci ? "Koli" : null })),
      bankalar: BANKA,
    });
  }

  const veri: BelgePdfVerisi = {
    tur, yon: "satis", durum: "onaylandi", no: { teklif: "TKF2026000148", siparis: "SIP2026000031", irsaliye: "KIR2026000012" }[tur], tarih: bugun(),
    gecerlilikTarihi: tur === "teklif" ? gunSonra(15) : null, revizyonNo: tur === "teklif" ? 1 : 0,
    talepNo: "RFQ-2026-0912", ilgiliKisi: yabanci ? "Omar Haddad" : "Ayşe Demir", odemeVadeGun: 30, teslimSuresi: yabanci ? "4 weeks" : "10 iş günü",
    teslimSekli: yabanci ? "FOB" : null, belgeDili: dil, ciftDil, dovizCinsi: doviz, kur: yabanci ? "41.85" : "1", ...toplamlar(kdv),
    aciklama: yabanci ? "Prices exclude freight and insurance." : "Fiyatlarımıza montaj dahil değildir.",
    cari, satirlar: satirlar(dil, kdv), bankalar: BANKA,
    ...(tur === "irsaliye" ? { plaka: "34ABC123", soforAdi: "Ali", soforSoyadi: "Kaya", fiiliSevkZamani: new Date().toISOString(), tasiyiciUnvan: "Örnek Lojistik" } : {}),
  };
  return belgePdfModeli(veri);
}
