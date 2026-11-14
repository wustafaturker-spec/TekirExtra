import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PrismaClient } from "@prisma/client";
import { PrismaService } from "../core/prisma.service";
import { cekimDurumuYaz, degerleriYaz, donemMetni, zincirKatsayisiGuncelle } from "./endeks-deposu";
import { evdsAylikDegerler, evdsGrupSerileri, evdsGruplari, EvdsHatasi, type EvdsGrubu, type EvdsSerisi } from "./evds-istemci";

/** Platform seçicisinin katalog önbelleği: EVDS kataloğu nadiren değişir, her aramada istenmez. */
const KATALOG_ONBELLEK_MS = 24 * 60 * 60 * 1000;
const GRUP_SERI_ONBELLEK_SINIRI = 200;

/** İlk doldurmada geriye bakılan yıl (END-03: en az 10 yıl). */
export const ILK_DOLDURMA_YIL = 10;
/** Düzenli çekimde son açıklanan dönemden geriye bakılan ay: TÜİK revizyonları yakalanır (END-04). */
const REVIZYON_PENCERESI_AY = 6;

export interface CekimSonucu {
  kod: string;
  basarili: boolean;
  hata?: string;
  yeni?: number;
  revize?: number;
  elleUyusmaz?: number;
  sonDonem?: string | null;
}

const ayBasi = (t: Date) => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
const ayEkle = (t: Date, ay: number) => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + ay, 1));

/**
 * END-03: etkin serileri EVDS'den tek istekte çeker. Kiracı isteği EVDS'ye
 * gitmez; çekim worker zamanlayıcısından ya da platform ekranından yapılır.
 * `db` hangi rolün yazacağını belirler (worker: uygulama, platform: platform).
 */
@Injectable()
export class EndeksService {
  private readonly logger = new Logger(EndeksService.name);

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private gruplar?: { at: number; liste: Promise<EvdsGrubu[]> };
  private readonly grupSerileri = new Map<string, { at: number; liste: Promise<EvdsSerisi[]> }>();

  /** END-26 seçici: EVDS veri grupları (24 saat önbellekli; hata önbelleğe alınmaz). */
  evdsGruplari(): Promise<EvdsGrubu[]> {
    if (!this.gruplar || Date.now() - this.gruplar.at > KATALOG_ONBELLEK_MS) {
      const liste = evdsGruplari(this.anahtar());
      this.gruplar = { at: Date.now(), liste };
      liste.catch(() => { if (this.gruplar?.liste === liste) this.gruplar = undefined; });
    }
    return this.gruplar.liste;
  }

  /** END-26 seçici: bir gruptaki seriler (grup başına 24 saat önbellekli). */
  evdsGrupSerileri(grupKodu: string): Promise<EvdsSerisi[]> {
    const kayit = this.grupSerileri.get(grupKodu);
    if (kayit && Date.now() - kayit.at <= KATALOG_ONBELLEK_MS) return kayit.liste;
    if (this.grupSerileri.size >= GRUP_SERI_ONBELLEK_SINIRI) this.grupSerileri.delete(this.grupSerileri.keys().next().value!);
    const liste = evdsGrupSerileri(this.anahtar(), grupKodu);
    this.grupSerileri.set(grupKodu, { at: Date.now(), liste });
    liste.catch(() => { if (this.grupSerileri.get(grupKodu)?.liste === liste) this.grupSerileri.delete(grupKodu); });
    return liste;
  }

  anahtarTanimli(): boolean {
    return Boolean(this.config.get<string>("TCMB_EVDS_API_KEY")?.trim());
  }

  private anahtar(): string {
    return this.config.get<string>("TCMB_EVDS_API_KEY")?.trim() ?? "";
  }

  /** Platform "sına": EVDS kodunun son 24 ayı; kayıt yazılmaz. Günlük seride aylık ortalama istenir. */
  async sina(evdsKodu: string, kaynakSiklik: "aylik" | "gunluk" = "aylik") {
    const bitis = new Date();
    const degerler = (await evdsAylikDegerler(this.anahtar(), [evdsKodu], ayEkle(ayBasi(bitis), -24), bitis, fetch, { gunlukOrtalama: kaynakSiklik === "gunluk" })).get(evdsKodu) ?? [];
    if (!degerler.length) throw new EvdsHatasi(kaynakSiklik === "gunluk" ? "Bu kodla son 24 ayda değer gelmedi; kodu kontrol edin." : "Bu kodla son 24 ayda aylık değer gelmedi; kod ya da sıklık yanlış olabilir (günlük seriyse \"günlük → aylık ortalama\" seçin).");
    const son = degerler[degerler.length - 1];
    return { ayAdedi: degerler.length, ilkDonem: degerler[0].donem, sonDonem: son.donem, sonDeger: son.deger };
  }

  /**
   * Serileri çeker. `kodlar` verilmezse etkin serilerin hepsi. `gecmisYil`
   * verilirse o kadar yıl geriye doldurulur; verilmezse değeri olmayan seri
   * için ILK_DOLDURMA_YIL, olan için son dönemden REVIZYON_PENCERESI_AY geri.
   */
  async cek(secenek: { db?: PrismaClient; kodlar?: string[]; gecmisYil?: number } = {}): Promise<CekimSonucu[]> {
    const db = secenek.db ?? this.prisma;
    const seriler = await db.endeksSerisi.findMany({
      where: secenek.kodlar?.length ? { kod: { in: secenek.kodlar } } : { etkin: true },
      orderBy: { sira: "asc" },
    });
    if (!seriler.length) return [];
    const bugun = new Date();
    const baslangiclar = seriler.map((s) =>
      secenek.gecmisYil ? ayEkle(ayBasi(bugun), -12 * secenek.gecmisYil)
        : s.sonDonem ? ayEkle(s.sonDonem, -REVIZYON_PENCERESI_AY)
          : ayEkle(ayBasi(bugun), -12 * ILK_DOLDURMA_YIL));
    const baslangic = new Date(Math.min(...baslangiclar.map((t) => t.getTime())));
    // Aylık seriler ve aylık ortalamaya çevrilen günlük seriler ayrı istekte çekilir.
    const buAyMetni = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }).slice(0, 7) + "-01";

    let veriler: Map<string, { donem: string; deger: string }[]>;
    try {
      veriler = new Map();
      for (const gunluk of [false, true]) {
        const grup = seriler.filter((s) => (s.kaynakSiklik === "gunluk") === gunluk);
        if (!grup.length) continue;
        for (const [k, v] of await evdsAylikDegerler(this.anahtar(), grup.map((s) => s.evdsKodu), baslangic, bugun, fetch, { gunlukOrtalama: gunluk })) veriler.set(k, v);
      }
    } catch (hata) {
      const mesaj = hata instanceof EvdsHatasi ? hata.message : "EVDS çekimi beklenmeyen bir hatayla durdu.";
      if (!(hata instanceof EvdsHatasi)) this.logger.error(`Endeks çekimi: ${hata instanceof Error ? hata.message : String(hata)}`);
      await Promise.all(seriler.map((s) => cekimDurumuYaz(db, s.kod, { hata: mesaj }).catch(() => undefined)));
      return seriler.map((s) => ({ kod: s.kod, basarili: false, hata: mesaj }));
    }

    const sonuclar: CekimSonucu[] = [];
    for (const s of seriler) {
      const degerler = veriler.get(s.evdsKodu) ?? [];
      try {
        if (!degerler.length) {
          const mesaj = "EVDS bu seri için değer döndürmedi; kod ya da yayın durumu kontrol edilmeli.";
          await cekimDurumuYaz(db, s.kod, { hata: mesaj });
          sonuclar.push({ kod: s.kod, basarili: false, hata: mesaj });
          continue;
        }
        const yazim = await degerleriYaz(db, s.kod, degerler, "evds", s.kaynakSiklik === "gunluk" ? buAyMetni : null);
        const sonDonem = degerler.map((d) => d.donem).sort().at(-1)!;
        const eskiSon = s.sonDonem ? donemMetni(s.sonDonem) : null;
        await cekimDurumuYaz(db, s.kod, { hata: null, sonDonem: eskiSon && eskiSon > sonDonem ? eskiSon : sonDonem });
        if (s.oncekiSeriKodu) await zincirKatsayisiGuncelle(db, s.kod);
        if (yazim.revize) this.logger.warn(`Endeks ${s.kod}: ${yazim.revize} dönem revize edildi (${yazim.elleUyusmaz} elle girilen değer EVDS'den farklı).`);
        sonuclar.push({ kod: s.kod, basarili: true, ...yazim, sonDonem });
      } catch (hata) {
        this.logger.error(`Endeks ${s.kod} yazılamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
        await cekimDurumuYaz(db, s.kod, { hata: "Değerler kaydedilemedi." }).catch(() => undefined);
        sonuclar.push({ kod: s.kod, basarili: false, hata: "Değerler kaydedilemedi." });
      }
    }
    return sonuclar;
  }
}
