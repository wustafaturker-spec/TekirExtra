/**
 * CARI-24/25/26: cari ekstresinin satırlarını belgeleriyle zenginleştirir.
 * Cari hareketi yalnız tutar ve açıklama taşır; hareket türü, belge no,
 * ödeme şekli ve (ayrıntılı ekstrede) fatura kalemleri kaynak kayıttan
 * okunur. Döviz ekstresinin iki modu da buradadır.
 */
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { hareketTuruEtiketi, varyantliAd, varyantliKod } from "@tekirextra/shared";
import { KUR_GERI_BAKIS_GUN } from "../doviz/kur-coz";

export interface EkstreHareketi {
  id: string;
  tip: "borc" | "alacak";
  tutar: Prisma.Decimal;
  dovizCinsi: string;
  kur: Prisma.Decimal;
  tutarTry: Prisma.Decimal;
  tarih: Date;
  kaynakTur: string;
  kaynakRef: string | null;
}

export interface EkstreKalemi {
  stokKod: string;
  stokAd: string;
  miktar: string;
  birim: string;
  birimFiyat: string;
  iskontoOrani: string;
  tutar: string;
}

export interface EkstreAyrintisi {
  hareketTuru: string;
  belgeNo: string | null;
  odemeSekli: string | null;
  /** Ayrıntılı ekstre: fatura dövizi ve kuru, kalemler ve toplamlar. */
  fatura?: {
    dovizCinsi: string;
    kur: string;
    kalemler: EkstreKalemi[];
    toplamMatrah: string;
    toplamKdv: string;
    genelToplam: string;
  };
}

const FATURA_KAYNAKLARI = new Set(["fatura", "fatura_iptal", "fatura_geri_alma"]);
const CEK_KAYNAKLARI = new Set(["cek_senet", "cek_senet_ciro", "cek_senet_ters"]);

/**
 * Hareketlerin kaynak kayıtlarını topluca okur (tür başına tek sorgu) ve
 * hareket kimliğine göre ayrıntıyı döner.
 */
export async function ekstreAyrintilari(
  tx: Prisma.TransactionClient,
  tenantId: string,
  hareketler: EkstreHareketi[],
  ayrintili: boolean,
): Promise<Map<string, EkstreAyrintisi>> {
  const refler = (kaynaklar: Set<string> | string) => [...new Set(hareketler
    .filter((h) => h.kaynakRef && (typeof kaynaklar === "string" ? h.kaynakTur === kaynaklar : kaynaklar.has(h.kaynakTur)))
    .map((h) => h.kaynakRef!))];

  const faturaIds = refler(FATURA_KAYNAKLARI);
  const kasaIds = refler("kasa_banka");
  const cekIds = refler(CEK_KAYNAKLARI);
  const kartIds = refler("kredi_karti");
  const posIds = refler("pos_tahsilat");

  const [faturalar, kalemler, kasaHareketleri, cekler, kartHareketleri, posTahsilatlari] = await Promise.all([
    faturaIds.length
      ? tx.fatura.findMany({
          where: { tenantId, id: { in: faturaIds } },
          select: { id: true, no: true, tip: true, dovizCinsi: true, kur: true, toplamMatrah: true, toplamKdv: true, genelToplam: true },
        })
      : [],
    // CARI-25: kalemler yalnız ayrıntılı ekstrede okunur.
    ayrintili && faturaIds.length
      ? tx.faturaSatir.findMany({
          where: { tenantId, faturaId: { in: faturaIds } },
          // Satırlarda sıra alanı yok; fatura PDF'i gibi kayıt sırasıyla okunur.
          select: { faturaId: true, miktar: true, birim: true, birimFiyat: true, iskontoOrani: true, matrah: true, stok: { select: { kod: true, ad: true } }, varyant: { select: { kod: true, ad: true } } },
        })
      : [],
    kasaIds.length
      ? tx.kasaBankaHareket.findMany({
          where: { tenantId, id: { in: kasaIds } },
          select: { id: true, kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true, bankaAdi: true } }, posHesap: { select: { ad: true } }, fatura: { select: { no: true } } },
        })
      : [],
    cekIds.length
      ? tx.cekSenet.findMany({ where: { tenantId, id: { in: cekIds } }, select: { id: true, tur: true, portfoyNo: true, cekNo: true, banka: true, vadeTarihi: true } })
      : [],
    kartIds.length
      ? tx.krediKartiHareket.findMany({ where: { tenantId, id: { in: kartIds } }, select: { id: true, taksitSayisi: true, krediKarti: { select: { ad: true, bankaAdi: true, sonDortHane: true } }, fatura: { select: { no: true } } } })
      : [],
    posIds.length
      ? tx.posTahsilat.findMany({ where: { id: { in: posIds } }, select: { id: true, saglayiciOdemeId: true } })
      : [],
  ]);

  const faturaHaritasi = new Map(faturalar.map((f) => [f.id, f]));
  const kalemHaritasi = new Map<string, typeof kalemler>();
  for (const k of kalemler) kalemHaritasi.set(k.faturaId, [...(kalemHaritasi.get(k.faturaId) ?? []), k]);
  const kasaHaritasi = new Map(kasaHareketleri.map((k) => [k.id, k]));
  const cekHaritasi = new Map(cekler.map((c) => [c.id, c]));
  const kartHaritasi = new Map(kartHareketleri.map((k) => [k.id, k]));
  const posHaritasi = new Map(posTahsilatlari.map((p) => [p.id, p]));

  const sonuc = new Map<string, EkstreAyrintisi>();
  for (const h of hareketler) {
    const ref = h.kaynakRef ?? "";
    const fatura = FATURA_KAYNAKLARI.has(h.kaynakTur) ? faturaHaritasi.get(ref) : undefined;
    let belgeNo: string | null = fatura?.no ?? null;
    let odemeSekli: string | null = null;

    const kasa = h.kaynakTur === "kasa_banka" ? kasaHaritasi.get(ref) : undefined;
    if (kasa) {
      odemeSekli = kasa.bankaHesap
        ? `Banka · ${kasa.bankaHesap.bankaAdi}${kasa.bankaHesap.ad && kasa.bankaHesap.ad !== kasa.bankaHesap.bankaAdi ? ` (${kasa.bankaHesap.ad})` : ""}`
        : kasa.kasa ? `Kasa · ${kasa.kasa.ad}` : kasa.posHesap ? `POS · ${kasa.posHesap.ad}` : null;
      belgeNo = kasa.fatura?.no ?? null;
    }
    const cek = CEK_KAYNAKLARI.has(h.kaynakTur) ? cekHaritasi.get(ref) : undefined;
    if (cek) {
      const ad = cek.tur === "cek" ? "Çek" : "Senet";
      odemeSekli = `${ad}${cek.banka ? ` · ${cek.banka}` : ""} · vade ${cek.vadeTarihi.toISOString().slice(0, 10).split("-").reverse().join(".")}`;
      belgeNo = cek.cekNo ?? cek.portfoyNo;
    }
    const kart = h.kaynakTur === "kredi_karti" ? kartHaritasi.get(ref) : undefined;
    if (kart) {
      odemeSekli = `Kredi kartı · ${kart.krediKarti.bankaAdi} •••• ${kart.krediKarti.sonDortHane}${kart.taksitSayisi > 1 ? ` · ${kart.taksitSayisi} taksit` : ""}`;
      belgeNo = kart.fatura?.no ?? null;
    }
    const pos = h.kaynakTur === "pos_tahsilat" ? posHaritasi.get(ref) : undefined;
    if (pos) {
      odemeSekli = "Sanal POS";
      belgeNo = pos.saglayiciOdemeId ?? null;
    }

    // Kalemler yalnız faturanın kendi hareketinin altında gösterilir; iptal
    // ve geri alma satırları tek satır kalır.
    const kalemli = ayrintili && fatura && h.kaynakTur === "fatura" ? fatura : undefined;
    sonuc.set(h.id, {
      hareketTuru: hareketTuruEtiketi({ kaynakTur: h.kaynakTur, tip: h.tip, faturaTipi: fatura?.tip }),
      belgeNo,
      odemeSekli,
      ...(kalemli
        ? {
            fatura: {
              dovizCinsi: kalemli.dovizCinsi,
              kur: kalemli.kur.toFixed(4),
              kalemler: (kalemHaritasi.get(kalemli.id) ?? []).map((s) => ({
                // Ekstrede satılan kalem görünür: varyantlıysa varyant kodu/adı.
                stokKod: varyantliKod(s.stok.kod, s.varyant),
                stokAd: varyantliAd(s.stok.ad, s.varyant),
                miktar: s.miktar.toString(),
                birim: s.birim,
                birimFiyat: s.birimFiyat.toString(),
                iskontoOrani: s.iskontoOrani.toFixed(2),
                tutar: s.matrah.toFixed(2),
              })),
              toplamMatrah: kalemli.toplamMatrah.toFixed(2),
              toplamKdv: kalemli.toplamKdv.toFixed(2),
              genelToplam: kalemli.genelToplam.toFixed(2),
            },
          }
        : {}),
    });
  }
  return sonuc;
}

/**
 * CARI-26 çevirme modu: hareketleri tek bir dövize çevirmek için dönemin
 * kurlarını bir kez okur, günü bellekte çözer (DVZ-04 penceresiyle: en fazla
 * `KUR_GERI_BAKIS_GUN` gün geriye). Kiracının elle kuru aynı gün TCMB'nin
 * önüne geçer. Kur bulunamayan gün sessizce varsayılmaz, hata verilir.
 */
export async function kurCozucu(
  tx: Prisma.TransactionClient,
  tenantId: string,
  dovizCinsi: "USD" | "EUR",
  enErken: Date,
  enGec: Date,
): Promise<(tarih: Date) => Prisma.Decimal> {
  const bas = new Date(enErken);
  bas.setUTCDate(bas.getUTCDate() - KUR_GERI_BAKIS_GUN);
  const [elle, tcmb] = await Promise.all([
    tx.elleKur.findMany({ where: { tenantId, dovizCinsi, tarih: { gte: bas, lte: enGec } }, select: { tarih: true, dovizSatis: true } }),
    tx.tcmbKuru.findMany({ where: { dovizCinsi, tarih: { gte: bas, lte: enGec } }, select: { tarih: true, dovizSatis: true } }),
  ]);
  const gunluk = new Map<string, Prisma.Decimal>();
  for (const k of tcmb) gunluk.set(k.tarih.toISOString().slice(0, 10), k.dovizSatis);
  for (const k of elle) gunluk.set(k.tarih.toISOString().slice(0, 10), k.dovizSatis);
  return (tarih: Date) => {
    const gun = new Date(Date.UTC(tarih.getUTCFullYear(), tarih.getUTCMonth(), tarih.getUTCDate()));
    for (let i = 0; i <= KUR_GERI_BAKIS_GUN; i++) {
      const kur = gunluk.get(gun.toISOString().slice(0, 10));
      if (kur) return kur;
      gun.setUTCDate(gun.getUTCDate() - 1);
    }
    throw new BadRequestException(
      `${dovizCinsi} için ${tarih.toISOString().slice(0, 10)} tarihinde ya da en fazla ${KUR_GERI_BAKIS_GUN} gün öncesinde kur bulunamadı; Ayarlar > Döviz Kurları ekranından çekin ya da elle girin`,
    );
  };
}

/**
 * Hareketin hedef dövizdeki tutarı: aynı dövizdeyse kendi tutarı, değilse TL
 * karşılığı hedef dövizin o günkü kuruna bölünür.
 */
export function hedefDovizTutari(h: Pick<EkstreHareketi, "tutar" | "dovizCinsi" | "tutarTry" | "tarih">, hedef: string, kur: (tarih: Date) => Prisma.Decimal) {
  if (h.dovizCinsi === hedef) return { tutar: h.tutar, kur: null as Prisma.Decimal | null };
  const gunKuru = kur(h.tarih);
  return { tutar: h.tutarTry.div(gunKuru).toDecimalPlaces(2), kur: gunKuru };
}
