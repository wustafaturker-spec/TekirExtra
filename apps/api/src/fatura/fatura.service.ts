import { agirlikliMaliyet, alisBirimMaliyeti } from "../stok/maliyet";
import { kesinlesmeTahminiYaz } from "../cari/tahmin-isabeti-kaynak";
import { faturaDagitimKosulu } from "../stok/maliyet-dagitimi.service";
import { belgeDiliNormalize, ciftDilGecerli, ebelgeGitmemisMi, faturaGeriAlmaEngeli, ihracKayitliSonTarih, ilgiliKisiTemizle, varyantAciklamasi, varyantliAd, varyantliKod, sonrakiTekrarTarihi, tekrarDegiskenDegerleri, tekrarMetniDoldur, faturaKurTipi, type DovizKodu } from "@tekirextra/shared";
import { kurCoz } from "../doviz/kur-coz";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { Prisma, FaturaTip, FaturaDurum, BelgeDurum } from "@prisma/client";
import { faturaHesapla, faturaSenaryosuTuret, KONAKLAMA_VERGISI_KODU, idisNormalize, metinNormalize, ozelMatrahKdvsi, sarjTuruCoz, sgkFaturasiMi, tevkifatPayPayda, type FaturaHesaplaSatirGirdi, type KayitEylem, type TevkifatKodu } from "@tekirextra/shared";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { belgeKodTablosu, firmaTevkifatTablosu, mevzuatKurallariniUygula } from "./tevkifat-tablosu";
import { MevzuatService } from "../mevzuat/mevzuat.service";
import { ekVergileriCoz, hesapGirdisi, maktuBirimleriniBagla, saklanacakEkVergiler, sakliEkVergiler, type EkVergi, type EkVergiGirdisi } from "./ek-vergi";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { izinliEylemler, eylemIzinli } from "../core/eylemler/eylem-kayit";
import { PrismaService } from "../core/prisma.service";
import { PdfService } from "../core/pdf/pdf.service";
import { StokService } from "../stok/stok.service";
import { DepoService } from "../stok/depo.service";
import { EpostaService } from "../tenant/eposta.service";
import { BelgelerService } from "../belgeler/belgeler.service";
import { BaglantilarService } from "../tenant/baglantilar.service";
import { EbelgeService } from "../ebelge/ebelge.service";
import { EbelgeGorunumService } from "../ebelge/ebelge-gorunum.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { renkNormalize } from "../core/pdf/belge-temasi";
import { ornekFatura } from "./sablon-onizleme";
import { faturaPdfHtml } from "./fatura-pdf";
import { ticariBelgeEkVerisi } from "../core/pdf/ticari-belge-veri";
import { durumGecmisiOku } from "../core/durum-gecmisi";
import { takiliRezervasyonMu } from "../ebelge/takili-rezervasyon";
import { birimKatsayisiBul, satirBirimleriniDogrula } from "../stok/birim-cevrim";
import { satirVaryantlariniDogrula } from "../stok/varyant-secimi";
import { teslimYeriUyarisi, teslimYeriVerisi, teslimYeriniCariyeKaydet } from "./teslim-yeri";
import { cariDenklestir, faturaKapamalariniCoz, kapamaKaynagi } from "./denklestirme";
import { kurFarkiKarsiligiYaz, kurFarkiKarsiliginiCoz } from "./kur-farki-karsilik";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu, kurFarkiTry, odemeOzetiGorunumu } from "./odeme-durumu";
import { cariIslemDenetle, riskLimitiDenetle } from "../cari/cari-islem-denetimi";
import type {
  faturaOlusturSemasi,
  faturaGuncelleSemasi,
  faturaSeriSemasi,
  tekrarlayanFaturaGuncelleSemasi,
  tekrarlayanFaturaSemasi,
} from "./fatura.semalar";
import { acikFaturaOzeti } from "./acik-fatura-ozeti";

/**
 * EBLG-155: iptal ve geri almada entegratör çağrısı işlemin içindedir; böylece çağrı başarısızsa
 * işlem geri alınır. Varsayılan 5 sn, entegratör geç yanıt verince işlemi düşürüyordu; iki çağrı (en çok 30'ar sn) ve ters kayıtları karşılar.
 */
/** EBLG-160: iptal ve geri almada entegratör çağrısı işlem dışında; işlem yalnız ters kayıtları yazar. */
const TERS_KAYIT_ISLEM_SURESI_MS = 30_000;

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

@Injectable()
export class FaturaService {
  private readonly logger = new Logger(FaturaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stokService: StokService,
    private readonly depoService: DepoService,
    private readonly pdf: PdfService,
    private readonly eposta: EpostaService,
    private readonly belgelerService: BelgelerService,
    private readonly donemKilidi: DonemKilidiService,
    private readonly baglantilar: BaglantilarService,
    @Inject(forwardRef(() => EbelgeService)) private readonly ebelge: EbelgeService,
    @Inject(forwardRef(() => EbelgeGorunumService)) private readonly ebelgeGorunum: EbelgeGorunumService,
    @Optional() private readonly ayarlar?: AyarlarService,
    @Optional() private readonly mevzuat?: MevzuatService,
  ) {}

  /** MVZ-11/12: belge tarihindeki merkezi tablolarla KDV oranı ve kod kuralları; ihlal kaydı durdurur. */
  private async tevkifatTablosuIleDogrula(girdi: { tarih: string | Date; ozelMatrahKodu?: string | null; ihracKayitliKodu?: string | null; satirlar?: { kdvOrani?: string | number | null; tevkifatKodu?: string | null; tevkifatOrani?: string | null; gibIstisnaKodu?: string | null }[] }, pasifKodKabul: boolean) {
    const tarih = typeof girdi.tarih === "string" ? girdi.tarih.slice(0, 10) : girdi.tarih.toISOString().slice(0, 10);
    const [tablo, kod] = await Promise.all([
      firmaTevkifatTablosu({ mevzuat: this.mevzuat, ayarlar: this.ayarlar }, tarih),
      belgeKodTablosu(this.mevzuat, tarih),
    ]);
    const hatalar = mevzuatKurallariniUygula({ ozelMatrahKodu: girdi.ozelMatrahKodu, ihracKayitliKodu: girdi.ihracKayitliKodu, satirlar: girdi.satirlar ?? [] }, { tevkifat: tablo, kod }, pasifKodKabul);
    if (hatalar.length) throw new BadRequestException(hatalar.join("; "));
    return tablo;
  }

  /** EBLG-120: satırların KDV dışı vergilerini belge tarihindeki merkezi vergi türleriyle çözer. */
  private async ekVergileriniCoz(girdi: { tip: string; tarih: string | Date; satirlar: { stokId: string; birim?: string | null; ekVergiler?: EkVergiGirdisi[] | null }[] }): Promise<EkVergi[][]> {
    if (!girdi.satirlar.some((s) => s.ekVergiler?.length)) return girdi.satirlar.map(() => []);
    const tarih = typeof girdi.tarih === "string" ? girdi.tarih.slice(0, 10) : girdi.tarih.toISOString().slice(0, 10);
    const { satirlar, hatalar } = ekVergileriCoz(girdi.tip, girdi.satirlar, (await belgeKodTablosu(this.mevzuat, tarih)).vergiTurleri);
    // EBLG-127: konaklama vergili satış KONAKLAMAVERGISI tipiyle gider; belge tek tip taşır, tevkifatla birleşemez.
    if (satirlar.some((l) => l.some((v) => v.kod === KONAKLAMA_VERGISI_KODU)) && girdi.satirlar.some((x) => (x as { tevkifatKodu?: string | null }).tevkifatKodu)) {
      hatalar.push("Konaklama vergili fatura tevkifat taşıyamaz (fatura tipi KONAKLAMAVERGISI); tevkifatlı kalemi ayrı faturaya alın");
    }
    if (hatalar.length) throw new BadRequestException(hatalar.join("; "));
    // EBLG-131: maktu vergi ek birimli satırda ana birime çevrilerek hesaplanır.
    if (satirlar.some((l) => l.some((v) => v.hesap === "birim"))) {
      await this.prisma.tenantIslem(aktifBaglam().tenantId, (tx) => maktuBirimleriniBagla(tx, girdi.satirlar, satirlar));
    }
    return satirlar;
  }

  private async cariTipiniDogrula(tx: Prisma.TransactionClient, cariId: string, tip: string): Promise<void> {
    const cari = await tx.cariHesap.findUnique({ where: { id: cariId }, select: { tip: true } });
    if (!cari) throw new NotFoundException("Cari hesap bulunamadı");
    const alisYonlu = tip === "alis" || tip === "alis_iade";
    const uygun = alisYonlu
      ? cari.tip === "tedarikci" || cari.tip === "her_ikisi"
      : cari.tip === "musteri" || cari.tip === "her_ikisi";
    if (!uygun) {
      throw new BadRequestException(alisYonlu
        ? "Alış faturasında tedarikçi veya her iki tipindeki cari seçilmelidir"
        : "Satış faturasında müşteri veya her iki tipindeki cari seçilmelidir");
    }
  }

  // ─── FATURA SERİ TANIMLARI ────────────────────────────────────────────────

  async seriListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.faturaSeri.findMany({ orderBy: [{ yil: "desc" }, { seri: "asc" }] }),
    );
  }

  async seriEkle(girdi: z.infer<typeof faturaSeriSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.faturaSeri.create({
          data: {
            tenantId,
            seri: girdi.seri,
            yil: girdi.yil,
            sonSira: girdi.sonSira ?? 0,
          },
        }),
      );
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(
          `'${girdi.seri}' serisi ${girdi.yil} yılı için zaten tanımlı`,
        );
      }
      throw hata;
    }
  }

  // ─── TEKRARLAYAN FATURALAR (FTR-10) ─────────────────────────────

  async tekrarlayanListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.tekrarlayanFatura.findMany({
      orderBy: [{ aktif: "desc" }, { sonrakiTarih: "asc" }],
      include: {
        sablonFatura: { select: { id: true, no: true, tip: true, dovizCinsi: true, genelToplam: true, cari: { select: { unvan: true } } } },
        _count: { select: { uretilenler: true } },
      },
    }));
  }

  async tekrarlayanOlustur(girdi: z.infer<typeof tekrarlayanFaturaSemasi>) {
    const { tenantId } = aktifBaglam();
    if (girdi.bitisTarihi && girdi.bitisTarihi < girdi.sonrakiTarih) {
      throw new BadRequestException("Bitiş tarihi ilk üretim tarihinden önce olamaz");
    }
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sablon = await tx.fatura.findUnique({ where: { id: girdi.sablonFaturaId } });
      if (!sablon) throw new NotFoundException("Şablon fatura bulunamadı");
      return tx.tekrarlayanFatura.create({ data: {
        tenantId, ad: girdi.ad, sablonFaturaId: girdi.sablonFaturaId,
        siklik: girdi.siklik, aralik: girdi.aralik,
        sonrakiTarih: new Date(girdi.sonrakiTarih),
        bitisTarihi: girdi.bitisTarihi ? new Date(girdi.bitisTarihi) : null,
        aciklamaSablonu: girdi.aciklamaSablonu ?? null, notSablonu: girdi.notSablonu ?? null,
        faturalananDonem: girdi.faturalananDonem, fiyatKaynagi: girdi.fiyatKaynagi,
      }});
    });
  }

  async tekrarlayanGuncelle(id: string, girdi: z.infer<typeof tekrarlayanFaturaGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const plan = await tx.tekrarlayanFatura.findUnique({ where: { id } });
      if (!plan) throw new NotFoundException("Tekrarlayan fatura planı bulunamadı");
      const sonraki = girdi.sonrakiTarih ? new Date(girdi.sonrakiTarih) : plan.sonrakiTarih;
      const bitis = girdi.bitisTarihi === undefined ? plan.bitisTarihi : girdi.bitisTarihi ? new Date(girdi.bitisTarihi) : null;
      if (bitis && bitis < sonraki) throw new BadRequestException("Bitiş tarihi sıradaki tarihten önce olamaz");
      return tx.tekrarlayanFatura.update({ where: { id }, data: {
        ad: girdi.ad, aktif: girdi.aktif, sonrakiTarih: sonraki, bitisTarihi: bitis,
        aciklamaSablonu: girdi.aciklamaSablonu, notSablonu: girdi.notSablonu, faturalananDonem: girdi.faturalananDonem,
        fiyatKaynagi: girdi.fiyatKaynagi,
      }});
    });
  }

  /**
   * FTR-10/43: vadesi gelen planlardan taslak üretir. `kalanKota` verilirse en
   * çok o kadar fatura açılır; üretilemeyen dönemde plan bekler (sonraki tarih
   * ilerlemez) ve kota açılınca kaldığı yerden devam eder.
   *
   * FTR-45: dövizli taslağa planlanan günün kuru yazılır; kur yoksa plan o
   * dönemde bekler (`kursuzlar`). "Güncel fiyat" planlarında taslak işlem
   * bittikten sonra güncel fiyatla olağan güncelleme yolundan geçirilir;
   * fiyatı bulunamayan satır şablon fiyatıyla kalır (`fiyatUyarilari`).
   */
  async vadesiGelenleriUret(secenek: { kalanKota?: number | null } = {}) {
    const { tenantId } = aktifBaglam();
    const kalanKota = secenek.kalanKota ?? null;
    const bugun = new Date(); bugun.setUTCHours(0, 0, 0, 0);
    const uretim = await this.prisma.tenantIslem(tenantId, async (tx) => {
      // Manuel tetikleme ve zamanlanmış görev aynı anda çalışabilir. Tenant
      // bazlı transaction kilidi, "kontrol et → oluştur" aralığını sıralar;
      // ikinci çağrı ilk transaction'ın ilerlettiği sonraki tarihi görür.
      await tx.$queryRaw(Prisma.sql`
        SELECT 1 AS kilit
        FROM pg_advisory_xact_lock(
          hashtext(CAST(${tenantId} AS text)),
          hashtext('tekrarlayan_fatura_uret')
        )
      `);
      const planlar = await tx.tekrarlayanFatura.findMany({
        where: { aktif: true, sonrakiTarih: { lte: bugun } },
        include: { sablonFatura: { include: { satirlar: true } } },
      });
      const uretilenIds: string[] = [];
      const guncelFiyatlilar: { planId: string; ad: string; faturaId: string }[] = [];
      const kursuzlar: { planId: string; ad: string; dovizCinsi: string; tarih: string }[] = [];
      let kotaDoldu = false;
      for (const plan of planlar) {
        let planUretimAdedi = 0;
        let sonUretimTarihi = plan.sonUretimTarihi;
        let tarih = plan.sonrakiTarih;
        let sayac = 0;
        while (tarih <= bugun && (!plan.bitisTarihi || tarih <= plan.bitisTarihi) && sayac++ < 120) {
          const mevcut = await tx.fatura.findFirst({ where: { tekrarlayanPlanId: plan.id, planlananTarih: tarih } });
          if (!mevcut) {
            if (kalanKota !== null && uretilenIds.length >= kalanKota) { kotaDoldu = true; break; }
            const s = plan.sablonFatura;
            // FTR-45: dövizli belgenin kuru planlanan günden gelir (formdaki alış/satış kuralı).
            const kur = s.dovizCinsi === "TRY" ? s.kur : await kurCoz(tx, tenantId, s.dovizCinsi, tarih, faturaKurTipi(s.tip));
            if (!kur) { kursuzlar.push({ planId: plan.id, ad: plan.ad, dovizCinsi: s.dovizCinsi, tarih: tarih.toISOString().slice(0, 10) }); break; }
            const vadeGun = s.vadeTarihi
              ? Math.round((s.vadeTarihi.getTime() - s.tarih.getTime()) / 86_400_000)
              : null;
            const vadeTarihi = vadeGun === null ? null : new Date(tarih.getTime() + vadeGun * 86_400_000);
            // FTR-44: plan şablonu varsa açıklama/not dönem değişkenleriyle doldurulur.
            const degerler = tekrarDegiskenDegerleri(tarih, plan.siklik, plan.aralik, plan.faturalananDonem);
            const aciklama = plan.aciklamaSablonu ? tekrarMetniDoldur(plan.aciklamaSablonu, degerler) : s.aciklama;
            const notlar = plan.notSablonu ? tekrarMetniDoldur(plan.notSablonu, degerler) : s.notlar;
            const yeni = await tx.fatura.create({ data: {
              tenantId, tip: s.tip, durum: "taslak", tarih, vadeTarihi,
              cariId: s.cariId, depoId: s.depoId, dovizCinsi: s.dovizCinsi, kur,
              teslimatAdres: s.teslimatAdres, teslimatIl: s.teslimatIl, teslimatIlce: s.teslimatIlce, teslimatPostaKodu: s.teslimatPostaKodu,
              genelIskontoYuzdesi: s.genelIskontoYuzdesi, genelIskontoTutari: s.genelIskontoTutari,
              toplamBrut: s.toplamBrut, toplamSatirIskontosu: s.toplamSatirIskontosu,
              genelIskontoToplam: s.genelIskontoToplam, toplamMatrah: s.toplamMatrah,
              toplamKdv: s.toplamKdv, toplamTevkifat: s.toplamTevkifat,
              toplamNetKdv: s.toplamNetKdv, toplamEkVergi: s.toplamEkVergi, toplamStopaj: s.toplamStopaj, genelToplam: s.genelToplam,
              aciklama, notlar, tekrarlayanPlanId: plan.id, planlananTarih: tarih,
            }});
            for (const satir of s.satirlar) {
              const { id: _id, faturaId: _faturaId, kaynakBelgeSatirId: _kaynakBelgeSatirId, ...veri } = satir;
              await tx.faturaSatir.create({ data: { ...veri, partiBilgileri: veri.partiBilgileri === null ? Prisma.JsonNull : veri.partiBilgileri as Prisma.InputJsonValue, ekVergiler: veri.ekVergiler === null ? Prisma.JsonNull : veri.ekVergiler as Prisma.InputJsonValue, id: undefined, faturaId: yeni.id } });
            }
            uretilenIds.push(yeni.id);
            if (plan.fiyatKaynagi === "guncel") guncelFiyatlilar.push({ planId: plan.id, ad: plan.ad, faturaId: yeni.id });
            planUretimAdedi += 1;
            sonUretimTarihi = tarih;
          }
          tarih = sonrakiTekrarTarihi(tarih, plan.siklik, plan.aralik);
        }
        await tx.tekrarlayanFatura.update({ where: { id: plan.id }, data: {
          sonrakiTarih: tarih, sonUretimTarihi: planUretimAdedi ? sonUretimTarihi : plan.sonUretimTarihi,
          aktif: plan.bitisTarihi ? tarih <= plan.bitisTarihi : true,
        }});
      }
      return { uretilenIds, guncelFiyatlilar, kursuzlar, kotaDoldu };
    });
    // Kilit bırakıldıktan sonra: güncelleme kendi işlemini ve doğrulamalarını açar.
    const fiyatUyarilari: { planId: string; ad: string; faturaId: string; sorunlar: string[] }[] = [];
    for (const g of uretim.guncelFiyatlilar) {
      const sorunlar = await this.guncelFiyatlariUygula(g.faturaId);
      if (sorunlar.length) fiyatUyarilari.push({ ...g, sorunlar });
    }
    return { uretilenAdet: uretim.uretilenIds.length, faturaIds: uretim.uretilenIds, kotaDoldu: uretim.kotaDoldu, kursuzlar: uretim.kursuzlar, fiyatUyarilari };
  }

  /**
   * FTR-45: taslağın satırlarına güncel fiyatı uygular; dönen liste şablon
   * fiyatıyla kalan satırların nedenleridir. Hata taslağı bozmaz.
   */
  private async guncelFiyatlariUygula(faturaId: string): Promise<string[]> {
    const { tenantId } = aktifBaglam();
    const sorunlar: string[] = [];
    try {
      const birimFiyatlari = await this.prisma.tenantIslem(tenantId, async (tx) => {
        const f = await tx.fatura.findUniqueOrThrow({ where: { id: faturaId }, include: { satirlar: { include: { stok: { select: { kod: true, ad: true } } } } } });
        const belgeKuru = f.dovizCinsi === "TRY" ? 1 : Number(f.kur);
        const fiyatlar = new Map<string, string>();
        for (const satir of f.satirlar) {
          const etiket = `${satir.stok.kod} ${satir.stok.ad}`;
          const kaynak = await this.stokService.kaynakFiyatBul(tx, { stokId: satir.stokId, varyantId: satir.varyantId, cariId: f.cariId, tip: f.tip });
          if (!kaynak || !(kaynak.birimFiyat > 0)) { sorunlar.push(`${etiket}: güncel fiyat tanımlı değil`); continue; }
          let fiyat = kaynak.birimFiyat;
          if (kaynak.kaynakDoviz !== f.dovizCinsi) {
            const kaynakKuru = kaynak.kaynakDoviz === "TRY" ? 1 : Number(await kurCoz(tx, tenantId, kaynak.kaynakDoviz, f.tarih, faturaKurTipi(f.tip)) ?? 0);
            if (!(kaynakKuru > 0) || !(belgeKuru > 0)) { sorunlar.push(`${etiket}: ${kaynak.kaynakDoviz} fiyatı ${f.dovizCinsi} belgeye çevrilemedi (kur yok)`); continue; }
            fiyat = (fiyat * kaynakKuru) / belgeKuru;
          }
          const yeni = fiyat.toFixed(4);
          if (!D(yeni).equals(satir.birimFiyat)) fiyatlar.set(satir.id, yeni);
        }
        return fiyatlar;
      });
      if (birimFiyatlari.size) await this.guncelle(faturaId, {}, { birimFiyatlari });
    } catch (hata) {
      return [`Güncel fiyat uygulanamadı, taslak şablon fiyatlarıyla kaldı: ${hata instanceof Error ? hata.message : String(hata)}`];
    }
    return sorunlar;
  }

  // ─── FATURA CRUD İŞLEMLERİ ───────────────────────────────────────────────

  async listele(
    arama?: string,
    tip?: string,
    durum?: string,
    imlec?: string,
    adet = 50,
    yon?: string,
    ebelge?: string,
    cariId?: string,
    baslangic?: string,
    bitis?: string,
    ihracKayitliAcik = false,
  ) {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();
    const aranan = arama ? metinNormalize(arama) : "";

    const tarihKosulu: Prisma.DateTimeFilter | undefined = (baslangic || bitis) ? {
      ...(baslangic ? { gte: new Date(`${baslangic}T00:00:00.000Z`) } : {}),
      ...(bitis ? { lte: new Date(`${bitis}T23:59:59.999Z`) } : {}),
    } : undefined;

    const where: Prisma.FaturaWhereInput = {
      ...(cariId ? { cariId } : {}),
      ...(tarihKosulu ? { tarih: tarihKosulu } : {}),
      ...(tip ? { tip: tip as FaturaTip } : yon === "satis" ? { tip: { in: ["satis", "satis_iade", "proforma"] } } : yon === "alis" ? { tip: { in: ["alis", "alis_iade"] } } : {}),
      ...(durum ? { durum: durum as FaturaDurum } : {}),
      ...(ebelge ? { ebelge: { is: { durum: ebelge === "hata" ? { in: ["hata", "ret"] } : ebelge as BelgeDurum } } } : {}),
      // EBLG-63: ihracatçıdan çıkış beyannamesi gelmemiş ihraç kayıtlı satışlar.
      ...(ihracKayitliAcik ? { ihracKayitliKodu: { not: null }, durum: "kesin" as FaturaDurum, gumrukBeyannameNo: null } : {}),
      ...(aranan
        ? {
            // ARA-01: fatura numarası ve carinin unvan/kod/VKN bilgisi kendi
            // `arama_normal` kolonlarında aksansız tutulur.
            OR: [
              { aramaNormal: { contains: aranan } },
              { cari: { aramaNormal: { contains: aranan } } },
              // FTR-31: müşterinin talep ve sipariş numarasıyla da bulunur.
              { siparisNo: { contains: arama, mode: "insensitive" } },
              { talepNo: { contains: arama, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.findMany({
        where,
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: adet + 1,
        ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
        include: {
          cari: { select: { id: true, kod: true, unvan: true } },
          // Alıcının kabul/ret kararı zarf durumundan ayrı bir eksendir
          // (EBLG-13); listede ikisi birlikte gösterilir.
          ebelge: { select: { id: true, durum: true, tur: true, entegratorRef: true, updatedAt: true, aliciYaniti: true, aliciYanitZamani: true, aliciYanitNotu: true } },
          ...FATURA_ODEME_SECIMI,
          satirlar: {
            include: {
              stok: { select: { id: true, kod: true, ad: true } },
              proje: { select: { id: true, kod: true, ad: true } },
              projeAltKirilim: { select: { id: true, kod: true, ad: true } },
            },
          },
        },
      }),
    );

    const sonrakiImlec = kayitlar.length > adet ? kayitlar[adet - 1].id : null;
    const sayfa = kayitlar.slice(0, adet);

    return {
      kayitlar: sayfa.map((k) => {
        return {
          ...this.gorunum(k),
          cari: k.cari,
          ebelge: k.ebelge && { ...k.ebelge, takiliGonderim: takiliRezervasyonMu(k.ebelge) },
          odemeOzeti: odemeOzetiGorunumu(faturaOdemeDurumu(k)),
          izinliEylemler: this.eylemler(k, ctx.rol),
        };
      }),
      sonrakiImlec,
    };
  }

  async isKuyruguOzeti() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [taslakSatis, taslakAlis, ebelgeHata, acik] = await Promise.all([
        tx.fatura.count({ where: { durum: "taslak", tip: { in: ["satis", "satis_iade", "proforma"] } } }),
        tx.fatura.count({ where: { durum: "taslak", tip: { in: ["alis", "alis_iade"] } } }),
        tx.ebelgeKayit.count({ where: { durum: { in: ["hata", "ret"] } } }),
        acikFaturaOzeti(tx, tenantId, ["satis", "alis_iade", "alis", "satis_iade"]),
      ]);
      const adet = (...tipler: string[]) => tipler.reduce((t, tip) => t + (acik.get(tip)?.adet ?? 0), 0);
      return { taslakSatis, taslakAlis, ebelgeHata, acikTahsilat: adet("satis", "alis_iade"), acikOdeme: adet("alis", "satis_iade") };
    });
  }

  async satisOzeti() {
    const { tenantId } = aktifBaglam();
    const simdi = new Date();
    const buAyBaslangic = new Date(simdi.getFullYear(), simdi.getMonth(), 1);
    const oncekiAyBaslangic = new Date(simdi.getFullYear(), simdi.getMonth() - 1, 1);
    const yilBaslangic = new Date(simdi.getFullYear(), 0, 1);
    const [donemFaturalari, acikFaturalar] = await this.prisma.tenantIslem(tenantId, async (tx) => Promise.all([
      tx.fatura.findMany({
        where: { durum: "kesin", tip: { in: ["satis", "satis_iade"] }, tarih: { gte: oncekiAyBaslangic } },
        select: { tip: true, tarih: true, genelToplam: true, toplamNetKdv: true, kur: true },
      }),
      acikFaturaOzeti(tx, tenantId, ["satis"]),
    ]));

    let buAyToplam = D(0); let buAyKdv = D(0); let buAyAdet = 0; let oncekiAyToplam = D(0);
    for (const fatura of donemFaturalari) {
      const isaret = fatura.tip === "satis_iade" ? D(-1) : D(1);
      const toplamTry = fatura.genelToplam.mul(fatura.kur).mul(isaret);
      if (fatura.tarih >= buAyBaslangic) {
        buAyToplam = buAyToplam.add(toplamTry);
        buAyKdv = buAyKdv.add(fatura.toplamNetKdv.mul(fatura.kur).mul(isaret));
        if (fatura.tip === "satis") buAyAdet += 1;
      } else {
        oncekiAyToplam = oncekiAyToplam.add(toplamTry);
      }
    }

    const yilFaturalari = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findMany({
      where: { durum: "kesin", tip: { in: ["satis", "satis_iade"] }, tarih: { gte: yilBaslangic } },
      select: { tip: true, genelToplam: true, kur: true },
    }));
    const yillikToplam = yilFaturalari.reduce((toplam, fatura) => toplam.add(fatura.genelToplam.mul(fatura.kur).mul(fatura.tip === "satis_iade" ? -1 : 1)), D(0));
    const acikTahsilat = acikFaturalar.get("satis")?.kalanTry ?? D(0);
    const degisimYuzdesi = oncekiAyToplam.isZero() ? null : buAyToplam.sub(oncekiAyToplam).div(oncekiAyToplam.abs()).mul(100).toDecimalPlaces(1).toNumber();

    return { buAyToplam: buAyToplam.toFixed(2), buAyAdet, buAyKdv: buAyKdv.toFixed(2), yillikToplam: yillikToplam.toFixed(2), acikTahsilat: acikTahsilat.toFixed(2), oncekiAyaGoreDegisim: degisimYuzdesi };
  }

  async alisOzeti() {
    const { tenantId } = aktifBaglam();
    const simdi = new Date();
    const buAyBaslangic = new Date(simdi.getFullYear(), simdi.getMonth(), 1);
    const oncekiAyBaslangic = new Date(simdi.getFullYear(), simdi.getMonth() - 1, 1);
    const yilBaslangic = new Date(simdi.getFullYear(), 0, 1);
    const [donemFaturalari, yilFaturalari, acikFaturalar] = await this.prisma.tenantIslem(tenantId, async (tx) => Promise.all([
      tx.fatura.findMany({ where: { durum: "kesin", tip: { in: ["alis", "alis_iade"] }, tarih: { gte: oncekiAyBaslangic } }, select: { tip: true, tarih: true, genelToplam: true, toplamNetKdv: true, kur: true } }),
      tx.fatura.findMany({ where: { durum: "kesin", tip: { in: ["alis", "alis_iade"] }, tarih: { gte: yilBaslangic } }, select: { tip: true, genelToplam: true, kur: true } }),
      acikFaturaOzeti(tx, tenantId, ["alis"]),
    ]));

    let buAyToplam = D(0); let buAyKdv = D(0); let buAyAdet = 0; let oncekiAyToplam = D(0);
    for (const fatura of donemFaturalari) {
      const isaret = fatura.tip === "alis_iade" ? D(-1) : D(1);
      const toplamTry = fatura.genelToplam.mul(fatura.kur).mul(isaret);
      if (fatura.tarih >= buAyBaslangic) {
        buAyToplam = buAyToplam.add(toplamTry);
        buAyKdv = buAyKdv.add(fatura.toplamNetKdv.mul(fatura.kur).mul(isaret));
        if (fatura.tip === "alis") buAyAdet += 1;
      } else oncekiAyToplam = oncekiAyToplam.add(toplamTry);
    }
    const yillikToplam = yilFaturalari.reduce((toplam, fatura) => toplam.add(fatura.genelToplam.mul(fatura.kur).mul(fatura.tip === "alis_iade" ? -1 : 1)), D(0));
    const acikOdeme = acikFaturalar.get("alis")?.kalanTry ?? D(0);
    const degisimYuzdesi = oncekiAyToplam.isZero() ? null : buAyToplam.sub(oncekiAyToplam).div(oncekiAyToplam.abs()).mul(100).toDecimalPlaces(1).toNumber();
    return { buAyToplam: buAyToplam.toFixed(2), buAyAdet, buAyKdv: buAyKdv.toFixed(2), yillikToplam: yillikToplam.toFixed(2), acikOdeme: acikOdeme.toFixed(2), oncekiAyaGoreDegisim: degisimYuzdesi };
  }

  /** EBLG-35: faturanın, e-Belgesinin ve alıcı yanıtının durum geçmişi. */
  async durumGecmisi(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({ where: { id }, select: { id: true } });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      return durumGecmisiOku(tx, { faturaId: id });
    });
  }

  async getir(id: string) {
    const ctx = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.fatura.findUnique({
        where: { id },
        include: {
          cari: { select: { id: true, kod: true, unvan: true, vknTckn: true, eFaturaMukellefi: true } },
          satirlar: {
            include: {
              stok: { select: { id: true, kod: true, ad: true } },
              varyant: { select: { id: true, kod: true, ad: true, nitelikler: true } },
              proje: { select: { id: true, kod: true, ad: true } },
              projeAltKirilim: { select: { id: true, kod: true, ad: true } },
            },
          },
          ebelge: true,
          // Gelen e-Faturadan oluşan alış faturası; orijinal görünüm buradan açılır.
          gelenEbelge: { select: { id: true, belgeNo: true } },
          kasaBankaHarekets: {
            orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
            include: {
              kasa: { select: { ad: true } },
              bankaHesap: { select: { ad: true } },
            },
          },
          krediKartiHareketleri: {
            orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
            include: { krediKarti: { select: { ad: true } } },
          },
          // KSB-16: faturayı kapatan bütün kayıtlar (elle ve vadeye göre otomatik).
          kapamalar: {
            orderBy: { createdAt: "asc" },
            include: {
              kasaBankaHareket: { select: { id: true, tip: true, tarih: true, aciklama: true, makbuzNo: true } },
              krediKartiHareket: { select: { id: true, tarih: true, aciklama: true } },
              cekSenet: { select: { id: true, tur: true, portfoyNo: true, islemTarihi: true } },
              iadeFatura: { select: { id: true, no: true, tarih: true } },
              mahsup: { select: { id: true, tarih: true, otomatik: true } },
              cariHareket: { select: { id: true, tarih: true, kaynakTur: true } },
            },
          },
          iadeKapamalari: { include: { fatura: { select: { id: true, no: true, tarih: true } } } },
        },
      }),
    );

    if (!kayit) throw new NotFoundException("Fatura bulunamadı");

    const odemeDurumu = faturaOdemeDurumu(kayit);
    // FTR-30: bağlı irsaliyelerin teslim yerleri farklıysa ekranda söylenir.
    const teslimUyarisi = await this.prisma.tenantIslem(ctx.tenantId, (tx) => teslimYeriUyarisi(tx, kayit));

    return {
      ...this.gorunum(kayit),
      teslimYeriUyarisi: teslimUyarisi,
      gelenEbelge: kayit.gelenEbelge,
      cari: kayit.cari,
      satirlar: kayit.satirlar.map((s) => ({
        id: s.id,
        stokId: s.stokId,
        varyantId: s.varyantId,
        varyant: s.varyant,
        partiBilgileri: s.partiBilgileri,
        stokKod: s.stok.kod,
        stokAd: s.stok.ad,
        // Varyantlı satırın belgede görünen kodu/adı/nitelikleri (PDF, liste).
        satirKod: varyantliKod(s.stok.kod, s.varyant),
        satirAd: varyantliAd(s.stok.ad, s.varyant),
        satirAciklama: varyantAciklamasi(s.varyant),
        miktar: s.miktar.toFixed(3),
        birim: s.birim,
        birimFiyat: s.birimFiyat.toFixed(4),
        iskontoOrani: s.iskontoOrani.toFixed(2),
        iskontoTutari: s.iskontoTutari.toFixed(2),
        genelIskontoPayi: s.genelIskontoPayi.toFixed(2),
        matrah: s.matrah.toFixed(2),
        kdvOrani: s.kdvOrani.toFixed(2),
        kdvTutari: s.kdvTutari.toFixed(2),
        tevkifatKodu: s.tevkifatKodu,
        tevkifatOrani: s.tevkifatPay && s.tevkifatPayda ? `${s.tevkifatPay}/${s.tevkifatPayda}` : null,
        tevkifatPay: s.tevkifatPay,
        tevkifatPayda: s.tevkifatPayda,
        tevkifatTutari: s.tevkifatTutari.toFixed(2),
        netKdvTutari: s.netKdvTutari.toFixed(2),
        // EBLG-120: KDV dışı vergiler (salt okunur; taslak düzenlenirken aynen geri gönderilir).
        ekVergiler: (s.ekVergiler as EkVergi[] | null) ?? [],
        ekVergiTutari: s.ekVergiTutari.toFixed(2),
        stopajTutari: s.stopajTutari.toFixed(2),
        toplamTutar: s.toplamTutar.toFixed(2),
        gibIstisnaKodu: s.gibIstisnaKodu,
        idisEtiketNo: s.idisEtiketNo,
        // EBLG-78: yatırım teşvik harcama tipi ve makine kimlikleri.
        ytbHarcamaTipi: s.ytbHarcamaTipi ?? null,
        ytbMakineAdi: s.ytbMakineAdi ?? null,
        ytbMakineId: s.ytbMakineId ?? null,
        ytbMakineSiraNo: s.ytbMakineSiraNo ?? null,
        sarjUniteSeriNo: s.sarjUniteSeriNo,
        // EBLG-102: ihracat kap bilgisi (proforma ve kendi çıktımız da basar).
        ihracatKapCinsi: s.ihracatKapCinsi ?? null,
        ihracatKapNo: s.ihracatKapNo ?? null,
        ihracatKapAdet: s.ihracatKapAdet ?? null,
      })),
      ebelge: kayit.ebelge && { ...kayit.ebelge, takiliGonderim: takiliRezervasyonMu(kayit.ebelge) },
      odemeOzeti: {
        ...odemeOzetiGorunumu(odemeDurumu),
        hareketler: [...kayit.kasaBankaHarekets.map((hareket) => ({
          id: hareket.id,
          tip: hareket.tip,
          tutar: hareket.tutar.toFixed(2),
          tutarTry: hareket.tutarTry.toFixed(2),
          dovizCinsi: hareket.dovizCinsi,
          // KSB-07: faturaya düşen kısım (fatura dövizinde) ve artan avans.
          mahsup: (hareket.faturaMahsubu ?? D(0)).toFixed(2),
          avans: (hareket.faturaKarsiligi ?? D(0)).sub(hareket.faturaMahsubu ?? 0).toFixed(2),
          // Bilgi: ödeme günü TL değeri ile mahsubun fatura kurundaki TL değeri farkı.
          kurFarkiTry: kurFarkiTry(hareket, kayit.kur),
          tarih: hareket.tarih.toISOString().slice(0, 10),
          aciklama: hareket.aciklama,
          hesap: hareket.kasa?.ad ?? hareket.bankaHesap?.ad ?? "Hesap belirtilmedi",
          createdAt: hareket.createdAt.toISOString(),
        })), ...kayit.krediKartiHareketleri.map((hareket) => ({ id: hareket.id, tip: "kredi_karti", tutar: (hareket.cariOdemeTutari ?? D(0)).toFixed(2), dovizCinsi: kayit.dovizCinsi, mahsup: (hareket.faturaMahsubu ?? D(0)).toFixed(2), avans: (hareket.cariOdemeTutari ?? D(0)).sub(hareket.faturaMahsubu ?? 0).toFixed(2), kurFarkiTry: "0.00", tarih: hareket.tarih.toISOString().slice(0, 10), aciklama: hareket.aciklama, hesap: hareket.krediKarti.ad, createdAt: hareket.createdAt.toISOString() }))],
        kapamalar: [
          ...kayit.kapamalar.map((k) => ({ id: k.id, tutar: k.tutar.toFixed(2), otomatik: k.otomatik, ...kapamaKaynagi(k) })),
          // İade faturasında: bu iadenin kapattığı faturalar.
          ...kayit.iadeKapamalari.map((k) => ({ id: k.id, tutar: k.tutar.toFixed(2), otomatik: k.otomatik, kaynakTur: "kapatilan_fatura" as const, kaynakId: k.fatura.id, tarih: k.fatura.tarih.toISOString().slice(0, 10), etiket: k.fatura.no ?? "Fatura" })),
        ],
      },
      izinliEylemler: this.eylemler(kayit, ctx.rol),
    };
  }

  /** `gelenBelge`: karşı tarafın gelen e-Faturasının kaydı; cari blokajı denetlenmez (CARI-32). */
  async olustur(girdi: z.infer<typeof faturaOlusturSemasi>, secenekler: { gelenBelge?: boolean } = {}) {
    const { tenantId, userId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "fatura oluşturma");

    // FTR-14: satıcı kullanıcı bazında maksimum iskonto yetkisi kontrolü
    const user = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (user && user.maksIskontoYuzdesi !== null) {
      const maks = Number(user.maksIskontoYuzdesi);
      if (Number(girdi.genelIskontoYuzdesi ?? 0) > maks) {
        throw new BadRequestException(
          `Maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
        );
      }
      for (const [index, s] of girdi.satirlar.entries()) {
        if (Number(s.iskontoOrani ?? 0) > maks) {
          throw new BadRequestException(
            `Satır ${index + 1} için maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
          );
        }
      }
    }

    // Fatura hesaplamalarını shared engine üzerinden yapalım (FTR-04)
    const tevkifatTablosu = await this.tevkifatTablosuIleDogrula(girdi, Boolean(secenekler.gelenBelge));
    const ekVergiler = await this.ekVergileriniCoz(girdi);
    const hesaplanan = this.hesaplaFatura(girdi, tevkifatTablosu, ekVergiler);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.cariTipiniDogrula(tx, girdi.cariId, girdi.tip);
      if (!secenekler.gelenBelge) await cariIslemDenetle(tx, girdi.cariId, "fatura", "yeni");
      await satirBirimleriniDogrula(tx, girdi.satirlar);
      await satirVaryantlariniDogrula(tx, girdi.satirlar);

      const cari = await tx.cariHesap.findUnique({
        where: { id: girdi.cariId },
        select: { varsayilanVadeGun: true, efaturaProfili: true, earsivGonderimSekli: true, vknTckn: true, belgeDili: true, belgeCiftDil: true },
      });

      let hesaplananVadeTarihi: Date;
      if (girdi.vadeTarihi) {
        hesaplananVadeTarihi = new Date(girdi.vadeTarihi);
      } else if (cari?.varsayilanVadeGun && cari.varsayilanVadeGun > 0) {
        const d = new Date(girdi.tarih);
        d.setDate(d.getDate() + cari.varsayilanVadeGun);
        hesaplananVadeTarihi = d;
      } else {
        hesaplananVadeTarihi = new Date(girdi.tarih);
      }

      // EBLG-71: şarj faturasının tipi satırdaki stok kartından türer; kartlar
      // yalnız bu yüzden okunur.
      const sarjKartlari = await tx.stokKart.findMany({
        where: { id: { in: [...new Set(girdi.satirlar.map((satir) => satir.stokId))] } },
        select: { id: true, sarjTuru: true },
      });
      const sarjTuru = sarjTuruCoz(girdi.satirlar.map((satir) => ({
        sarjTuru: sarjKartlari.find((kart) => kart.id === satir.stokId)?.sarjTuru,
      })));
      if (sarjTuru.karisik) {
        throw new BadRequestException("Şarj hizmeti ve şarj ünitesi satırları aynı faturada olamaz; belgenin tek bir tipi olmalıdır");
      }

      if (girdi.teslimatAdresiniCariyeKaydet) await teslimYeriniCariyeKaydet(tx, tenantId, girdi.cariId, girdi);

      // Fatura kafasını oluştur
      const fatura = await tx.fatura.create({
        data: {
          tenantId,
          tip: girdi.tip,
          gelirTuru: girdi.gelirTuru ?? "ticari_satis",
          // Senaryo satırlardan türetilir, kullanıcı seçmez (FTR-16); profilin
          // varsayılanı cari kartından gelir (FTR-19).
          senaryo: faturaSenaryosuTuret(girdi.tip, girdi.satirlar.map((s) => ({
            ekVergiKodlari: (s.ekVergiler ?? []).map((v) => v.kod),
            kdvOrani: Number(s.kdvOrani),
            tevkifatKodu: s.tevkifatKodu,
            gibIstisnaKodu: s.gibIstisnaKodu,
          })), girdi.ihracKayitliKodu, girdi.ozelMatrahKodu, sgkFaturasiMi(cari?.vknTckn), sarjTuru.turu),
          // EBLG-60: ihraç kayıtlıda KDV hesaplanır ama tahsil edilmez.
          ihracKayitliKodu: girdi.ihracKayitliKodu ?? null,
          // İDİS (EBLG-72): sevkiyat no doluysa belge IDIS profiliyle gider.
          idisSevkiyatNo: girdi.idisSevkiyatNo ? idisNormalize(girdi.idisSevkiyatNo) : null,
          // EBLG-78: numara doluysa belge YATIRIMTESVIK profiliyle gider.
          ytbNo: girdi.ytbNo?.trim() || null,
          ytbTarihi: girdi.ytbTarihi ? new Date(girdi.ytbTarihi) : null,
          // Özel matrah: KDV satış bedeline dahildir, belge düzeyinde bildirilir.
          ozelMatrahKodu: girdi.ozelMatrahKodu ?? null,
          ozelMatrahTutari: girdi.ozelMatrahKodu ? D(girdi.ozelMatrahTutari ?? "0") : null,
          ozelMatrahOrani: girdi.ozelMatrahKodu ? D(girdi.ozelMatrahOrani ?? "0") : null,
          efaturaProfili: girdi.efaturaProfili ?? cari?.efaturaProfili ?? "temel",
          earsivGonderimSekli: girdi.earsivGonderimSekli ?? cari?.earsivGonderimSekli ?? "elektronik",
          ihracatTeslimSarti: girdi.ihracatTeslimSarti || null,
          ihracatTasimaSekli: girdi.ihracatTasimaSekli || null,
          // FTR-40: dil verilmezse cari kartındaki dil.
          belgeDili: girdi.belgeDili ?? belgeDiliNormalize(cari?.belgeDili),
          ciftDil: ciftDilGecerli(girdi.belgeDili ?? belgeDiliNormalize(cari?.belgeDili), girdi.ciftDil ?? (girdi.belgeDili === undefined ? cari?.belgeCiftDil : false)),
          durum: "taslak",
          no: girdi.no ?? null,
          tarih: new Date(girdi.tarih),
          vadeTarihi: hesaplananVadeTarihi,
          siparisNo: girdi.siparisNo || null,
          siparisTarihi: girdi.siparisTarihi ? new Date(girdi.siparisTarihi) : null,
          talepNo: girdi.talepNo || null,
          talepTarihi: girdi.talepTarihi ? new Date(girdi.talepTarihi) : null,
          ...ilgiliKisiTemizle(girdi),
          cariId: girdi.cariId,
          // STK-07: boş bırakılırsa depo kesinleştirmede varsayılana çözülür
          depoId: girdi.depoId ?? null,
          ...teslimYeriVerisi(girdi),
          dovizCinsi: girdi.dovizCinsi,
          kur: D(girdi.kur),
          genelIskontoYuzdesi: D(girdi.genelIskontoYuzdesi),
          genelIskontoTutari: D(girdi.genelIskontoTutari),
          toplamBrut: D(hesaplanan.toplamBrut),
          toplamSatirIskontosu: D(hesaplanan.toplamSatirIskontosu),
          genelIskontoToplam: D(hesaplanan.genelIskontoTutari),
          toplamMatrah: D(hesaplanan.toplamMatrah),
          toplamKdv: D(hesaplanan.toplamKdv),
          toplamTevkifat: D(hesaplanan.toplamTevkifat),
          toplamNetKdv: D(hesaplanan.toplamNetKdv),
          toplamEkVergi: D(hesaplanan.toplamEkVergi),
          toplamStopaj: D(hesaplanan.toplamStopaj),
          genelToplam: D(hesaplanan.genelToplam),
          aciklama: girdi.aciklama,
          notlar: girdi.notlar,
        },
      });

      // Satırları oluştur (sıralı await: async forEach transaction
      // kapandıktan sonra çalışıp P2028 ile süreci düşürüyordu)
      for (const [index, s] of hesaplanan.satirlar.entries()) {
        const orijinalSatir = girdi.satirlar[index];
        await this.stokService.varyantDogrula(tx, s.stokId, orijinalSatir.varyantId);
        await tx.faturaSatir.create({
          data: {
            tenantId,
            faturaId: fatura.id,
            stokId: s.stokId,
            varyantId: orijinalSatir.varyantId,
            partiBilgileri: orijinalSatir.partiBilgileri,
            miktar: D(s.miktar),
            birim: orijinalSatir.birim ?? "adet",
            birimFiyat: D(s.birimFiyat),
            iskontoOrani: D(s.iskontoOrani),
            iskontoTutari: D(s.iskontoTutari),
            genelIskontoPayi: D(s.genelIskontoPayi),
            matrah: D(s.matrah),
            kdvOrani: D(s.kdvOrani),
            kdvTutari: D(s.kdvTutari),
            tevkifatKodu: orijinalSatir.tevkifatKodu,
            tevkifatPay: s.tevkifatPay,
            tevkifatPayda: s.tevkifatPayda,
            tevkifatTutari: D(s.tevkifatTutari),
            netKdvTutari: D(s.netKdvTutari),
            // EBLG-120: KDV dışı vergiler (davranış merkezden çözüldü).
            ekVergiler: ekVergiler[index].length ? (saklanacakEkVergiler(ekVergiler[index], s) as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
            ekVergiTutari: D(s.ekVergiTutari),
            stopajTutari: D(s.stopajTutari),
            toplamTutar: D(s.toplamTutar),
            gibIstisnaKodu: orijinalSatir.gibIstisnaKodu,
            // İDİS etiket no ve şarj ünitesi seri no satır alanlarıdır
            // (EBLG-71/72); biçim denetimi gönderimde yapılır.
            idisEtiketNo: orijinalSatir.idisEtiketNo ? idisNormalize(orijinalSatir.idisEtiketNo) : null,
            sarjUniteSeriNo: orijinalSatir.sarjUniteSeriNo?.trim() || null,
            // EBLG-78: yatırım teşvik harcama tipi ve makine kimlikleri.
            ytbHarcamaTipi: orijinalSatir.ytbHarcamaTipi?.trim() || null,
            ytbMakineAdi: orijinalSatir.ytbMakineAdi?.trim() || null,
            ytbMakineId: orijinalSatir.ytbMakineId?.trim() || null,
            ytbMakineSiraNo: orijinalSatir.ytbMakineSiraNo?.trim() || null,
            projeId: orijinalSatir.projeId,
            projeAltKirilimId: orijinalSatir.projeAltKirilimId,
          },
        });
      }

      return this.gorunum(fatura);
    });
  }

  /**
   * `ic.birimFiyatlari` yalnız sunucu içi kullanım içindir (FTR-45): saklı
   * satırlar korunur, verilen satır kimliklerinin birim fiyatı değişir ve
   * belge olağan güncelleme yolundan yeniden hesaplanır.
   */
  async guncelle(id: string, girdi: z.infer<typeof faturaGuncelleSemasi>, ic: { birimFiyatlari?: ReadonlyMap<string, string> } = {}) {
    const { tenantId, userId } = aktifBaglam();
    const fatura = await this.getir(id);
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih ?? fatura.tarih, "fatura güncelleme");

    // FTR-29: kesin fatura yerinde düzenlenmez; gönderilmemişse önce taslağa
    // geri alınır (stok ve cari ters kayıtla düzelir), taslakta düzenlenir.
    if (fatura.durum !== "taslak" || fatura.ebelge) {
      throw new BadRequestException(
        fatura.durum === "kesin" && !faturaGeriAlmaEngeli(fatura)
          ? "Kesinleşmiş fatura düzenlenmez; önce taslağa geri alın"
          : "Yalnızca e-Belgesi gönderilmemiş taslak faturalar güncellenebilir",
      );
    }

    // Tam güncelleme için girdiyi tamamla
    const birlesikGirdi = {
      tip: girdi.tip ?? (fatura.tip as z.infer<typeof faturaOlusturSemasi>["tip"]),
      no: girdi.no !== undefined ? girdi.no : fatura.no,
      tarih: girdi.tarih ?? fatura.tarih,
      vadeTarihi: girdi.vadeTarihi !== undefined ? girdi.vadeTarihi : fatura.vadeTarihi,
      siparisNo: girdi.siparisNo !== undefined ? girdi.siparisNo : fatura.siparisNo,
      siparisTarihi: girdi.siparisTarihi !== undefined ? (girdi.siparisTarihi ? new Date(girdi.siparisTarihi) : null) : fatura.siparisTarihi,
      talepNo: girdi.talepNo !== undefined ? girdi.talepNo : fatura.talepNo,
      talepTarihi: girdi.talepTarihi !== undefined ? (girdi.talepTarihi ? new Date(girdi.talepTarihi) : null) : fatura.talepTarihi,
      ilgiliKisi: girdi.ilgiliKisi !== undefined ? girdi.ilgiliKisi : fatura.ilgiliKisi,
      ilgiliKisiGorevi: girdi.ilgiliKisiGorevi !== undefined ? girdi.ilgiliKisiGorevi : fatura.ilgiliKisiGorevi,
      cariId: girdi.cariId ?? fatura.cariId,
      efaturaProfili: girdi.efaturaProfili ?? (fatura.efaturaProfili as "temel" | "ticari"),
      earsivGonderimSekli: girdi.earsivGonderimSekli ?? (fatura.earsivGonderimSekli as "elektronik" | "kagit"),
      belgeDili: girdi.belgeDili ?? belgeDiliNormalize(fatura.belgeDili),
      ihracatTeslimSarti: girdi.ihracatTeslimSarti !== undefined ? girdi.ihracatTeslimSarti : fatura.ihracatTeslimSarti,
      ihracatTasimaSekli: girdi.ihracatTasimaSekli !== undefined ? girdi.ihracatTasimaSekli : fatura.ihracatTasimaSekli,
      ciftDil: girdi.ciftDil ?? fatura.ciftDil ?? false,
      ihracKayitliKodu: girdi.ihracKayitliKodu !== undefined ? girdi.ihracKayitliKodu : fatura.ihracKayitliKodu,
      idisSevkiyatNo: girdi.idisSevkiyatNo !== undefined ? girdi.idisSevkiyatNo : fatura.idisSevkiyatNo,
      ytbNo: girdi.ytbNo !== undefined ? girdi.ytbNo : fatura.ytbNo,
      ytbTarihi: girdi.ytbTarihi !== undefined ? girdi.ytbTarihi : fatura.ytbTarihi ?? null,
      ozelMatrahKodu: girdi.ozelMatrahKodu !== undefined ? girdi.ozelMatrahKodu : fatura.ozelMatrahKodu,
      ozelMatrahTutari: girdi.ozelMatrahTutari !== undefined ? girdi.ozelMatrahTutari : fatura.ozelMatrahTutari?.toString(),
      ozelMatrahOrani: girdi.ozelMatrahOrani !== undefined ? girdi.ozelMatrahOrani : fatura.ozelMatrahOrani?.toString(),
      depoId: girdi.depoId !== undefined ? girdi.depoId : fatura.depoId,
      teslimatAdres: girdi.teslimatAdres !== undefined ? girdi.teslimatAdres : fatura.teslimatAdres,
      teslimatIl: girdi.teslimatIl !== undefined ? girdi.teslimatIl : fatura.teslimatIl,
      teslimatIlce: girdi.teslimatIlce !== undefined ? girdi.teslimatIlce : fatura.teslimatIlce,
      teslimatPostaKodu: girdi.teslimatPostaKodu !== undefined ? girdi.teslimatPostaKodu : fatura.teslimatPostaKodu,
      dovizCinsi: girdi.dovizCinsi ?? (fatura.dovizCinsi as DovizKodu),
      kur: girdi.kur ?? fatura.kur,
      genelIskontoYuzdesi: girdi.genelIskontoYuzdesi ?? fatura.genelIskontoYuzdesi,
      genelIskontoTutari: girdi.genelIskontoTutari ?? fatura.genelIskontoTutari,
      aciklama: girdi.aciklama !== undefined ? girdi.aciklama : fatura.aciklama,
      notlar: girdi.notlar !== undefined ? girdi.notlar : fatura.notlar,
      satirlar:
        girdi.satirlar ??
        fatura.satirlar.map((s) => ({
          stokId: s.stokId,
          varyantId: s.varyantId,
          partiBilgileri: s.partiBilgileri as z.infer<typeof faturaOlusturSemasi>["satirlar"][number]["partiBilgileri"],
          miktar: s.miktar,
          birim: s.birim,
          birimFiyat: ic.birimFiyatlari?.get(s.id) ?? s.birimFiyat,
          iskontoOrani: s.iskontoOrani,
          kdvOrani: s.kdvOrani,
          tevkifatKodu: s.tevkifatKodu,
          tevkifatPay: s.tevkifatPay,
          tevkifatPayda: s.tevkifatPayda,
          gibIstisnaKodu: s.gibIstisnaKodu,
          idisEtiketNo: s.idisEtiketNo,
          sarjUniteSeriNo: s.sarjUniteSeriNo,
          ytbHarcamaTipi: s.ytbHarcamaTipi,
          ytbMakineAdi: s.ytbMakineAdi,
          ytbMakineId: s.ytbMakineId,
          ytbMakineSiraNo: s.ytbMakineSiraNo,
          projeId: (s as any).projeId ?? undefined,
          projeAltKirilimId: (s as any).projeAltKirilimId ?? undefined,
          ekVergiler: sakliEkVergiler(s.ekVergiler),
        })),
    };

    // FTR-14: satıcı kullanıcı bazında maksimum iskonto yetkisi kontrolü
    const user = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (user && user.maksIskontoYuzdesi !== null) {
      const maks = Number(user.maksIskontoYuzdesi);
      if (Number(birlesikGirdi.genelIskontoYuzdesi ?? 0) > maks) {
        throw new BadRequestException(
          `Maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
        );
      }
      for (const [index, s] of birlesikGirdi.satirlar.entries()) {
        if (Number(s.iskontoOrani ?? 0) > maks) {
          throw new BadRequestException(
            `Satır ${index + 1} için maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
          );
        }
      }
    }

    // MVZ-03: taslak her kaydedişte kendi tarihindeki merkezi tevkifat oranıyla hesaplanır.
    const tevkifatTablosu = await this.tevkifatTablosuIleDogrula(birlesikGirdi, Boolean(fatura.gelenEbelge));
    const ekVergiler = await this.ekVergileriniCoz(birlesikGirdi);
    const hesaplanan = this.hesaplaFatura(birlesikGirdi, tevkifatTablosu, ekVergiler);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.cariTipiniDogrula(tx, birlesikGirdi.cariId, birlesikGirdi.tip);
      // CARI-32: taslak da kara listede düzenlenmez; cari değişiyorsa pasif de olmamalı.
      await cariIslemDenetle(tx, birlesikGirdi.cariId, "fatura", birlesikGirdi.cariId === fatura.cariId ? "mevcut" : "yeni");
      // Satırları sil ve yeniden ekle
      await tx.faturaSatir.deleteMany({ where: { faturaId: id } });

      // Sıralı await (async forEach P2028 hatası — olustur ile aynı düzeltme)
      for (const [index, s] of hesaplanan.satirlar.entries()) {
        const orijinalSatir = birlesikGirdi.satirlar[index];
        await this.stokService.varyantDogrula(tx, s.stokId, orijinalSatir.varyantId);
        await tx.faturaSatir.create({
          data: {
            tenantId,
            faturaId: id,
            stokId: s.stokId,
            varyantId: orijinalSatir.varyantId,
            partiBilgileri: orijinalSatir.partiBilgileri,
            miktar: D(s.miktar),
            birim: orijinalSatir.birim ?? "adet",
            birimFiyat: D(s.birimFiyat),
            iskontoOrani: D(s.iskontoOrani),
            iskontoTutari: D(s.iskontoTutari),
            genelIskontoPayi: D(s.genelIskontoPayi),
            matrah: D(s.matrah),
            kdvOrani: D(s.kdvOrani),
            kdvTutari: D(s.kdvTutari),
            tevkifatKodu: orijinalSatir.tevkifatKodu,
            tevkifatPay: s.tevkifatPay,
            tevkifatPayda: s.tevkifatPayda,
            tevkifatTutari: D(s.tevkifatTutari),
            netKdvTutari: D(s.netKdvTutari),
            // EBLG-120: KDV dışı vergiler (davranış merkezden çözüldü).
            ekVergiler: ekVergiler[index].length ? (saklanacakEkVergiler(ekVergiler[index], s) as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
            ekVergiTutari: D(s.ekVergiTutari),
            stopajTutari: D(s.stopajTutari),
            toplamTutar: D(s.toplamTutar),
            gibIstisnaKodu: orijinalSatir.gibIstisnaKodu,
            // İDİS etiket no ve şarj ünitesi seri no satır alanlarıdır
            // (EBLG-71/72); biçim denetimi gönderimde yapılır.
            idisEtiketNo: orijinalSatir.idisEtiketNo ? idisNormalize(orijinalSatir.idisEtiketNo) : null,
            sarjUniteSeriNo: orijinalSatir.sarjUniteSeriNo?.trim() || null,
            // EBLG-78: yatırım teşvik harcama tipi ve makine kimlikleri.
            ytbHarcamaTipi: orijinalSatir.ytbHarcamaTipi?.trim() || null,
            ytbMakineAdi: orijinalSatir.ytbMakineAdi?.trim() || null,
            ytbMakineId: orijinalSatir.ytbMakineId?.trim() || null,
            ytbMakineSiraNo: orijinalSatir.ytbMakineSiraNo?.trim() || null,
            projeId: orijinalSatir.projeId,
            projeAltKirilimId: orijinalSatir.projeAltKirilimId,
          },
        });
      }

      if (girdi.satirlar) await satirBirimleriniDogrula(tx, girdi.satirlar);
      if (girdi.satirlar) await satirVaryantlariniDogrula(tx, girdi.satirlar);

      // EBLG-71: satırlar değiştiyse şarj türü de değişebilir.
      const guncelSarjKartlari = await tx.stokKart.findMany({
        where: { id: { in: [...new Set(birlesikGirdi.satirlar.map((satir) => satir.stokId))] } },
        select: { id: true, sarjTuru: true },
      });
      const guncelSarjTuru = sarjTuruCoz(birlesikGirdi.satirlar.map((satir) => ({
        sarjTuru: guncelSarjKartlari.find((kart) => kart.id === satir.stokId)?.sarjTuru,
      })));
      if (guncelSarjTuru.karisik) {
        throw new BadRequestException("Şarj hizmeti ve şarj ünitesi satırları aynı faturada olamaz; belgenin tek bir tipi olmalıdır");
      }

      if (girdi.teslimatAdresiniCariyeKaydet) await teslimYeriniCariyeKaydet(tx, tenantId, birlesikGirdi.cariId, birlesikGirdi);

      const guncellenen = await tx.fatura.update({
        where: { id },
        data: {
          tip: birlesikGirdi.tip,
          // Satırlar değiştiyse senaryo da değişebilir; her güncellemede
          // yeniden türetilir (FTR-16).
          senaryo: faturaSenaryosuTuret(birlesikGirdi.tip, birlesikGirdi.satirlar.map((s) => ({
            ekVergiKodlari: (s.ekVergiler ?? []).map((v) => v.kod),
            kdvOrani: Number(s.kdvOrani),
            tevkifatKodu: s.tevkifatKodu,
            gibIstisnaKodu: s.gibIstisnaKodu,
          })), birlesikGirdi.ihracKayitliKodu, birlesikGirdi.ozelMatrahKodu, sgkFaturasiMi(fatura.cari?.vknTckn), guncelSarjTuru.turu),
          ihracKayitliKodu: birlesikGirdi.ihracKayitliKodu,
          idisSevkiyatNo: birlesikGirdi.idisSevkiyatNo ? idisNormalize(birlesikGirdi.idisSevkiyatNo) : null,
          // EBLG-78: yatırım teşvik belge no/tarihi.
          ytbNo: birlesikGirdi.ytbNo?.trim() || null,
          ytbTarihi: birlesikGirdi.ytbTarihi ? new Date(birlesikGirdi.ytbTarihi) : null,
          ozelMatrahKodu: birlesikGirdi.ozelMatrahKodu ?? null,
          ozelMatrahTutari: birlesikGirdi.ozelMatrahKodu ? D(birlesikGirdi.ozelMatrahTutari ?? "0") : null,
          ozelMatrahOrani: birlesikGirdi.ozelMatrahKodu ? D(birlesikGirdi.ozelMatrahOrani ?? "0") : null,
          efaturaProfili: birlesikGirdi.efaturaProfili,
          earsivGonderimSekli: birlesikGirdi.earsivGonderimSekli,
          belgeDili: birlesikGirdi.belgeDili,
          ciftDil: ciftDilGecerli(birlesikGirdi.belgeDili, birlesikGirdi.ciftDil),
          ihracatTeslimSarti: birlesikGirdi.ihracatTeslimSarti || null,
          ihracatTasimaSekli: birlesikGirdi.ihracatTasimaSekli || null,
          no: birlesikGirdi.no ?? null,
          tarih: new Date(birlesikGirdi.tarih),
          vadeTarihi: birlesikGirdi.vadeTarihi ? new Date(birlesikGirdi.vadeTarihi) : null,
          // Sipariş referansı güncellemede hiç yazılmıyordu; FTR-31 ile düzeldi.
          siparisNo: birlesikGirdi.siparisNo || null,
          // Mevcut faturanın tarihleri görünümden metin olarak gelir.
          siparisTarihi: birlesikGirdi.siparisTarihi ? new Date(birlesikGirdi.siparisTarihi) : null,
          talepNo: birlesikGirdi.talepNo || null,
          talepTarihi: birlesikGirdi.talepTarihi ? new Date(birlesikGirdi.talepTarihi) : null,
          ...ilgiliKisiTemizle(birlesikGirdi),
          cariId: birlesikGirdi.cariId,
          depoId: birlesikGirdi.depoId ?? null,
          ...teslimYeriVerisi(birlesikGirdi),
          dovizCinsi: birlesikGirdi.dovizCinsi,
          kur: D(birlesikGirdi.kur),
          genelIskontoYuzdesi: D(birlesikGirdi.genelIskontoYuzdesi),
          genelIskontoTutari: D(birlesikGirdi.genelIskontoTutari),
          toplamBrut: D(hesaplanan.toplamBrut),
          toplamSatirIskontosu: D(hesaplanan.toplamSatirIskontosu),
          genelIskontoToplam: D(hesaplanan.genelIskontoTutari),
          toplamMatrah: D(hesaplanan.toplamMatrah),
          toplamKdv: D(hesaplanan.toplamKdv),
          toplamTevkifat: D(hesaplanan.toplamTevkifat),
          toplamNetKdv: D(hesaplanan.toplamNetKdv),
          toplamEkVergi: D(hesaplanan.toplamEkVergi),
          toplamStopaj: D(hesaplanan.toplamStopaj),
          genelToplam: D(hesaplanan.genelToplam),
          aciklama: birlesikGirdi.aciklama,
          notlar: birlesikGirdi.notlar,
        },
      });

      return this.gorunum(guncellenen);
    });
  }

  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    const fatura = await this.getir(id);

    if (fatura.durum !== "taslak" || fatura.ebelge) {
      throw new BadRequestException("Yalnızca e-Belgesi oluşmamış taslak faturalar silinebilir");
    }

    await this.prisma.tenantIslem(tenantId, async (tx) => {
      // FTR-12: taslak zincir faturası siliniyorsa bağlı belgeler yeniden
      // dönüştürülebilir olsun diye onaylı durumuna döner (rezerv zaten
      // fatura kesinleşmediği için çözülmemişti).
      await tx.belge.updateMany({
        where: { faturaId: id },
        data: { faturaId: null, durum: "onaylandi" },
      });
      await tx.gelenEbelge.updateMany({
        where: { faturaId: id },
        data: { faturaId: null, durum: "beklemede" },
      });
      await tx.fatura.delete({ where: { id } });
    });
  }

  /**
   * Taslağı kayıt izini koruyarak iptal eder. Kesin ve e-belgesiz faturada
   * mali kayıtlar silinmez; stok ve cari için ters hareket üretilir.
   */
  /**
   * STK-26: satış iadesinin birim maliyeti — bağlı satış faturalarındaki aynı
   * ürün/varyant çıkışlarının ağırlıklı maliyeti; bağ yoksa anlık ortalama.
   * Kart satırı çağıranda kilitlidir.
   */
  private async satisIadesiMaliyeti(tx: Prisma.TransactionClient, stokId: string, varyantId: string | null, kaynakFaturaIdleri: string[]) {
    if (kaynakFaturaIdleri.length) {
      const cikislar = await tx.stokHareket.findMany({ where: { kaynakTur: "fatura", kaynakRef: { in: kaynakFaturaIdleri }, stokId, varyantId: varyantId ?? null, miktar: { lt: 0 } }, select: { miktar: true, maliyet: true } });
      const maliyet = agirlikliMaliyet(cikislar);
      if (maliyet) return maliyet;
    }
    const kart = await tx.stokKart.findUnique({ where: { id: stokId }, select: { ortalamaMaliyet: true } });
    return kart?.ortalamaMaliyet ?? new Prisma.Decimal(0);
  }

  /** STK-40: maliyet dağıtımının kaynağı ya da hedefi olan fatura geri alınmaz. */
  private async dagitimEngeli(tenantId: string, faturaId: string, eylem: string) {
    const sayi = await this.prisma.tenantIslem(tenantId, (tx) => tx.maliyetDagitimi.count({ where: faturaDagitimKosulu(faturaId) }));
    if (sayi) throw new BadRequestException(`Bu faturaya maliyet dağıtımı bağlı; fatura ${eylem}. Önce Maliyet Dağıtımı ekranından dağıtımı geri alın`);
  }

  async iptal(id: string) {
    const { tenantId } = aktifBaglam();
    // STK-38: ters kayıtlar faturanın tarihine yazılır; dönemi kapalıysa iptal
    // edilemez (kapalı döneme kayıt girmez), düzeltme iade faturasıyla yapılır.
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findUnique({ where: { id }, select: { tarih: true, durum: true, tip: true } }));
    if (!kayit) throw new NotFoundException("Fatura bulunamadı");
    await this.dagitimEngeli(tenantId, id, "iptal edilemez");
    if (kayit.durum === "kesin" && kayit.tip !== "proforma") {
      try {
        await this.donemKilidi.tarihDogrula(tenantId, kayit.tarih, "fatura iptali");
      } catch (hata) {
        if (hata instanceof ConflictException) throw new ConflictException(`${hata.message}; iade faturası düzenleyin`);
        throw hata;
      }
    }
    // EBLG-160: entegratör çağrısı veritabanı işleminin dışındadır. Önce kısa bir işlemde
    // ön koşullar denetlenir, sonra entegratör (e-Arşiv iptali ya da "ulaşmadı" sorgusu),
    // en son kısa bir işlemde faturanın kendisi iptal edilir ve ön koşullar yeniden denetlenir.
    const on = await this.prisma.tenantIslem(tenantId, (tx) => this.iptalHazirla(tx, tenantId, id));
    if (on.taslakSonucu) return on.taslakSonucu;
    const ebelgeKaydi = on.fatura.ebelge;
    const earsivIptali = Boolean(ebelgeKaydi && !on.gitmemisEbelge && ebelgeKaydi.durum !== "iptal");
    if (ebelgeKaydi && on.gitmemisEbelge) {
      await this.ebelge.entegratoreUlasmadiginiDogrula(on.fatura, ebelgeKaydi, "fatura iptal edilemez", "iptal durduruldu");
    } else if (ebelgeKaydi && earsivIptali) {
      // Başarılıysa e-Belge kaydı burada `iptal` yazılır; aşağıdaki adım düşerse yeniden denemede entegratör tekrar çağrılmaz.
      await this.ebelge.earsivBelgesiniIptalEt(on.fatura, ebelgeKaydi);
    }
    try {
      return await this.prisma.tenantIslem(tenantId, async (tx) => {
        const { fatura, gitmemisEbelge, taslakSonucu } = await this.iptalHazirla(tx, tenantId, id);
        if (taslakSonucu) return taslakSonucu;
        if (fatura.ebelge && gitmemisEbelge) {
          await tx.ebelgeKayit.update({ where: { id: fatura.ebelge.id }, data: { durum: "iptal" } });
        } else if (fatura.ebelge && fatura.ebelge.durum !== "iptal") {
          throw new ConflictException("Faturanın e-Belge durumu iptal sırasında değişti; yeniden deneyin");
        }

        if (fatura.tip !== "proforma") {
          const hareketler = await this.sonKesinlestirmeHareketleri(tx, id);
          await this.stokService.kartlariKilitle(tx, hareketler.map((h) => h.stokId));
          for (const hareket of hareketler) {
            await this.stokService.hareketEkle(tx, {
              stokId: hareket.stokId,
              varyantId: hareket.varyantId,
              depoId: hareket.depoId,
              tip: hareket.tip === "cikis" ? "giris" : "cikis",
              // Hareket miktarı işaretli saklanır (çıkış eksi), `hareketEkle` ise
              // yönü tipten alıp pozitif miktar bekler. İşaretli verilince iptalin
              // "girişi" stoğu bir kez daha düşürüyordu.
              miktar: hareket.miktar.abs(),
              girilenBirim: hareket.girilenBirim,
              girilenMiktar: hareket.girilenMiktar,
              birimMaliyet: hareket.maliyet,
              // STK-27: girişin tersi girdiği maliyetle çıkar ve ortalamadan düşer.
              maliyetliCikis: hareket.tip !== "cikis",
              tarih: fatura.tarih,
              aciklama: `${fatura.no || fatura.id} nolu fatura iptal ters hareketi`,
              kaynakTur: "fatura_iptal",
              kaynakRef: fatura.id,
              partiler: hareket.partiler.map((parti) => ({
                lotNo: parti.parti.lotNo,
                seriNo: parti.parti.seriNo,
                sonKullanmaTarihi: parti.parti.sonKullanmaTarihi?.toISOString().slice(0, 10) ?? null,
                uretimTarihi: parti.parti.uretimTarihi?.toISOString().slice(0, 10) ?? null,
                miktar: parti.miktar.abs(),
              })),
            });
          }

          const cariHareketTip = fatura.tip === "satis" || fatura.tip === "alis_iade" ? "alacak" : "borc";
          await tx.cariHareket.create({
            data: {
              tenantId,
              cariId: fatura.cariId,
              tip: cariHareketTip,
              tutar: fatura.genelToplam,
              dovizCinsi: fatura.dovizCinsi,
              kur: fatura.kur,
              tutarTry: fatura.genelToplam.mul(fatura.kur).toDecimalPlaces(2),
              tarih: fatura.tarih,
              aciklama: `${fatura.no || fatura.id} nolu fatura iptal ters hareketi`,
              kaynakTur: "fatura_iptal",
              kaynakRef: fatura.id,
            },
          });
        }
        // KSB-29: kur farkı karşılığı ters kayıtla kapanır.
        await kurFarkiKarsiliginiCoz(tx, tenantId, id);
        // KSB-16: iptal edilen faturanın kapamaları (elle dahil) çözülür; ödemeler avansa döner ve yeniden dağılır.
        await faturaKapamalariniCoz(tx, id);
        const iptalEdilen = await tx.fatura.update({ where: { id }, data: { durum: "iptal" } });
        await cariDenklestir(tx, tenantId, fatura.cariId);
        return iptalEdilen;
      }, { timeout: TERS_KAYIT_ISLEM_SURESI_MS });
    } catch (hata) {
      // e-Arşiv entegratörde iptal edildi ama fatura iptal edilemedi: belge "e-Arşivi iptal, fatura kesin" kalır.
      if (earsivIptali) await this.ebelge.earsivIptaliYarimKaldi(on.fatura, hata);
      throw hata;
    }
  }

  /** EBLG-160: iptalin ön koşulları; hem entegratör çağrısından önce hem asıl iptal işleminde çalışır. Taslak fatura burada iptal edilir. */
  private async iptalHazirla(tx: Prisma.TransactionClient, tenantId: string, id: string) {
  const fatura = await tx.fatura.findUnique({
    where: { id },
    include: { ebelge: { select: { id: true, tur: true, durum: true, entegratorRef: true, createdAt: true } } },
  });
  if (!fatura) throw new NotFoundException("Fatura bulunamadı");
  if (fatura.durum === "iptal") throw new BadRequestException("Fatura zaten iptal edilmiş");
  // Kesilen e-Fatura iptal edilmez; düzeltme yolu iade faturasıdır.
  // e-Arşiv'de ise iptal normal mekanizmadır — belge GİB raporuna
  // girmediği sürece iptal edilebilir (EBLG-22).
  // e-Belgesi entegratöre hiç ulaşmamış fatura (hata, numarasız, referanssız)
  // kanaldan bağımsız iptal edilebilir: GİB'de karşılığı yoktur. Ulaşmadığı
  // iptal anında entegratöre sorularak doğrulanır.
  const gitmemisEbelge = Boolean(fatura.ebelge && ebelgeGitmemisMi({ faturaNo: fatura.no, ebelge: fatura.ebelge }));
  if (fatura.ebelge && fatura.ebelge.tur !== "earsiv" && !gitmemisEbelge) {
    throw new BadRequestException("e-Fatura olarak gönderilmiş fatura iptal edilemez; iade faturası düzenleyin");
  }

  if (fatura.durum === "taslak") {
    await tx.belge.updateMany({ where: { faturaId: id }, data: { faturaId: null, durum: "onaylandi" } });
    await tx.gelenEbelge.updateMany({ where: { faturaId: id }, data: { faturaId: null, durum: "beklemede" } });
    return { fatura, gitmemisEbelge, taslakSonucu: await tx.fatura.update({ where: { id }, data: { durum: "iptal" } }) };
  }

  const [kasaBankaSayisi, posSayisi, krediKartiSayisi, elleKapamaSayisi] = await Promise.all([
    tx.kasaBankaHareket.count({ where: { faturaId: id } }),
    tx.posTahsilat.count({ where: { faturaId: id } }),
    tx.krediKartiHareket.count({ where: { tenantId, faturaId: id } }),
    // KSB-16: birden çok faturaya dağıtılan ödemenin hareketinde fatura alanı boştur; bağı elle kapama taşır.
    // KSB-29: kur farkı karşılığı ödeme sayılmaz; geri almada ters kaydıyla çözülür.
    // PZR-13: pazaryeri hakedişinin kapaması da bağlı ödemedir (önce hakediş geri alınır).
    tx.faturaKapama.count({ where: { faturaId: id, otomatik: false, OR: [{ cariHareketId: null }, { cariHareket: { kaynakTur: "pazaryeri_hakedis" } }] } }),
  ]);
  if (kasaBankaSayisi + posSayisi + krediKartiSayisi + elleKapamaSayisi > 0) {
    throw new BadRequestException("Tahsilat, ödeme ya da mahsup bağlı fatura doğrudan iptal edilemez; önce finans hareketini ya da mahsubu geri alın veya iade faturası düzenleyin");
  }
    return { fatura, gitmemisEbelge, taslakSonucu: null };
  }

  /**
   * FTR-29: e-Belgesi GİB'de karşılığı olan bir belgeye dönüşmemiş kesin
   * faturayı taslağa geri alır. Kesinleştirmenin etkileri ters kayıtla
   * kaldırılır (cari hareketleri yalnız eklemeli tutulur): stok ve cari ters
   * hareketi faturanın tarihine yazılır ki dönem raporlarında sıfırlansın,
   * çözülen sipariş rezervi geri konur. Numara, seri ve sıra korunur; yeniden
   * kesinleştirmede aynı numara kullanılır. Entegratöre ulaşmamış e-Belge kaydı
   * önce sağlayıcıya sorularak doğrulanır, sonra silinir — düzeltilen belge
   * gönderimde baştan üretilir.
   */
  async taslagaGeriAl(id: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findUnique({ where: { id }, select: { tarih: true } }));
    if (!kayit) throw new NotFoundException("Fatura bulunamadı");
    await this.dagitimEngeli(tenantId, id, "taslağa geri alınamaz");
    await this.donemKilidi.tarihDogrula(tenantId, kayit.tarih, "faturayı taslağa geri alma");
    // EBLG-160: "entegratöre ulaşmadı" sorgusu işlemin dışında; ön koşullar sorgudan önce ve asıl işlemde yeniden denetlenir.
    const on = await this.prisma.tenantIslem(tenantId, (tx) => this.geriAlmaHazirla(tx, tenantId, id));
    if (on.ebelge) await this.ebelge.entegratoreUlasmadiginiDogrula(on, on.ebelge, "fatura taslağa geri alınamaz", "geri alma durduruldu");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await this.geriAlmaHazirla(tx, tenantId, id);
      if (fatura.ebelge) {
        // Sorgulanan kayıt değişmişse (ör. bu arada gönderildi) sorgu sonucu geçersizdir.
        if (fatura.ebelge.id !== on.ebelge?.id || fatura.ebelge.durum !== on.ebelge.durum || fatura.ebelge.entegratorRef !== on.ebelge.entegratorRef) {
          throw new ConflictException("Faturanın e-Belge durumu geri alma sırasında değişti; yeniden deneyin");
        }
        await tx.ebelgeKayit.delete({ where: { id: fatura.ebelge.id } });
      } else if (on.ebelge) {
        throw new ConflictException("Faturanın e-Belge durumu geri alma sırasında değişti; yeniden deneyin");
      }

      const etiket = `${fatura.no || fatura.id} nolu fatura taslağa geri alma ters hareketi`;
      const geriAlinacaklar = await this.sonKesinlestirmeHareketleri(tx, id);
      await this.stokService.kartlariKilitle(tx, geriAlinacaklar.map((h) => h.stokId));
      for (const hareket of geriAlinacaklar) {
        await this.stokService.hareketEkle(tx, {
          stokId: hareket.stokId,
          varyantId: hareket.varyantId,
          depoId: hareket.depoId,
          tip: hareket.tip === "cikis" ? "giris" : "cikis",
          miktar: hareket.miktar.abs(),
          girilenBirim: hareket.girilenBirim,
          girilenMiktar: hareket.girilenMiktar,
          birimMaliyet: hareket.maliyet,
          maliyetliCikis: hareket.tip !== "cikis",
          tarih: hareket.tarih,
          aciklama: etiket,
          kaynakTur: "fatura_geri_alma",
          kaynakRef: fatura.id,
          partiler: hareket.partiler.map((parti) => ({
            lotNo: parti.parti.lotNo,
            seriNo: parti.parti.seriNo,
            sonKullanmaTarihi: parti.parti.sonKullanmaTarihi?.toISOString().slice(0, 10) ?? null,
            uretimTarihi: parti.parti.uretimTarihi?.toISOString().slice(0, 10) ?? null,
            miktar: parti.miktar.abs(),
          })),
        });
      }

      await tx.cariHareket.create({
        data: {
          tenantId,
          cariId: fatura.cariId,
          tip: fatura.tip === "satis" || fatura.tip === "alis_iade" ? "alacak" : "borc",
          tutar: fatura.genelToplam,
          dovizCinsi: fatura.dovizCinsi,
          kur: fatura.kur,
          tutarTry: fatura.genelToplam.mul(fatura.kur).toDecimalPlaces(2),
          tarih: fatura.tarih,
          vadeTarihi: fatura.vadeTarihi,
          aciklama: etiket,
          kaynakTur: "fatura_geri_alma",
          kaynakRef: fatura.id,
        },
      });

      // Kesinleştirmede çözülen bağlı irsaliyelerin sipariş rezervi geri konur;
      // yeniden kesinleştirmede yine çözülür (FTR-26 bağ kaldırmayla aynı).
      const bagliBelgeler = await tx.belge.findMany({ where: { faturaId: id }, select: { id: true } });
      await this.belgelerService.zincirEtkisiniCoz(tx, bagliBelgeler.map((b) => b.id), 1);

      await kurFarkiKarsiliginiCoz(tx, tenantId, id);
      await faturaKapamalariniCoz(tx, id);
      const taslak = await tx.fatura.update({ where: { id }, data: { durum: "taslak" } });
      await cariDenklestir(tx, tenantId, fatura.cariId);
      return this.gorunum(taslak);
    }, { timeout: TERS_KAYIT_ISLEM_SURESI_MS });
  }

  /** EBLG-160: taslağa geri almanın ön koşulları; entegratör sorgusundan önce ve asıl işlemde çalışır. */
  private async geriAlmaHazirla(tx: Prisma.TransactionClient, tenantId: string, id: string) {
  const fatura = await tx.fatura.findUnique({
    where: { id },
    include: { ebelge: { select: { id: true, tur: true, durum: true, entegratorRef: true, createdAt: true } } },
  });
  if (!fatura) throw new NotFoundException("Fatura bulunamadı");
  const engel = faturaGeriAlmaEngeli(fatura);
  if (engel) throw new BadRequestException(engel);

  const [kasaBankaSayisi, posSayisi, krediKartiSayisi, elleKapamaSayisi] = await Promise.all([
    tx.kasaBankaHareket.count({ where: { faturaId: id } }),
    tx.posTahsilat.count({ where: { faturaId: id } }),
    tx.krediKartiHareket.count({ where: { tenantId, faturaId: id } }),
    // KSB-16: birden çok faturaya dağıtılan ödemenin hareketinde fatura alanı boştur; bağı elle kapama taşır.
    // KSB-29: kur farkı karşılığı ödeme sayılmaz; geri almada ters kaydıyla çözülür.
    // PZR-13: pazaryeri hakedişinin kapaması da bağlı ödemedir (önce hakediş geri alınır).
    tx.faturaKapama.count({ where: { faturaId: id, otomatik: false, OR: [{ cariHareketId: null }, { cariHareket: { kaynakTur: "pazaryeri_hakedis" } }] } }),
  ]);
  if (kasaBankaSayisi + posSayisi + krediKartiSayisi + elleKapamaSayisi > 0) {
    throw new BadRequestException("Tahsilat, ödeme ya da mahsup bağlı fatura taslağa geri alınamaz; önce finans hareketini ya da mahsubu geri alın");
  }
    return fatura;
  }

  /**
   * Faturanın son kesinleştirmesinin stok hareketleri. Taslağa geri alınıp
   * yeniden kesinleştirilen faturada önceki turun hareketleri ters kaydıyla
   * zaten kapanmıştır; iptal ya da yeni geri alma yalnız sonuncuyu çevirmeli.
   */
  private async sonKesinlestirmeHareketleri(tx: Prisma.TransactionClient, faturaId: string) {
    const sonGeriAlma = await tx.stokHareket.findFirst({
      where: { kaynakTur: "fatura_geri_alma", kaynakRef: faturaId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return tx.stokHareket.findMany({
      // STK-33: eski hizmet hareketleri ters çevrilmez (hizmete hareket yazılmaz).
      where: { kaynakTur: "fatura", kaynakRef: faturaId, stok: { tip: { not: "hizmet" } }, ...(sonGeriAlma ? { createdAt: { gt: sonGeriAlma.createdAt } } : {}) },
      include: { partiler: { include: { parti: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  /** FTR-09: proforma faturayı tek tıkla satış faturası taslağına dönüştürür. */
  async satisaDonustur(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const proforma = await tx.fatura.findUnique({
        where: { id },
        include: { satirlar: true },
      });
      if (!proforma) throw new NotFoundException("Fatura bulunamadı");
      if (proforma.tip !== "proforma") {
        throw new BadRequestException("Yalnızca proforma faturalar dönüştürülebilir");
      }
      await cariIslemDenetle(tx, proforma.cariId, "fatura", "yeni");

      const yeni = await tx.fatura.create({
        data: {
          tenantId,
          tip: "satis",
          durum: "taslak",
          tarih: new Date(),
          vadeTarihi: proforma.vadeTarihi,
          cariId: proforma.cariId,
          dovizCinsi: proforma.dovizCinsi,
          kur: proforma.kur,
          genelIskontoYuzdesi: proforma.genelIskontoYuzdesi,
          genelIskontoTutari: proforma.genelIskontoTutari,
          toplamBrut: proforma.toplamBrut,
          toplamSatirIskontosu: proforma.toplamSatirIskontosu,
          genelIskontoToplam: proforma.genelIskontoToplam,
          toplamMatrah: proforma.toplamMatrah,
          toplamKdv: proforma.toplamKdv,
          toplamTevkifat: proforma.toplamTevkifat,
          toplamNetKdv: proforma.toplamNetKdv,
          genelToplam: proforma.genelToplam,
          aciklama: `${proforma.no ?? "Proforma"} kaynaklı satış faturası`,
          belgeDili: proforma.belgeDili,
          ciftDil: proforma.ciftDil,
          ihracatTeslimSarti: proforma.ihracatTeslimSarti,
          ihracatTasimaSekli: proforma.ihracatTasimaSekli,
          notlar: proforma.notlar,
        },
      });
      for (const s of proforma.satirlar) {
        await tx.faturaSatir.create({
          data: {
            tenantId,
            faturaId: yeni.id,
            stokId: s.stokId,
            varyantId: s.varyantId,
            partiBilgileri: s.partiBilgileri ?? Prisma.JsonNull,
            miktar: s.miktar,
            birim: s.birim,
            birimFiyat: s.birimFiyat,
            iskontoOrani: s.iskontoOrani,
            iskontoTutari: s.iskontoTutari,
            genelIskontoPayi: s.genelIskontoPayi,
            matrah: s.matrah,
            kdvOrani: s.kdvOrani,
            kdvTutari: s.kdvTutari,
            tevkifatPay: s.tevkifatPay,
            tevkifatPayda: s.tevkifatPayda,
            tevkifatTutari: s.tevkifatTutari,
            netKdvTutari: s.netKdvTutari,
            toplamTutar: s.toplamTutar,
          },
        });
      }
      return this.gorunum(yeni);
    });
  }

  async kopyala(id: string) {
    const { tenantId } = aktifBaglam();
    const fatura = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.findUnique({
        where: { id },
        include: {
          satirlar: true,
        },
      }),
    );

    if (!fatura) throw new NotFoundException("Fatura bulunamadı");

    const ctx = aktifBaglam();
    if (!eylemIzinli("fatura", "kopyala", { durum: fatura.durum }, ctx)) {
      throw new ForbiddenException("Bu fatura kopyalanamaz veya bu işlem için yetkiniz yok");
    }

    const yeni = await this.prisma.tenantIslem(tenantId, async (tx) => {
      await cariIslemDenetle(tx, fatura.cariId, "fatura", "yeni");
      const kopya = await tx.fatura.create({
        data: {
          tenantId,
          tip: fatura.tip,
          durum: "taslak",
          tarih: new Date(),
          vadeTarihi: null,
          cariId: fatura.cariId,
          dovizCinsi: fatura.dovizCinsi,
          kur: fatura.kur,
          genelIskontoYuzdesi: fatura.genelIskontoYuzdesi,
          genelIskontoTutari: fatura.genelIskontoTutari,
          toplamBrut: fatura.toplamBrut,
          toplamSatirIskontosu: fatura.toplamSatirIskontosu,
          genelIskontoToplam: fatura.genelIskontoToplam,
          toplamMatrah: fatura.toplamMatrah,
          toplamKdv: fatura.toplamKdv,
          toplamTevkifat: fatura.toplamTevkifat,
          toplamNetKdv: fatura.toplamNetKdv,
          toplamEkVergi: fatura.toplamEkVergi,
          toplamStopaj: fatura.toplamStopaj,
          genelToplam: fatura.genelToplam,
          aciklama: fatura.aciklama ? `${fatura.aciklama} (Kopya)` : "Kopya",
          notlar: fatura.notlar,
          // Toplamlar özgünden geldiği için onları belirleyen işaretler de
          // gelmeli: ihraç kayıtlıda KDV tahsil edilmez, genel toplam matrahtır.
          gelirTuru: fatura.gelirTuru,
          depoId: fatura.depoId,
          teslimatAdres: fatura.teslimatAdres,
          teslimatIl: fatura.teslimatIl,
          teslimatIlce: fatura.teslimatIlce,
          teslimatPostaKodu: fatura.teslimatPostaKodu,
          senaryo: fatura.senaryo,
          efaturaProfili: fatura.efaturaProfili,
          earsivGonderimSekli: fatura.earsivGonderimSekli,
          belgeDili: fatura.belgeDili,
          ciftDil: fatura.ciftDil,
          ihracKayitliKodu: fatura.ihracKayitliKodu,
          ozelMatrahKodu: fatura.ozelMatrahKodu,
          ozelMatrahTutari: fatura.ozelMatrahTutari,
          ozelMatrahOrani: fatura.ozelMatrahOrani,
          ihracatTeslimSarti: fatura.ihracatTeslimSarti,
          ihracatTasimaSekli: fatura.ihracatTasimaSekli,
        },
      });

      for (const s of fatura.satirlar) {
        await tx.faturaSatir.create({
          data: {
            tenantId,
            faturaId: kopya.id,
            stokId: s.stokId,
            varyantId: s.varyantId,
            partiBilgileri: s.partiBilgileri ?? Prisma.JsonNull,
            miktar: s.miktar,
            birim: s.birim,
            birimFiyat: s.birimFiyat,
            iskontoOrani: s.iskontoOrani,
            iskontoTutari: s.iskontoTutari,
            genelIskontoPayi: s.genelIskontoPayi,
            matrah: s.matrah,
            kdvOrani: s.kdvOrani,
            kdvTutari: s.kdvTutari,
            tevkifatPay: s.tevkifatPay,
            tevkifatPayda: s.tevkifatPayda,
            tevkifatTutari: s.tevkifatTutari,
            netKdvTutari: s.netKdvTutari,
            ekVergiler: s.ekVergiler ?? Prisma.JsonNull,
            ekVergiTutari: s.ekVergiTutari,
            stopajTutari: s.stopajTutari,
            toplamTutar: s.toplamTutar,
            gibIstisnaKodu: s.gibIstisnaKodu,
            tevkifatKodu: s.tevkifatKodu,
            projeId: s.projeId,
            projeAltKirilimId: s.projeAltKirilimId,
          },
        });
      }

      return kopya;
    });

    return this.getir(yeni.id);
  }

  // ─── FATURA KESİNLEŞTİRME VE ENTEGRASYONLAR (FTR-03/05/06) ───────────────

  async kesinlestir(id: string, veri?: { no?: string; seri?: string; riskOnayGerekcesi?: string | null }) {
    const { tenantId, userId, rol } = aktifBaglam();
    const tarih = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findUnique({ where: { id }, select: { tarih: true } }));
    if (!tarih) throw new NotFoundException("Fatura bulunamadı");
    await this.donemKilidi.tarihDogrula(tenantId, tarih.tarih, "fatura kesinleştirme");
    
    // Faturayı kilitlemek ve işlemleri yürütmek için transaction başlatıyoruz
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({
        where: { id },
        include: { satirlar: true, cari: true, gelenEbelge: { select: { id: true } } },
      });

      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      if (fatura.durum !== "taslak") {
        throw new BadRequestException("Fatura zaten kesinleştirilmiş veya iptal edilmiş");
      }

      // İşlem blokajı (CARI-17/32): kara listedeki cariye belge kesilemez.
      // Gelen e-Faturanın kaydı karşı tarafın belgesidir; denetlenmez.
      if (!fatura.gelenEbelge) await cariIslemDenetle(tx, fatura.cariId, "fatura", "mevcut");

      let seriKod = veri?.seri ?? "TKR";
      let faturaNo = veri?.no ?? null;
      const numaralandirma = await this.baglantilar.numaralandirma(tx);

      // 1. Numara Serisi Üretimi (FTR-06):
      // Alış faturalarında numara el ile girilir, satış faturalarında sayaç artırılarak otomatik üretilir.
      // Alış iadesini biz keseriz (EBLG-58); numarası satıştaki gibi kendi serimizden gelir.
      // FTR-29: taslağa geri alınıp yeniden kesinleştirilen fatura önceki
      // numarasını korur; yeni sıra almak seride boşluk bırakırdı.
      const oncekiNumara = fatura.no && fatura.sira !== null ? fatura.no : null;
      if (oncekiNumara) {
        faturaNo = oncekiNumara;
        seriKod = fatura.seri ?? seriKod;
      } else if (!fatura.gelenEbelge && (fatura.tip === "satis" || fatura.tip === "satis_iade" || fatura.tip === "alis_iade")) {
        // Entegratör otomatik seri kullanıyorsa numarayı o atar (EBLG-16);
        // burada sayaç ilerletilmez. Reddedilen belge böylece seride boşluk
        // bırakmaz, numara gönderim yanıtından gelir.
        if (numaralandirma.saglayiciAtar && !veri?.no) {
          seriKod = numaralandirma.seriOneki!;
          fatura.seri = seriKod;
          faturaNo = null;
        } else {
          const yil = new Date(fatura.tarih).getFullYear();
        
          // FaturaSeri kaydını kilitleyerek güncelliyoruz (Concurrency Safe)
          let seriKaydi = await tx.faturaSeri.findUnique({
            where: { tenantId_seri_yil: { tenantId, seri: seriKod, yil } },
          });

          if (!seriKaydi) {
            seriKaydi = await tx.faturaSeri.create({
              data: { tenantId, seri: seriKod, yil, sonSira: 0 },
            });
          }

          const guncelSeri = await tx.faturaSeri.update({
            where: { id: seriKaydi.id },
            data: { sonSira: { increment: 1 } },
          });

          faturaNo = `${seriKod}${yil}${String(guncelSeri.sonSira).padStart(9, "0")}`;
          fatura.seri = seriKod;
          fatura.sira = guncelSeri.sonSira;
        }
      } else {
        // EBLG-119: gelen e-Faturadan doğan satış iadesinin numarası müşterinin
        // belgesidir; bizim serimizden sıra almaz.
        // Alış faturası ise el ile girilen numara zorunlu olmalı; taslağa
        // geri alınmış faturada önceki numara kullanılır (FTR-29).
        faturaNo = faturaNo ?? fatura.no;
        if (!faturaNo) {
          throw new BadRequestException("Alış faturaları için belge numarası girmelisiniz");
        }
      }

      // 1b. Belge zinciri çözümü (FTR-12): bağlı siparişin rezervi (satış)
      // veya yoldakisi (alış) çözülür. Stok hareketlerinden ÖNCE yapılır ki
      // kullanılabilir stok kontrolü (STK-17) rezervi çifte saymasın.
      const bagliBelgeler = await tx.belge.findMany({ where: { faturaId: id }, select: { id: true } });
      await this.belgelerService.zincirEtkisiniCoz(tx, bagliBelgeler.map((b) => b.id), -1);

      // 2. Stok Hareketlerinin Tetiklenmesi (FTR-03):
      // Satış/Alış_İade -> Çıkış hareketi (Stok azalır).
      // Alış/Satış_İade -> Giriş hareketi (Stok artar).
      // Proforma fatura stoğu etkilemez.
      const stokUyarilari: string[] = [];
      // Kesinleşen faturada hangi depodan çıkıldığı kayda geçer (STK-07)
      let kullanilanDepoId: string | null = fatura.depoId;
      if (fatura.tip !== "proforma") {
        // STK-07: fatura başlığındaki depo; seçilmemişse varsayılan depo
        const depoId = await this.depoService.depoCozumle(tx, fatura.depoId);
        kullanilanDepoId = depoId;
        await this.stokService.kartlariKilitle(tx, fatura.satirlar.map((s) => s.stokId));
        // STK-26: satış iadesinin maliyeti bağlı satış faturalarının çıkışından gelir.
        const iadeKaynaklari = fatura.tip === "satis_iade"
          ? (await tx.faturaIadeReferansi.findMany({ where: { faturaId: id, kaynakFaturaId: { not: null } }, select: { kaynakFaturaId: true } })).map((r) => r.kaynakFaturaId!)
          : [];
        // STK-33: hizmet satırı stok hareketi üretmez.
        const hizmetler = new Set((await tx.stokKart.findMany({ where: { id: { in: fatura.satirlar.map((s) => s.stokId) }, tip: "hizmet" }, select: { id: true } })).map((k) => k.id));
        for (const s of fatura.satirlar) {
          if (hizmetler.has(s.stokId)) continue;
          const tip =
            fatura.tip === "satis" || fatura.tip === "alis_iade" ? "cikis" : "giris";
          // STK-10: ek birimle (koli) girilen satır stoğa ana birimle (adet)
          // yazılır; birim fiyat da ana birim başına düşer.
          const katsayi = await birimKatsayisiBul(tx, s.stokId, s.birim);
          const anaMiktar = s.miktar.mul(katsayi);
          // STK-25/26/27: alış ve alış iadesinde satırın net TL tutarı; satış
          // iadesinde satışın çıkış maliyeti; satışta ortalama (hareketEkle verir).
          // EBLG-120: bedele eklenen KDV dışı vergi (ÖTV, ÖİV…) maliyettir; stopaj değildir.
          const birimMaliyet = fatura.tip === "alis" || fatura.tip === "alis_iade"
            ? alisBirimMaliyeti(s.matrah.add(s.ekVergiTutari), fatura.kur, anaMiktar)
            : fatura.tip === "satis_iade"
              ? await this.satisIadesiMaliyeti(tx, s.stokId, s.varyantId, iadeKaynaklari)
              : new Prisma.Decimal(0);

          const hareketSonucu = await this.stokService.hareketEkle(tx, {
            stokId: s.stokId,
            varyantId: s.varyantId,
            depoId,
            tip,
            miktar: anaMiktar,
            girilenBirim: s.birim,
            girilenMiktar: s.miktar,
            birimMaliyet,
            maliyetliCikis: fatura.tip === "alis_iade",
            tarih: new Date(fatura.tarih),
            aciklama: `${faturaNo || fatura.id} nolu fatura hareketi`,
            kaynakTur: "fatura",
            kaynakRef: fatura.id,
            partiler: this.partiBilgileriniOku(s.partiBilgileri).map((p) => ({ ...p, miktar: p.miktar.mul(katsayi) })),
          });
          // Eksi stok politikası "uyar" ise kesinleştirme sürer, uyarı döner (STK-17)
          if (hareketSonucu.eksiStokUyarisi) {
            stokUyarilari.push(hareketSonucu.eksiStokUyarisi);
          }
        }

        // CARI-49: carinin bu andaki tahmini gecikmesi, faturanın kendi hareketinden önce kaydedilir.
        if (fatura.tip === "satis") {
          await kesinlesmeTahminiYaz(tx, tenantId, { id: fatura.id, cariId: fatura.cariId }, fatura.cari.riskLimiti === null ? null : Number(fatura.cari.riskLimiti));
        }

        // 3. Cari Hesap Hareketinin Tetiklenmesi (FTR-03):
        // Satış/Alış_İade -> Borç.
        // Alış/Satış_İade -> Alacak.
        const cariHareketTip =
          fatura.tip === "satis" || fatura.tip === "alis_iade" ? "borc" : "alacak";

        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: fatura.cariId,
            tip: cariHareketTip,
            tutar: fatura.genelToplam,
            dovizCinsi: fatura.dovizCinsi,
            kur: fatura.kur,
            tutarTry: fatura.genelToplam.mul(fatura.kur).toDecimalPlaces(2),
            tarih: new Date(fatura.tarih),
            vadeTarihi: fatura.vadeTarihi ? new Date(fatura.vadeTarihi) : null,
            aciklama: faturaNo ? `${faturaNo} nolu fatura hareketi` : "Fatura hareketi",
            kaynakTur: "fatura",
            kaynakRef: fatura.id,
          },
        });
      }

      // Risk limiti (CARI-08/32): kartla aynı risk, bu fatura dahil (hareket yukarıda yazıldı);
      // politika uyar / engelle / yönetici onayı. Engel işlemi geri alır.
      const riskUyari = fatura.tip === "satis"
        ? await riskLimitiDenetle(tx, { tenantId, userId, rol, cariId: fatura.cariId, ekTutarTry: new Prisma.Decimal(0), belgeEtiketi: "bu fatura", onayGerekcesi: veri?.riskOnayGerekcesi })
        : null;

      // Fatura durumunu güncelle
      const kesinFatura = await tx.fatura.update({
        where: { id },
        data: {
          durum: "kesin",
          no: faturaNo,
          seri: fatura.seri,
          sira: fatura.sira,
          depoId: kullanilanDepoId,
        },
      });
      // KSB-29: kur farkı faturası ödenmez; karşılık hareketiyle kendiliğinden kapanır.
      await kurFarkiKarsiligiYaz(tx, tenantId, id);
      // KSB-16: carinin bekleyen avansı ve iadeleri yeni faturayı vadesine göre kapatır.
      await cariDenklestir(tx, tenantId, fatura.cariId);

      return { kesinFatura: { ...this.gorunum(kesinFatura), riskUyari, stokUyarilari } };
    });

    // Kesinleşme sonrası işler (ör. PLT-22 abonelik tahsilatı); hata kesinleştirmeyi geri almaz.
    for (const dinleyici of this.kesinlesmeDinleyicileri) {
      await dinleyici(tenantId, id).catch((hata) => this.logger.error(JSON.stringify({ event: "invoice_finalize_listener_failed", tenantId, faturaId: id, error: hata instanceof Error ? hata.message : String(hata) })));
    }
    return sonuc.kesinFatura;
  }

  private readonly kesinlesmeDinleyicileri: ((tenantId: string, faturaId: string) => Promise<void>)[] = [];

  /** Faturaya bağımlı modüller kendini buradan kaydeder (FaturaModule onları içe aktarmaz; döngü olmaz). */
  kesinlesinceCalistir(dinleyici: (tenantId: string, faturaId: string) => Promise<void>) {
    this.kesinlesmeDinleyicileri.push(dinleyici);
  }

  // ─── PDF ÜRETİMİ (FTR-07, T-02 altyapısı) ───────────────────────────────

  async pdfUret(id: string, secenekler: { kopya?: boolean } = {}): Promise<{ buffer: Buffer; dosyaAdi: string }> {
    const fatura = await this.getir(id);
    // Numarasız belge dışarı çıkmamalı: entegratör numarayı gönderimde atıyorsa
    // (EBLG-16) fatura kesin olsa bile henüz resmî numarası yoktur.
    if (fatura.durum === "kesin" && !fatura.no) {
      throw new BadRequestException(
        "Faturanın numarası entegratör tarafından henüz atanmadı; e-Belge gönderimi tamamlanmadan yazdırılamaz veya e-postalanamaz",
      );
    }
    const { tenantId } = aktifBaglam();
    const dil = belgeDiliNormalize(fatura.belgeDili);
    const ek = await this.prisma.tenantIslem(tenantId, (tx) => ticariBelgeEkVerisi(tx, {
      tenantId, cariId: fatura.cariId, stokIds: fatura.satirlar.map((s) => s.stokId), dil, doviz: fatura.dovizCinsi,
    }));
    if (!ek.firma) throw new NotFoundException("Firma bulunamadı");
    const [tema, gorunum, kaseDataUri, kodTablosu] = await Promise.all([
      this.pdf.belgeTemasi(), this.pdf.belgeGorunumu(), this.pdf.firmaKaseDataUri(),
      belgeKodTablosu(this.mevzuat, new Date(fatura.tarih).toISOString().slice(0, 10)),
    ]);
    const { html, altBilgi } = faturaPdfHtml({
      ...fatura,
      kodTablosu,
      cari: { ...fatura.cari, ...ek.cari },
      satirlar: fatura.satirlar.map((s) => ({ ...s, ...ek.stoklar.get(s.stokId) })),
      bankalar: ek.bankalar,
    }, { firma: ek.firma, gorunum, logoDataUri: tema.logoDataUri, kaseDataUri }, secenekler.kopya === true);
    const buffer = await this.pdf.htmlToPdf(html, { altBilgi });
    return {
      buffer,
      dosyaAdi: `fatura-${fatura.no ?? "taslak"}.pdf`,
    };
  }

  /**
   * FTR-24: şablon önizlemesi. Örnek faturayı gerçek PDF üretecinden geçirir;
   * seçim kaydedilmeden denenebilsin diye şablon ve renk parametreden gelir,
   * verilmeyeni kiracının kayıtlı temasından tamamlanır.
   */
  async sablonOnizlemePdf(_sablon?: string, renk?: string): Promise<Buffer> {
    const { tenantId } = aktifBaglam();
    const firma = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { unvan: true, vkn: true, vergiDairesi: true, adres: true, ilce: true, il: true, postaKodu: true, telefon: true, eposta: true, webSitesi: true, mersisNo: true, ticaretSicilNo: true },
      }),
    );
    if (!firma) throw new NotFoundException("Firma bulunamadı");
    // FTR-37: şablon seçimi kalktı; renk verilirse kayıtlı görünümün ana rengi yerine denenir.
    const [tema, gorunum] = await Promise.all([this.pdf.belgeTemasi(), this.pdf.belgeGorunumu()]);
    const { html, altBilgi } = faturaPdfHtml(ornekFatura(), {
      firma,
      gorunum: renk ? { ...gorunum, anaRenk: renkNormalize(renk) } : gorunum,
      logoDataUri: tema.logoDataUri,
    });
    return this.pdf.htmlToPdf(html, { altBilgi });
  }


  /**
   * Fatura PDF'ini cariye e-posta ile gönderir (FTR-07). Alıcı verilmezse
   * cari kartındaki e-posta kullanılır; taslak fatura gönderilemez.
   */
  async pdfGonder(id: string, aliciEposta?: string) {
    const fatura = await this.getir(id);
    if (fatura.durum === "taslak") {
      throw new BadRequestException(
        "Taslak fatura gönderilemez; önce kesinleştirin",
      );
    }
    let alici = aliciEposta;
    if (!alici) {
      const { tenantId } = aktifBaglam();
      const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariHesap.findUnique({
          where: { id: fatura.cariId },
          select: { eposta: true },
        }),
      );
      alici = cari?.eposta ?? undefined;
    }
    if (!alici) {
      throw new BadRequestException(
        "Alıcı e-postası yok: cari kartına e-posta ekleyin veya adres belirtin",
      );
    }
    // GİB'e gitmiş faturada müşteriye resmî belgenin görünümü gider; bizim
    // şablonumuz yalnız e-Belgesi olmayan (kâğıt) faturanın çıktısıdır.
    const resmi = await this.resmiGorunum(id, fatura.ebelge);
    const { buffer, dosyaAdi } = resmi ?? (await this.pdfUret(id));
    const belgeAdi = resmi ? (fatura.ebelge?.tur === "earsiv" ? "e-Arşiv faturanız" : "e-Faturanız") : "faturanız";
    await this.eposta.ekliIletiGonder({
      alici,
      sablon: { tur: "fatura_eposta", degiskenler: { cari: fatura.cari.unvan, belge_no: fatura.no, belge_adi: belgeAdi } },
      ekler: [{ dosyaAdi, icerik: buffer, mime: "application/pdf" }],
    });
    return { gonderildi: true, alici, belge: resmi ? "ebelge" as const : "sistem" as const };
  }

  /**
   * Gönderilmiş e-Belgenin resmî görünümü (entegratörün PDF'i, alınamazsa
   * arşivdeki UBL'den basılan görünüm). Belge gönderilmemiş ya da hata
   * almışsa `null`: o faturanın resmî bir e-Belgesi yoktur.
   */
  private async resmiGorunum(faturaId: string, ebelge: { durum: string } | null | undefined) {
    if (!ebelge || ebelge.durum === "hata" || ebelge.durum === "kuyrukta") return null;
    try {
      return await this.ebelgeGorunum.gidenPdf(faturaId);
    } catch (hata) {
      if (hata instanceof NotFoundException) return null;
      throw hata;
    }
  }

  // ─── PRIVATE YARDIMCILAR ──────────────────────────────────────────────────

  private partiBilgileriniOku(deger: Prisma.JsonValue | null) {
    if (!Array.isArray(deger)) return [];
    return deger.flatMap((p) => {
      if (!p || typeof p !== "object" || Array.isArray(p)) return [];
      const kayit = p as Record<string, Prisma.JsonValue>;
      if (typeof kayit.lotNo !== "string" || typeof kayit.miktar !== "string") return [];
      return [{ lotNo: kayit.lotNo, seriNo: typeof kayit.seriNo === "string" ? kayit.seriNo : null, sonKullanmaTarihi: typeof kayit.sonKullanmaTarihi === "string" ? kayit.sonKullanmaTarihi : null, uretimTarihi: typeof kayit.uretimTarihi === "string" ? kayit.uretimTarihi : null, miktar: D(kayit.miktar) }];
    });
  }

  private hesaplaFatura(girdi: {
    ihracKayitliKodu?: string | null;
    ozelMatrahKodu?: string | null;
    ozelMatrahTutari?: string | number | Prisma.Decimal | null;
    ozelMatrahOrani?: string | number | Prisma.Decimal | null;
    satirlar: {
      stokId: string;
      miktar: string | number | Prisma.Decimal;
      birimFiyat: string | number | Prisma.Decimal;
      iskontoOrani: string | number | Prisma.Decimal;
      kdvOrani: string | number | Prisma.Decimal;
      tevkifatKodu?: string | null;
      tevkifatOrani?: string | null;
      tevkifatPay?: number | null;
      tevkifatPayda?: number | null;
    }[];
    genelIskontoYuzdesi?: string | number | Prisma.Decimal;
    genelIskontoTutari?: string | number | Prisma.Decimal;
  }, tevkifatTablosu?: readonly TevkifatKodu[], ekVergiler?: EkVergi[][]) {
    const satirGirdileri: FaturaHesaplaSatirGirdi[] = girdi.satirlar.map((s, i) => {
      // Oran GİB kodundan türer (FTR-18). Saklı satırlar yeniden hesaplanırken
      // kod henüz yoksa mevcut pay/payda korunur.
      const oran = tevkifatPayPayda(s.tevkifatKodu, s.tevkifatOrani, tevkifatTablosu);
      return {
        stokId: s.stokId,
        miktar: Number(s.miktar),
        birimFiyat: Number(s.birimFiyat),
        iskontoOrani: Number(s.iskontoOrani),
        kdvOrani: Number(s.kdvOrani),
        tevkifatPay: oran?.pay ?? s.tevkifatPay ?? undefined,
        tevkifatPayda: oran?.payda ?? s.tevkifatPayda ?? undefined,
        ekVergiler: (ekVergiler?.[i] ?? []).map(hesapGirdisi),
      };
    });

    return faturaHesapla({
      satirlar: satirGirdileri,
      genelIskontoYuzdesi: girdi.genelIskontoYuzdesi ? Number(girdi.genelIskontoYuzdesi) : 0,
      genelIskontoTutari: girdi.genelIskontoTutari ? Number(girdi.genelIskontoTutari) : 0,
      kdvTahsilEdilmez: Boolean(girdi.ihracKayitliKodu),
      // Özel matrahta satırlar KDV'siz girilir; KDV belgeye girilen matrahtan
      // doğar ve genel toplama eklenir (karar 2026-09-20).
      ozelMatrahKdvsi: girdi.ozelMatrahKodu
        ? ozelMatrahKdvsi(girdi.ozelMatrahTutari?.toString(), girdi.ozelMatrahOrani?.toString())
        : 0,
    });
  }

  private eylemler(kayit: { durum: string }, _rol: string): KayitEylem[] {
    return izinliEylemler("fatura", { durum: kayit.durum }, aktifBaglam());
  }

  private gorunum(k: {
    id: string;
    tip: string;
    durum: string;
    no: string | null;
    seri: string | null;
    sira: number | null;
    tarih: Date;
    vadeTarihi: Date | null;
    siparisNo: string | null;
    siparisTarihi: Date | null;
    talepNo: string | null;
    talepTarihi: Date | null;
    ilgiliKisi: string | null;
    ilgiliKisiGorevi: string | null;
    cariId: string;
    senaryo: string;
    efaturaProfili: string;
    earsivGonderimSekli: string;
    /** FTR-40: basım dili. */
    belgeDili?: string;
    ciftDil?: boolean;
    ihracKayitliKodu?: string | null;
    ihracatTeslimTarihi?: Date | null;
    ihracatTeslimSarti?: string | null;
    ihracatTasimaSekli?: string | null;
    gumrukBeyannameNo?: string | null;
    gumrukBeyannameTarihi?: Date | null;
    kamuHarcamaBirimiVkn?: string | null;
    kamuHarcamaBirimiAdi?: string | null;
    kamuIban?: string | null;
    ozelMatrahKodu?: string | null;
    ozelMatrahTutari?: Prisma.Decimal | null;
    ozelMatrahOrani?: Prisma.Decimal | null;
    idisSevkiyatNo?: string | null;
    ytbNo?: string | null;
    ytbTarihi?: Date | null;
    sarjPlaka?: string | null;
    sarjBaslangic?: Date | null;
    sarjBitis?: Date | null;
    sarjEsuRaporlari?: unknown;
    sgkIlaveFaturaTipi?: string | null;
    sgkMukellefKodu?: string | null;
    sgkMukellefAdi?: string | null;
    sgkDosyaNo?: string | null;
    sgkDonemBaslangic?: Date | null;
    sgkDonemBitis?: Date | null;
    yolcuBeraberi?: unknown;
    depoId: string | null;
    teslimatAdres: string | null;
    teslimatIl: string | null;
    teslimatIlce: string | null;
    teslimatPostaKodu: string | null;
    dovizCinsi: string;
    kur: Prisma.Decimal;
    genelIskontoYuzdesi: Prisma.Decimal;
    genelIskontoTutari: Prisma.Decimal;
    toplamBrut: Prisma.Decimal;
    toplamSatirIskontosu: Prisma.Decimal;
    genelIskontoToplam: Prisma.Decimal;
    toplamMatrah: Prisma.Decimal;
    toplamKdv: Prisma.Decimal;
    toplamTevkifat: Prisma.Decimal;
    toplamNetKdv: Prisma.Decimal;
    toplamEkVergi?: Prisma.Decimal;
    toplamStopaj?: Prisma.Decimal;
    genelToplam: Prisma.Decimal;
    aciklama: string | null;
    notlar: string | null;
    tekrarlayanPlanId?: string | null;
    planlananTarih?: Date | null;
    satirlar?: Array<{
      id: string;
      stokId: string;
      varyantId?: string | null;
      miktar: Prisma.Decimal;
      birimFiyat: Prisma.Decimal;
      iskontoOrani: Prisma.Decimal;
      iskontoTutari?: Prisma.Decimal;
      netTutar?: Prisma.Decimal;
      kdvOrani: Prisma.Decimal;
      kdvTutari?: Prisma.Decimal;
      tevkifatOrani?: number;
      tevkifatTutari?: Prisma.Decimal;
      satirToplami?: Prisma.Decimal;
      gibIstisnaKodu?: string | null;
      projeId?: string | null;
      projeAltKirilimId?: string | null;
      proje?: { id: string; kod: string; ad: string } | null;
      projeAltKirilim?: { id: string; kod: string; ad: string } | null;
      stok?: { id: string; kod: string; ad: string } | null;
    }>;
  }) {
    return {
      id: k.id,
      tip: k.tip,
      durum: k.durum,
      no: k.no,
      seri: k.seri,
      sira: k.sira,
      tarih: k.tarih.toISOString().slice(0, 10),
      vadeTarihi: k.vadeTarihi?.toISOString().slice(0, 10) ?? null,
      siparisNo: k.siparisNo,
      siparisTarihi: k.siparisTarihi?.toISOString().slice(0, 10) ?? null,
      talepNo: k.talepNo,
      ilgiliKisi: k.ilgiliKisi,
      ilgiliKisiGorevi: k.ilgiliKisiGorevi,
      talepTarihi: k.talepTarihi?.toISOString().slice(0, 10) ?? null,
      cariId: k.cariId,
      senaryo: k.senaryo,
      efaturaProfili: k.efaturaProfili,
      earsivGonderimSekli: k.earsivGonderimSekli,
      belgeDili: belgeDiliNormalize(k.belgeDili),
      ciftDil: k.ciftDil ?? false,
      // EBLG-60: ihraç kayıtlı satış kodu; boşsa normal satış.
      ihracKayitliKodu: k.ihracKayitliKodu ?? null,
      // EBLG-63: malın ihraç edilmesi gereken son gün; beyanname gelince takip biter.
      ihracKayitliSonTarih: k.ihracKayitliKodu ? ihracKayitliSonTarih(k.tarih) : null,
      // EBLG-53/54: ihracat ve gümrük alanları; yurt içi faturada boş durur.
      ihracatTeslimTarihi: k.ihracatTeslimTarihi?.toISOString().slice(0, 10) ?? null,
      ihracatTeslimSarti: k.ihracatTeslimSarti ?? null,
      ihracatTasimaSekli: k.ihracatTasimaSekli ?? null,
      gumrukBeyannameNo: k.gumrukBeyannameNo ?? null,
      gumrukBeyannameTarihi: k.gumrukBeyannameTarihi?.toISOString().slice(0, 10) ?? null,
      // KAMU senaryosu: sihirbazda seçilen harcama birimi ve IBAN.
      kamuHarcamaBirimiVkn: k.kamuHarcamaBirimiVkn ?? null,
      kamuHarcamaBirimiAdi: k.kamuHarcamaBirimiAdi ?? null,
      kamuIban: k.kamuIban ?? null,
      // Özel matrah (KDV K. 23): kod, matrah ve oran; KDV belge düzeyindedir.
      ozelMatrahKodu: k.ozelMatrahKodu ?? null,
      ozelMatrahTutari: k.ozelMatrahTutari ? D(k.ozelMatrahTutari).toFixed(2) : null,
      ozelMatrahOrani: k.ozelMatrahOrani ? D(k.ozelMatrahOrani).toFixed(2) : null,
      // İDİS ve şarj alanları (EBLG-71/72); PDF ve sihirbaz bunları okur.
      idisSevkiyatNo: k.idisSevkiyatNo ?? null,
      // Yatırım teşvik belgesi (EBLG-78): numara doluysa belge YTB kapsamında.
      ytbNo: k.ytbNo ?? null,
      ytbTarihi: k.ytbTarihi ? k.ytbTarihi.toISOString().slice(0, 10) : null,
      sarjPlaka: k.sarjPlaka ?? null,
      sarjBaslangic: k.sarjBaslangic ? k.sarjBaslangic.toISOString() : null,
      sarjBitis: k.sarjBitis ? k.sarjBitis.toISOString() : null,
      sarjEsuRaporlari: (k.sarjEsuRaporlari as { raporId: string; tarih: string }[] | null) ?? null,
      // SGK faturası: grup, Kurum'daki kod/ad, dosya no ve dönem (EBLG-70).
      sgkIlaveFaturaTipi: k.sgkIlaveFaturaTipi ?? null,
      sgkMukellefKodu: k.sgkMukellefKodu ?? null,
      sgkMukellefAdi: k.sgkMukellefAdi ?? null,
      sgkDosyaNo: k.sgkDosyaNo ?? null,
      sgkDonemBaslangic: k.sgkDonemBaslangic ? k.sgkDonemBaslangic.toISOString() : null,
      sgkDonemBitis: k.sgkDonemBitis ? k.sgkDonemBitis.toISOString() : null,
      // Yolcu beraberi (tax-free): yolcu ve aracı kurum bilgisi; boşsa değildir.
      yolcuBeraberi: (k.yolcuBeraberi as Record<string, unknown> | null) ?? null,
      depoId: k.depoId,
      teslimatAdres: k.teslimatAdres,
      teslimatIl: k.teslimatIl,
      teslimatIlce: k.teslimatIlce,
      teslimatPostaKodu: k.teslimatPostaKodu,
      dovizCinsi: k.dovizCinsi,
      kur: D(k.kur).toFixed(4),
      genelIskontoYuzdesi: D(k.genelIskontoYuzdesi).toFixed(2),
      genelIskontoTutari: D(k.genelIskontoTutari).toFixed(2),
      toplamBrut: D(k.toplamBrut).toFixed(2),
      toplamSatirIskontosu: D(k.toplamSatirIskontosu).toFixed(2),
      genelIskontoToplam: D(k.genelIskontoToplam).toFixed(2),
      toplamMatrah: D(k.toplamMatrah).toFixed(2),
      toplamKdv: D(k.toplamKdv).toFixed(2),
      toplamTevkifat: D(k.toplamTevkifat).toFixed(2),
      toplamNetKdv: D(k.toplamNetKdv).toFixed(2),
      // EBLG-120: bedele eklenen KDV dışı vergiler ve kesilen stopaj.
      toplamEkVergi: D(k.toplamEkVergi ?? 0).toFixed(2),
      toplamStopaj: D(k.toplamStopaj ?? 0).toFixed(2),
      genelToplam: D(k.genelToplam).toFixed(2),
      aciklama: k.aciklama,
      notlar: k.notlar,
      tekrarlayanPlanId: k.tekrarlayanPlanId ?? null,
      planlananTarih: k.planlananTarih?.toISOString().slice(0, 10) ?? null,
      satirlar: k.satirlar?.map((s) => ({
        id: s.id,
        stokId: s.stokId,
        varyantId: s.varyantId ?? null,
        miktar: s.miktar !== undefined && s.miktar !== null ? D(s.miktar).toNumber() : 0,
        birimFiyat: s.birimFiyat !== undefined && s.birimFiyat !== null ? D(s.birimFiyat).toFixed(2) : "0.00",
        iskontoOrani: s.iskontoOrani !== undefined && s.iskontoOrani !== null ? D(s.iskontoOrani).toFixed(2) : "0.00",
        iskontoTutari: s.iskontoTutari !== undefined && s.iskontoTutari !== null ? D(s.iskontoTutari).toFixed(2) : "0.00",
        netTutar: s.netTutar !== undefined && s.netTutar !== null ? D(s.netTutar).toFixed(2) : "0.00",
        kdvOrani: s.kdvOrani !== undefined && s.kdvOrani !== null ? D(s.kdvOrani).toFixed(2) : "0.00",
        kdvTutari: s.kdvTutari !== undefined && s.kdvTutari !== null ? D(s.kdvTutari).toFixed(2) : "0.00",
        tevkifatOrani: s.tevkifatOrani ?? 0,
        tevkifatTutari: s.tevkifatTutari !== undefined && s.tevkifatTutari !== null ? D(s.tevkifatTutari).toFixed(2) : "0.00",
        satirToplami: s.satirToplami !== undefined && s.satirToplami !== null ? D(s.satirToplami).toFixed(2) : "0.00",
        gibIstisnaKodu: s.gibIstisnaKodu ?? null,
        projeId: s.projeId ?? null,
        projeAltKirilimId: s.projeAltKirilimId ?? null,
        proje: s.proje ? { id: s.proje.id, kod: s.proje.kod, ad: s.proje.ad } : null,
        projeAltKirilim: s.projeAltKirilim ? { id: s.projeAltKirilim.id, kod: s.projeAltKirilim.kod, ad: s.projeAltKirilim.ad } : null,
        stok: s.stok ? { id: s.stok.id, kod: s.stok.kod, ad: s.stok.ad } : null,
      })),
    };
  }
}
