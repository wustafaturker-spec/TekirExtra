import { Prisma } from "@prisma/client";
import {
  gelenDenetimYap,
  type GelenDenetimSatiri,
  type GelenFiyatReferansi,
  type GelenMukerrerAdayi,
  type OnDenetimBulgusu,
} from "@tekirextra/shared";
import { belgeNoSadelestir, faturaIrsaliyeAdaylari } from "../belgeler/irsaliye-eslesme";
import { gonderenCariSec } from "../cari/tedarikci-cari";
import { kanuniDegerOku } from "../mevzuat/kanuni-deger";
import { belgeNetMatrahlari, fiyatBirimi, fiyatKarsilastir, yilOnce } from "./fiyat-analizi";
import { gelenFaturaTipi } from "./gelen-fatura";
import { faturaUblOku, type UblFatura } from "./ubl-oku";

/**
 * Gelen alış denetçisinin (EBLG-144…149) veri toplayıcısı: kurallar
 * `@tekirextra/shared` içindedir, burada yalnız geçmiş okunur. Dışarıya çağrı
 * yapmaz, yazmaz (sonucu saklamak çağıranın işidir).
 */
const GECMIS_SATIR_SAYISI = 200;
const MUKERRER_GUN = 7;
const ISTISNA_TIPLERI = new Set(["ISTISNA", "IHRACKAYITLI", "OZELMATRAH"]);

export interface GelenDenetimAyari {
  fiyatYuzde: number;
  siparisToleransYuzde: number;
  testOrtami: boolean;
}

export type SatirEslesmesi = { stokId: string; varyantId?: string | null } | null | undefined;

const gun = (d: Date) => d.toISOString().slice(0, 10);
const sayi = (d: Prisma.Decimal | number | string) => Number(d);
const gunFarki = (bitis: string, baslangic: string) => Math.round((Date.parse(`${bitis}T00:00:00Z`) - Date.parse(`${baslangic}T00:00:00Z`)) / 86_400_000);
const imza = (satirlar: { stokId: string | null; varyantId?: string | null; miktar: number | string }[]) =>
  satirlar.map((s) => `${s.stokId}:${s.varyantId ?? ""}:${Number(s.miktar).toFixed(3)}`).sort().join("|");
const adImzasi = (ubl: UblFatura) => ubl.satirlar.map((s) => `${s.ad.trim().toLocaleUpperCase("tr-TR")}:${s.miktar.toFixed(3)}`).sort().join("|");

export async function gelenDenetimCalistir(
  tx: Prisma.TransactionClient,
  tenantId: string,
  kayit: { id: string; gonderenVkn: string; faturaId: string | null },
  ubl: UblFatura,
  eslesme: (siraNo: number) => SatirEslesmesi,
  ayar: GelenDenetimAyari,
): Promise<{ bulgular: OnDenetimBulgusu[]; susturulan: number }> {
  const tip = gelenFaturaTipi(ubl);
  const tarih = ubl.tarih;
  const belgeGunu = new Date(`${tarih}T00:00:00Z`);
  const { cari: secilen } = await gonderenCariSec(tx, tenantId, kayit.gonderenVkn, tip === "satis_iade" ? "musteri" : "tedarikci");
  const cari = secilen
    ? await tx.cariHesap.findUnique({
        where: { id: secilen.id },
        select: { id: true, unvan: true, iban: true, varsayilanVadeGun: true, bankaHesaplari: { select: { iban: true } } },
      })
    : null;
  const firma = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { unvan: true, vergiDairesi: true, il: true } });

  // ── Satırlar: fiyat geçmişi, KDV geçmişi, sipariş fiyatı ──────────────────
  const netler = belgeNetMatrahlari(ubl.satirlar.map((s) => s.matrah), ubl.toplamlar.belgeIskontosu);
  const stokIdler = [...new Set(ubl.satirlar.map((s) => eslesme(s.siraNo)?.stokId).filter((x): x is string => Boolean(x)))];
  const kartlar = await tx.stokKart.findMany({ where: { tenantId, id: { in: stokIdler } }, select: { id: true, ad: true, tip: true, kdvOrani: true } });
  const siparisFiyatlari = cari ? await siparisFiyatlariniTopla(tx, tenantId, cari.id, ubl) : new Map<string, { fiyat: number; belgeNo: string | null; belgeId: string }>();

  const satirlar: GelenDenetimSatiri[] = [];
  for (const [i, s] of ubl.satirlar.entries()) {
    const e = eslesme(s.siraNo);
    const kart = e ? kartlar.find((k) => k.id === e.stokId) : undefined;
    const net = sayi(netler[i]);
    let referans: GelenFiyatReferansi | null = null;
    let gecmisKdvOranlari: number[] = [];
    if (kart && tip === "alis" && s.miktar > 0 && net > 0) {
      const gecmis = await tx.faturaSatir.findMany({
        where: {
          tenantId, stokId: kart.id, varyantId: e?.varyantId ?? null,
          fatura: { tenantId, tip: "alis", durum: "kesin", ozelMatrahKodu: null, tarih: { gte: new Date(yilOnce(tarih, 2)), lt: belgeGunu },
            ...(kayit.faturaId ? { id: { not: kayit.faturaId } } : {}) },
        },
        select: { miktar: true, matrah: true, birim: true, kdvOrani: true,
          fatura: { select: { id: true, no: true, tarih: true, createdAt: true, dovizCinsi: true, cariId: true, cari: { select: { unvan: true } } } } },
        orderBy: [{ fatura: { tarih: "desc" } }, { fatura: { createdAt: "desc" } }, { faturaId: "asc" }, { id: "asc" }],
        take: GECMIS_SATIR_SAYISI + 1,
      });
      gecmisKdvOranlari = gecmis.map((g) => sayi(g.kdvOrani));
      const analiz = fiyatKarsilastir({
        tarih, miktar: String(s.miktar), matrah: netler[i], birim: s.birim, doviz: ubl.dovizCinsi,
        cariId: cari?.id ?? null, kesildi: gecmis.length > GECMIS_SATIR_SAYISI,
        gecmis: gecmis.slice(0, GECMIS_SATIR_SAYISI).map((g) => ({
          miktar: g.miktar.toString(), matrah: g.matrah.toString(), birim: g.birim, doviz: g.fatura.dovizCinsi,
          tarih: gun(g.fatura.tarih), kayitAt: g.fatura.createdAt.toISOString(),
          faturaId: g.fatura.id, no: g.fatura.no, cariId: g.fatura.cariId, unvan: g.fatura.cari.unvan,
        })),
      });
      if (analiz.sonAlis) {
        referans = { fiyat: sayi(analiz.sonAlis.netBirimFiyat), kaynak: "tedarikci", faturaId: analiz.sonAlis.faturaId, faturaNo: analiz.sonAlis.no };
      } else if (analiz.tedarikciler.length) {
        // Her tedarikçinin son 90 gündeki son faturası, miktar ağırlıklı.
        const miktar = analiz.tedarikciler.reduce((t, x) => t + sayi(x.miktar), 0);
        const tutar = analiz.tedarikciler.reduce((t, x) => t + sayi(x.matrah), 0);
        if (miktar > 0) referans = { fiyat: tutar / miktar, kaynak: "donem" };
      }
    }
    satirlar.push({
      sira: s.siraNo,
      ad: s.ad,
      stok: kart ? { id: kart.id, ad: kart.ad, tip: kart.tip, kdvOrani: sayi(kart.kdvOrani) } : null,
      miktar: s.miktar,
      birim: s.birim,
      netBirimFiyat: s.miktar > 0 ? net / s.miktar : 0,
      kdvOrani: s.kdvOrani,
      tevkifatKodu: s.tevkifat?.kod ?? null,
      referans,
      siparis: kart ? siparisFiyatlari.get(`${kart.id}:${e?.varyantId ?? ""}:${fiyatBirimi(s.birim)}:${ubl.dovizCinsi}`) ?? null : null,
      gecmisKdvOranlari,
    });
  }

  // ── Ödeme hesabı ──────────────────────────────────────────────────────────
  const oncekiGelenler = await tx.gelenEbelge.findMany({
    where: { tenantId, gonderenVkn: kayit.gonderenVkn, id: { not: kayit.id } },
    select: { odemeHesaplari: true },
    take: 200,
  });
  const bilinenler = [
    ...(cari?.iban ? [cari.iban] : []),
    ...(cari?.bankaHesaplari.map((b) => b.iban) ?? []),
    ...oncekiGelenler.flatMap((g) => g.odemeHesaplari),
  ].map((x) => x.replace(/\s+/g, "").toLocaleUpperCase("tr-TR"));
  const oncekiAlis = cari ? await tx.fatura.count({ where: { tenantId, cariId: cari.id, tip: "alis", ...(kayit.faturaId ? { id: { not: kayit.faturaId } } : {}) } }) : 0;

  // ── Tevkifat alışkanlığı ──────────────────────────────────────────────────
  const gecmisFaturalar = cari && tip === "alis"
    ? await tx.fatura.findMany({
        where: { tenantId, cariId: cari.id, tip: "alis", durum: "kesin", tarih: { lte: belgeGunu }, ...(kayit.faturaId ? { id: { not: kayit.faturaId } } : {}) },
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        take: 5,
        select: { toplamTevkifat: true },
      })
    : [];
  const altSinir = await kanuniDegerOku(tx, "tevkifat_alt_siniri", tarih, -1);

  // ── Mükerrer ──────────────────────────────────────────────────────────────
  const pencere = (fark: number) => new Date(belgeGunu.getTime() + fark * 86_400_000);
  const no = belgeNoSadelestir(ubl.belgeNo);
  const toplam = ubl.toplamlar.genelToplam.toFixed(2);
  const mukerrerAdaylari: GelenMukerrerAdayi[] = [];
  const komsuGelenler = await tx.gelenEbelge.findMany({
    where: {
      tenantId, gonderenVkn: kayit.gonderenVkn, id: { not: kayit.id }, durum: { not: "reddedildi" },
      OR: [{ tarih: { gte: pencere(-MUKERRER_GUN), lte: pencere(MUKERRER_GUN) } }, { belgeNo: { equals: ubl.belgeNo, mode: "insensitive" } }],
    },
    orderBy: { tarih: "desc" },
    take: 20,
    select: { id: true, belgeNo: true, tarih: true, genelToplam: true, dovizCinsi: true, satirSayisi: true },
  });
  const buAdImzasi = adImzasi(ubl);
  for (const k of komsuGelenler) {
    const ayniNo = belgeNoSadelestir(k.belgeNo) === no;
    const ayniToplam = (k.dovizCinsi ?? "TRY") === ubl.dovizCinsi && k.genelToplam?.toFixed(2) === toplam;
    let ayniSatirlar = false;
    // Satırlar yalnız satır sayısı tutan komşuda okunur (XML ağırdır).
    if (!ayniNo && !ayniToplam && k.satirSayisi === ubl.satirlar.length) {
      const xml = await tx.gelenEbelge.findUnique({ where: { id: k.id }, select: { xmlIcerik: true } });
      try { ayniSatirlar = adImzasi(faturaUblOku(xml?.xmlIcerik ?? "")) === buAdImzasi; } catch { ayniSatirlar = false; }
    }
    mukerrerAdaylari.push({ tur: "gelen", id: k.id, no: k.belgeNo, tarih: gun(k.tarih), ayniNo, ayniToplam, ayniSatirlar });
  }
  if (cari) {
    // Elle girilmiş (gelen belgeden doğmamış) alış faturaları.
    const elle = await tx.fatura.findMany({
      where: {
        tenantId, cariId: cari.id, tip: tip === "satis_iade" ? "satis_iade" : "alis", durum: { not: "iptal" }, gelenEbelge: null,
        ...(kayit.faturaId ? { id: { not: kayit.faturaId } } : {}),
        OR: [{ tarih: { gte: pencere(-MUKERRER_GUN), lte: pencere(MUKERRER_GUN) } }, { no: { equals: ubl.belgeNo, mode: "insensitive" } }],
      },
      orderBy: { tarih: "desc" },
      take: 20,
      select: { id: true, no: true, tarih: true, genelToplam: true, dovizCinsi: true, satirlar: { select: { stokId: true, varyantId: true, miktar: true } } },
    });
    const eslesenler = ubl.satirlar.map((s) => ({ stokId: eslesme(s.siraNo)?.stokId ?? null, varyantId: eslesme(s.siraNo)?.varyantId ?? null, miktar: s.miktar }));
    const buImza = eslesenler.every((s) => s.stokId) ? imza(eslesenler) : null;
    for (const f of elle) {
      mukerrerAdaylari.push({
        tur: "fatura", id: f.id, no: f.no, tarih: gun(f.tarih),
        ayniNo: Boolean(f.no) && belgeNoSadelestir(f.no) === no,
        ayniToplam: f.dovizCinsi === ubl.dovizCinsi && f.genelToplam.toFixed(2) === toplam,
        ayniSatirlar: buImza !== null && imza(f.satirlar.map((x) => ({ ...x, miktar: x.miktar.toString() }))) === buImza,
      });
    }
  }

  const tevkifatli = ubl.toplamlar.tevkifat > 0 || ubl.toplamlar.kdvIcindeTevkifat > 0 || ubl.satirlar.some((s) => s.tevkifat);
  const bulgular = gelenDenetimYap({
    belge: {
      no: ubl.belgeNo,
      tarih,
      tip,
      doviz: ubl.dovizCinsi,
      kdvKarsilastirilmaz: ISTISNA_TIPLERI.has(ubl.faturaTipKodu) || ubl.istisnaKodlari.length > 0,
      vadeGun: ubl.vadeTarihi && /^\d{4}-\d{2}-\d{2}$/.test(ubl.vadeTarihi) ? gunFarki(ubl.vadeTarihi, tarih) : null,
      kdvDahilTl: ubl.toplamlar.vergiDahil || ubl.toplamlar.genelToplam,
      tevkifatli,
      kismiTevkifatli: [...ubl.satirlar.map((s) => s.tevkifat?.oran), ...ubl.toplamlar.tevkifatKodlari.map((t) => t.oran)]
        .some((oran) => oran !== undefined && oran > 0 && oran < 100),
    },
    testOrtami: ayar.testOrtami,
    cari: cari ? { id: cari.id, unvan: cari.unvan, vadeGun: cari.varsayilanVadeGun } : null,
    firma,
    alici: ubl.alici,
    odeme: { hesaplar: ubl.odemeHesaplari, bilinenler: [...new Set(bilinenler)], oncekiBelgeVar: oncekiGelenler.length > 0 || oncekiAlis > 0 },
    gecmisTevkifat: gecmisFaturalar.map((f) => sayi(f.toplamTevkifat) > 0),
    tevkifatAltSiniri: altSinir >= 0 ? altSinir : null,
    satirlar,
    mukerrerAdaylari,
    esikler: { fiyatYuzde: ayar.fiyatYuzde, siparisToleransYuzde: ayar.siparisToleransYuzde },
  });
  // EBLG-150: tedarikçi için susturulan kurallar gösterilmez ve onay istemez.
  const susturulanlar = cari
    ? new Set((await tx.onDenetimSusturma.findMany({ where: { tenantId, cariId: cari.id }, select: { kod: true } })).map((k) => k.kod))
    : new Set<string>();
  const gorunen = bulgular.filter((b) => !susturulanlar.has(b.kod));
  return { bulgular: gorunen, susturulan: bulgular.length - gorunen.length };
}

/**
 * EBLG-145: faturanın andığı irsaliyeler bizdeki alış irsaliyelerine eşlenir;
 * irsaliye satırı bir sipariş satırından doğmuşsa siparişin net birim fiyatı
 * (iskontolar sonrası) ürün + varyant + birim + döviz anahtarıyla döner.
 */
async function siparisFiyatlariniTopla(tx: Prisma.TransactionClient, tenantId: string, cariId: string, ubl: UblFatura) {
  const sonuc = new Map<string, { fiyat: number; belgeNo: string | null; belgeId: string }>();
  if (!ubl.irsaliyeler.length) return sonuc;
  const { eslesen } = await faturaIrsaliyeAdaylari(tx, tenantId, cariId, ubl.irsaliyeler.map((i) => i.no));
  if (!eslesen.length) return sonuc;
  const irsaliyeSatirlari = await tx.belgeSatir.findMany({
    where: { tenantId, belgeId: { in: eslesen.map((e) => e.id) }, kaynakSatirId: { not: null } },
    select: { kaynakSatirId: true },
  });
  const siparisSatirlari = await tx.belgeSatir.findMany({
    where: { tenantId, id: { in: irsaliyeSatirlari.map((s) => s.kaynakSatirId as string) }, belge: { tur: "siparis", yon: "alis" } },
    select: { stokId: true, varyantId: true, miktar: true, matrah: true, birim: true, belge: { select: { id: true, no: true, dovizCinsi: true } } },
  });
  for (const s of siparisSatirlari) {
    if (!(sayi(s.miktar) > 0)) continue;
    const anahtar = `${s.stokId}:${s.varyantId ?? ""}:${fiyatBirimi(s.birim)}:${s.belge.dovizCinsi}`;
    if (!sonuc.has(anahtar)) sonuc.set(anahtar, { fiyat: sayi(s.matrah) / sayi(s.miktar), belgeNo: s.belge.no, belgeId: s.belge.id });
  }
  return sonuc;
}
