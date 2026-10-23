import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { muhtelifMusteriMi } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { CariService } from "./cari.service";
import { ciftAnahtari, FARKLI_UNVAN_ESIGI, mukerrerGruplari, unvanBenzerligi, unvanKelimeleri } from "./cari-mukerrer";

type Tx = Prisma.TransactionClient;

/** Birleştirmede taşınmayan cari bağları: geçmiş kayıtları kendi kartını göstermeli. */
const TASINMAZ = new Set(["cari_mukerrer_istisnalari", "cari_birlestirmeleri"]);
/** Veritabanında yabancı anahtarı olmayan cari bağları. */
const EK_BAGLAR = [{ tablo: "ekstre_kurallari", sutun: "cari_id", guncellenebilir: true }];
/**
 * Cari kimliğini değiştirmeyi veritabanı tetikleyicisinin reddettiği geçmişler
 * (CARI-50/52 söz ve takip, F03 fırsat bağları): bu kayıtları olan kart taşınamaz.
 */
const DEGISMEZ_GECMIS: Array<{ tablo: string; ad: string }> = [
  { tablo: "odeme_sozleri", ad: "ödeme sözü" },
  { tablo: "tahsilat_takipleri", ad: "tahsilat takibi" },
  { tablo: "firsat_belge_baglari", ad: "CRM fırsat–belge bağı" },
  { tablo: "firsat_iade_paylari", ad: "CRM fırsat iade payı" },
  { tablo: "firsat_kapama_paylari", ad: "CRM fırsat kapama payı" },
];

const TABLO_ADI: Record<string, string> = {
  faturalar: "Fatura", belgeler: "Teklif / sipariş / irsaliye", cari_hareketler: "Cari hareket", kasa_banka_hareketleri: "Kasa / banka fişi",
  fatura_kapamalari: "Fatura kapama", cek_senetler: "Çek / senet", cek_senet_bordrolari: "Çek bordrosu", masraflar: "Masraf", gelir_kayitlari: "Gelir kaydı",
  kredi_karti_hareketleri: "Kredi kartı hareketi", pos_tahsilatlari: "POS tahsilatı", banka_odeme_talimatlari: "Ödeme talimatı",
  banka_ekstre_satirlari: "Banka ekstre satırı", ekstre_kurallari: "Ekstre kuralı", cari_adresler: "Adres", cari_kisiler: "İlgili kişi",
  cari_banka_hesaplari: "Banka hesabı", cari_etiket_atamalari: "Etiket", cari_teminatlari: "Teminat", cari_mutabakatlari: "Mutabakat",
  crm_etkilesimleri: "CRM etkileşimi", crm_gorevleri: "CRM görevi", crm_firsatlari: "CRM fırsatı", gelen_epostalar: "Gelen e-posta",
  eposta_teklif_islemleri: "E-postadan teklif", stok_tedarikcileri: "Stok tedarikçisi", satin_alma_teklifleri: "Satın alma teklifi",
  pazaryeri_siparisleri: "Pazaryeri siparişi", kira_sozlesmeleri: "Kira sözleşmesi", projeler: "Proje", ai_hafiza: "Asistan hafızası",
  fatura_gecikme_tahminleri: "Gecikme tahmini", on_denetim_susturmalari: "Ön denetim susturması", users: "Bayi kullanıcısı",
  cari_hesaplar: "Önceden birleştirilmiş kart",
};

/** Ana kartta boşsa taşınan karttan doldurulan alanlar (CARI-59). */
const DOLAN_ALANLAR = [
  "vknTckn", "vergiDairesi", "mersisNo", "ticaretSicilNo", "kvkkOnayTarihi", "eposta", "telefon", "webSitesi", "faks", "iban", "kisaAd", "sektor",
  "temsilciUserId", "grupId", "fiyatListesiId", "varsayilanIskonto", "varsayilanVadeGun", "riskLimiti", "eFaturaMukellefi", "efaturaPostaKutusu",
  "eirsaliyePostaKutusu", "harcamaBirimiVkn", "harcamaBirimiAdi", "belgeDili", "muhasebeKodu", "notlar",
] as const;
const ALAN_ADI: Record<string, string> = {
  vknTckn: "VKN/TCKN", vergiDairesi: "Vergi dairesi", mersisNo: "MERSİS no", ticaretSicilNo: "Ticaret sicil no", kvkkOnayTarihi: "KVKK onay tarihi",
  eposta: "E-posta", telefon: "Telefon", webSitesi: "Web sitesi", faks: "Faks", iban: "IBAN", kisaAd: "Kısa ad", sektor: "Sektör", temsilciUserId: "Temsilci",
  grupId: "Cari grubu", fiyatListesiId: "Fiyat listesi", varsayilanIskonto: "Varsayılan iskonto", varsayilanVadeGun: "Varsayılan vade", riskLimiti: "Risk limiti",
  eFaturaMukellefi: "e-Fatura mükellefiyeti", efaturaPostaKutusu: "e-Fatura posta kutusu", eirsaliyePostaKutusu: "e-İrsaliye posta kutusu",
  harcamaBirimiVkn: "Harcama birimi VKN", harcamaBirimiAdi: "Harcama birimi adı", belgeDili: "Belge dili", muhasebeKodu: "Muhasebe kodu", notlar: "Notlar",
};

const KART_SECIMI = {
  id: true, kod: true, unvan: true, tip: true, aktif: true, karaListe: true, karaListeNotu: true, dovizCinsi: true, birlestigiCariId: true,
  personel: { select: { id: true } },
  vknTckn: true, vergiDairesi: true, mersisNo: true, ticaretSicilNo: true, kvkkOnayTarihi: true, eposta: true, telefon: true, webSitesi: true, faks: true,
  iban: true, kisaAd: true, sektor: true, temsilciUserId: true, grupId: true, fiyatListesiId: true, varsayilanIskonto: true, varsayilanVadeGun: true,
  riskLimiti: true, eFaturaMukellefi: true, efaturaPostaKutusu: true, eirsaliyePostaKutusu: true, harcamaBirimiVkn: true, harcamaBirimiAdi: true,
  belgeDili: true, muhasebeKodu: true, notlar: true,
} as const satisfies Prisma.CariHesapSelect & Record<(typeof DOLAN_ALANLAR)[number], true>;
type Kart = Prisma.CariHesapGetPayload<{ select: typeof KART_SECIMI }>;

interface Bag { tablo: string; sutun: string; guncellenebilir: boolean }
/** Uygulama rolüne UPDATE'i kapalı (yalnız eklenen) bağlar ve onları taşıyan dar veritabanı işlevleri. */
const ISLEVLE_TASINAN: Record<string, string> = { "cari_hareketler.cari_id": "cari_birlestirme_hareket_tasi" };

export interface TasinanOnizleme {
  cari: { id: string; kod: string; unvan: string };
  engeller: string[];
  uyarilar: string[];
  /** Taşınacak kayıtlar, tablo adıyla. */
  kayitlar: Array<{ ad: string; adet: number }>;
  doldurulacaklar: string[];
}

const bos = (d: unknown) => d === null || d === undefined || d === "";
const esit = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

/**
 * CARI-56…62: mükerrer cari raporu, "aynı değil" işareti ve birleştirme.
 * Birleştirme geri alınmaz (karar 2026-10-23); her taşımanın izi
 * `cari_birlestirmeleri`nde kalır.
 */
@Injectable()
export class CariBirlestirmeService {
  constructor(private readonly prisma: PrismaService, private readonly cari: CariService) {}

  async rapor() {
    const { tenantId } = aktifBaglam();
    const { kartlar, istisnalar } = await this.prisma.tenantIslem(tenantId, async (tx) => ({
      kartlar: await tx.cariHesap.findMany({
        where: { birlestigiCariId: null },
        select: { id: true, kod: true, unvan: true, tip: true, aktif: true, karaListe: true, dovizCinsi: true, vknTckn: true, iban: true, eposta: true, telefon: true, personel: { select: { id: true } } },
      }),
      istisnalar: await tx.cariMukerrerIstisna.findMany({ select: { cariAId: true, cariBId: true } }),
    }));
    const gruplar = mukerrerGruplari(
      kartlar.map((k) => ({ ...k, personel: k.tip === "personel" || Boolean(k.personel) })),
      new Set(istisnalar.map((i) => ciftAnahtari(i.cariAId, i.cariBId))),
    );
    const ilgili = [...new Set(gruplar.flatMap((g) => g.kartIdleri))];
    const [bakiyeler, hareketler] = await Promise.all([
      this.cari.bakiyeleriGetir(ilgili),
      this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findMany({
        where: { id: { in: ilgili } },
        select: { id: true, _count: { select: { hareketler: true, faturas: true } }, hareketler: { select: { tarih: true }, orderBy: { tarih: "desc" }, take: 1 } },
      })),
    ]);
    const sayim = new Map(hareketler.map((h) => [h.id, h]));
    const kartMap = new Map(kartlar.map((k) => [k.id, k]));
    return {
      gruplar: gruplar.map((g) => ({
        tur: g.tur,
        nedenler: g.nedenler,
        birlestirilebilir: g.tur !== "farkli_rol",
        kartlar: g.kartIdleri.map((id) => {
          const k = kartMap.get(id)!;
          const s = sayim.get(id);
          return {
            id, kod: k.kod, unvan: k.unvan, tip: k.tip, aktif: k.aktif, karaListe: k.karaListe, dovizCinsi: k.dovizCinsi, vknTckn: k.vknTckn,
            personel: k.tip === "personel" || Boolean(k.personel),
            bakiyeTry: (bakiyeler.get(id) ?? []).reduce((t, b) => t.add(b.bakiyeGuncelTry), new Prisma.Decimal(0)).toFixed(2),
            hareketSayisi: s?._count.hareketler ?? 0,
            faturaSayisi: s?._count.faturas ?? 0,
            sonHareket: s?.hareketler[0]?.tarih.toISOString().slice(0, 10) ?? null,
          };
        }),
      })),
      istisnaSayisi: istisnalar.length,
    };
  }

  /** CARI-57: verilen kartların her çifti "aynı değil" işaretlenir. */
  async istisnaEkle(cariIdler: string[]) {
    const { tenantId, userId } = aktifBaglam();
    const tekil = [...new Set(cariIdler)];
    if (tekil.length < 2) throw new BadRequestException("En az iki cari seçin");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bulunan = await tx.cariHesap.count({ where: { id: { in: tekil } } });
      if (bulunan !== tekil.length) throw new NotFoundException("Cari bulunamadı");
      const ciftler = tekil.flatMap((a, i) => tekil.slice(i + 1).map((b) => (a < b ? [a, b] : [b, a])));
      const { count } = await tx.cariMukerrerIstisna.createMany({
        data: ciftler.map(([cariAId, cariBId]) => ({ tenantId, cariAId, cariBId, userId: userId || null })),
        skipDuplicates: true,
      });
      return { eklenen: count };
    });
  }

  async istisnalar() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.cariMukerrerIstisna.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
      const kartlar = new Map((await tx.cariHesap.findMany({
        where: { id: { in: kayitlar.flatMap((k) => [k.cariAId, k.cariBId]) } }, select: { id: true, kod: true, unvan: true },
      })).map((k) => [k.id, k]));
      return kayitlar.map((k) => ({ id: k.id, a: kartlar.get(k.cariAId) ?? null, b: kartlar.get(k.cariBId) ?? null, tarih: k.createdAt }));
    });
  }

  async istisnaKaldir(id: string) {
    const { tenantId } = aktifBaglam();
    const { count } = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariMukerrerIstisna.deleteMany({ where: { id } }));
    if (!count) throw new NotFoundException("İşaret bulunamadı");
    return { silindi: true };
  }

  async onizleme(anaCariId: string, tasinanCariIdler: string[]) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => this.denetle(tx, tenantId, anaCariId, tasinanCariIdler), { timeout: 30_000 });
  }

  /** CARI-59…62: taşınan kartların bütün kayıtları ana karta aktarılır; kartlar pasif kalır. */
  async birlestir(anaCariId: string, tasinanCariIdler: string[]) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM cari_hesaplar WHERE id = ANY(${[anaCariId, ...tasinanCariIdler]}::uuid[]) ORDER BY id FOR UPDATE`;
      const durum = await this.denetle(tx, tenantId, anaCariId, tasinanCariIdler);
      const engelli = durum.tasinanlar.filter((t) => t.engeller.length);
      if (durum.anaEngelleri.length || engelli.length) {
        throw new ConflictException([...durum.anaEngelleri, ...engelli.map((t) => `${t.cari.kod}: ${t.engeller.join("; ")}`)].join(" · "));
      }
      const baglar = await this.baglar(tx);
      const sonuclar = [];
      for (const t of durum.tasinanlar) {
        const ana = await tx.cariHesap.findUniqueOrThrow({ where: { id: anaCariId }, select: KART_SECIMI });
        const tasinan = await tx.cariHesap.findUniqueOrThrow({ where: { id: t.cari.id }, select: KART_SECIMI });
        const dusenler = await this.cakismalariGider(tx, ana.id, tasinan.id);
        const tasinanlar: Record<string, number> = {};
        for (const b of baglar) {
          const islev = ISLEVLE_TASINAN[`${b.tablo}.${b.sutun}`];
          const adet = b.guncellenebilir
            ? await tx.$executeRawUnsafe(`UPDATE "${b.tablo}" SET "${b.sutun}" = $1::uuid WHERE "${b.sutun}" = $2::uuid`, ana.id, tasinan.id)
            : (await tx.$queryRawUnsafe<Array<{ adet: number }>>(`SELECT ${islev}($1::uuid, $2::uuid) AS adet`, ana.id, tasinan.id))[0].adet;
          if (adet) tasinanlar[`${b.tablo}.${b.sutun}`] = adet;
        }
        const doldurulanlar = Object.fromEntries(DOLAN_ALANLAR.filter((a) => bos(ana[a]) && !bos(tasinan[a])).map((a) => [a, tasinan[a]]));
        const karaListe = !ana.karaListe && tasinan.karaListe;
        await tx.cariHesap.update({
          where: { id: ana.id },
          data: {
            ...doldurulanlar,
            ...(karaListe ? { karaListe: true, karaListeNotu: [ana.karaListeNotu, tasinan.karaListeNotu ? `${tasinan.kod}: ${tasinan.karaListeNotu}` : `${tasinan.kod} kara listedeydi`].filter(Boolean).join("\n") } : {}),
          } as Prisma.CariHesapUncheckedUpdateInput,
        });
        await tx.cariHesap.update({ where: { id: tasinan.id }, data: { aktif: false, birlestigiCariId: ana.id } });
        const iz = { tasinanlar, dusenler, doldurulanlar: { ...doldurulanlar, ...(karaListe ? { karaListe: true } : {}) }, uyarilar: t.uyarilar };
        await tx.cariBirlestirme.create({ data: { tenantId, anaCariId: ana.id, tasinanCariId: tasinan.id, userId: userId || null, ...(JSON.parse(JSON.stringify(iz)) as typeof iz) } });
        await tx.auditLog.create({
          data: { tenantId, userId, islem: "cari_birlestir", varlik: "cari", varlikId: ana.id, detay: JSON.parse(JSON.stringify({ tasinanCariId: tasinan.id, tasinanKod: tasinan.kod, ...iz })) },
        });
        sonuclar.push({ cari: t.cari, tasinanKayit: Object.values(tasinanlar).reduce((a, b) => a + b, 0), dusenKayit: Object.values(dusenler).reduce((a, b) => a + b, 0), doldurulanlar: Object.keys(doldurulanlar).map((a) => ALAN_ADI[a] ?? a) });
      }
      return { anaCariId, sonuclar };
    }, { timeout: 120_000 });
  }

  /** Cariye bağlı bütün sütunlar: tek sütunlu yabancı anahtarlar + şemada anahtarı olmayan bağlar. */
  private async baglar(tx: Tx): Promise<Bag[]> {
    const fk = await tx.$queryRaw<Bag[]>`
      SELECT c.conrelid::regclass::text AS tablo, a.attname::text AS sutun,
        has_column_privilege(c.conrelid, a.attname, 'UPDATE') AS guncellenebilir
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'cari_hesaplar'::regclass AND array_length(c.conkey, 1) = 1
      ORDER BY 1, 2`;
    const sonuc = [...fk.filter((b) => !TASINMAZ.has(b.tablo)), ...EK_BAGLAR];
    // Yeni bir yalnız-ekleme tablosu cariye bağlanırsa sessizce atlanmasın.
    const islevsiz = sonuc.filter((b) => !b.guncellenebilir && !ISLEVLE_TASINAN[`${b.tablo}.${b.sutun}`]);
    if (islevsiz.length) throw new ConflictException(`Birleştirme şu bağları taşıyamıyor: ${islevsiz.map((b) => `${b.tablo}.${b.sutun}`).join(", ")}`);
    return sonuc;
  }

  /** Tekil kısıtta çakışacak kopyalar ana kartınkiyle birleşir, taşınan kopya düşer. */
  private async cakismalariGider(tx: Tx, ana: string, tasinan: string) {
    const dusen: Record<string, number> = {};
    const say = (tablo: string, adet: number) => { if (adet) dusen[tablo] = (dusen[tablo] ?? 0) + adet; };
    say("cari_etiket_atamalari", await tx.$executeRaw`
      DELETE FROM cari_etiket_atamalari t WHERE t.cari_id = ${tasinan}::uuid
        AND EXISTS (SELECT 1 FROM cari_etiket_atamalari a WHERE a.cari_id = ${ana}::uuid AND a.etiket_id = t.etiket_id)`);
    say("on_denetim_susturmalari", await tx.$executeRaw`
      DELETE FROM on_denetim_susturmalari t WHERE t.cari_id = ${tasinan}::uuid
        AND EXISTS (SELECT 1 FROM on_denetim_susturmalari a WHERE a.cari_id = ${ana}::uuid AND a.kod = t.kod)`);
    // Aynı stoğun tedarikçi satırı: ana satırın boş alanları ve varyant kodları taşınandan tamamlanır.
    await tx.$executeRaw`
      UPDATE stok_tedarikcileri a SET
        varsayilan = a.varsayilan OR t.varsayilan,
        alis_fiyati = COALESCE(a.alis_fiyati, t.alis_fiyati),
        doviz_cinsi = CASE WHEN a.alis_fiyati IS NULL AND t.alis_fiyati IS NOT NULL THEN t.doviz_cinsi ELSE a.doviz_cinsi END,
        tedarik_suresi_gun = COALESCE(a.tedarik_suresi_gun, t.tedarik_suresi_gun),
        tedarikci_urun_kodu = COALESCE(a.tedarikci_urun_kodu, t.tedarikci_urun_kodu)
      FROM stok_tedarikcileri t
      WHERE a.cari_id = ${ana}::uuid AND t.cari_id = ${tasinan}::uuid AND a.stok_id = t.stok_id`;
    await tx.$executeRaw`
      UPDATE stok_tedarikci_varyant_kodlari v SET stok_tedarikci_id = a.id
      FROM stok_tedarikcileri t JOIN stok_tedarikcileri a ON a.stok_id = t.stok_id AND a.cari_id = ${ana}::uuid
      WHERE v.stok_tedarikci_id = t.id AND t.cari_id = ${tasinan}::uuid
        AND NOT EXISTS (SELECT 1 FROM stok_tedarikci_varyant_kodlari x WHERE x.stok_tedarikci_id = a.id AND x.varyant_id = v.varyant_id)`;
    say("stok_tedarikcileri", await tx.$executeRaw`
      DELETE FROM stok_tedarikcileri t WHERE t.cari_id = ${tasinan}::uuid
        AND EXISTS (SELECT 1 FROM stok_tedarikcileri a WHERE a.cari_id = ${ana}::uuid AND a.stok_id = t.stok_id)`);
    // Aynı IBAN ikinci kez eklenmez; ona bağlı ödeme talimatı ana karttaki hesaba döner.
    await tx.$executeRaw`
      UPDATE banka_odeme_talimatlari o SET cari_banka_hesap_id = a.id
      FROM cari_banka_hesaplari t JOIN cari_banka_hesaplari a ON a.cari_id = ${ana}::uuid AND upper(replace(a.iban, ' ', '')) = upper(replace(t.iban, ' ', ''))
      WHERE o.cari_banka_hesap_id = t.id AND t.cari_id = ${tasinan}::uuid`;
    say("cari_banka_hesaplari", await tx.$executeRaw`
      DELETE FROM cari_banka_hesaplari t WHERE t.cari_id = ${tasinan}::uuid
        AND EXISTS (SELECT 1 FROM cari_banka_hesaplari a WHERE a.cari_id = ${ana}::uuid AND upper(replace(a.iban, ' ', '')) = upper(replace(t.iban, ' ', '')))`);
    return dusen;
  }

  private async denetle(tx: Tx, tenantId: string, anaCariId: string, tasinanCariIdler: string[]) {
    const tekil = [...new Set(tasinanCariIdler)].filter((id) => id !== anaCariId);
    if (!tekil.length) throw new BadRequestException("Ana karttan başka en az bir cari seçin");
    if (tekil.length > 20) throw new BadRequestException("Bir seferde en çok 20 kart birleştirilir");
    const kartlar = await tx.cariHesap.findMany({ where: { id: { in: [anaCariId, ...tekil] } }, select: KART_SECIMI });
    const ana = kartlar.find((k) => k.id === anaCariId);
    if (!ana || kartlar.length !== tekil.length + 1) throw new NotFoundException("Cari bulunamadı");
    const kiraci = await tx.tenant.findUnique({ where: { id: tenantId }, select: { vkn: true } });
    const ortakEngel = (k: Kart, rol: string) => [
      ...(k.tip === "personel" || k.personel ? [`${rol} personel kartı; personel kartı birleştirilmez`] : []),
      ...(muhtelifMusteriMi({ vknTckn: k.vknTckn }) ? [`${rol} Muhtelif Müşteriler kartı`] : []),
      ...(kiraci?.vkn && k.vknTckn?.trim() === kiraci.vkn ? [`${rol} firmanın kendi VKN'si ile açılmış`] : []),
      ...(k.birlestigiCariId ? [`${rol} zaten başka bir karta birleştirilmiş`] : []),
    ];
    const anaEngelleri = [...ortakEngel(ana, "Ana kart"), ...(!ana.aktif ? ["Ana kart pasif; önce etkinleştirin"] : [])];
    const baglar = await this.baglar(tx);
    const kilitli = new Set((await tx.$queryRaw<Array<{ tablo: string }>>`
      SELECT t.tgrelid::regclass::text AS tablo FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE p.proname = 'mali_donem_yazma_kilidi'`).map((r) => r.tablo));
    const anaKelime = unvanKelimeleri(ana.unvan);

    const tasinanlar: TasinanOnizleme[] = [];
    for (const id of tekil) {
      const k = kartlar.find((x) => x.id === id)!;
      const engeller = ortakEngel(k, "Kart");
      const kayitlar: Array<{ ad: string; adet: number }> = [];
      for (const b of baglar) {
        const [{ adet }] = await tx.$queryRawUnsafe<Array<{ adet: number }>>(`SELECT count(*)::int AS adet FROM "${b.tablo}" WHERE "${b.sutun}" = $1::uuid`, id);
        if (!adet) continue;
        kayitlar.push({ ad: TABLO_ADI[b.tablo] ?? b.tablo, adet });
        if (kilitli.has(b.tablo)) {
          const [{ kapali }] = await tx.$queryRawUnsafe<Array<{ kapali: number }>>(
            `SELECT count(*)::int AS kapali FROM "${b.tablo}" x WHERE x."${b.sutun}" = $1::uuid AND EXISTS (
               SELECT 1 FROM mali_donemler d WHERE d.tenant_id = x.tenant_id AND d.yil = EXTRACT(YEAR FROM x.tarih)::int
                 AND d.ay = EXTRACT(MONTH FROM x.tarih)::int AND d.durum = 'kapali')`, id);
          if (kapali) engeller.push(`kapalı mali dönemde ${kapali} ${(TABLO_ADI[b.tablo] ?? b.tablo).toLocaleLowerCase("tr-TR")} kaydı var`);
        }
      }
      for (const g of DEGISMEZ_GECMIS) {
        const [{ adet }] = await tx.$queryRawUnsafe<Array<{ adet: number }>>(`SELECT count(*)::int AS adet FROM "${g.tablo}" WHERE cari_id = $1::uuid`, id);
        if (adet) engeller.push(`${adet} ${g.ad} kaydı var (geçmişi değiştirilemez)`);
      }
      const uyarilar: string[] = [];
      if (k.dovizCinsi !== ana.dovizCinsi) uyarilar.push(`Döviz cinsi farklı (${k.dovizCinsi} → ${ana.dovizCinsi}); ana kartınki geçerli olur`);
      if (k.muhasebeKodu && !esit(k.muhasebeKodu, ana.muhasebeKodu)) {
        uyarilar.push(ana.muhasebeKodu
          ? `Kartın muhasebe kodu (${k.muhasebeKodu}) ana karttakinden (${ana.muhasebeKodu}) farklı; önceki aktarımlar eski kodla kaldı`
          : `Kartın muhasebe kodu (${k.muhasebeKodu}) ana karta yazılacak`);
      }
      for (const [alan, ad] of [["riskLimiti", "Risk limiti"], ["varsayilanVadeGun", "Varsayılan vade"], ["varsayilanIskonto", "Varsayılan iskonto"]] as const) {
        if (!bos(k[alan]) && !bos(ana[alan]) && !esit(k[alan], ana[alan])) uyarilar.push(`${ad} farklı (${String(k[alan])} / ana kart ${String(ana[alan])}); ana kartınki kalır`);
      }
      if (k.vknTckn && ana.vknTckn && k.vknTckn.trim() !== ana.vknTckn.trim()) uyarilar.push(`VKN/TCKN farklı (${k.vknTckn} / ana kart ${ana.vknTckn}); ana kartınki kalır`);
      else if (k.vknTckn && k.vknTckn === ana.vknTckn && unvanBenzerligi(unvanKelimeleri(k.unvan), anaKelime) < FARKLI_UNVAN_ESIGI) {
        uyarilar.push("Aynı VKN/TCKN ama unvanlar benzemiyor; aynı firma olduğundan emin olun");
      }
      if (k.karaListe && !ana.karaListe) uyarilar.push("Kart kara listede; ana kart da kara listeye alınır");
      tasinanlar.push({
        cari: { id: k.id, kod: k.kod, unvan: k.unvan },
        engeller,
        uyarilar,
        kayitlar,
        doldurulacaklar: DOLAN_ALANLAR.filter((a) => bos(ana[a]) && !bos(k[a])).map((a) => ALAN_ADI[a] ?? a),
      });
    }
    return {
      ana: { id: ana.id, kod: ana.kod, unvan: ana.unvan },
      anaEngelleri,
      tasinanlar,
      birlestirilebilir: !anaEngelleri.length && tasinanlar.every((t) => !t.engeller.length),
    };
  }
}
