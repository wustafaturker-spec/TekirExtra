import { Prisma } from "@prisma/client";
import { onDenetimYap, type MukerrerAdayi, type OnDenetimBulgusu, type OnDenetimSatiri } from "@tekirextra/shared";
import { kurBul } from "../doviz/kur-coz";
import { fiyatBirimi, yilOnce } from "./fiyat-analizi";

/**
 * Ön denetçinin (EBLG-134…139) veri toplayıcısı: kurallar `@tekirextra/shared`
 * içindedir, burada yalnız geçmiş okunur. Yalnız okur, dışarıya çağrı yapmaz.
 *
 * "Geçerli satış": kesin satış faturası; e-Belgesi reddedilmiş ya da iptal
 * edilmiş olanlar sayılmaz (yerine yenisi kesilmiştir, alışkanlık değildir).
 */
const GECMIS_SATIR_SAYISI = 20;
const MUKERRER_GUN = 7;

const gecerliSatis = (tenantId: string, haricFaturaId: string): Prisma.FaturaWhereInput => ({
  tenantId,
  tip: "satis",
  durum: "kesin",
  id: { not: haricFaturaId },
  NOT: { ebelge: { is: { OR: [{ durum: { in: ["ret", "iptal"] } }, { aliciYaniti: "ret" }] } } },
});

const gun = (d: Date) => d.toISOString().slice(0, 10);
const sayi = (d: Prisma.Decimal | number) => Number(d);
const satirImzasi = (satirlar: { stokId: string; varyantId: string | null; miktar: Prisma.Decimal }[]) =>
  satirlar.map((s) => `${s.stokId}:${s.varyantId ?? ""}:${s.miktar.toString()}`).sort().join("|");

export async function onDenetimCalistir(
  tx: Prisma.TransactionClient,
  tenantId: string,
  faturaId: string,
  secenek: { yurtDisi: boolean; esikler?: { fiyatYuzde?: number; kurYuzde?: number } },
): Promise<{ bulgular: OnDenetimBulgusu[]; susturulan: number }> {
  const fatura = await tx.fatura.findUniqueOrThrow({
    where: { id: faturaId },
    select: {
      id: true, tarih: true, senaryo: true, dovizCinsi: true, kur: true, genelToplam: true, cariId: true,
      cari: { select: { id: true, unvan: true, vknTckn: true, vergiDairesi: true, fiyatListesiId: true } },
      // Satır sırası sihirbazın öteki uyarılarıyla (birim uyarısı) aynıdır.
      satirlar: {
        select: {
          stokId: true, varyantId: true, miktar: true, birim: true, birimFiyat: true, matrah: true, kdvOrani: true,
          tevkifatKodu: true, gibIstisnaKodu: true, kaynakBelgeSatirId: true,
          stok: { select: { ad: true, tip: true, kdvOrani: true, anaBirim: true, ortalamaMaliyet: true } },
        },
      },
    },
  });
  const tarih = gun(fatura.tarih);
  const kur = sayi(fatura.kur) || 1;
  const gecerli = gecerliSatis(tenantId, faturaId);

  const liste = fatura.cari.fiyatListesiId
    ? await tx.fiyatListesi.findFirst({
        where: { id: fatura.cari.fiyatListesiId, aktif: true, dovizCinsi: fatura.dovizCinsi },
        select: { kalemler: { where: { stokId: { in: fatura.satirlar.map((s) => s.stokId) } }, select: { stokId: true, fiyat: true } } },
      })
    : null;

  const denetimSatirlari: OnDenetimSatiri[] = [];
  for (const [index, s] of fatura.satirlar.entries()) {
    const birim = fiyatBirimi(s.birim);
    const anaBirimde = birim === fiyatBirimi(s.stok.anaBirim);
    const gecmis = await tx.faturaSatir.findMany({
      where: {
        tenantId, stokId: s.stokId, varyantId: s.varyantId,
        fatura: { ...gecerli, tarih: { gte: new Date(yilOnce(tarih, 2)), lte: fatura.tarih } },
      },
      orderBy: [{ fatura: { tarih: "desc" } }, { fatura: { createdAt: "desc" } }],
      take: GECMIS_SATIR_SAYISI,
      select: {
        miktar: true, matrah: true, birim: true, kdvOrani: true, tevkifatKodu: true, gibIstisnaKodu: true,
        fatura: { select: { cariId: true, dovizCinsi: true, senaryo: true } },
      },
    });
    const ayniBirim = gecmis.filter((g) => fiyatBirimi(g.birim) === birim && sayi(g.miktar) > 0);
    const cariye = gecmis.filter((g) => g.fatura.cariId === fatura.cariId);
    let kaynakAsimi: OnDenetimSatiri["kaynakAsimi"] = null;
    if (s.kaynakBelgeSatirId) {
      const kaynak = await tx.belgeSatir.findUnique({
        where: { id: s.kaynakBelgeSatirId },
        select: { miktar: true, birim: true, belge: { select: { no: true } } },
      });
      if (kaynak && fiyatBirimi(kaynak.birim) === birim) {
        const faturalanan = await tx.faturaSatir.aggregate({
          where: { tenantId, kaynakBelgeSatirId: s.kaynakBelgeSatirId, fatura: { ...gecerli, id: undefined } },
          _sum: { miktar: true },
        });
        const toplam = sayi(faturalanan._sum.miktar ?? 0);
        if (toplam > sayi(kaynak.miktar) + 1e-9) {
          kaynakAsimi = { belgeNo: kaynak.belge.no, kaynakMiktar: sayi(kaynak.miktar), toplamFaturalanan: toplam };
        }
      }
    }
    const listeKalemi = liste?.kalemler.find((k) => k.stokId === s.stokId);
    denetimSatirlari.push({
      sira: index + 1,
      stokId: s.stokId,
      stokAd: s.stok.ad,
      stokTip: s.stok.tip,
      birim: s.birim,
      miktar: sayi(s.miktar),
      birimFiyat: sayi(s.birimFiyat),
      netBirimFiyat: sayi(s.miktar) > 0 ? sayi(s.matrah) / sayi(s.miktar) : 0,
      kdvOrani: sayi(s.kdvOrani),
      kartKdvOrani: sayi(s.stok.kdvOrani),
      tevkifatKodu: s.tevkifatKodu,
      istisnaKodu: s.gibIstisnaKodu,
      // Ortalama maliyet TL ve ana birim başınadır.
      birimMaliyet: anaBirimde && sayi(s.stok.ortalamaMaliyet) > 0 ? sayi(s.stok.ortalamaMaliyet) / kur : null,
      listeFiyati: anaBirimde && listeKalemi ? sayi(listeKalemi.fiyat) : null,
      gecmisFiyatlar: ayniBirim
        .filter((g) => g.fatura.dovizCinsi === fatura.dovizCinsi)
        .map((g) => ({ fiyat: sayi(g.matrah) / sayi(g.miktar), ayniCari: g.fatura.cariId === fatura.cariId })),
      gecmisKdvOranlari: gecmis
        .filter((g) => !g.gibIstisnaKodu && !["istisna", "ihrackayitli", "ozelmatrah"].includes(g.fatura.senaryo))
        .map((g) => sayi(g.kdvOrani)),
      cariGecmisTevkifat: cariye.map((g) => g.tevkifatKodu),
      cariGecmisMiktarlar: cariye.filter((g) => fiyatBirimi(g.birim) === birim).map((g) => sayi(g.miktar)),
      kaynakAsimi,
    });
  }

  const gecmisSenaryolar = await tx.fatura.findMany({
    where: { ...gecerli, cariId: fatura.cariId, tarih: { lte: fatura.tarih }, ebelge: { is: { durum: { in: ["iletildi", "kabul"] } } } },
    orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
    take: 5,
    select: { senaryo: true },
  });

  const pencere = (fark: number) => new Date(fatura.tarih.getTime() + fark * 86_400_000);
  const komsular = await tx.fatura.findMany({
    where: { ...gecerli, cariId: fatura.cariId, tarih: { gte: pencere(-MUKERRER_GUN), lte: pencere(MUKERRER_GUN) } },
    orderBy: { tarih: "desc" },
    take: 50,
    select: { id: true, no: true, tarih: true, genelToplam: true, dovizCinsi: true, satirlar: { select: { stokId: true, varyantId: true, miktar: true } } },
  });
  const imza = satirImzasi(fatura.satirlar);
  const mukerrerAdaylari: MukerrerAdayi[] = komsular.map((k) => ({
    id: k.id,
    no: k.no,
    tarih: gun(k.tarih),
    ayniToplam: k.dovizCinsi === fatura.dovizCinsi && k.genelToplam.equals(fatura.genelToplam),
    ayniSatirlar: satirImzasi(k.satirlar) === imza,
  }));

  let mukellef: { efaturaMukellefi: boolean; unvan: string | null; yeniKutular: string[] } | null = null;
  if (fatura.cari.vknTckn && !secenek.yurtDisi) {
    const kutular = await tx.gibMukellef.findMany({
      where: { vknTckn: fatura.cari.vknTckn, belgeTuru: "efatura" },
      select: { postaKutusu: true, unvan: true, kutuKayitZamani: true },
    });
    if (kutular.length) {
      const sonGonderim = await tx.ebelgeKayit.findFirst({
        where: { tenantId, tur: "efatura", durum: { in: ["iletildi", "kabul"] }, fatura: { cariId: fatura.cariId }, faturaId: { not: faturaId } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      mukellef = {
        efaturaMukellefi: true,
        unvan: kutular.find((k) => k.unvan)?.unvan ?? null,
        yeniKutular: sonGonderim
          ? kutular.filter((k) => k.kutuKayitZamani && k.kutuKayitZamani > sonGonderim.createdAt).map((k) => k.postaKutusu)
          : [],
      };
    }
  }

  const gunKuru = fatura.dovizCinsi === "TRY" ? null : await kurBul(tx, tenantId, fatura.dovizCinsi, fatura.tarih);

  const bulgular = onDenetimYap({
    fatura: { senaryo: fatura.senaryo, doviz: fatura.dovizCinsi, kur, yurtDisi: secenek.yurtDisi },
    cari: { id: fatura.cari.id, unvan: fatura.cari.unvan, vknTckn: fatura.cari.vknTckn, vergiDairesi: fatura.cari.vergiDairesi },
    mukellef,
    gecmisSenaryolar: gecmisSenaryolar.map((f) => f.senaryo),
    satirlar: denetimSatirlari,
    mukerrerAdaylari,
    gunKuru: gunKuru ? { alis: sayi(gunKuru.alis), satis: sayi(gunKuru.satis) } : null,
    esikler: secenek.esikler,
  });
  // EBLG-141: kullanıcının bu cari için susturduğu kurallar gösterilmez ve onay istemez.
  const susturulanlar = new Set((await tx.onDenetimSusturma.findMany({ where: { tenantId, cariId: fatura.cariId }, select: { kod: true } })).map((k) => k.kod));
  const gorunen = bulgular.filter((b) => !susturulanlar.has(b.kod));
  return { bulgular: gorunen, susturulan: bulgular.length - gorunen.length };
}
