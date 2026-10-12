import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { bugunTR } from "@tekirextra/shared";
import { Prisma, type DovizCinsi } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { cariDenklestir, carileriDenklestir, elleKapamaYaz, kaynakKapamalariniCoz } from "../fatura/denklestirme";
import { faturaKilitleVeKalaniGetir, mahsupAyir } from "../fatura/odeme-durumu";
import { icYuzdeMatrah } from "../fatura/kur-farki-kural";
import { kurZorunlu } from "../doviz/kur-coz";
import { ekstreOzeti, type EkstreDonemi } from "./kart-ekstre";
import { kartEkstreleriniOku } from "./kart-ekstre-oku";
import type { krediKartiCariOdemeSemasi, krediKartiEkstreOdemeSemasi, krediKartiGuncelleSemasi, krediKartiHareketSemasi, krediKartiKesinlestirSemasi, krediKartiOlusturSemasi } from "./kredi-karti.semalar";
import { MevzuatService } from "../mevzuat/mevzuat.service";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);
const gunMetni = (t: Date) => t.toISOString().slice(0, 10);

/** KSB-10: kart giderlerinin varsayılan masraf kategorileri (yoksa oluşturulur). */
const FINANSMAN_KATEGORISI = { ad: "Finansman Giderleri", muhasebeKodu: "780", varsayilanKdvOrani: 0 };
const BANKA_KATEGORISI = { ad: "Banka ve POS Komisyonları", muhasebeKodu: null, varsayilanKdvOrani: 0 };

/** Ayın aynı gününü korur; kısa aylarda ayın son gününü kullanır. */
function ayEkle(tarih: Date, ay: number): Date {
  const yil = tarih.getUTCFullYear(); const hedefAy = tarih.getUTCMonth() + ay; const gun = tarih.getUTCDate();
  const aySonu = new Date(Date.UTC(yil, hedefAy + 1, 0)).getUTCDate();
  return new Date(Date.UTC(yil, hedefAy, Math.min(gun, aySonu)));
}

function taksitVerileri(tenantId: string, hareketId: string, toplam: Prisma.Decimal, adet: number, ilkTarih: Date) {
  const tabanKurus = toplam.mul(100).div(adet).floor(); const toplamKurus = toplam.mul(100).toDecimalPlaces(0); let dagitilan = D(0);
  return Array.from({ length: adet }, (_, i) => {
    const kurus = i === adet - 1 ? toplamKurus.sub(dagitilan) : tabanKurus; dagitilan = dagitilan.add(kurus);
    return { tenantId, hareketId, sira: i + 1, vadeTarihi: ayEkle(ilkTarih, i), tutar: kurus.div(100) };
  });
}

/** Ekranın kullandığı dönem görünümü; kalemler ayrıntı ucunda verilir. */
function donemOzeti(d: EkstreDonemi) {
  return {
    kesimTarihi: d.kesimTarihi, baslangic: d.baslangic, sonOdemeTarihi: d.sonOdemeTarihi, tur: d.tur, durum: d.durum,
    kesinlesti: Boolean(d.kesin), bankaTutari: d.kesin ? D(d.kesin.bankaTutari).toFixed(2) : null,
    hesaplananBorc: d.hesaplananBorc.toFixed(2), devreden: d.devreden.toFixed(2), donemIciOdeme: d.donemIciOdeme.toFixed(2),
    harcamalar: d.harcamalar.toFixed(2), donemBorcu: d.donemBorcu.toFixed(2), asgari: d.asgari.toFixed(2),
    odenen: d.odenen.toFixed(2), kalan: d.kalan.toFixed(2), asgariKalan: d.asgariKalan.toFixed(2), kalemSayisi: d.kalemler.length,
  };
}

@Injectable()
export class KrediKartiService {
  constructor(private readonly prisma: PrismaService, private readonly donemKilidi: DonemKilidiService, @Optional() private readonly mevzuat?: MevzuatService) {}

  /**
   * Kartlar, borç/limit ve ekstre özetiyle. Hareketler burada yüklenmez;
   * ekran seçili dönemin kalemlerini `ekstre` ucundan alır (KSB-10).
   */
  async listele() {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [kartlar, hesaplanan] = await Promise.all([
        tx.krediKarti.findMany({ where: { tenantId }, orderBy: [{ aktif: "desc" }, { ad: "asc" }], include: { bagliBankaHesap: { select: { id: true, ad: true } } } }),
        kartEkstreleriniOku(tx, bugun),
      ]);
      const borclar = await this.borclar(tx);
      return kartlar.map((kart) => {
        const net = Prisma.Decimal.max(0, borclar.get(kart.id) ?? D(0));
        const ozet = ekstreOzeti(hesaplanan.find((h) => h.kart.id === kart.id)?.donemler ?? []);
        return {
          ...kart, borc: net, kullanilabilirLimit: Prisma.Decimal.max(0, kart.limit.sub(net)),
          kullanimOrani: kart.limit.gt(0) ? net.div(kart.limit).mul(100).toDecimalPlaces(1) : D(0),
          sonEkstre: ozet.sonKesilen && donemOzeti(ozet.sonKesilen),
          acikDonem: ozet.acik && donemOzeti(ozet.acik),
          gelecekTaksitler: ozet.gelecek.map((d) => ({ kesimTarihi: d.kesimTarihi, sonOdemeTarihi: d.sonOdemeTarihi, tutar: d.harcamalar.toFixed(2) })),
        };
      });
    });
  }

  /** Kartın bütün dönemleri, yeniden eskiye (gelecek taksit dönemleri dahil). */
  async ekstreler(kartId: string) {
    const { tenantId } = aktifBaglam();
    const [sonuc] = await this.prisma.tenantIslem(tenantId, (tx) => kartEkstreleriniOku(tx, bugunTR(), kartId));
    if (!sonuc) throw new NotFoundException("Kredi kartı bulunamadı");
    return sonuc.donemler.filter((d) => d.tur !== "gelecek" || !d.harcamalar.isZero()).map(donemOzeti).reverse();
  }

  /** Bir dönemin kalemleri, ödemeleri ve hareket ayrıntıları. */
  async ekstre(kartId: string, kesimTarihi: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [sonuc] = await kartEkstreleriniOku(tx, bugunTR(), kartId);
      if (!sonuc) throw new NotFoundException("Kredi kartı bulunamadı");
      const donem = sonuc.donemler.find((d) => d.kesimTarihi === kesimTarihi);
      if (!donem) throw new NotFoundException("Bu tarihte kesilen bir dönem yok");
      const hareketIdleri = [...new Set([...donem.kalemler.map((k) => k.hareketId), ...donem.odemeler.map((o) => o.hareketId)])];
      const hareketler = await tx.krediKartiHareket.findMany({
        where: { id: { in: hareketIdleri } },
        select: {
          id: true, tip: true, tarih: true, tutar: true, aciklama: true, belgeNo: true, taksitSayisi: true, komisyonTutari: true, cariOdemeTutari: true,
          geriAlinanHareketId: true, ekstreId: true, taksitler: { select: { ekstreId: true } },
          cari: { select: { id: true, kod: true, unvan: true } }, fatura: { select: { id: true, no: true } },
          masrafOdemesi: { select: { masraf: { select: { id: true, kaynakTur: true, kategori: { select: { ad: true } } } } } },
        },
      });
      const terslenen = new Set((await tx.krediKartiHareket.findMany({ where: { geriAlinanHareketId: { in: hareketIdleri } }, select: { geriAlinanHareketId: true } })).map((t) => t.geriAlinanHareketId));
      return {
        ...donemOzeti(donem),
        kalemler: donem.kalemler.map((k) => ({ ...k, tutar: k.tutar.toFixed(2) })),
        odemeler: donem.odemeler.map((o) => ({ ...o, tutar: o.tutar.toFixed(2) })),
        hareketler: hareketler.map((h) => ({
          ...h,
          masraf: h.masrafOdemesi?.masraf ? { id: h.masrafOdemesi.masraf.id, kaynakTur: h.masrafOdemesi.masraf.kaynakTur, kategori: h.masrafOdemesi.masraf.kategori.ad } : null,
          ekstresiKesinlesti: Boolean(h.ekstreId || h.taksitler.some((t) => t.ekstreId)),
          geriAlindi: terslenen.has(h.id),
        })),
      };
    });
  }

  /**
   * Bankanın kestiği ekstreyi kesinleştirir: dönem borcu bundan sonra bankanın
   * tutarından yürür, dönemin kalemleri damgalanır. Yalnız kesilmiş ve son
   * kesinleşmişten sonraki dönem kesinleştirilir.
   */
  async kesinlestir(kartId: string, kesimTarihi: string, girdi: z.infer<typeof krediKartiKesinlestirSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM kredi_kartlari WHERE id = ${kartId}::uuid FOR UPDATE`;
      const [sonuc] = await kartEkstreleriniOku(tx, bugunTR(), kartId);
      if (!sonuc) throw new NotFoundException("Kredi kartı bulunamadı");
      const donem = sonuc.donemler.find((d) => d.kesimTarihi === kesimTarihi);
      if (!donem || donem.tur !== "kesilmis") throw new BadRequestException("Yalnız kesimi geçmiş dönemin ekstresi kesinleştirilir");
      if (donem.kesin) throw new ConflictException("Bu ekstre zaten kesinleşti");
      const sonKesin = sonuc.kart.ekstreler.at(-1);
      if (sonKesin && gunMetni(sonKesin.kesimTarihi) > kesimTarihi) throw new BadRequestException(`${gunMetni(sonKesin.kesimTarihi)} ekstresi kesinleşmiş; daha eski ekstre sonradan kesinleştirilemez`);

      const ekstre = await tx.krediKartiEkstre.create({
        data: {
          tenantId, krediKartiId: kartId, kesimTarihi: new Date(kesimTarihi), sonOdemeTarihi: new Date(donem.sonOdemeTarihi),
          hesaplananTutar: donem.hesaplananBorc, bankaTutari: D(girdi.bankaTutari), bankaAsgariTutari: girdi.bankaAsgariTutari == null ? null : D(girdi.bankaAsgariTutari), userId,
        },
      });
      const taksitIdleri = donem.kalemler.filter((k) => k.kaynak === "taksit").map((k) => k.id);
      const hareketIdleri = donem.kalemler.filter((k) => k.kaynak === "hareket").map((k) => k.id);
      await tx.krediKartiTaksit.updateMany({ where: { id: { in: taksitIdleri } }, data: { ekstreId: ekstre.id } });
      await tx.krediKartiHareket.updateMany({ where: { id: { in: hareketIdleri } }, data: { ekstreId: ekstre.id } });
      return { ...ekstre, fark: D(girdi.bankaTutari).sub(donem.hesaplananBorc).toFixed(2) };
    });
  }

  /** Son kesinleştirmeyi geri alır; damgalar kalkar, dönem yeniden hesaplanır. */
  async kesinlestirmeyiGeriAl(kartId: string, kesimTarihi: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonKesin = await tx.krediKartiEkstre.findFirst({ where: { krediKartiId: kartId }, orderBy: { kesimTarihi: "desc" } });
      if (!sonKesin || gunMetni(sonKesin.kesimTarihi) !== kesimTarihi) throw new BadRequestException("Yalnız son kesinleşen ekstrenin kesinleştirmesi geri alınabilir");
      await tx.krediKartiEkstre.delete({ where: { id: sonKesin.id } });
      return { geriAlindi: true };
    });
  }

  async olustur(girdi: z.infer<typeof krediKartiOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (girdi.bagliBankaHesapId && !await tx.bankaHesap.findUnique({ where: { id: girdi.bagliBankaHesapId } })) throw new BadRequestException("Bağlı banka hesabı bulunamadı");
      return tx.krediKarti.create({ data: { ...girdi, tenantId, limit: D(girdi.limit), asgariOdemeOrani: girdi.asgariOdemeOrani == null ? null : D(girdi.asgariOdemeOrani) } });
    });
  }

  async guncelle(id: string, girdi: z.infer<typeof krediKartiGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (!(await tx.krediKarti.findUnique({ where: { id } }))) throw new NotFoundException("Kredi kartı bulunamadı");
      if (girdi.bagliBankaHesapId && !await tx.bankaHesap.findUnique({ where: { id: girdi.bagliBankaHesapId } })) throw new BadRequestException("Bağlı banka hesabı bulunamadı");
      return tx.krediKarti.update({
        where: { id },
        data: {
          ...girdi,
          ...(girdi.limit !== undefined ? { limit: D(girdi.limit) } : {}),
          ...(girdi.asgariOdemeOrani !== undefined ? { asgariOdemeOrani: girdi.asgariOdemeOrani == null ? null : D(girdi.asgariOdemeOrani) } : {}),
        },
      });
    });
  }

  async hareketEkle(girdi: z.infer<typeof krediKartiHareketSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "kredi kartı hareketi oluşturma");
    // MVZ-11: KDV oranı belge tarihindeki merkezi listeden olmalı.
    if (girdi.tip === "harcama") await this.mevzuat?.kdvOranlariniDogrula([girdi.kdvOrani], girdi.tarih);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kart = await tx.krediKarti.findUnique({ where: { id: girdi.krediKartiId, tenantId } }); if (!kart?.aktif) throw new NotFoundException("Aktif kredi kartı hesabı bulunamadı");
      const tutar = D(girdi.tutar); const tarih = new Date(girdi.tarih);
      if (girdi.tip !== "iade") await this.limitDenetle(tx, kart, tutar, girdi.limitAsimiOnay);
      const { kategoriId: _k, saticiUnvan, kdvOrani, limitAsimiOnay: _l, ...hareketVerisi } = girdi;
      const hareket = await tx.krediKartiHareket.create({ data: { ...hareketVerisi, tenantId, tarih, tutar } });
      if (girdi.tip === "harcama") await tx.krediKartiTaksit.createMany({ data: taksitVerileri(tenantId, hareket.id, tutar, girdi.taksitSayisi, tarih) });
      // KSB-10: harcama, faiz ve aidat gider olarak masrafa yazılır; iade masraf üretmez.
      if (girdi.tip !== "iade") {
        await this.kartGideriYaz(tx, {
          kart, hareketId: hareket.id, tarih, tutar, aciklama: girdi.aciklama, belgeNo: girdi.belgeNo ?? null,
          ...(girdi.tip === "harcama"
            ? { kategoriId: girdi.kategoriId!, kdvOrani: kdvOrani ?? null, saticiUnvan: saticiUnvan || girdi.aciklama, belgeTuru: "fis" as const }
            : { kategori: girdi.tip === "faiz" ? FINANSMAN_KATEGORISI : BANKA_KATEGORISI, kdvOrani: 0, saticiUnvan: kart.bankaAdi, belgeTuru: "dekont" as const }),
        });
      }
      return hareket;
    });
  }

  async cariOdeme(girdi: z.infer<typeof krediKartiCariOdemeSemasi>) {
    const { tenantId } = aktifBaglam(); const cariTutar = D(girdi.cariOdemeTutari); const komisyon = D(girdi.komisyonTutari); const toplam = cariTutar.add(komisyon); const tarih = new Date(girdi.tarih);
    await this.donemKilidi.tarihDogrula(tenantId, tarih, "kredi kartıyla cari ödeme");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [kart, cari] = await Promise.all([tx.krediKarti.findUnique({ where: { id: girdi.krediKartiId, tenantId } }), tx.cariHesap.findUnique({ where: { id: girdi.cariId } })]);
      if (!kart?.aktif) throw new NotFoundException("Aktif kredi kartı hesabı bulunamadı"); if (!cari?.aktif) throw new NotFoundException("Aktif cari hesap bulunamadı");
      if (kart.dovizCinsi !== cari.dovizCinsi) throw new BadRequestException("Kart ve cari hesabın para birimleri aynı olmalıdır");
      await this.limitDenetle(tx, kart, toplam, girdi.limitAsimiOnay);
      // KSB-07: faturaya kalan kadar mahsup edilir, artanı tedarikçide avans kalır.
      let faturaMahsubu: Prisma.Decimal | null = null;
      if (girdi.faturaId) {
        const fatura = await faturaKilitleVeKalaniGetir(tx, girdi.faturaId);
        if (fatura.cariId !== cari.id || fatura.durum !== "kesin" || !["alis", "satis_iade"].includes(fatura.tip)) throw new BadRequestException("Yalnızca seçili carinin kesinleşmiş alış borcu ödenebilir");
        if (fatura.dovizCinsi !== kart.dovizCinsi) throw new BadRequestException("Fatura ve kart para birimleri aynı olmalıdır");
        if (fatura.kalan.isZero()) throw new BadRequestException(`${fatura.no ?? "Fatura"} zaten kapanmış; ödemeyi faturaya bağlamadan cariye işleyin`);
        faturaMahsubu = mahsupAyir(cariTutar, fatura.kalan).mahsup;
      }
      const hareket = await tx.krediKartiHareket.create({ data: { tenantId, krediKartiId: kart.id, tip: "harcama", tarih, aciklama: girdi.aciklama, tutar: toplam, cariOdemeTutari: cariTutar, faturaMahsubu, komisyonTutari: komisyon, taksitSayisi: girdi.taksitSayisi, ilkTaksitTarihi: new Date(girdi.ilkTaksitTarihi), belgeNo: girdi.belgeNo, cariId: cari.id, faturaId: girdi.faturaId } });
      await tx.krediKartiTaksit.createMany({ data: taksitVerileri(tenantId, hareket.id, toplam, girdi.taksitSayisi, new Date(girdi.ilkTaksitTarihi)) });
      const kartBilgisi = `${kart.ad} •••• ${kart.sonDortHane}${girdi.taksitSayisi > 1 ? ` · ${girdi.taksitSayisi} taksit` : " · tek çekim"}${komisyon.gt(0) ? ` · ${komisyon.toFixed(2)} ${kart.dovizCinsi} komisyon/vade farkı` : ""}`;
      // Dövizli kartta TL karşılığı işlem günü kuruyla hesaplanır; kur 1 varsayılmaz.
      const kur = kart.dovizCinsi === "TRY" ? D(1) : await kurZorunlu(tx, kart.dovizCinsi, tarih);
      await tx.cariHareket.create({ data: { tenantId, cariId: cari.id, tip: "borc", tutar: cariTutar, dovizCinsi: kart.dovizCinsi, kur, tutarTry: cariTutar.mul(kur).toDecimalPlaces(2), tarih, aciklama: `${girdi.aciklama} · Kredi kartı: ${kartBilgisi}`, kaynakTur: "kredi_karti", kaynakRef: hareket.id } });
      // KSB-10: komisyon/vade farkı finansman gideridir.
      if (komisyon.gt(0)) {
        await this.kartGideriYaz(tx, {
          kart, hareketId: hareket.id, tarih, tutar: komisyon, aciklama: `${girdi.aciklama} · komisyon/vade farkı`, belgeNo: girdi.belgeNo ?? null,
          kategori: FINANSMAN_KATEGORISI, kdvOrani: 0, saticiUnvan: kart.bankaAdi, belgeTuru: "dekont", kur,
        });
      }
      // KSB-16: bağlanan kısım elle kapama; artanı tedarikçinin diğer faturalarına vadeyle dağılır.
      if (girdi.faturaId && faturaMahsubu) await elleKapamaYaz(tx, { tenantId, cariId: cari.id, faturaId: girdi.faturaId, tutar: faturaMahsubu, kaynak: { krediKartiHareketId: hareket.id } });
      await cariDenklestir(tx, tenantId, cari.id);
      return hareket;
    });
  }

  async ekstreOdeme(girdi: z.infer<typeof krediKartiEkstreOdemeSemasi>) {
    const { tenantId } = aktifBaglam(); const tutar = D(girdi.tutar); const tarih = new Date(girdi.tarih);
    await this.donemKilidi.tarihDogrula(tenantId, tarih, "kredi kartı ekstre ödemesi");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [kart, banka] = await Promise.all([tx.krediKarti.findUnique({ where: { id: girdi.krediKartiId, tenantId } }), tx.bankaHesap.findUnique({ where: { id: girdi.bankaHesapId } })]);
      if (!kart?.aktif || !banka?.aktif) throw new NotFoundException("Aktif kredi kartı veya banka hesabı bulunamadı"); if (kart.dovizCinsi !== banka.dovizCinsi) throw new BadRequestException("Kart ve banka hesabı para birimleri aynı olmalıdır");
      const borc = Prisma.Decimal.max(0, (await this.borclar(tx, kart.id)).get(kart.id) ?? D(0));
      if (tutar.gt(borc)) throw new BadRequestException(`Ödeme güncel ${borc.toFixed(2)} ${kart.dovizCinsi} kart borcunu aşamaz`);
      const kur = kart.dovizCinsi === "TRY" ? D(1) : await kurZorunlu(tx, kart.dovizCinsi, tarih);
      const bankaHareket = await tx.kasaBankaHareket.create({ data: { tenantId, bankaHesapId: banka.id, tip: "tediye", tutar, dovizCinsi: kart.dovizCinsi, kur, tutarTry: tutar.mul(kur).toDecimalPlaces(2), tarih, aciklama: girdi.aciklama, kaynakTur: "kredi_karti_ekstre" } });
      const hareket = await tx.krediKartiHareket.create({ data: { tenantId, krediKartiId: kart.id, tip: "odeme", tarih, aciklama: girdi.aciklama, tutar, taksitSayisi: 1, belgeNo: girdi.belgeNo, bankaHareketId: bankaHareket.id } });
      await tx.kasaBankaHareket.update({ where: { id: bankaHareket.id }, data: { kaynakRef: hareket.id } }); return hareket;
    });
  }

  /**
   * KSB-08: kredi kartı hareketini geri alır. Açık dönemde hareket; taksitleri,
   * cari hareketi ve (ekstre ödemesiyse) banka fişiyle birlikte silinir ve
   * görüntüsü denetim izine yazılır. Kapalı dönemde ya da ekstresi kesinleşmiş
   * harekette (KSB-10: banka ekstresi değişmez) bugün tarihli ters hareket
   * atılır, vadesi gelmemiş taksitler plandan düşer. Kart ekranından girilen
   * gider kaydı (masraf) hareketle birlikte silinir; Masraflar ekranından
   * kartla ödenen harcama oradan geri alınır.
   */
  async hareketGeriAl(id: string, neden: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM kredi_karti_hareketleri WHERE id = ${id}::uuid FOR UPDATE`;
      const h = await tx.krediKartiHareket.findUnique({
        where: { id },
        include: { masrafOdemesi: { include: { masraf: true } }, taksitler: true, bankaHareket: { include: { ekstreSatir: { select: { id: true } } } } },
      });
      if (!h) throw new NotFoundException("Kredi kartı hareketi bulunamadı");
      if (h.geriAlinanHareketId) throw new BadRequestException("Ters kayıt geri alınamaz; gerekiyorsa işlemi yeniden girin");
      const kartGideri = h.masrafOdemesi?.masraf.kaynakTur === "kredi_karti" ? h.masrafOdemesi.masraf : null;
      if (h.masrafOdemesi && !kartGideri) throw new BadRequestException("Bu harcama Masraflar ekranında kartla ödendi; ödemeyi oradan geri alın");
      if (await tx.krediKartiHareket.findUnique({ where: { geriAlinanHareketId: id }, select: { id: true } })) throw new ConflictException("Bu hareket zaten geri alındı");

      const cariHareketleri = await tx.cariHareket.findMany({ where: { kaynakTur: "kredi_karti", kaynakRef: id } });
      const iz = (islem: string, ek: Record<string, unknown> = {}) => tx.auditLog.create({
        data: { tenantId, userId, islem, varlik: "kredi-kartlari", varlikId: id, detay: JSON.parse(JSON.stringify({ neden, hareket: h, cariHareketleri, masraf: kartGideri, ...ek })) as Prisma.InputJsonValue },
      });
      const kapali = await this.donemKapaliMi(tenantId, h.tarih);
      const ekstresiKesinlesti = Boolean(h.ekstreId || h.taksitler.some((t) => t.ekstreId));
      if (kartGideri && kapali) throw new BadRequestException("Mali dönem kapalı; kart ekranından girilen gider geri alınamaz. Bankadan iade geldiyse İade hareketi girin");
      // Gider kaydı hareketle birlikte gider (ödeme bağı zincirleme silinir).
      if (kartGideri) await tx.masraf.delete({ where: { id: kartGideri.id } });

      if (!kapali && !ekstresiKesinlesti) {
        await tx.cariHareket.deleteMany({ where: { id: { in: cariHareketleri.map((c) => c.id) } } });
        await tx.krediKartiHareket.delete({ where: { id } }); // taksitler zincirleme silinir
        if (h.bankaHareket) {
          if (h.bankaHareket.ekstreSatir) {
            await tx.bankaEkstreSatir.update({ where: { id: h.bankaHareket.ekstreSatir.id }, data: { durum: "beklemede", cariId: null, faturaId: null, eslesmeTuru: null } });
          }
          await tx.kasaBankaHareket.delete({ where: { id: h.bankaHareket.id } });
        }
        await iz("kredi_karti_hareketi_silindi");
        await carileriDenklestir(tx, tenantId, [h.cariId]);
        return { yontem: "silindi" as const };
      }

      const bugun = bugunTR();
      await this.donemKilidi.tarihDogrula(tenantId, bugun, "ters kayıt", tx);
      const tarih = new Date(bugun);
      // Ödeme ve iade borcu azaltmıştı, tersi borcu geri yazar; diğerleri iadeyle sıfırlanır.
      const tersTip = h.tip === "odeme" || h.tip === "iade" ? "harcama" : "iade";
      const bankaTersi = h.bankaHareket
        ? await tx.kasaBankaHareket.create({
          data: {
            tenantId, bankaHesapId: h.bankaHareket.bankaHesapId, tip: h.bankaHareket.tip === "tediye" ? "tahsilat" : "tediye",
            tutar: h.bankaHareket.tutar, dovizCinsi: h.bankaHareket.dovizCinsi, kur: h.bankaHareket.kur, tutarTry: h.bankaHareket.tutarTry, tarih,
            aciklama: `Ters kayıt: ${h.bankaHareket.aciklama ?? "kredi kartı ekstre ödemesi"} — ${neden}`.slice(0, 500), kaynakTur: "ters_kayit", kaynakRef: h.bankaHareket.id,
          },
        })
        : null;
      const ters = await tx.krediKartiHareket.create({
        data: {
          tenantId, krediKartiId: h.krediKartiId, tip: tersTip, tarih, aciklama: `Ters kayıt: ${h.aciklama} — ${neden}`.slice(0, 200), tutar: h.tutar, taksitSayisi: 1,
          cariId: h.cariId, faturaId: h.faturaId, faturaMahsubu: h.faturaMahsubu?.negated() ?? null, bankaHareketId: bankaTersi?.id ?? null, geriAlinanHareketId: h.id,
        },
      });
      // Kesinleşmiş ekstreye girmiş taksit plandan düşmez.
      await tx.krediKartiTaksit.deleteMany({ where: { hareketId: h.id, vadeTarihi: { gte: tarih }, ekstreId: null } });
      for (const c of cariHareketleri) {
        await tx.cariHareket.create({
          data: {
            tenantId, cariId: c.cariId, tip: c.tip === "borc" ? "alacak" : "borc", tutar: c.tutar, dovizCinsi: c.dovizCinsi, kur: c.kur, tutarTry: c.tutarTry, tarih,
            aciklama: `Ters kayıt: ${c.aciklama ?? "kredi kartı"}`.slice(0, 500), kaynakTur: "kredi_karti", kaynakRef: ters.id,
          },
        });
      }
      await iz("kredi_karti_hareketi_ters_kayit", { tersHareketId: ters.id, neden: kapali ? "mali_donem_kapali" : "ekstre_kesinlesti" });
      await kaynakKapamalariniCoz(tx, { krediKartiHareketIdler: [h.id] });
      await carileriDenklestir(tx, tenantId, [h.cariId]);
      return { yontem: "ters_kayit" as const, ekstreKesinlesti: !kapali };
    });
  }

  // ─── YARDIMCILAR ───────────────────────────────────────────────────────────

  /** Kart borçları: harcama + faiz + aidat − iade − ödeme (ileri taksitler dahil). */
  private async borclar(tx: Prisma.TransactionClient, kartId?: string) {
    const gruplar = await tx.krediKartiHareket.groupBy({ by: ["krediKartiId", "tip"], where: kartId ? { krediKartiId: kartId } : {}, _sum: { tutar: true } });
    const sonuc = new Map<string, Prisma.Decimal>();
    for (const g of gruplar) {
      const tutar = D(g._sum.tutar ?? 0);
      sonuc.set(g.krediKartiId, (sonuc.get(g.krediKartiId) ?? D(0)).add(["harcama", "faiz", "aidat"].includes(g.tip) ? tutar : tutar.negated()));
    }
    return sonuc;
  }

  /**
   * KSB-10: kullanılabilir limit aşılırsa onay istenir (409). Banka işlemi
   * zaten onaylamış olabilir; kullanıcı onaylarsa kayıt yine yazılır.
   */
  private async limitDenetle(tx: Prisma.TransactionClient, kart: { id: string; limit: Prisma.Decimal; dovizCinsi: string }, tutar: Prisma.Decimal, onay?: boolean) {
    if (onay) return;
    const borc = Prisma.Decimal.max(0, (await this.borclar(tx, kart.id)).get(kart.id) ?? D(0));
    const kullanilabilir = Prisma.Decimal.max(0, kart.limit.sub(borc));
    if (tutar.gt(kullanilabilir)) {
      throw new ConflictException(`Bu işlem kart limitini ${tutar.sub(kullanilabilir).toFixed(2)} ${kart.dovizCinsi} aşıyor (kullanılabilir limit ${kullanilabilir.toFixed(2)} ${kart.dovizCinsi}). Banka işlemi onayladıysa yine de kaydedebilirsiniz.`);
    }
  }

  /**
   * KSB-10: kart ekranından girilen gideri ödenmiş masraf olarak yazar ve kart
   * hareketine bağlar; gelir-gider raporu ve bütçe bu kayıttan beslenir.
   * KDV dahil tutardan matrah iç yüzdeyle ayrılır.
   */
  private async kartGideriYaz(tx: Prisma.TransactionClient, g: {
    kart: { id: string; tenantId: string; dovizCinsi: DovizCinsi };
    hareketId: string; tarih: Date; tutar: Prisma.Decimal; aciklama: string; belgeNo: string | null; saticiUnvan: string;
    belgeTuru: "fis" | "dekont"; kdvOrani: number | null; kur?: Prisma.Decimal;
    kategoriId?: string; kategori?: { ad: string; muhasebeKodu: string | null; varsayilanKdvOrani: number };
  }) {
    const tenantId = g.kart.tenantId;
    let kategoriId = g.kategoriId;
    let kdvOrani = g.kdvOrani;
    if (kategoriId) {
      const kategori = await tx.masrafKategori.findUnique({ where: { id: kategoriId } });
      if (!kategori) throw new BadRequestException("Masraf kategorisi bulunamadı");
      kdvOrani ??= kategori.varsayilanKdvOrani?.toNumber() ?? 20;
    } else {
      const k = g.kategori!;
      const kategori = await tx.masrafKategori.findFirst({ where: { ad: k.ad } })
        ?? await tx.masrafKategori.create({ data: { tenantId, ad: k.ad, muhasebeKodu: k.muhasebeKodu, varsayilanKdvOrani: k.varsayilanKdvOrani } });
      kategoriId = kategori.id;
      kdvOrani ??= k.varsayilanKdvOrani;
    }
    const kur = g.kur ?? (g.kart.dovizCinsi === "TRY" ? D(1) : await kurZorunlu(tx, g.kart.dovizCinsi, g.tarih));
    const matrah = icYuzdeMatrah(g.tutar, kdvOrani);
    const masraf = await tx.masraf.create({
      data: {
        tenantId, kategoriId, belgeTuru: g.belgeTuru, belgeNo: g.belgeNo, tarih: g.tarih, saticiUnvan: g.saticiUnvan.slice(0, 200), aciklama: g.aciklama,
        matrah, kdvOrani: D(kdvOrani), kdvTutari: g.tutar.sub(matrah), toplam: g.tutar, dovizCinsi: g.kart.dovizCinsi, kur,
        durum: "onaylandi", odemeDurumu: "odendi", odenenTutar: g.tutar, odemeTarihi: g.tarih, kaynakTur: "kredi_karti",
      },
    });
    await tx.masrafOdeme.create({ data: { tenantId, masrafId: masraf.id, krediKartiId: g.kart.id, krediKartiHareketId: g.hareketId, tutar: g.tutar, odemeTarihi: g.tarih } });
    return masraf;
  }

  private async donemKapaliMi(tenantId: string, tarih: Date): Promise<boolean> {
    try {
      await this.donemKilidi.tarihDogrula(tenantId, tarih, "geri alma");
      return false;
    } catch (hata) {
      if (hata instanceof ConflictException) return true;
      throw hata;
    }
  }
}
