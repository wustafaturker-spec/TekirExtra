import { Prisma } from "@prisma/client";
import { MUHASEBE_HESAPLARI, type MuhasebeHesapAnahtari } from "@tekirextra/shared";

/**
 * MUH-04: kaynak kayıtlardan Tekdüzen yevmiye fişleri. Saf fonksiyonlardır;
 * veritabanı okuması `fis-okuyucu.ts`'tedir. Her kaynak kendi fişini üretir ve
 * birbirine karşı hesap üzerinden bağlanır: masraf 320/329'u alacaklandırır,
 * ödemesi aynı hesabı borçlandırır; çek girişi 101'i borçlandırır, tahsili
 * alacaklandırır. Böylece bir tutar iki kez gider ya da gelir yazılmaz.
 */

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);
const SIFIR = D(0);
const TL = (tutar: Prisma.Decimal.Value, kur: Prisma.Decimal.Value = 1) => D(tutar).mul(kur).toDecimalPlaces(2);
/** Kuruş yuvarlamasından büyük denge farkı fişi "kontrol gerekiyor"a düşürür. */
const YUVARLAMA_SINIRI = D("0.05");

export type FisTuru = "mahsup" | "tahsil" | "tediye";

export interface FisSatiri {
  hesapKodu: string;
  aciklama: string;
  borc: Prisma.Decimal;
  alacak: Prisma.Decimal;
  doviz?: { cins: string; tutar: Prisma.Decimal; kur: Prisma.Decimal };
}

export interface Kaynak {
  tur: "fatura" | "hareket" | "masraf" | "gelir" | "cek" | "kart" | "doviz_islem" | "cari_hareket" | "bordro" | "amortisman" | "demirbas" | "cari_mahsup" | "kur_farki";
  id: string;
  etiket: string;
}

export interface Fis {
  tarih: string;
  tur: FisTuru;
  aciklama: string;
  belgeNo: string | null;
  kaynak: Kaynak;
  satirlar: FisSatiri[];
}

export interface Kontrol {
  kaynak: Kaynak;
  mesaj: string;
}

// ─── Girdi tipleri (okuyucunun ürettiği düz kayıtlar) ──────────────────────

export interface CariBilgi { id: string; kod: string; unvan: string; tip: string; muhasebeKodu: string | null }
export interface HesapBilgi { tur: "kasa" | "banka" | "pos" | "kart" | "kredi"; id: string; ad: string; dovizCinsi: string; sira: number; muhasebeKodu: string | null }

export interface FaturaGirdisi {
  id: string; no: string | null; tip: string; tarih: string; cariId: string | null; dovizCinsi: string; kur: Prisma.Decimal;
  toplamMatrah: Prisma.Decimal; toplamKdv: Prisma.Decimal; toplamNetKdv: Prisma.Decimal; toplamTevkifat: Prisma.Decimal; genelToplam: Prisma.Decimal;
  /** EBLG-120: alıcının kestiği stopaj (360'a alacak). */
  toplamStopaj?: Prisma.Decimal;
  ihracat: boolean; ihracKayitli: boolean; kurFarki: boolean;
  /** STK-40: stokaDagitildi — maliyet dağıtımına kaynak olmuş hizmet satırı 153'e gider. */
  /** EBLG-120: ekVergi — bedele eklenen KDV dışı vergi; satırın gider/stok hesabına eklenir. */
  /**
   * DMR-02: demirbaşa bağlı alış satırı stok/gider yerine kartın hesabına;
   * DMR-08: satılan demirbaşın satırı (kartlara bağlanan TL tutarı) gelir yerine varlık hesabına.
   */
  satirlar: Array<{
    matrah: Prisma.Decimal; ekVergi?: Prisma.Decimal; stokTipi: string | null; stokaDagitildi?: boolean;
    demirbas?: DemirbasHesabi | null; demirbasCikis?: (DemirbasHesabi & { tl: Prisma.Decimal }) | null;
  }>;
}

/** DMR-01: kartın varlık hesabı; boşsa sınıfın ayardaki hesabı. */
export interface DemirbasHesabi { sinif: string; hesapKodu: string | null }

/** DMR-09: kesin yıl sonu amortismanı (31.12). */
export interface AmortismanGirdisi {
  id: string; yil: number; tarih: string;
  satirlar: Array<DemirbasHesabi & { kod: string; ad: string; giderHesapKodu: string | null; tutar: Prisma.Decimal }>;
}

/** DMR-08/09: elden çıkış; satisTl satış faturasında varlık hesabına alacaklanan tutardır. */
export interface DemirbasCikisGirdisi extends DemirbasHesabi {
  id: string; kod: string; ad: string; tarih: string; tur: string;
  bedel: Prisma.Decimal; birikmis: Prisma.Decimal; satisTl: Prisma.Decimal;
}

export interface HareketGirdisi {
  id: string; tip: string; tarih: string; tutar: Prisma.Decimal; tutarTry: Prisma.Decimal; dovizCinsi: string; kur: Prisma.Decimal;
  aciklama: string | null; makbuzNo: string | null; kaynakTur: string; kaynakRef: string | null;
  hesap: { tur: "kasa" | "banka" | "pos"; id: string } | null;
  karsiHareketId: string | null;
  cariId: string | null; faturaId: string | null; faturaTipi: string | null;
  faturaKarsiligi: Prisma.Decimal | null; faturaDovizi: string | null;
  masrafId: string | null; gelirId: string | null; kartId: string | null;
  /** KRD-08: banka kredisi işlemi (kullanım, taksit, rotatif geri ödeme/faiz). */
  kredi?: { id: string; tip: string; anapara: Prisma.Decimal; uzunVadeli: Prisma.Decimal; masraf: Prisma.Decimal; finansman: Prisma.Decimal } | null;
}

export interface MasrafGirdisi {
  id: string; tarih: string; belgeNo: string | null; aciklama: string | null; saticiUnvan: string | null;
  kategoriAd: string; kategoriKodu: string | null; cariId: string | null;
  matrah: Prisma.Decimal; kdvTutari: Prisma.Decimal; toplam: Prisma.Decimal; stopajTutari: Prisma.Decimal | null; kur: Prisma.Decimal; dovizCinsi: string;
  /** STK-40: stok maliyetine dağıtılmış masraf gider yerine 153'e borç yazılır. */
  stokaDagitildi?: boolean;
}

export interface GelirGirdisi {
  id: string; tarih: string; belgeNo: string | null; aciklama: string | null; kategoriAd: string; kategoriKodu: string | null; cariId: string | null;
  brutTutar: Prisma.Decimal; kdvTutari: Prisma.Decimal; stopajTutari: Prisma.Decimal; kur: Prisma.Decimal; dovizCinsi: string;
}

export interface CekGirdisi {
  id: string; tur: "cek" | "senet"; yon: "alinan" | "verilen"; portfoyNo: string; cekNo: string | null; tutar: Prisma.Decimal; tutarTry: Prisma.Decimal; kur: Prisma.Decimal; dovizCinsi: string;
  cariId: string | null; ciroCariId: string | null;
  olaylar: Array<{ id: string; oncekiDurum: string | null; yeniDurum: string; tarih: string; gecerli: boolean }>;
}

export interface KartGirdisi {
  id: string; kartId: string; tip: string; tarih: string; aciklama: string; tutar: Prisma.Decimal; cariOdemeTutari: Prisma.Decimal | null;
  cariId: string | null; masrafId: string | null; belgeNo: string | null; geriAlinanHareketId: string | null; kartDovizi: string;
}

export interface DovizIslemGirdisi {
  id: string; tarih: string; aciklama: string | null;
  cikan: { hesap: { tur: "kasa" | "banka" | "pos"; id: string }; tutar: Prisma.Decimal; doviz: string; kur: Prisma.Decimal; tl: Prisma.Decimal };
  giren: { hesap: { tur: "kasa" | "banka" | "pos"; id: string }; tutar: Prisma.Decimal; doviz: string; kur: Prisma.Decimal; tl: Prisma.Decimal };
}

/** CARI-28: elle girilen cari düzeltmesi (açılış bakiyesi hariç). */
export interface CariDuzeltmeGirdisi {
  id: string; cariId: string; tip: "borc" | "alacak"; tarih: string; tutar: Prisma.Decimal; dovizCinsi: string; kur: Prisma.Decimal; tutarTry: Prisma.Decimal;
  aciklama: string | null; karsiHesapKodu: string | null;
}

/**
 * KSB-25: alış–satış mahsubu. Taraflar fatura kurlarıyla TL'ye çevrilir:
 * satış tarafı (satış faturası, alış iadesi) 120'den, alış tarafı (alış
 * faturası, satış iadesi) 320'den kapanır; dövizli mahsupta iki tarafın kur
 * farkı 646/656'ya gider.
 */
/**
 * KSB-28: faturası kesilmeden kapatılan kur farkı (yurt dışı işlem ya da
 * önemsiz fark). Carinin TL artığı 646 (lehimize) ya da 656 (aleyhimize)
 * ile kapanır.
 */
export interface KurFarkiKapamaGirdisi {
  id: string; cariId: string; taraf: "alici" | "satici"; tarih: string; tutar: Prisma.Decimal; lehimize: boolean; faturaNo: string | null;
}

export interface CariMahsupGirdisi {
  id: string; cariId: string; tarih: string; dovizCinsi: string; tutar: Prisma.Decimal;
  satisTry: Prisma.Decimal; alisTry: Prisma.Decimal; faturaNolari: string[];
}

/**
 * PRS-19 (P3-1): onaylı bordronun tahakkuk fişi; tarih dönem sonu (cari
 * tahakkukla aynı). Tutarlar bordroda saklanan kalem ve hesap özetinden okunur.
 */
export interface BordroGirdisi {
  id: string; tarih: string; donem: string; personelNo: string; adSoyad: string;
  odenecekTutar: Prisma.Decimal;
  kalemler: Array<{ tip: "kazanc" | "kesinti"; kod: string | null; aciklama: string; tutar: Prisma.Decimal }>;
  /** Mevzuatla hesaplanmamış bordroda null (işveren payı yok). */
  isverenPayi: { sgk: Prisma.Decimal; issizlik: Prisma.Decimal } | null;
}

export interface UreticiGirdisi {
  hesapKodlari: Partial<Record<MuhasebeHesapAnahtari, string>>;
  cariler: Map<string, CariBilgi>;
  hesaplar: Map<string, HesapBilgi>; // anahtar "tur:id"
  faturalar: FaturaGirdisi[];
  hareketler: HareketGirdisi[];
  /** Dönem dışında kalsa da ters kaydın aynası ve virmanın karşı bacağı için. */
  ekHareketler: Map<string, HareketGirdisi>;
  masraflar: MasrafGirdisi[];
  /** Hareket ve kart karşı hesabı için dönem dışı masraf/gelir de gerekir. */
  tumMasraflar: Map<string, MasrafGirdisi>;
  gelirler: GelirGirdisi[];
  tumGelirler: Map<string, GelirGirdisi>;
  cekler: CekGirdisi[];
  tumCekler: Map<string, CekGirdisi>;
  kartHareketleri: KartGirdisi[];
  ekKartHareketleri: Map<string, KartGirdisi>;
  dovizIslemleri: DovizIslemGirdisi[];
  /** Eski çağıranlar için isteğe bağlı. */
  cariDuzeltmeleri?: CariDuzeltmeGirdisi[];
  /** PRS-19: onaylı bordrolar ve personel carisi → personel no (335/196 alt hesabı). */
  bordrolar?: BordroGirdisi[];
  personelCarileri?: Map<string, string>;
  amortismanlar?: AmortismanGirdisi[];
  demirbasCikislari?: DemirbasCikisGirdisi[];
  cariMahsuplari?: CariMahsupGirdisi[];
  kurFarkiKapamalari?: KurFarkiKapamaGirdisi[];
  baslangic: string;
  bitis: string;
}

// ─── Hesap kodu çözümü ────────────────────────────────────────────────────

export class HesapCozucu {
  constructor(private readonly g: Pick<UreticiGirdisi, "hesapKodlari" | "cariler" | "hesaplar">) {}

  kod(anahtar: MuhasebeHesapAnahtari): string {
    return this.g.hesapKodlari[anahtar]?.trim() || MUHASEBE_HESAPLARI[anahtar].kod;
  }

  /**
   * Cari alt hesabı (MUH-03). Kayıtlı kod bir tarafın ana hesabıyla başlıyorsa
   * öbür taraf için ilk bölüm değiştirilir: 120.01.0005 ↔ 320.01.0005.
   */
  cari(cariId: string | null, taraf: "alici" | "satici"): string {
    const cari = cariId ? this.g.cariler.get(cariId) : undefined;
    const ana = this.kod(taraf);
    if (!cari) return "";
    const kayitli = cari.muhasebeKodu?.trim();
    if (kayitli) {
      const diger = this.kod(taraf === "alici" ? "satici" : "alici");
      if (kayitli === ana || kayitli.startsWith(`${ana}.`)) return kayitli;
      if (kayitli === diger || kayitli.startsWith(`${diger}.`)) return ana + kayitli.slice(diger.length);
      return kayitli;
    }
    return `${ana}.01.${cari.kod}`;
  }

  /** PRS-19: personel alt hesabı, ör. 335.01.PRS-000005 / 196.01.PRS-000005. */
  personel(anahtar: "personel_borc" | "personel_avans", personelNo: string | undefined): string {
    const ana = this.kod(anahtar);
    return personelNo ? `${ana}.01.${personelNo}` : ana;
  }

  hesap(tur: HesapBilgi["tur"], id: string): string {
    const h = this.g.hesaplar.get(`${tur}:${id}`);
    const ana = this.kod(tur === "kart" ? "kredi_karti" : tur === "kredi" ? "kisa_vadeli_kredi" : tur);
    if (!h) return "";
    return h.muhasebeKodu?.trim() || `${ana}.01.${String(h.sira).padStart(3, "0")}`;
  }

  /** KRD-08: kredinin 300 alt hesabı; uzun vadeli kısım aynı alt hesapla 400'de. */
  kredi(id: string, uzun: boolean): string {
    const kisa = this.hesap("kredi", id);
    if (!uzun || !kisa) return kisa;
    const ana = this.kod("kisa_vadeli_kredi");
    const uzunAna = this.kod("uzun_vadeli_kredi");
    return kisa === ana || kisa.startsWith(`${ana}.`) ? uzunAna + kisa.slice(ana.length) : `${uzunAna}.01.${String(this.g.hesaplar.get(`kredi:${id}`)?.sira ?? 0).padStart(3, "0")}`;
  }

  /** DMR-01: kartın varlık hesabı ve birikmiş amortisman hesabı (hak/özel maliyette 268). */
  demirbas(d: DemirbasHesabi): string {
    return d.hesapKodu?.trim() || this.kod(`dmr_${d.sinif}` as MuhasebeHesapAnahtari);
  }

  birikmis(d: DemirbasHesabi): string {
    return this.kod(d.sinif === "hak" || d.sinif === "ozel_maliyet" ? "birikmis_itfa" : "birikmis_amortisman");
  }

  hesapAdi(tur: HesapBilgi["tur"], id: string): string {
    return this.g.hesaplar.get(`${tur}:${id}`)?.ad ?? "";
  }

  cariAdi(cariId: string | null): string {
    return (cariId && this.g.cariler.get(cariId)?.unvan) || "";
  }

  cariTipi(cariId: string | null): string | null {
    return (cariId && this.g.cariler.get(cariId)?.tip) || null;
  }
}

// ─── Yardımcılar ──────────────────────────────────────────────────────────

const borc = (hesapKodu: string, aciklama: string, tutar: Prisma.Decimal, doviz?: FisSatiri["doviz"]): FisSatiri => ({ hesapKodu, aciklama, borc: tutar, alacak: SIFIR, doviz });
const alacak = (hesapKodu: string, aciklama: string, tutar: Prisma.Decimal, doviz?: FisSatiri["doviz"]): FisSatiri => ({ hesapKodu, aciklama, borc: SIFIR, alacak: tutar, doviz });
const dovizBilgisi = (cins: string, tutar: Prisma.Decimal, kur: Prisma.Decimal) => (cins === "TRY" ? undefined : { cins, tutar, kur });
const ayna = (satirlar: FisSatiri[]): FisSatiri[] => satirlar.map((s) => ({ ...s, borc: s.alacak, alacak: s.borc }));
const sifirDegil = (s: FisSatiri) => !s.borc.isZero() || !s.alacak.isZero();

/** Karşı satır (cari/karşı hesap) yuvarlama farkını üstlenir; büyük fark kontrol listesine düşer. */
function dengele(satirlar: FisSatiri[], karsiIndeksi: number, kaynak: Kaynak, kontroller: Kontrol[]) {
  const fark = satirlar.reduce((t, s) => t.add(s.borc).sub(s.alacak), SIFIR);
  if (fark.isZero()) return;
  if (fark.abs().lte(YUVARLAMA_SINIRI)) {
    const k = satirlar[karsiIndeksi];
    if (k.borc.gt(0)) k.borc = k.borc.sub(fark);
    else k.alacak = k.alacak.add(fark);
    return;
  }
  kontroller.push({ kaynak, mesaj: `Fişin borç ve alacağı ${fark.abs().toFixed(2)} TL tutmuyor` });
}

// ─── Kaynak kuralları ─────────────────────────────────────────────────────

function faturaFisi(f: FaturaGirdisi, c: HesapCozucu, kontroller: Kontrol[]): Fis | null {
  const kaynak: Kaynak = { tur: "fatura", id: f.id, etiket: `Fatura ${f.no ?? "(numarasız)"}` };
  const satis = f.tip === "satis" || f.tip === "satis_iade";
  const iade = f.tip === "satis_iade" || f.tip === "alis_iade";
  const cariKodu = c.cari(f.cariId, satis ? "alici" : "satici");
  if (!cariKodu) kontroller.push({ kaynak, mesaj: "Faturanın carisi yok; cari hesap kodu belirlenemedi" });
  const cariAd = c.cariAdi(f.cariId);
  const aciklama = `${f.no ?? ""} ${cariAd}`.trim();
  const cariTl = TL(f.genelToplam, f.kur);
  const cariDoviz = dovizBilgisi(f.dovizCinsi, f.genelToplam, f.kur);
  const satirlar: FisSatiri[] = [];

  if (satis) {
    const gelirKodu = f.tip === "satis_iade" ? c.kod("satis_iade") : f.kurFarki ? c.kod("kur_farki_gelir") : c.kod(f.ihracat ? "yurtdisi_satis" : "yurtici_satis");
    // Satış: B 120 / A 600 + A 391. Satış iadesi: tam tersi, gelir yerine 610 borçlanır.
    const cari = (iade ? alacak : borc)(cariKodu, aciklama, cariTl, cariDoviz);
    // DMR-08: satılan demirbaşa bağlanan tutar gelir yerine varlık hesabına alacak yazılır.
    const dmrSatirlari = iade ? [] : f.satirlar.filter((s) => s.demirbasCikis);
    const dmr = dmrSatirlari.map((s) => alacak(c.demirbas(s.demirbasCikis!), `${aciklama} demirbaş satışı`, s.demirbasCikis!.tl));
    const dmrToplam = dmr.reduce((t, s) => t.add(s.alacak), SIFIR);
    const gelir = (iade ? borc : alacak)(gelirKodu, aciklama, TL(f.toplamMatrah, f.kur).sub(dmrToplam));
    const kdv = (iade ? borc : alacak)(c.kod("hesaplanan_kdv"), `${aciklama} KDV`, TL(f.toplamNetKdv, f.kur));
    satirlar.push(cari, gelir, ...dmr, kdv);
    // EBLG-128: tahsil edilen KDV dışı vergi (ÖTV, ÖİV, konaklama…) devlete ödenecektir (360);
    // alıcının kestiği stopaj bizim peşin ödediğimiz vergidir (193).
    const ekVergi = f.satirlar.reduce((t, s) => t.add(s.ekVergi ?? SIFIR), SIFIR);
    if (ekVergi.gt(0)) satirlar.push((iade ? borc : alacak)(c.kod("odenecek_vergi"), `${aciklama} KDV dışı vergiler`, TL(ekVergi, f.kur)));
    const satisStopaji = TL(f.toplamStopaj ?? SIFIR, f.kur);
    if (satisStopaji.gt(0)) satirlar.push((iade ? alacak : borc)(c.kod("pesin_vergi"), `${aciklama} stopaj`, satisStopaji));
  } else {
    // Alış: B 153/150/770 (satırın stok tipine göre, genel iskonto oranlı dağıtılır) + B 191 / A 320 + A 360.
    // EBLG-120: bedele eklenen KDV dışı vergi (ÖTV, ÖİV…) satırın hesabına eklenir; stopaj 360'a alacak.
    const satirToplami = f.satirlar.reduce((t, s) => t.add(s.matrah), SIFIR);
    const gruplar = new Map<string, { matrah: Prisma.Decimal; ekVergi: Prisma.Decimal }>();
    for (const s of f.satirlar) {
      const kod = f.kurFarki ? c.kod("kur_farki_gider")
        : s.demirbas && !iade ? c.demirbas(s.demirbas)
          : s.stokTipi === "urun" || s.stokaDagitildi ? c.kod("mal_alis") : s.stokTipi === "sarf" ? c.kod("sarf_alis") : c.kod("hizmet_alis");
      const g = gruplar.get(kod) ?? { matrah: SIFIR, ekVergi: SIFIR };
      gruplar.set(kod, { matrah: g.matrah.add(s.matrah), ekVergi: g.ekVergi.add(s.ekVergi ?? SIFIR) });
    }
    const giderler = [...gruplar.entries()].map(([kod, g]) => {
      const pay = satirToplami.isZero() ? f.toplamMatrah : f.toplamMatrah.mul(g.matrah).div(satirToplami);
      return (iade ? alacak : borc)(kod, aciklama, TL(pay.add(g.ekVergi), f.kur));
    });
    const kdv = (iade ? alacak : borc)(c.kod("indirilecek_kdv"), `${aciklama} KDV`, TL(f.toplamKdv, f.kur));
    const cari = (iade ? borc : alacak)(cariKodu, aciklama, cariTl, cariDoviz);
    const stopajTl = TL(f.toplamStopaj ?? SIFIR, f.kur);
    satirlar.push(...giderler, kdv, cari);
    if (stopajTl.gt(0)) satirlar.push((iade ? borc : alacak)(c.kod("odenecek_vergi"), `${aciklama} stopaj`, stopajTl));
    // KDV tevkifatı ya da ihraç kayıtlı alış (EBLG-114): cariye ödenmeyen KDV 360'a.
    if (f.toplamTevkifat.gt(0) || f.ihracKayitli) {
      const toplamGider = giderler.reduce((t, s) => t.add(s.borc).add(s.alacak), SIFIR);
      const odenecek = toplamGider.add(kdv.borc).add(kdv.alacak).sub(cariTl).sub(stopajTl);
      if (odenecek.gt(0)) satirlar.push((iade ? borc : alacak)(c.kod("odenecek_vergi"), `${aciklama} ${f.ihracKayitli ? "ihraç kayıtlı KDV" : "KDV tevkifatı"}`, odenecek));
    }
  }
  const sonuc = satirlar.filter(sifirDegil);
  dengele(sonuc, sonuc.findIndex((s) => s.hesapKodu === cariKodu), kaynak, kontroller);
  return { tarih: f.tarih, tur: "mahsup", aciklama: `${f.tip === "satis" ? "Satış" : f.tip === "alis" ? "Alış" : f.tip === "satis_iade" ? "Satış iadesi" : "Alış iadesi"} faturası ${aciklama}`, belgeNo: f.no, kaynak, satirlar: sonuc };
}

function masrafKarsiKodu(m: MasrafGirdisi, c: HesapCozucu) {
  return m.cariId ? c.cari(m.cariId, "satici") : c.kod("diger_ticari_borc");
}

function masrafFisi(m: MasrafGirdisi, c: HesapCozucu, kontroller: Kontrol[]): Fis {
  const kaynak: Kaynak = { tur: "masraf", id: m.id, etiket: `Masraf ${m.belgeNo ?? m.saticiUnvan ?? m.kategoriAd}` };
  const aciklama = `${m.kategoriAd}${m.saticiUnvan ? ` · ${m.saticiUnvan}` : ""}${m.aciklama ? ` · ${m.aciklama}` : ""}`.slice(0, 200);
  const stopaj = m.stopajTutari ?? SIFIR;
  const satirlar = [
    borc(m.stokaDagitildi ? c.kod("mal_alis") : m.kategoriKodu?.trim() || c.kod("hizmet_alis"), aciklama, TL(m.matrah, m.kur)),
    borc(c.kod("indirilecek_kdv"), `${aciklama} KDV`, TL(m.kdvTutari, m.kur)),
    alacak(masrafKarsiKodu(m, c), aciklama, TL(m.toplam.sub(stopaj), m.kur), dovizBilgisi(m.dovizCinsi, m.toplam.sub(stopaj), m.kur)),
    alacak(c.kod("odenecek_vergi"), `${aciklama} stopaj`, TL(stopaj, m.kur)),
  ].filter(sifirDegil);
  dengele(satirlar, satirlar.findIndex((s) => s.alacak.gt(0)), kaynak, kontroller);
  return { tarih: m.tarih, tur: "mahsup", aciklama: `Masraf ${aciklama}`, belgeNo: m.belgeNo, kaynak, satirlar };
}

function gelirKarsiKodu(g: GelirGirdisi, c: HesapCozucu) {
  return g.cariId ? c.cari(g.cariId, "alici") : c.kod("diger_alacak");
}

function gelirFisi(g: GelirGirdisi, c: HesapCozucu, kontroller: Kontrol[]): Fis {
  const kaynak: Kaynak = { tur: "gelir", id: g.id, etiket: `Gelir ${g.belgeNo ?? g.kategoriAd}` };
  const aciklama = `${g.kategoriAd}${g.aciklama ? ` · ${g.aciklama}` : ""}`.slice(0, 200);
  const net = g.brutTutar.add(g.kdvTutari).sub(g.stopajTutari);
  const satirlar = [
    borc(gelirKarsiKodu(g, c), aciklama, TL(net, g.kur), dovizBilgisi(g.dovizCinsi, net, g.kur)),
    borc(c.kod("pesin_vergi"), `${aciklama} stopaj`, TL(g.stopajTutari, g.kur)),
    alacak(g.kategoriKodu?.trim() || c.kod("diger_gelir"), aciklama, TL(g.brutTutar, g.kur)),
    alacak(c.kod("hesaplanan_kdv"), `${aciklama} KDV`, TL(g.kdvTutari, g.kur)),
  ].filter(sifirDegil);
  dengele(satirlar, 0, kaynak, kontroller);
  return { tarih: g.tarih, tur: "mahsup", aciklama: `Gelir ${aciklama}`, belgeNo: g.belgeNo, kaynak, satirlar };
}

function cekHesapKodu(cek: CekGirdisi, c: HesapCozucu) {
  if (cek.yon === "alinan") return c.kod(cek.tur === "cek" ? "alinan_cek" : "alacak_senedi");
  return c.kod(cek.tur === "cek" ? "verilen_cek" : "borc_senedi");
}

function cekFisleri(cek: CekGirdisi, g: UreticiGirdisi, c: HesapCozucu, kontroller: Kontrol[]): Fis[] {
  const fisler: Fis[] = [];
  const evrak = `${cek.tur === "cek" ? "Çek" : "Senet"} ${cek.cekNo ?? cek.portfoyNo}`;
  const hesap = cekHesapKodu(cek, c);
  const doviz = dovizBilgisi(cek.dovizCinsi, cek.tutar, cek.kur);
  for (const o of cek.olaylar) {
    if (!o.gecerli || o.tarih < g.baslangic || o.tarih > g.bitis) continue;
    const kaynak: Kaynak = { tur: "cek", id: cek.id, etiket: evrak };
    let satirlar: FisSatiri[] | null = null;
    let aciklama = "";
    if (cek.yon === "alinan") {
      if (o.oncekiDurum === null) {
        aciklama = `${evrak} portföye giriş`;
        satirlar = [borc(hesap, aciklama, cek.tutarTry, doviz), alacak(c.cari(cek.cariId, "alici"), aciklama, cek.tutarTry, doviz)];
      } else if (o.yeniDurum === "ciro_edildi") {
        aciklama = `${evrak} ciro`;
        satirlar = [borc(c.cari(cek.ciroCariId, "satici"), aciklama, cek.tutarTry, doviz), alacak(hesap, aciklama, cek.tutarTry, doviz)];
      } else if (o.yeniDurum === "karsiliksiz") {
        aciklama = `${evrak} karşılıksız`;
        satirlar = [borc(c.kod("karsiliksiz"), aciklama, cek.tutarTry, doviz), alacak(hesap, aciklama, cek.tutarTry, doviz)];
      } else if (o.yeniDurum === "iade_edildi") {
        aciklama = `${evrak} müşteriye iade`;
        satirlar = [borc(c.cari(cek.cariId, "alici"), aciklama, cek.tutarTry, doviz), alacak(hesap, aciklama, cek.tutarTry, doviz)];
      }
    } else if (o.oncekiDurum === null) {
      aciklama = `${evrak} verildi`;
      satirlar = [borc(c.cari(cek.cariId, "satici"), aciklama, cek.tutarTry, doviz), alacak(hesap, aciklama, cek.tutarTry, doviz)];
    } else if (o.yeniDurum === "iade_edildi") {
      aciklama = `${evrak} geri alındı`;
      satirlar = [borc(hesap, aciklama, cek.tutarTry, doviz), alacak(c.cari(cek.cariId, "satici"), aciklama, cek.tutarTry, doviz)];
    }
    // Tahsil/ödeme kasa-banka hareketinden, tahsile/teminata verme fişsizdir.
    if (!satirlar) continue;
    if (satirlar.some((s) => !s.hesapKodu)) kontroller.push({ kaynak, mesaj: `${aciklama}: evrakın carisi yok; cari hesap kodu belirlenemedi` });
    fisler.push({ tarih: o.tarih, tur: "mahsup", aciklama, belgeNo: cek.cekNo ?? cek.portfoyNo, kaynak, satirlar });
  }
  return fisler;
}

type KarsiSonucu = { kod: string; doviz?: FisSatiri["doviz"] } | { eksik: string };

/** Kasa/banka/POS hareketinin karşı hesabı (MUH-04). */
function hareketKarsisi(h: HareketGirdisi, g: UreticiGirdisi, c: HesapCozucu): KarsiSonucu {
  const masraf = h.masrafId ? g.tumMasraflar.get(h.masrafId) : undefined;
  if (masraf) return { kod: masrafKarsiKodu(masraf, c) };
  const gelir = h.gelirId ? g.tumGelirler.get(h.gelirId) : undefined;
  if (gelir) return { kod: gelirKarsiKodu(gelir, c) };
  const cek = h.kaynakTur === "cek_senet" && h.kaynakRef ? g.tumCekler.get(h.kaynakRef) : undefined;
  if (cek) return { kod: cekHesapKodu(cek, c) };
  if (h.kaynakTur === "kredi_karti_ekstre" && h.kartId) return { kod: c.hesap("kart", h.kartId) };
  if (h.kaynakTur === "pazaryeri_kesinti") return { kod: c.kod("pazaryeri_kesinti") };
  // PZR-09: e-ticaret stopajı gider değil, mahsup edilecek peşin vergidir.
  if (h.kaynakTur === "pazaryeri_stopaj") return { kod: c.kod("pesin_vergi") };
  // PRS-19: maaş ödemesi 335'i, avans ödemesi 196'yı kapatır; iptalleri aynı hesabın tersidir.
  if (h.kaynakTur === "personel_maas" || h.kaynakTur === "personel_maas_iptal") return { kod: c.personel("personel_borc", h.cariId ? g.personelCarileri?.get(h.cariId) : undefined) };
  if (h.kaynakTur === "personel_avans" || h.kaynakTur === "personel_avans_iptal") return { kod: c.personel("personel_avans", h.cariId ? g.personelCarileri?.get(h.cariId) : undefined) };
  if (h.cariId) {
    // Bağlı faturanın yönü önceliklidir; yoksa cari tipi, ikisi de olan caride hareket yönü.
    const faturaTarafi = h.faturaTipi ? (h.faturaTipi === "satis" || h.faturaTipi === "alis_iade" ? "alici" : "satici") : null;
    const tip = c.cariTipi(h.cariId);
    const taraf = faturaTarafi ?? (tip === "musteri" ? "alici" : tip === "tedarikci" ? "satici" : h.tip === "tahsilat" ? "alici" : "satici");
    // Farklı dövizle kapamada cari tarafı faturanın dövizindeki karşılığı taşır (KSB-07).
    const doviz = h.faturaKarsiligi && h.faturaDovizi && h.faturaDovizi !== "TRY" && h.faturaKarsiligi.gt(0)
      ? { cins: h.faturaDovizi, tutar: h.faturaKarsiligi, kur: h.tutarTry.div(h.faturaKarsiligi).toDecimalPlaces(6) }
      : dovizBilgisi(h.dovizCinsi, h.tutar, h.kur);
    return { kod: c.cari(h.cariId, taraf), doviz };
  }
  return { eksik: "Carisi ve bağlı kaydı olmayan fişin karşı hesabı belirlenemedi" };
}

function hareketFisi(h: HareketGirdisi, g: UreticiGirdisi, c: HesapCozucu, kontroller: Kontrol[]): Fis | null {
  if (!h.hesap) return null;
  const kaynak: Kaynak = { tur: "hareket", id: h.id, etiket: h.makbuzNo ? `Fiş ${h.makbuzNo}` : `${c.hesapAdi(h.hesap.tur, h.hesap.id)} ${h.tarih}` };
  const hesapKodu = c.hesap(h.hesap.tur, h.hesap.id);
  const hesapDoviz = dovizBilgisi(h.dovizCinsi, h.tutar, h.kur);
  const aciklama = (h.aciklama ?? "").slice(0, 200) || (h.cariId ? c.cariAdi(h.cariId) : "");

  // Virman: tek fiş, B hedef / A kaynak. Gelen bacak gidenle birlikte fişlenir.
  if (h.tip === "virman_gelis") return null;
  if (h.tip === "virman_gidis") {
    const karsi = h.karsiHareketId ? g.ekHareketler.get(h.karsiHareketId) : undefined;
    if (!karsi?.hesap) {
      kontroller.push({ kaynak, mesaj: "Virmanın karşı bacağı bulunamadı" });
      return null;
    }
    const satirlar = [
      borc(c.hesap(karsi.hesap.tur, karsi.hesap.id), aciklama || "Virman", karsi.tutarTry, dovizBilgisi(karsi.dovizCinsi, karsi.tutar, karsi.kur)),
      alacak(hesapKodu, aciklama || "Virman", h.tutarTry, hesapDoviz),
    ];
    dengele(satirlar, 0, kaynak, kontroller);
    return { tarih: h.tarih, tur: "mahsup", aciklama: `Virman ${c.hesapAdi(h.hesap.tur, h.hesap.id)} → ${c.hesapAdi(karsi.hesap.tur, karsi.hesap.id)}`, belgeNo: null, kaynak, satirlar };
  }

  // Ters kayıt (KSB-08): asıl fişin aynası, kendi tarihinde.
  if (h.kaynakTur === "ters_kayit") {
    const asil = h.kaynakRef ? g.ekHareketler.get(h.kaynakRef) : undefined;
    const asilFis = asil ? hareketFisi(asil, g, c, kontroller) : null;
    if (!asilFis) {
      kontroller.push({ kaynak, mesaj: "Ters kaydın asıl fişi bulunamadı" });
      return null;
    }
    return { ...asilFis, tarih: h.tarih, aciklama: `Ters kayıt: ${asilFis.aciklama}`, kaynak, satirlar: ayna(asilFis.satirlar) };
  }

  // KRD-08: kredi hareketinin karşısı anapara (300/400) ve masrafla kapanan faiz/vergi (329).
  if (h.kredi) {
    const k = h.kredi;
    const kur = h.kur;
    const kisa = TL(k.anapara.sub(k.uzunVadeli), kur);
    const uzun = TL(k.uzunVadeli, kur);
    const gider = TL(k.tip === "kullanim" ? k.masraf : k.finansman, kur);
    const kisaKod = c.kredi(k.id, false);
    const satirlar = (k.tip === "kullanim"
      ? [borc(hesapKodu, aciklama, h.tutarTry, hesapDoviz), borc(c.kod("diger_ticari_borc"), `${aciklama} tahsis ücreti`, gider), alacak(kisaKod, aciklama, kisa), alacak(c.kredi(k.id, true), aciklama, uzun)]
      : [borc(kisaKod, aciklama, kisa), borc(c.kredi(k.id, true), aciklama, uzun), borc(c.kod("diger_ticari_borc"), `${aciklama} faiz ve vergiler`, gider), alacak(hesapKodu, aciklama, h.tutarTry, hesapDoviz)]
    ).filter(sifirDegil);
    dengele(satirlar, satirlar.findIndex((s) => s.hesapKodu === kisaKod), kaynak, kontroller);
    return { tarih: h.tarih, tur: "mahsup", aciklama: `Banka kredisi ${aciklama}`, belgeNo: null, kaynak, satirlar };
  }

  const karsi = hareketKarsisi(h, g, c);
  if ("eksik" in karsi) kontroller.push({ kaynak, mesaj: karsi.eksik });
  const karsiKodu = "kod" in karsi ? karsi.kod : "";
  const karsiDoviz = "kod" in karsi ? karsi.doviz : undefined;
  const giris = h.tip === "tahsilat";
  const satirlar = giris
    ? [borc(hesapKodu, aciklama, h.tutarTry, hesapDoviz), alacak(karsiKodu, aciklama, h.tutarTry, karsiDoviz)]
    : [borc(karsiKodu, aciklama, h.tutarTry, karsiDoviz), alacak(hesapKodu, aciklama, h.tutarTry, hesapDoviz)];
  const tur: FisTuru = h.hesap.tur === "kasa" ? (giris ? "tahsil" : "tediye") : "mahsup";
  return { tarih: h.tarih, tur, aciklama: `${giris ? "Tahsilat" : "Ödeme"}${aciklama ? ` ${aciklama}` : ""}`, belgeNo: h.makbuzNo, kaynak, satirlar };
}

function kartFisi(k: KartGirdisi, g: UreticiGirdisi, c: HesapCozucu, kontroller: Kontrol[]): Fis | null {
  const kaynak: Kaynak = { tur: "kart", id: k.id, etiket: `Kart ${k.tarih} ${k.aciklama}`.slice(0, 80) };
  if (k.tip === "odeme") return null; // bankadan karta ödeme kasa-banka hareketinden fişlenir
  if (k.kartDovizi !== "TRY") {
    kontroller.push({ kaynak, mesaj: "Dövizli kredi kartı hareketinin kuru tutulmuyor; elle fişlenmeli" });
    return null;
  }
  if (k.geriAlinanHareketId) {
    const asil = g.ekKartHareketleri.get(k.geriAlinanHareketId);
    const asilFis = asil ? kartFisi(asil, g, c, kontroller) : null;
    if (!asilFis) return null;
    return { ...asilFis, tarih: k.tarih, aciklama: `Ters kayıt: ${asilFis.aciklama}`, kaynak, satirlar: ayna(asilFis.satirlar) };
  }
  const kart = c.hesap("kart", k.kartId);
  const aciklama = k.aciklama.slice(0, 200);
  const masraf = k.masrafId ? g.tumMasraflar.get(k.masrafId) : undefined;
  const karsilar: FisSatiri[] = [];
  const cariTutar = k.cariId ? (k.cariOdemeTutari ?? k.tutar) : SIFIR;
  if (k.cariId && cariTutar.gt(0)) karsilar.push(borc(c.cari(k.cariId, "satici"), aciklama, cariTutar));
  const kalan = k.tutar.sub(cariTutar);
  if (kalan.gt(0)) {
    if (masraf) karsilar.push(borc(masrafKarsiKodu(masraf, c), aciklama, kalan));
    else {
      karsilar.push(borc("", aciklama, kalan));
      kontroller.push({ kaynak, mesaj: "Kart hareketinin carisi ya da masrafı yok; karşı hesap belirlenemedi" });
    }
  }
  const satirlar = [...karsilar, alacak(kart, aciklama, k.tutar)];
  const sonuc = k.tip === "iade" ? ayna(satirlar) : satirlar;
  return { tarih: k.tarih, tur: "mahsup", aciklama: `Kredi kartı ${k.tip === "iade" ? "iadesi" : k.tip === "faiz" ? "faizi" : k.tip === "aidat" ? "aidatı" : "harcaması"} ${aciklama}`, belgeNo: k.belgeNo, kaynak, satirlar: sonuc };
}

function dovizIslemFisi(d: DovizIslemGirdisi, c: HesapCozucu, kontroller: Kontrol[]): Fis {
  const kaynak: Kaynak = { tur: "doviz_islem", id: d.id, etiket: `Döviz ${d.cikan.doviz}→${d.giren.doviz} ${d.tarih}` };
  const aciklama = d.aciklama?.slice(0, 200) || `${d.cikan.doviz} → ${d.giren.doviz}`;
  const satirlar = [
    borc(c.hesap(d.giren.hesap.tur, d.giren.hesap.id), aciklama, d.giren.tl, dovizBilgisi(d.giren.doviz, d.giren.tutar, d.giren.kur)),
    alacak(c.hesap(d.cikan.hesap.tur, d.cikan.hesap.id), aciklama, d.cikan.tl, dovizBilgisi(d.cikan.doviz, d.cikan.tutar, d.cikan.kur)),
  ];
  const fark = d.giren.tl.sub(d.cikan.tl);
  if (fark.gt(0)) satirlar.push(alacak(c.kod("kur_farki_gelir"), `${aciklama} kambiyo kârı`, fark));
  if (fark.lt(0)) satirlar.push(borc(c.kod("kur_farki_gider"), `${aciklama} kambiyo zararı`, fark.abs()));
  dengele(satirlar, 0, kaynak, kontroller);
  return { tarih: d.tarih, tur: "mahsup", aciklama: `Döviz alım/satımı ${aciklama}`, belgeNo: null, kaynak, satirlar };
}

/**
 * CARI-28: elle cari düzeltmesi. Borç yönlü: B 120/320 / A karşı (varsayılan 679);
 * alacak yönlü: B karşı (varsayılan 689) / A 120/320. Tedarikçi carisi 320'de.
 */
function cariDuzeltmeFisi(h: CariDuzeltmeGirdisi, c: HesapCozucu): Fis {
  const cariAd = c.cariAdi(h.cariId);
  const kaynak: Kaynak = { tur: "cari_hareket", id: h.id, etiket: `Cari düzeltme ${cariAd}`.trim() };
  const cariKodu = c.cari(h.cariId, c.cariTipi(h.cariId) === "tedarikci" ? "satici" : "alici");
  const karsiKodu = h.karsiHesapKodu?.trim() || c.kod(h.tip === "borc" ? "cari_duzeltme_gelir" : "cari_duzeltme_gider");
  const aciklama = `${cariAd}${h.aciklama ? ` · ${h.aciklama}` : ""}`.slice(0, 200);
  const doviz = dovizBilgisi(h.dovizCinsi, h.tutar, h.kur);
  const satirlar = h.tip === "borc"
    ? [borc(cariKodu, aciklama, h.tutarTry, doviz), alacak(karsiKodu, aciklama, h.tutarTry)]
    : [borc(karsiKodu, aciklama, h.tutarTry), alacak(cariKodu, aciklama, h.tutarTry, doviz)];
  return { tarih: h.tarih, tur: "mahsup", aciklama: `Cari düzeltme ${aciklama}`, belgeNo: null, kaynak, satirlar };
}

function cariMahsupFisi(m: CariMahsupGirdisi, c: HesapCozucu): Fis {
  const cariAd = c.cariAdi(m.cariId);
  const kaynak: Kaynak = { tur: "cari_mahsup", id: m.id, etiket: `Alış–satış mahsubu ${cariAd}`.trim() };
  const aciklama = `${cariAd} · mahsup ${m.faturaNolari.join(", ")}`.slice(0, 200);
  const doviz = m.dovizCinsi === "TRY" ? undefined : dovizBilgisi(m.dovizCinsi, m.tutar, m.tutar.gt(0) ? m.alisTry.div(m.tutar).toDecimalPlaces(4) : new Prisma.Decimal(1));
  const satirlar = [borc(c.cari(m.cariId, "satici"), aciklama, m.alisTry, doviz), alacak(c.cari(m.cariId, "alici"), aciklama, m.satisTry, doviz)];
  const fark = m.alisTry.sub(m.satisTry);
  if (fark.gt(0)) satirlar.push(alacak(c.kod("kur_farki_gelir"), aciklama, fark));
  if (fark.lt(0)) satirlar.push(borc(c.kod("kur_farki_gider"), aciklama, fark.neg()));
  return { tarih: m.tarih, tur: "mahsup", aciklama: `Alış–satış mahsubu ${aciklama}`, belgeNo: null, kaynak, satirlar };
}

function kurFarkiKapamaFisi(k: KurFarkiKapamaGirdisi, c: HesapCozucu): Fis {
  const cariAd = c.cariAdi(k.cariId);
  const kaynak: Kaynak = { tur: "kur_farki", id: k.id, etiket: `Kur farkı ${k.faturaNo ?? ""} ${cariAd}`.trim() };
  const aciklama = `${cariAd} · ${k.faturaNo ?? "fatura"} kur farkı (faturasız kapatıldı)`.slice(0, 200);
  const cariKodu = c.cari(k.cariId, k.taraf);
  const satirlar = k.lehimize
    ? [borc(cariKodu, aciklama, k.tutar), alacak(c.kod("kur_farki_gelir"), aciklama, k.tutar)]
    : [borc(c.kod("kur_farki_gider"), aciklama, k.tutar), alacak(cariKodu, aciklama, k.tutar)];
  return { tarih: k.tarih, tur: "mahsup", aciklama: `Kur farkı ${aciklama}`, belgeNo: null, kaynak, satirlar };
}

const SGK_KESINTILERI = new Set(["sgk_isci", "issizlik_isci"]);
const VERGI_KESINTILERI = new Set(["gelir_vergisi", "damga_vergisi"]);
const TAZMINATLAR = new Set(["kidem_tazminati", "ihbar_tazminati"]);

/**
 * PRS-19: B ücret gideri (kazançlar + işveren SGK/işsizlik), B tazminat gideri
 * (kıdem, ihbar) / A 361 (işçi + işveren SGK ve işsizlik), A 360 (GV + DV),
 * A 196 (avans mahsubu), A 649 (işçinin ihbar borcu), A 336 (diğer kesintiler),
 * A 335 net ödenecek (fark satırı; bordronun ödenecek tutarıyla tutmazsa kontrol).
 */
function bordroFisi(b: BordroGirdisi, c: HesapCozucu, kontroller: Kontrol[]): Fis {
  const kaynak: Kaynak = { tur: "bordro", id: b.id, etiket: `Bordro ${b.donem} ${b.adSoyad}` };
  const topla = (f: (k: BordroGirdisi["kalemler"][number]) => boolean) => b.kalemler.filter(f).reduce((t, k) => t.add(k.tutar), SIFIR);
  const kazanc = (k: BordroGirdisi["kalemler"][number]) => k.tip === "kazanc";
  const kesinti = (k: BordroGirdisi["kalemler"][number]) => k.tip === "kesinti";
  const ucret = topla((k) => kazanc(k) && !TAZMINATLAR.has(k.kod ?? ""));
  const tazminat = topla((k) => kazanc(k) && TAZMINATLAR.has(k.kod ?? ""));
  const isveren = b.isverenPayi ? b.isverenPayi.sgk.add(b.isverenPayi.issizlik) : SIFIR;
  const sgk = topla((k) => kesinti(k) && SGK_KESINTILERI.has(k.kod ?? "")).add(isveren);
  const vergi = topla((k) => kesinti(k) && VERGI_KESINTILERI.has(k.kod ?? ""));
  const avans = topla((k) => kesinti(k) && k.kod === "avans_mahsup");
  const ihbarBorcu = topla((k) => kesinti(k) && k.kod === "ihbar_kesintisi");
  const diger = topla((k) => kesinti(k) && !SGK_KESINTILERI.has(k.kod ?? "") && !VERGI_KESINTILERI.has(k.kod ?? "") && k.kod !== "avans_mahsup" && k.kod !== "ihbar_kesintisi");
  const net = ucret.add(tazminat).add(isveren).sub(sgk).sub(vergi).sub(avans).sub(ihbarBorcu).sub(diger);
  if (net.sub(b.odenecekTutar).abs().gt(YUVARLAMA_SINIRI)) kontroller.push({ kaynak, mesaj: `Bordro kalemlerinden çıkan net (${net.toFixed(2)}) ödenecek tutarla (${b.odenecekTutar.toFixed(2)}) tutmuyor` });
  const ad = `${b.adSoyad} ${b.donem}`;
  const satirlar = [
    borc(c.kod("ucret_gideri"), `${ad} brüt ücret ve ek ödemeler`, ucret),
    borc(c.kod("ucret_gideri"), `${ad} işveren SGK ve işsizlik payı`, isveren),
    borc(c.kod("tazminat_gideri"), `${ad} kıdem ve ihbar tazminatı`, tazminat),
    alacak(c.kod("odenecek_sgk"), `${ad} SGK ve işsizlik primleri`, sgk),
    alacak(c.kod("odenecek_vergi"), `${ad} gelir ve damga vergisi`, vergi),
    alacak(c.personel("personel_avans", b.personelNo), `${ad} avans mahsubu`, avans),
    alacak(c.kod("diger_gelir"), `${ad} ihbar önelsiz ayrılış`, ihbarBorcu),
    alacak(c.kod("diger_cesitli_borc"), `${ad} diğer kesintiler`, diger),
    alacak(c.personel("personel_borc", b.personelNo), `${ad} net ödenecek`, net),
  ].filter(sifirDegil);
  return { tarih: b.tarih, tur: "mahsup", aciklama: `Bordro tahakkuku ${ad}`, belgeNo: null, kaynak, satirlar };
}

/** DMR-09: yıl sonu amortismanı — B gider (kart başına) / A birikmiş amortisman. */
function amortismanFisi(a: AmortismanGirdisi, c: HesapCozucu): Fis {
  const kaynak: Kaynak = { tur: "amortisman", id: String(a.yil), etiket: `Amortisman ${a.yil}` };
  const giderler = a.satirlar.map((s) => borc(s.giderHesapKodu?.trim() || c.kod("amortisman_gideri"), `${s.kod} ${s.ad} amortismanı`, s.tutar));
  const birikmis = new Map<string, Prisma.Decimal>();
  for (const s of a.satirlar) birikmis.set(c.birikmis(s), (birikmis.get(c.birikmis(s)) ?? SIFIR).add(s.tutar));
  const alacaklar = [...birikmis.entries()].map(([kod, t]) => alacak(kod, `${a.yil} yılı amortismanı`, t));
  return { tarih: a.tarih, tur: "mahsup", aciklama: `${a.yil} yılı amortismanı`, belgeNo: null, kaynak, satirlar: [...giderler, ...alacaklar].filter(sifirDegil) };
}

/**
 * DMR-08/09: elden çıkış — birikmiş amortisman kapanır, varlık hesabının satış
 * faturasında alacaklanmamış kalanı kapanır, fark 679 (kâr) / 689 (zarar).
 */
function demirbasCikisFisi(d: DemirbasCikisGirdisi, c: HesapCozucu): Fis {
  const kaynak: Kaynak = { tur: "demirbas", id: d.id, etiket: `Demirbaş ${d.kod}` };
  const aciklama = `${d.kod} ${d.ad} elden çıkışı`;
  const kalanVarlik = d.bedel.sub(d.satisTl);
  const fark = d.satisTl.sub(d.bedel.sub(d.birikmis));
  const satirlar = [
    borc(c.birikmis(d), aciklama, d.birikmis),
    kalanVarlik.gte(0) ? alacak(c.demirbas(d), aciklama, kalanVarlik) : borc(c.demirbas(d), aciklama, kalanVarlik.neg()),
    fark.gt(0) ? alacak(c.kod("dmr_satis_kari"), `${aciklama} kârı`, fark) : borc(c.kod("dmr_satis_zarari"), `${aciklama} zararı`, fark.neg()),
  ].filter(sifirDegil);
  return { tarih: d.tarih, tur: "mahsup", aciklama, belgeNo: d.kod, kaynak, satirlar };
}

// ─── Giriş noktası ────────────────────────────────────────────────────────

export function fisleriUret(g: UreticiGirdisi): { fisler: Fis[]; kontroller: Kontrol[] } {
  const c = new HesapCozucu(g);
  const kontroller: Kontrol[] = [];
  const fisler: Fis[] = [];
  const ekle = (f: Fis | null) => {
    if (!f || !f.satirlar.length) return;
    for (const s of f.satirlar) if (!s.hesapKodu && !kontroller.some((k) => k.kaynak.id === f.kaynak.id)) kontroller.push({ kaynak: f.kaynak, mesaj: "Hesap kodu belirlenemeyen satır var" });
    fisler.push(f);
  };
  for (const f of g.faturalar) ekle(faturaFisi(f, c, kontroller));
  for (const h of g.hareketler) ekle(hareketFisi(h, g, c, kontroller));
  for (const m of g.masraflar) ekle(masrafFisi(m, c, kontroller));
  for (const gl of g.gelirler) ekle(gelirFisi(gl, c, kontroller));
  for (const cek of g.cekler) for (const f of cekFisleri(cek, g, c, kontroller)) ekle(f);
  for (const k of g.kartHareketleri) ekle(kartFisi(k, g, c, kontroller));
  for (const d of g.dovizIslemleri) ekle(dovizIslemFisi(d, c, kontroller));
  for (const h of g.cariDuzeltmeleri ?? []) ekle(cariDuzeltmeFisi(h, c));
  for (const b of g.bordrolar ?? []) ekle(bordroFisi(b, c, kontroller));
  for (const a of g.amortismanlar ?? []) ekle(amortismanFisi(a, c));
  for (const d of g.demirbasCikislari ?? []) ekle(demirbasCikisFisi(d, c));
  for (const m of g.cariMahsuplari ?? []) ekle(cariMahsupFisi(m, c));
  for (const k of g.kurFarkiKapamalari ?? []) ekle(kurFarkiKapamaFisi(k, c));
  const sira: Record<Kaynak["tur"], number> = { fatura: 0, masraf: 1, gelir: 2, cek: 3, kart: 4, doviz_islem: 5, cari_hareket: 6, cari_mahsup: 7, kur_farki: 8, bordro: 9, hareket: 10, demirbas: 11, amortisman: 12 };
  fisler.sort((a, b) => a.tarih.localeCompare(b.tarih) || sira[a.kaynak.tur] - sira[b.kaynak.tur] || (a.belgeNo ?? "").localeCompare(b.belgeNo ?? ""));
  return { fisler, kontroller };
}
