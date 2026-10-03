import { Injectable } from "@nestjs/common";
import type { BildirimTuru, DuzeltmeTuru } from "@prisma/client";
import { bugunTR, EIRSALIYE_YANIT_GUN_SAYISI, MUHTELIF_MUSTERI_VKN, eirsaliyeYanitSuresi, gunEkleTR, IHRAC_KAYITLI_UYARI_GUNU, IRSALIYE_FATURA_GUN_SAYISI, irsaliyeFaturaSuresi, irsaliyeSevkGunu, type Rol, ihracKayitliSonTarih } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { ENTEGRATOR_IPTAL_ANAHTAR_ONEKI, entegratorIptalBildirimi } from "../ebelge/entegrator-iptal-bildirimi";
import { yerlesmisHataKosulu } from "../ebelge/yerlesmis-hata";
import { VARSAYILAN_ONAY_ESIGI, onaylayabilecekRoller } from "../satin-alma/satin-alma.hesap";
import { RaporService } from "../rapor/rapor.service";
import { ekstreOzeti } from "../kasa-banka/kart-ekstre";
import { kartEkstreleriniOku } from "../kasa-banka/kart-ekstre-oku";
import { BildirimService, type BildirimGirdisi } from "./bildirim.service";

const KRITIK_SLA_SAATI = 24;
const CEK_UYARI_GUNU = 7;
/** KSB-10: kart ekstresinin son ödeme gününe bu kadar gün kala hatırlatılır. */
const KART_UYARI_GUNU = 3;

/** Türe göre hedef roller — bildirim, işi yapan rolün önüne düşmelidir. */
const HEDEF_ROLLER: Record<BildirimTuru, Rol[]> = {
  duzeltme: ["yonetici", "muhasebe"],
  ebelge: ["yonetici", "muhasebe"],
  vade: ["yonetici", "muhasebe"],
  cek_senet: ["yonetici", "muhasebe"],
  stok: ["yonetici", "depo"],
  donem: ["yonetici", "muhasebe"],
  entegrasyon: ["yonetici", "muhasebe"],
  satin_alma: ["yonetici", "muhasebe"],
};

/**
 * Düzeltme türünü bildirim türüne çevirir: dış sistemden gelen istisnalar
 * kullanıcı için "entegrasyon sorunu", kendi kayıtlarımızdakiler "düzeltme".
 */
const DUZELTME_TUR_ESLEMESI: Record<DuzeltmeTuru, BildirimTuru> = {
  banka_ekstre: "entegrasyon",
  kredi_karti: "entegrasyon",
  pos: "entegrasyon",
  masraf: "duzeltme",
  ebelge: "ebelge",
  stok: "stok",
  cek_senet: "cek_senet",
  fatura_cari: "duzeltme",
  satin_alma: "satin_alma",
};

/**
 * Taramanın her türde ürettiği anahtar önekleri. Kapatma yalnız bunlarla
 * sınırlıdır: aynı türde olay anında üretilen bildirimler (alıcı reddi
 * `ebelge-ret:`, raporlanmış iptal `earsiv-iptal-raporlu:`, kira kuru
 * `kira-kur-eksik:`) taramada bulunmadığı için her turda kapanıyordu.
 * Düzeltme kayıtları eşlemeye göre birçok türe düşer, `duzeltme:` her türdedir.
 */
const TARAMA_ONEKLERI: Record<BildirimTuru, string[]> = {
  duzeltme: ["duzeltme:"],
  ebelge: ["duzeltme:", "ebelge:", ENTEGRATOR_IPTAL_ANAHTAR_ONEKI],
  vade: ["duzeltme:", "vade:"],
  cek_senet: ["duzeltme:", "cek_senet:"],
  stok: ["duzeltme:", "stok_kritik:", "stok_sayim:"],
  donem: ["duzeltme:", "donem:"],
  entegrasyon: ["duzeltme:", "banka-senkron:", "ekstre-bekleyen:"],
  satin_alma: ["duzeltme:", "satin_alma:"],
};

function gunAnahtari(tarih = new Date()): string {
  return tarih.toISOString().slice(0, 10);
}

/**
 * Kaynak modülleri tarayıp bildirim üretir (BLD-08).
 *
 * İki desen vardır. **Kayıt bazlı** olaylar (kritik düzeltme, hatalı e-belge,
 * kapanmayan dönem) sahiplenilmesi gereken tekil istisnalardır; her kayıt kendi
 * bildirimini alır. **Toplu** olaylar (vadesi geçen faturalar, kritik stok)
 * yüzlerce satır üretebileceği için günlük özet olarak bildirilir; kullanıcı
 * bağlantıdan filtrelenmiş listeye gider. Aksi hâlde ilk tarama zilin altına
 * yüzlerce kayıt boşaltır ve bildirim merkezi ilk günde okunmaz hâle gelirdi.
 */
@Injectable()
export class BildirimUreticiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bildirimler: BildirimService,
    private readonly rapor: RaporService,
    private readonly ayarlar?: AyarlarService,
  ) {}

  async tara(): Promise<{ uretilen: number; yeniTeslimat: number; kapanan: number; yukseltilen: number }> {
    const girdiler = [
      ...(await this.duzeltmeKayitlari()),
      ...(await this.ebelgeHatalari()),
      ...(await this.eirsaliyeYanitlari()),
      ...(await this.gelenEirsaliyeYanitSureleri()),
      ...(await this.vadeOzetleri()),
      ...(await this.stokOzetleri()),
      ...(await this.donemKontrolleri()),
      ...(await this.satinAlmaOnaylari()),
      ...(await this.bankaEntegrasyonu()),
    ];

    let yeniTeslimat = 0;
    for (const girdi of girdiler) yeniTeslimat += (await this.bildirimler.uret(girdi)).yeniTeslimat;

    // Yalnız bu taramada gerçekten bakılan türler kapatılır; bakılmayan bir
    // türün kayıtları "artık tespit edilmiyor" sanılıp kapanmamalıdır.
    const taranan: BildirimTuru[] = ["duzeltme", "ebelge", "vade", "cek_senet", "stok", "donem", "entegrasyon", "satin_alma"];
    let kapanan = 0;
    for (const tur of taranan) {
      const anahtarlar = girdiler.filter((g) => g.tur === tur).map((g) => g.birlesimAnahtari);
      kapanan += await this.bildirimler.kapatEksikleri(tur, anahtarlar, TARAMA_ONEKLERI[tur]);
    }

    return { uretilen: girdiler.length, yeniTeslimat, kapanan, yukseltilen: await this.yukselt() };
  }

  /**
   * Son tarihi geçmiş kritik bildirimi kimse sahiplenmediyse yöneticiye taşır
   * (BLD-05). Yükseltme bir kez yapılır; `yukseltildiAt` bunu işaretler.
   */
  private async yukselt(): Promise<number> {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const adaylar = await tx.bildirim.findMany({
        where: {
          onem: "kritik",
          kapandiAt: null,
          yukseltildiAt: null,
          sonTarih: { lt: new Date() },
          teslimatlar: { none: { durum: { in: ["ustlenildi", "aksiyon_alindi", "yoksayildi"] } } },
        },
        select: { id: true },
      });
      if (!adaylar.length) return 0;

      const yoneticiler = await tx.user.findMany({ where: { rol: "yonetici", aktif: true }, select: { id: true } });
      for (const bildirim of adaylar) {
        const mevcut = await tx.bildirimTeslimati.findMany({ where: { bildirimId: bildirim.id }, select: { userId: true } });
        const teslimEdilen = new Set(mevcut.map((t) => t.userId));
        const eksikler = yoneticiler.filter((y) => !teslimEdilen.has(y.id));
        if (eksikler.length) {
          await tx.bildirimTeslimati.createMany({
            data: eksikler.map((y) => ({ tenantId, bildirimId: bildirim.id, userId: y.id })),
          });
        }
        await tx.bildirim.update({ where: { id: bildirim.id }, data: { yukseltildiAt: new Date() } });
      }
      return adaylar.length;
    });
  }

  private sla(onem: BildirimGirdisi["onem"]): Date | undefined {
    if (onem !== "kritik") return undefined;
    const sonTarih = new Date();
    sonTarih.setHours(sonTarih.getHours() + KRITIK_SLA_SAATI);
    return sonTarih;
  }

  /**
   * SAT-07: onay bekleyen her satın alma talebi, tutarına göre onaylayabilecek
   * rollere bildirilir; karara bağlanınca ya da geri çekilince tespit edilmez ve
   * bildirim kapanır.
   */
  private async satinAlmaOnaylari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const ayar = this.ayarlar ? await this.ayarlar.getir("satin_alma") : {};
    const esik = Number(ayar.onayEsigi ?? VARSAYILAN_ONAY_ESIGI);
    const talepler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.satinAlmaTalebi.findMany({
        where: { durum: "onay_bekliyor" },
        select: { id: true, no: true, tahminiToplam: true, talepEden: { select: { adSoyad: true } } },
        orderBy: { createdAt: "asc" },
        take: 200,
      }),
    );
    return talepler.map((t) => ({
      tur: "satin_alma" as const,
      onem: "uyari" as const,
      baslik: "Satın alma talebi onay bekliyor",
      aciklama: `${t.no} · ${t.talepEden.adSoyad} · ${Number(t.tahminiToplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL`,
      birlesimAnahtari: `satin_alma:talep:${t.id}`,
      kaynakTur: "satin_alma_talebi",
      kaynakRef: t.id,
      hedefYol: `/panel/satin-alma/talepler?talep=${t.id}`,
      roller: onaylayabilecekRoller(Number(t.tahminiToplam), esik),
    }));
  }

  private async duzeltmeKayitlari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.duzeltmeKaydi.findMany({
        where: { durum: { in: ["acik", "incelemede", "beklemede"] }, OR: [{ onem: "kritik" }, { sonTarih: { lt: new Date() } }] },
        select: { id: true, tur: true, onem: true, aciklama: true, onerilenEylem: true, sonTarih: true },
        orderBy: { createdAt: "asc" },
        take: 200,
      }),
    );
    return kayitlar.map((kayit) => {
      const gecikti = Boolean(kayit.sonTarih && kayit.sonTarih < new Date());
      const tur = DUZELTME_TUR_ESLEMESI[kayit.tur];
      return {
        tur,
        onem: kayit.onem === "kritik" ? "kritik" : "uyari",
        baslik: gecikti && kayit.onem !== "kritik" ? "Düzeltme kaydı SLA süresini aştı" : "Kritik düzeltme gerekli",
        aciklama: kayit.onerilenEylem ? `${kayit.aciklama} ${kayit.onerilenEylem}` : kayit.aciklama,
        birlesimAnahtari: `duzeltme:${kayit.id}`,
        kaynakTur: "duzeltme",
        kaynakRef: kayit.id,
        hedefYol: "/panel/islemler",
        sonTarih: kayit.sonTarih ?? this.sla(kayit.onem === "kritik" ? "kritik" : "uyari"),
        roller: HEDEF_ROLLER[tur],
      };
    });
  }

  private async ebelgeHatalari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ebelgeKayit.findMany({
        // Taze `hata` bildirim doğurmaz (EBLG-46): gönderim işi düşünce kayıt
        // hemen `hata` yazılır ama kuyruk birkaç kez daha dener, ikinci
        // denemede geçen gönderim de arada `hata` görünür — bildirim geri
        // alınamadığı için denemeler bitene kadar beklenir. `ret` alıcının
        // nihai kararıdır, yeniden denenmez, bu yüzden hemen bildirilir.
        where: { OR: [yerlesmisHataKosulu(), { durum: "ret" }, { durum: "iptal", fatura: { durum: "kesin" } }] },
        select: { id: true, durum: true, hataMesaji: true, faturaId: true, fatura: { select: { no: true, durum: true, cari: { select: { unvan: true } } } } },
        orderBy: { updatedAt: "desc" },
        take: 200,
      }),
    );
    // EBLG-39: entegratörde iptal edilmiş belge, fatura iptal edilene kadar
    // hatırlatılır; fatura iptal edilince tespit edilmez ve bildirim kapanır.
    const iptaller = kayitlar
      .filter((kayit) => kayit.durum === "iptal" && kayit.fatura.durum === "kesin")
      .map((kayit) => entegratorIptalBildirimi(kayit.faturaId, kayit.fatura.no));
    return [...iptaller, ...kayitlar.filter((kayit) => kayit.durum !== "iptal").map((kayit) => ({
      tur: "ebelge" as const,
      onem: "kritik" as const,
      baslik: kayit.durum === "ret" ? "e-Belge reddedildi" : "e-Belge gönderimi hata verdi",
      aciklama: `${kayit.fatura.no ?? "Numarasız fatura"} · ${kayit.fatura.cari.unvan} — ${kayit.hataMesaji ?? "Entegratör hata ayrıntısı bildirmedi."}`,
      birlesimAnahtari: `ebelge:${kayit.id}`,
      kaynakTur: "ebelge",
      kaynakRef: kayit.faturaId,
      hedefYol: "/panel/fatura?ebelge=hata",
      sonTarih: this.sla("kritik"),
      roller: HEDEF_ROLLER.ebelge,
    }))];
  }

  /**
   * EBLG-91: alıcının e-İrsaliyeye verdiği RET ya da kısmi kabul (mali
   * müşavir, 2026-09-24). Stok ve sipariş kendiliğinden değişmez — stok
   * hareketi irsaliyede değil faturada doğar; kullanıcı yönlendirilir. RET
   * irsaliye iptal edilince, kısmi kabul irsaliye kesin faturaya bağlanınca
   * tespit edilmez ve bildirim kapanır.
   */
  private async eirsaliyeYanitlari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.eirsaliyeKayit.findMany({
        where: {
          OR: [
            { durum: "ret", belge: { durum: { not: "iptal" } } },
            { durum: "kismi_kabul", belge: { durum: { not: "iptal" }, OR: [{ faturaId: null }, { fatura: { is: { durum: { not: "kesin" } } } }] } },
          ],
        },
        select: { id: true, durum: true, hataMesaji: true, belgeId: true, belge: { select: { no: true, cari: { select: { unvan: true } } } } },
        orderBy: { updatedAt: "desc" },
        take: 200,
      }),
    );
    return kayitlar.map((kayit) => {
      const ret = kayit.durum === "ret";
      const onem = ret ? ("kritik" as const) : ("uyari" as const);
      return {
        tur: "ebelge" as const,
        onem,
        baslik: ret ? "Alıcı e-İrsaliyeyi reddetti" : "Alıcı e-İrsaliyeyi kısmen kabul etti",
        aciklama: `${kayit.belge.no ?? "Numarasız irsaliye"} · ${kayit.belge.cari.unvan} — ${ret
          ? "Belge GİB'de geçersiz oldu. İrsaliyeyi programda iptal edip doğru bilgilerle yenisini düzenleyin."
          : "Faturayı alıcının kabul ettiği miktarla kesin."}${kayit.hataMesaji ? ` Alıcı notu: ${kayit.hataMesaji}` : ""}`,
        birlesimAnahtari: `ebelge:irsaliye:${kayit.id}`,
        kaynakTur: "belge",
        kaynakRef: kayit.belgeId,
        hedefYol: `/panel/belgeler?odak=${kayit.belgeId}`,
        sonTarih: this.sla(onem),
        roller: HEDEF_ROLLER.ebelge,
      };
    });
  }

  /**
   * EBLG-96: gelen e-İrsaliyeye yanıt fiilî sevkten itibaren 7 gün içinde
   * verilir; süresinde yanıtlanmayan belge tam teslim alınmış sayılır (GİB
   * SSS 57). Son 2 gün kala belge başına uyarı; yanıt verilince ya da süre
   * dolunca tespit edilmez ve bildirim kapanır. Son tarih süre sonudur, her
   * taramada aynı hesaplandığı için tazelenmez.
   */
  private async gelenEirsaliyeYanitSureleri(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEirsaliye.findMany({
        where: { durum: "yeni", kendiSevkimiz: false, sevkTarihi: { gte: new Date(`${gunEkleTR(-EIRSALIYE_YANIT_GUN_SAYISI)}T00:00:00Z`) } },
        select: { id: true, belgeNo: true, gonderenUnvan: true, sevkTarihi: true },
        take: 200,
      }),
    );
    return kayitlar.flatMap((kayit) => {
      const sure = eirsaliyeYanitSuresi({ sevkGunu: kayit.sevkTarihi.toISOString().slice(0, 10), bugun });
      if (!sure.yaklasiyor) return [];
      const sonGun = sure.sonGun.split("-").reverse().join(".");
      return [{
        tur: "ebelge" as const,
        onem: "uyari" as const,
        baslik: "Gelen e-İrsaliyenin yanıt süresi doluyor",
        aciklama: `${kayit.belgeNo} · ${kayit.gonderenUnvan} — yanıt için son gün ${sonGun}. Süresinde yanıt verilmezse mal tam teslim alınmış sayılır; eksik ya da hatalı teslimatı bu tarihe kadar bildirin.`,
        birlesimAnahtari: `ebelge:gelen-irsaliye-yanit:${kayit.id}`,
        kaynakTur: "gelen_eirsaliye",
        kaynakRef: kayit.id,
        hedefYol: "/panel/ebelge/irsaliye-gelen",
        sonTarih: new Date(`${sure.sonGun}T23:59:59+03:00`),
        roller: HEDEF_ROLLER.ebelge,
      }];
    });
  }

  /**
   * KSB-15: otomatik çekimi 3 kez üst üste başarısız olan ya da kimlik
   * reddiyle durmuş Vomsis bağlantısı (bağlantı başına) ve eşleştirme
   * bekleyen ekstre satırları (banka hesabı başına özet). Anahtarlar güne
   * bağlı değildir: sayı değişince metin güncellenir, sorun kalkınca kapanır.
   */
  private async bankaEntegrasyonu(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const [baglantilar, bekleyenler] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.baglanti.findMany({
        where: { aile: "banka", saglayici: "vomsis", durum: "aktif", OR: [{ ardisikHata: { gte: 3 } }, { otomatikDurduNedeni: { not: null } }] },
        select: { id: true, ardisikHata: true, sonSenkronHatasi: true, otomatikDurduNedeni: true },
      }),
      tx.bankaEkstreSatir.groupBy({ by: ["bankaHesapId"], where: { durum: "beklemede" }, _count: { _all: true } }),
    ]));
    const hesapAdlari = bekleyenler.length
      ? new Map((await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaHesap.findMany({ where: { id: { in: bekleyenler.map((b) => b.bankaHesapId) } }, select: { id: true, ad: true } }))).map((h) => [h.id, h.ad]))
      : new Map<string, string>();
    return [
      ...baglantilar.map((b): BildirimGirdisi => ({
        tur: "entegrasyon",
        onem: b.otomatikDurduNedeni ? "kritik" : "uyari",
        baslik: b.otomatikDurduNedeni ? "Banka hareketlerinin otomatik çekimi durdu" : "Banka hareketleri çekilemiyor",
        aciklama: b.otomatikDurduNedeni
          ? `${b.otomatikDurduNedeni}. Vomsis bilgilerini düzeltip "Hareketleri çek" ile deneyin; başarılı çekimde otomatik çekim yeniden başlar.`
          : `Son ${b.ardisikHata} çekim başarısız oldu: ${b.sonSenkronHatasi ?? "bilinmeyen hata"}. Ekstre satırları güncel olmayabilir.`,
        birlesimAnahtari: `banka-senkron:${b.id}`,
        kaynakTur: "baglanti",
        kaynakRef: b.id,
        hedefYol: "/panel/ayarlar/banka-baglantilari",
        roller: HEDEF_ROLLER.entegrasyon,
      })),
      ...bekleyenler.map((b): BildirimGirdisi => ({
        tur: "entegrasyon",
        onem: "bilgi",
        baslik: "Eşleştirme bekleyen banka hareketi var",
        aciklama: `${hesapAdlari.get(b.bankaHesapId) ?? "Banka hesabı"}: ${b._count._all} ekstre satırı eşleştirme bekliyor.`,
        birlesimAnahtari: `ekstre-bekleyen:${b.bankaHesapId}`,
        kaynakTur: "banka_hesap",
        kaynakRef: b.bankaHesapId,
        hedefYol: `/panel/kasa-banka/ekstre?bankaHesapId=${b.bankaHesapId}`,
        roller: HEDEF_ROLLER.entegrasyon,
      })),
    ];
  }

  private async vadeOzetleri(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const gun = gunAnahtari();
    const girdiler: BildirimGirdisi[] = [];

    // Vade tanımı rapor motorundan gelir; aynı sayı iki yerde ayrı hesaplanırsa
    // kullanıcı zilde ve raporda farklı rakam görür.
    const vadesiGecenler = await this.rapor.vadesiGecenler();
    const alacak = vadesiGecenler.alacaklar.length;
    const borc = vadesiGecenler.borclar.length;
    if (alacak || borc) {
      girdiler.push({
        tur: "vade",
        onem: "uyari",
        baslik: "Vadesi geçen fatura var",
        aciklama: `${alacak} tahsil edilecek (${vadesiGecenler.toplamAlacak} TL), ${borc} ödenecek (${vadesiGecenler.toplamBorc} TL) fatura vadesini geçti.`,
        birlesimAnahtari: `vade:${gun}`,
        hedefYol: "/panel/fatura?odeme=acik",
        roller: HEDEF_ROLLER.vade,
      });
    }

    const sinir = new Date();
    sinir.setDate(sinir.getDate() + CEK_UYARI_GUNU);
    const yaklasanCek = await this.prisma.tenantIslem(tenantId, (tx) =>
      // Sonuçlanmamış evraklar: portföyde duran, bankaya verilen ve kendi
      // kestiğimiz ödenmemiş çekler. Tahsil/ödeme/ciro sonrası uyarı gereksizdir.
      tx.cekSenet.count({
        where: { durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi", "verildi"] }, vadeTarihi: { lte: sinir } },
      }),
    );
    if (yaklasanCek) {
      girdiler.push({
        tur: "cek_senet",
        onem: "uyari",
        baslik: "Vadesi yaklaşan çek/senet",
        aciklama: `${yaklasanCek} evrakın vadesi önümüzdeki ${CEK_UYARI_GUNU} gün içinde doluyor.`,
        birlesimAnahtari: `cek_senet:${gun}`,
        hedefYol: "/panel/kasa-banka/cek-senet",
        roller: HEDEF_ROLLER.cek_senet,
      });
    }

    girdiler.push(...(await this.kartEkstreUyarilari()));
    girdiler.push(...(await this.ihracKayitliOzetleri(gun)));
    girdiler.push(...(await this.irsaliyeFaturaOzetleri(gun)));
    return girdiler;
  }

  /**
   * KSB-10: son kesilen kart ekstresi. Son ödeme günü yaklaşırken uyarı,
   * asgari ödenmeden geçince kritik bildirim; anahtar duruma göre ayrıldığı
   * için "yaklaşıyor"dan "gecikti"ye geçiş yeni bildirimdir. Ekstre ödenince
   * tarama onu artık üretmez ve bildirim kapanır (`vade:` öneki).
   */
  private async kartEkstreUyarilari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    const kartlar = await this.prisma.tenantIslem(tenantId, (tx) => kartEkstreleriniOku(tx, bugun));
    const girdiler: BildirimGirdisi[] = [];
    for (const { kart, donemler } of kartlar) {
      const ekstre = ekstreOzeti(donemler).sonKesilen;
      if (!ekstre || ekstre.kalan.lte(0)) continue;
      const kartAdi = `${kart.ad} •••• ${kart.sonDortHane}`;
      const sonOdeme = ekstre.sonOdemeTarihi.split("-").reverse().join(".");
      const para = (d: { toFixed: (n: number) => string }) => `${Number(d.toFixed(2)).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${kart.dovizCinsi}`;
      const ortak = { tur: "vade" as const, kaynakTur: "kredi_karti_ekstre", kaynakRef: kart.id, hedefYol: `/panel/kasa-banka/kredi-kartlari?kart=${kart.id}`, roller: HEDEF_ROLLER.vade };
      if (ekstre.durum === "gecikti") {
        girdiler.push({
          ...ortak, onem: "kritik", baslik: "Kart ekstresi gecikti",
          aciklama: `${kartAdi} ekstresinin son ödeme günü ${sonOdeme} geçti; asgari ödemeden ${para(ekstre.asgariKalan)} eksik, toplam kalan ${para(ekstre.kalan)}. Gecikme faizi işler.`,
          birlesimAnahtari: `vade:kart:${kart.id}:${ekstre.kesimTarihi}:gecikti`,
        });
      } else if (ekstre.durum === "bekliyor" || ekstre.durum === "kismi") {
        const kalanGun = Math.round((Date.parse(ekstre.sonOdemeTarihi) - Date.parse(bugun)) / 86_400_000);
        if (kalanGun > KART_UYARI_GUNU) continue;
        girdiler.push({
          ...ortak, onem: "uyari", baslik: "Kart ekstresinin son ödeme günü yaklaşıyor",
          aciklama: `${kartAdi}: ${para(ekstre.kalan)} ekstre borcunun son ödeme günü ${sonOdeme}${kalanGun === 0 ? " (bugün)" : ` (${kalanGun} gün kaldı)`}; asgari ${para(ekstre.asgariKalan)}.`,
          birlesimAnahtari: `vade:kart:${kart.id}:${ekstre.kesimTarihi}:yaklasiyor`,
          sonTarih: new Date(`${ekstre.sonOdemeTarihi}T23:59:59+03:00`),
        });
      }
    }
    return girdiler;
  }

  /**
   * EBLG-82: fatura teslimden itibaren 7 gün içinde düzenlenir (VUK 231/5).
   * Satışta süresi dolan kritik, dolmak üzere olan uyarıdır. Alışta faturayı
   * tedarikçi keser; bizim için hatırlatmadır, yalnız süre dolunca ve uyarı
   * önemiyle çıkar. Kesin faturaya bağlanan irsaliye faturalanmış sayılır;
   * liste olayıdır, günlük özet üretilir (`vade:` öneki taramanın kapatması için).
   */
  private async irsaliyeFaturaOzetleri(gun: string): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const bekleyenler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.belge.findMany({
        where: {
          tur: "irsaliye",
          durum: { in: ["onaylandi", "kapandi"] },
          OR: [{ faturaId: null }, { fatura: { is: { durum: { not: "kesin" } } } }],
          // EBLG-95: muhtelif irsaliyenin faturası müşterilere ayrı ayrı kesilir; takibe girmez.
          cari: { OR: [{ vknTckn: null }, { vknTckn: { not: MUHTELIF_MUSTERI_VKN } }] },
        },
        select: { yon: true, tarih: true, fiiliSevkZamani: true },
      }),
    );
    if (bekleyenler.length === 0) return [];
    const ayar = this.ayarlar ? await this.ayarlar.getir("ebelge") : {};
    const gunSayisi = Number(ayar.irsaliyeFaturaGunSayisi) > 0 ? Number(ayar.irsaliyeFaturaGunSayisi) : IRSALIYE_FATURA_GUN_SAYISI;
    const bugun = bugunTR();
    const sure = (b: (typeof bekleyenler)[number]) => irsaliyeFaturaSuresi({ sevkGunu: irsaliyeSevkGunu(b), bugun, gunSayisi });
    const satis = bekleyenler.filter((b) => b.yon === "satis").map(sure);
    const alisGecen = bekleyenler.filter((b) => b.yon === "alis").map(sure).filter((s) => s.gecti).length;
    const satisGecen = satis.filter((s) => s.gecti).length;
    const satisYaklasan = satis.filter((s) => s.yaklasiyor).length;

    const girdiler: BildirimGirdisi[] = [];
    if (satisGecen) {
      girdiler.push({
        tur: "vade",
        onem: "kritik",
        baslik: "İrsaliyenin faturalama süresi doldu",
        aciklama: `${satisGecen} satış irsaliyesi ${gunSayisi} gün içinde faturalanmadı. Süresinde düzenlenmeyen fatura hiç düzenlenmemiş sayılır ve özel usulsüzlük cezası doğar; faturayı hemen düzenleyin.`,
        birlesimAnahtari: `vade:irsaliye-fatura-gecen:${gun}`,
        hedefYol: "/panel/belgeler?tur=irsaliye&yon=satis&faturaBekleyen=1",
        roller: HEDEF_ROLLER.vade,
      });
    }
    if (satisYaklasan) {
      girdiler.push({
        tur: "vade",
        onem: "uyari",
        baslik: "İrsaliyenin faturalama süresi doluyor",
        aciklama: `${satisYaklasan} satış irsaliyesinin ${gunSayisi} günlük faturalama süresi önümüzdeki günlerde doluyor.`,
        birlesimAnahtari: `vade:irsaliye-fatura-yaklasan:${gun}`,
        hedefYol: "/panel/belgeler?tur=irsaliye&yon=satis&faturaBekleyen=1",
        roller: HEDEF_ROLLER.vade,
      });
    }
    if (alisGecen) {
      girdiler.push({
        tur: "vade",
        onem: "uyari",
        baslik: "Tedarikçiden fatura gelmedi",
        aciklama: `${alisGecen} alış irsaliyesinin faturası ${gunSayisi} gün içinde gelmedi. Tedarikçiden faturayı isteyin; geldiyse irsaliyeyi faturaya bağlayın.`,
        birlesimAnahtari: `vade:irsaliye-fatura-alis:${gun}`,
        hedefYol: "/panel/belgeler?tur=irsaliye&yon=alis&faturaBekleyen=1",
        roller: HEDEF_ROLLER.vade,
      });
    }
    return girdiler;
  }

  /**
   * EBLG-63: ihraç kaydıyla satılan malın süresinde ihraç edildiğini gösteren
   * çıkış beyannamesi ihracatçıdan gelmediyse uyarır. EBLG-114: ihraç kayıtlı
   * alışta ihracatçı firmadır; beyanname girilmemiş alışlar ayrı bildirimle
   * izlenir. Liste olayıdır, günlük özet üretilir; anahtar `vade:` önekiyle
   * başlar ki tarama kapatabilsin. Süresi geçen kritik sayılır: tecil edilen
   * KDV'nin ödenmesi gündeme gelir.
   */
  private async ihracKayitliOzetleri(gun: string): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const aciklar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.findMany({
        where: { ihracKayitliKodu: { not: null }, durum: "kesin", gumrukBeyannameNo: null, tip: { in: ["satis", "alis"] } },
        select: { tarih: true, tip: true },
      }),
    );
    const bugun = gunAnahtari();
    const sinir = new Date();
    sinir.setDate(sinir.getDate() + IHRAC_KAYITLI_UYARI_GUNU);
    const uyariSiniri = gunAnahtari(sinir);

    const girdiler: BildirimGirdisi[] = [];
    for (const yon of ["satis", "alis"] as const) {
      const sonTarihler = aciklar.filter((f) => f.tip === yon).map((f) => ihracKayitliSonTarih(f.tarih));
      const gecen = sonTarihler.filter((s) => s < bugun).length;
      const yaklasan = sonTarihler.filter((s) => s >= bugun && s <= uyariSiniri).length;
      const satis = yon === "satis";
      const hedefYol = satis ? "/panel/fatura?ihracKayitli=acik" : "/panel/fatura?yon=alis&ihracKayitli=acik";
      const anahtar = satis ? "ihrac-kayitli" : "ihrac-kayitli-alis";
      if (gecen) {
        girdiler.push({
          tur: "vade",
          onem: "kritik",
          baslik: satis ? "İhraç kayıtlı satışta süre doldu" : "İhraç kayıtlı alışta ihracat süresi doldu",
          aciklama: satis
            ? `${gecen} ihraç kayıtlı satışın ihracat süresi geçti ve çıkış beyannamesi işlenmedi. İhracatçıdan beyannameyi isteyin; gerçekleşmediyse tecil edilen KDV için mali müşavirinize danışın.`
            : `${gecen} ihraç kayıtlı alışta malın ihraç süresi geçti ve gümrük beyannamesi işlenmedi. İhraç edildiyse beyannameyi alış faturasına girin; edilmediyse ödenmeyen KDV firmadan aranır, mali müşavirinize danışın.`,
          birlesimAnahtari: `vade:${anahtar}-gecen:${gun}`,
          hedefYol,
          roller: HEDEF_ROLLER.vade,
        });
      }
      if (yaklasan) {
        girdiler.push({
          tur: "vade",
          onem: "uyari",
          baslik: satis ? "İhraç kayıtlı satışta süre doluyor" : "İhraç kayıtlı alışta ihracat süresi doluyor",
          aciklama: satis
            ? `${yaklasan} ihraç kayıtlı satışın ihracat süresi önümüzdeki ${IHRAC_KAYITLI_UYARI_GUNU} gün içinde doluyor; çıkış beyannamesi henüz işlenmedi.`
            : `${yaklasan} ihraç kayıtlı alışta malı ihraç etmeniz gereken süre önümüzdeki ${IHRAC_KAYITLI_UYARI_GUNU} gün içinde doluyor; gümrük beyannamesi henüz işlenmedi.`,
          birlesimAnahtari: `vade:${anahtar}-yaklasan:${gun}`,
          hedefYol,
          roller: HEDEF_ROLLER.vade,
        });
      }
    }
    return girdiler;
  }

  private async stokOzetleri(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const gun = gunAnahtari();
    const [kritikStok, taslakSayim] = await this.prisma.tenantIslem(tenantId, async (tx) => [
      await tx.$queryRaw<{ sayi: bigint }[]>`
        SELECT count(*)::bigint AS sayi FROM "stok_kartlari"
        WHERE "tenant_id" = ${tenantId}::uuid AND "aktif" = true
          AND "kritik_seviye" IS NOT NULL AND "mevcut_miktar" <= "kritik_seviye"`,
      await tx.sayim.count({ where: { durum: "taslak" } }),
    ]);
    const kritikSayisi = Number(kritikStok[0]?.sayi ?? 0);

    const girdiler: BildirimGirdisi[] = [];
    if (kritikSayisi) {
      girdiler.push({
        tur: "stok",
        onem: "uyari",
        baslik: "Kritik seviyeye düşen stok",
        aciklama: `${kritikSayisi} stok kartı kritik seviyenin altında veya seviyesinde.`,
        birlesimAnahtari: `stok_kritik:${gun}`,
        hedefYol: "/panel/stok",
        roller: HEDEF_ROLLER.stok,
      });
    }
    if (taslakSayim) {
      girdiler.push({
        tur: "stok",
        onem: "uyari",
        baslik: "Onaysız stok sayımı",
        aciklama: `${taslakSayim} sayım taslak durumda; onaylanmadan stok miktarlarına yansımaz.`,
        birlesimAnahtari: `stok_sayim:${gun}`,
        hedefYol: "/panel/stok/sayim",
        roller: HEDEF_ROLLER.stok,
      });
    }
    return girdiler;
  }

  private async donemKontrolleri(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const donemler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.maliDonem.findMany({
        where: { durum: "acik", kontroller: { some: { basarili: false } } },
        select: { id: true, yil: true, ay: true, kontroller: { where: { basarili: false }, select: { aciklama: true } } },
        orderBy: [{ yil: "desc" }, { ay: "desc" }],
        take: 12,
      }),
    );
    return donemler.map((donem) => ({
      tur: "donem" as const,
      onem: "uyari" as const,
      baslik: `${String(donem.ay).padStart(2, "0")}/${donem.yil} dönemi kapanmaya hazır değil`,
      aciklama: donem.kontroller.map((kontrol) => kontrol.aciklama).join(" · "),
      birlesimAnahtari: `donem:${donem.yil}-${donem.ay}`,
      kaynakTur: "mali_donem",
      kaynakRef: donem.id,
      hedefYol: "/panel/donem-kapatma",
      roller: HEDEF_ROLLER.donem,
    }));
  }
}
