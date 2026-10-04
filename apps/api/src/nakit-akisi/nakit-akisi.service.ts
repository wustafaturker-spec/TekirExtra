import { ekstreOzeti } from "../kasa-banka/kart-ekstre";
import { kartEkstreleriniOku } from "../kasa-banka/kart-ekstre-oku";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { aktifBaglam } from "../core/istek-baglami";
import { DovizService } from "../doviz/doviz.service";
import { cariDavranisAnalizi } from "../cari/cari-analiz";
import { bordroYasalTutarlari, bordroYasalVade, gunEkle, kurusa, nakitTahmini, type CariTahsilatProfili, type NakitKalemi, type Ufuk } from "./nakit-akisi.hesap";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";

/** Tahmine girmeyen ve ekranda açıkça söylenen kalemler (S-01, 2026-09-11). */
const KAPSAM_DISI = ["KDV, muhtasar ve SGK ödemeleri tahmine dahil değildir."];

/** Kur çevrilmeden önceki kalem: tutar kendi para biriminde. */
type HamKalem = Omit<NakitKalemi, "kurus"> & { belgeKuru: number | null };

const isoGun = (d: Date) => d.toISOString().slice(0, 10);

/** Türkiye takvim günü; sunucunun saat dilimi ne olursa olsun. */
function bugunIstanbul(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
}

function ayinGunu(yil: number, ay: number, gun: number): string {
  const sonGun = new Date(Date.UTC(yil, ay, 0)).getUTCDate();
  return isoGun(new Date(Date.UTC(yil, ay - 1, Math.min(gun, sonGun))));
}

function ayEkle(tarih: string, ay: number, gun?: number): string {
  const [y, m, d] = tarih.split("-").map(Number);
  const hedef = new Date(Date.UTC(y, m - 1 + ay, 1));
  return ayinGunu(hedef.getUTCFullYear(), hedef.getUTCMonth() + 1, gun ?? d);
}

const FATURA_ADLARI: Record<string, string> = { satis: "Satış faturası", alis: "Alış faturası", satis_iade: "Satış iadesi", alis_iade: "Alış iadesi" };

/**
 * Nakit akışı tahmini (NAK-01…NAK-12). Kaynakları okur, kalemlere çevirir ve
 * senaryo/bakiye hesabını saf katmana (`nakit-akisi.hesap.ts`) bırakır.
 */
@Injectable()
export class NakitAkisiService {
  private readonly logger = new Logger(NakitAkisiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly doviz: DovizService,
  ) {}

  async tahmin(ufukGun: Ufuk) {
    const { tenantId } = aktifBaglam();
    const bugun = bugunIstanbul();
    const ufukSonu = gunEkle(bugun, ufukGun - 1);
    const sonTarih = new Date(`${ufukSonu}T00:00:00.000Z`);
    const bugunTarih = new Date(`${bugun}T00:00:00.000Z`);

    const veri = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kalemler: HamKalem[] = [];
      const ekle = (k: Omit<HamKalem, "tahmin" | "tahsilat" | "cariId" | "cariUnvan" | "baglanti" | "belgeKuru"> & Partial<HamKalem>) =>
        kalemler.push({ tahmin: false, tahsilat: false, cariId: null, cariUnvan: null, baglanti: null, belgeKuru: null, ...k });

      // NAK-01: başlangıç bakiyesi hareketlerden, hesap bazında.
      const kasalar = await tx.kasa.findMany({ where: { tenantId, aktif: true }, select: { id: true, dovizCinsi: true } });
      const bankalar = await tx.bankaHesap.findMany({ where: { tenantId, aktif: true }, select: { id: true, dovizCinsi: true } });
      const hesapDovizi = new Map<string, string>([...kasalar, ...bankalar].map((h) => [h.id, h.dovizCinsi]));
      const gruplar = await tx.kasaBankaHareket.groupBy({
        by: ["kasaId", "bankaHesapId", "tip"],
        where: { tenantId, OR: [{ kasaId: { in: kasalar.map((k) => k.id) } }, { bankaHesapId: { in: bankalar.map((b) => b.id) } }] },
        _sum: { tutar: true, tutarTry: true },
      });
      const hesaplar = new Map<string, { doviz: string; tutar: number; tutarTry: number }>();
      for (const g of gruplar) {
        const id = g.kasaId ?? g.bankaHesapId;
        if (!id || !hesapDovizi.has(id)) continue;
        const isaret = g.tip === "tahsilat" || g.tip === "virman_gelis" ? 1 : -1;
        const h = hesaplar.get(id) ?? { doviz: hesapDovizi.get(id)!, tutar: 0, tutarTry: 0 };
        h.tutar += isaret * Number(g._sum.tutar ?? 0);
        h.tutarTry += isaret * Number(g._sum.tutarTry ?? 0);
        hesaplar.set(id, h);
      }

      // NAK-03: faturalar — kalan tutar, vadesinde.
      const faturalar = await tx.fatura.findMany({
        where: {
          tenantId,
          durum: "kesin",
          tip: { in: ["satis", "alis", "satis_iade", "alis_iade"] },
          OR: [{ vadeTarihi: { lte: sonTarih } }, { vadeTarihi: null, tarih: { lte: sonTarih } }],
        },
        select: {
          id: true, no: true, tip: true, tarih: true, vadeTarihi: true, genelToplam: true, kur: true, dovizCinsi: true, cariId: true,
          cari: { select: { unvan: true } },
          durum: true,
          ...FATURA_ODEME_SECIMI,
        },
      });
      // ENT-07: onaylı/gönderilmiş talimattaki tutar talimat kalemi olarak çıkar; faturadan düşülür.
      const planlanan = new Map((await tx.bankaOdemeTalimatiFatura.groupBy({
        by: ["faturaId"], where: { tenantId, talimat: { durum: { in: ["onaylandi", "gonderildi"] } } }, _sum: { tutar: true },
      })).map((g) => [g.faturaId, Number(g._sum.tutar ?? 0)]));
      for (const f of faturalar) {
        const kur = Number(f.kur) || 1;
        const kalan = Number(faturaOdemeDurumu(f).kalan) - (planlanan.get(f.id) ?? 0);
        if (kalan < 0.005) continue;
        const giris = f.tip === "satis" || f.tip === "alis_iade";
        ekle({
          kaynak: "fatura", kaynakId: f.id, yon: giris ? "giris" : "cikis", vade: isoGun(f.vadeTarihi ?? f.tarih),
          dovizCinsi: f.dovizCinsi, dovizTutar: kalan, belgeKuru: kur,
          aciklama: `${FATURA_ADLARI[f.tip]} ${f.no ?? "(numarasız)"}`,
          cariId: f.cariId, cariUnvan: f.cari.unvan, tahsilat: f.tip === "satis", baglanti: `/panel/fatura?fatura=${f.id}`,
        });
      }

      // NAK-04: çek/senet.
      const cekler = await tx.cekSenet.findMany({
        where: {
          tenantId,
          vadeTarihi: { lte: sonTarih },
          OR: [{ yon: "alinan", durum: { in: ["portfoyde", "tahsile_verildi"] } }, { yon: "verilen", durum: "verildi" }],
        },
        select: { id: true, tur: true, yon: true, portfoyNo: true, cekNo: true, vadeTarihi: true, tutar: true, dovizCinsi: true, kur: true, borclu: true, cariId: true, cari: { select: { unvan: true } } },
      });
      for (const c of cekler) {
        ekle({
          kaynak: "cek_senet", kaynakId: c.id, yon: c.yon === "alinan" ? "giris" : "cikis", vade: isoGun(c.vadeTarihi),
          dovizCinsi: c.dovizCinsi, dovizTutar: Number(c.tutar), belgeKuru: Number(c.kur) || null,
          aciklama: `${c.tur === "cek" ? "Çek" : "Senet"} ${c.portfoyNo}${c.cekNo ? ` / ${c.cekNo}` : ""}`,
          cariId: c.cariId, cariUnvan: c.cari?.unvan ?? c.borclu, baglanti: "/panel/kasa-banka/cek-senet",
        });
      }

      // NAK-05: masraf.
      const masraflar = await tx.masraf.findMany({
        where: {
          tenantId,
          durum: "onaylandi",
          odemeDurumu: { not: "odendi" },
          OR: [{ vadeTarihi: { lte: sonTarih } }, { vadeTarihi: null, tarih: { lte: sonTarih } }],
        },
        select: { id: true, belgeNo: true, saticiUnvan: true, tarih: true, vadeTarihi: true, toplam: true, odenenTutar: true, dovizCinsi: true, cariId: true, cari: { select: { unvan: true } }, kategori: { select: { ad: true } } },
      });
      for (const m of masraflar) {
        const kalan = Number(m.toplam) - Number(m.odenenTutar);
        if (kalan < 0.005) continue;
        ekle({
          kaynak: "masraf", kaynakId: m.id, yon: "cikis", vade: isoGun(m.vadeTarihi ?? m.tarih),
          dovizCinsi: m.dovizCinsi, dovizTutar: kalan,
          aciklama: `${m.kategori.ad}${m.belgeNo ? ` · ${m.belgeNo}` : ""}`,
          cariId: m.cariId, cariUnvan: m.cari?.unvan ?? m.saticiUnvan, baglanti: "/panel/masraflar",
        });
      }

      // NAK-05: kira. Bugünden önceki ödeme günleri üretilmez (ödenmiş ya da
      // masraf olarak girilmiş sayılır); ayın kira masrafı kayıtlıysa o ay atlanır.
      const kiralar = await tx.kiraSozlesme.findMany({
        where: { tenantId, aktif: true, baslangicTarihi: { lte: sonTarih }, OR: [{ bitisTarihi: null }, { bitisTarihi: { gte: bugunTarih } }] },
        select: {
          id: true, baslik: true, kirayaVeren: true, odemeGunu: true, matrah: true, kdvOrani: true, stopajOrani: true, dovizCinsi: true,
          baslangicTarihi: true, bitisTarihi: true, cariId: true, cari: { select: { unvan: true } },
          masraflar: { where: { kiraDonemi: { not: null } }, select: { kiraDonemi: true } },
        },
      });
      for (const k of kiralar) {
        const kayitliAylar = new Set(k.masraflar.map((m) => isoGun(m.kiraDonemi!).slice(0, 7)));
        const odeme = Number(k.matrah) * (1 + Number(k.kdvOrani) / 100 - Number(k.stopajOrani) / 100);
        for (let i = 0; i < 4; i += 1) {
          const tarih = ayEkle(`${bugun.slice(0, 7)}-01`, i, k.odemeGunu);
          if (tarih < bugun || tarih > ufukSonu) continue;
          if (tarih < isoGun(k.baslangicTarihi) || (k.bitisTarihi && tarih > isoGun(k.bitisTarihi))) continue;
          if (kayitliAylar.has(tarih.slice(0, 7))) continue;
          ekle({
            kaynak: "kira", kaynakId: k.id, yon: "cikis", vade: tarih, dovizCinsi: k.dovizCinsi, dovizTutar: odeme,
            aciklama: `Kira · ${k.baslik}`, cariId: k.cariId, cariUnvan: k.cari?.unvan ?? k.kirayaVeren, baglanti: "/panel/masraflar/kiralar",
          });
        }
      }

      // NAK-06 / KSB-10: kart borcu ekstrenin son ödeme gününde çıkar — son
      // kesilen ekstrenin kalanı (gecikmişse bugün), açık dönemin birikeni ve
      // ileri dönemlere düşen taksitler. Taksit günü nakit çıkışı değildir.
      for (const { kart, donemler } of await kartEkstreleriniOku(tx, bugun)) {
        const { sonKesilen, acik, gelecek } = ekstreOzeti(donemler);
        const satirlar: Array<{ kesim: string; sonOdeme: string; tutar: number; etiket: string; tahmin: boolean }> = [];
        const kesilenKalan = sonKesilen ? Number(sonKesilen.kalan) : 0;
        if (sonKesilen && kesilenKalan > 0) satirlar.push({ kesim: sonKesilen.kesimTarihi, sonOdeme: sonKesilen.sonOdemeTarihi, tutar: kesilenKalan, etiket: "ekstre", tahmin: false });
        // Açık dönem borcu son ekstrenin kalanını da taşır; o kısım yukarıda sayıldı.
        const acikTutar = acik ? Number(acik.donemBorcu) - kesilenKalan : 0;
        if (acik && acikTutar > 0.005) satirlar.push({ kesim: acik.kesimTarihi, sonOdeme: acik.sonOdemeTarihi, tutar: acikTutar, etiket: "açık dönem", tahmin: true });
        for (const d of gelecek) satirlar.push({ kesim: d.kesimTarihi, sonOdeme: d.sonOdemeTarihi, tutar: Number(d.harcamalar), etiket: "taksitler", tahmin: true });
        for (const satir of satirlar) {
          const vade = satir.sonOdeme < bugun ? bugun : satir.sonOdeme;
          if (vade > ufukSonu || satir.tutar <= 0) continue;
          ekle({
            kaynak: "kart_ekstre", kaynakId: `${kart.id}:${satir.kesim}`, yon: "cikis", vade, dovizCinsi: kart.dovizCinsi, dovizTutar: satir.tutar, tahmin: satir.tahmin,
            aciklama: `${kart.ad} •••• ${kart.sonDortHane} · ${satir.etiket} (kesim ${satir.kesim.split("-").reverse().join(".")})`,
            baglanti: "/panel/kasa-banka/kredi-kartlari",
          });
        }
      }

      // KRD-07: ödenmemiş kredi taksitleri vade gününde çıkış; geciken bugüne çekilir.
      const krediTaksitleri = await tx.bankaKrediTaksiti.findMany({
        where: { islemId: null, kredi: { durum: "aktif" }, vadeTarihi: { lte: new Date(`${ufukSonu}T00:00:00.000Z`) } },
        include: { kredi: { select: { id: true, ad: true, dovizCinsi: true } } },
      });
      for (const t of krediTaksitleri) {
        const vadeGunu = isoGun(t.vadeTarihi);
        ekle({
          kaynak: "kredi_taksit", kaynakId: t.id, yon: "cikis", vade: vadeGunu < bugun ? bugun : vadeGunu, dovizCinsi: t.kredi.dovizCinsi,
          dovizTutar: Number(t.anapara.add(t.faiz).add(t.bsmv).add(t.kkdf)),
          aciklama: `${t.kredi.ad} · ${t.sira}. taksit${vadeGunu < bugun ? " (gecikmiş)" : ""}`,
          baglanti: `/panel/kasa-banka/krediler?kredi=${t.kredi.id}`,
        });
      }

      // NAK-07: bordro — açık bordroların kalanı, sonraki aylar son dönemin tekrarı.
      const acikBordrolar = await tx.personelBordro.findMany({
        where: { tenantId, durum: { in: ["onaylandi", "kismen_odendi"] } },
        select: { id: true, donemYil: true, donemAy: true, odenecekTutar: true, odenenTutar: true, odemeTarihi: true, personel: { select: { ad: true, soyad: true } } },
      });
      for (const b of acikBordrolar) {
        const kalan = Number(b.odenecekTutar) - Number(b.odenenTutar);
        if (kalan < 0.005) continue;
        const vade = b.odemeTarihi ? isoGun(b.odemeTarihi) : ayinGunu(b.donemYil, b.donemAy, 31);
        if (vade > ufukSonu) continue;
        ekle({
          kaynak: "bordro", kaynakId: b.id, yon: "cikis", vade, dovizCinsi: "TRY", dovizTutar: kalan,
          aciklama: `Bordro ${String(b.donemAy).padStart(2, "0")}.${b.donemYil} · ${b.personel.ad} ${b.personel.soyad}`,
          baglanti: `/panel/personel/bordrolar/${b.id}`,
        });
      }
      const sonBordro = await tx.personelBordro.findFirst({
        where: { tenantId, durum: { notIn: ["reddedildi", "iptal"] } },
        orderBy: [{ donemYil: "desc" }, { donemAy: "desc" }],
        select: { donemYil: true, donemAy: true },
      });
      if (sonBordro) {
        const donemBordrolari = await tx.personelBordro.findMany({
          where: { tenantId, donemYil: sonBordro.donemYil, donemAy: sonBordro.donemAy, durum: { notIn: ["reddedildi", "iptal"] } },
          select: { odenecekTutar: true, odemeTarihi: true },
        });
        const toplam = donemBordrolari.reduce((t, b) => t + Number(b.odenecekTutar), 0);
        const odemeGunu = donemBordrolari.find((b) => b.odemeTarihi)?.odemeTarihi;
        const sonOdeme = odemeGunu ? isoGun(odemeGunu) : ayinGunu(sonBordro.donemYil, sonBordro.donemAy, 31);
        const gun = Number(sonOdeme.slice(8, 10));
        for (let i = 1; i <= 4 && toplam > 0; i += 1) {
          const tarih = ayEkle(sonOdeme, i, odemeGunu ? gun : 31);
          if (tarih > ufukSonu) break;
          if (tarih < bugun) continue;
          const donem = ayEkle(`${sonBordro.donemYil}-${String(sonBordro.donemAy).padStart(2, "0")}-01`, i);
          ekle({
            kaynak: "bordro", kaynakId: `tahmin-${donem.slice(0, 7)}`, yon: "cikis", vade: tarih, dovizCinsi: "TRY", dovizTutar: toplam, tahmin: true,
            aciklama: `Bordro ${donem.slice(5, 7)}.${donem.slice(0, 4)} (son dönemin tekrarı)`, baglanti: "/panel/personel",
          });
        }
      }

      // PRS-05: bordronun SGK primi ve muhtasarı ertesi ayın 26'sında. Ödeme takibi
      // olmadığı için vadesi gelmemiş dönemler sayılır; son dönem sonraki aylara tekrarlanır.
      const yasalBordrolar = await tx.personelBordro.findMany({
        where: { tenantId, durum: { notIn: ["reddedildi", "iptal"] }, mevzuatSetiId: { not: null } },
        select: { donemYil: true, donemAy: true, durum: true, hesapOzeti: true },
      });
      const yasalDonemler = new Map<string, { yil: number; ay: number; sgk: number; vergi: number; kesin: boolean }>();
      for (const b of yasalBordrolar) {
        const t = bordroYasalTutarlari(b.hesapOzeti);
        if (!t) continue;
        const anahtar = `${b.donemYil}-${String(b.donemAy).padStart(2, "0")}`;
        const d = yasalDonemler.get(anahtar) ?? { yil: b.donemYil, ay: b.donemAy, sgk: 0, vergi: 0, kesin: false };
        d.sgk += t.sgk; d.vergi += t.vergi;
        if (["onaylandi", "kismen_odendi", "odendi"].includes(b.durum)) d.kesin = true;
        yasalDonemler.set(anahtar, d);
      }
      const yasalEkle = (yil: number, ay: number, sgk: number, vergi: number, tahmin: boolean, ek: string) => {
        const vade = bordroYasalVade(yil, ay);
        if (vade < bugun || vade > ufukSonu) return;
        const donem = `${String(ay).padStart(2, "0")}.${yil}`;
        if (sgk > 0.004) ekle({ kaynak: "bordro_yasal", kaynakId: `sgk-${yil}-${ay}`, yon: "cikis", vade, dovizCinsi: "TRY", dovizTutar: Math.round(sgk * 100) / 100, tahmin, aciklama: `SGK primleri ${donem}${ek}`, baglanti: "/panel/personel/bordrolar" });
        if (vergi > 0.004) ekle({ kaynak: "bordro_yasal", kaynakId: `muhtasar-${yil}-${ay}`, yon: "cikis", vade, dovizCinsi: "TRY", dovizTutar: Math.round(vergi * 100) / 100, tahmin, aciklama: `Muhtasar (gelir + damga vergisi) ${donem}${ek}`, baglanti: "/panel/personel/bordrolar" });
      };
      const sirali = [...yasalDonemler.values()].sort((a, b) => a.yil - b.yil || a.ay - b.ay);
      for (const d of sirali) yasalEkle(d.yil, d.ay, d.sgk, d.vergi, !d.kesin, d.kesin ? "" : " (onaylanmamış bordro)");
      const sonYasal = sirali.at(-1);
      if (sonYasal) {
        for (let i = 1; i <= 4; i += 1) {
          const toplamAy = sonYasal.ay - 1 + i;
          yasalEkle(sonYasal.yil + Math.floor(toplamAy / 12), (toplamAy % 12) + 1, sonYasal.sgk, sonYasal.vergi, true, " (son dönemin tekrarı)");
        }
      }

      // NAK-08: tekrarlayan faturalar — ufuk içindeki her üretim tarihi.
      const tekrarlar = await tx.tekrarlayanFatura.findMany({
        where: { tenantId, aktif: true, sonrakiTarih: { lte: sonTarih } },
        select: {
          id: true, ad: true, siklik: true, aralik: true, sonrakiTarih: true, bitisTarihi: true,
          sablonFatura: { select: { tip: true, genelToplam: true, kur: true, dovizCinsi: true, cariId: true, cari: { select: { unvan: true, varsayilanVadeGun: true } } } },
        },
      });
      for (const t of tekrarlar) {
        const sablon = t.sablonFatura;
        const giris = sablon.tip === "satis" || sablon.tip === "alis_iade";
        let tarih = isoGun(t.sonrakiTarih);
        for (let n = 0; n < 400 && tarih <= ufukSonu; n += 1) {
          if (t.bitisTarihi && tarih > isoGun(t.bitisTarihi)) break;
          ekle({
            kaynak: "tekrarlayan_fatura", kaynakId: `${t.id}:${tarih}`, yon: giris ? "giris" : "cikis",
            vade: gunEkle(tarih, sablon.cari.varsayilanVadeGun ?? 0), dovizCinsi: sablon.dovizCinsi, dovizTutar: Number(sablon.genelToplam),
            belgeKuru: Number(sablon.kur) || null, tahmin: true, tahsilat: sablon.tip === "satis",
            aciklama: `Tekrarlayan · ${t.ad}`, cariId: sablon.cariId, cariUnvan: sablon.cari.unvan, baglanti: "/panel/fatura/tekrarlayan",
          });
          const adim = Math.max(1, t.aralik);
          tarih = t.siklik === "haftalik" ? gunEkle(tarih, 7 * adim) : ayEkle(tarih, t.siklik === "yillik" ? 12 * adim : adim);
        }
      }

      // NAK-08: onaylanmış, bankaya gönderilmemiş ödeme talimatları bugün.
      const talimatlar = await tx.bankaOdemeTalimati.findMany({
        where: { tenantId, durum: { in: ["onaylandi", "gonderildi"] } },
        select: { id: true, no: true, aliciUnvan: true, tutar: true, dovizCinsi: true, aciklama: true, odemeTarihi: true, cariId: true },
      });
      for (const t of talimatlar) {
        const vade = isoGun(t.odemeTarihi) < bugun ? bugun : isoGun(t.odemeTarihi);
        if (vade > ufukSonu) continue;
        ekle({
          kaynak: "odeme_talimati", kaynakId: t.id, yon: "cikis", vade, dovizCinsi: t.dovizCinsi, dovizTutar: Number(t.tutar),
          aciklama: `Ödeme talimatı ${t.no ?? ""} · ${t.aciklama}`, cariId: t.cariId, cariUnvan: t.aliciUnvan, baglanti: "/panel/kasa-banka/odeme-talimatlari",
        });
      }

      // NAK-09: tahsilat kalemi olan carilerin gecikme profili (CARI-20 ile aynı hesap).
      const cariIdler = [...new Set(kalemler.filter((k) => k.tahsilat && k.cariId).map((k) => k.cariId!))];
      const cariler = cariIdler.length
        ? await tx.cariHesap.findMany({
            where: { tenantId, id: { in: cariIdler } },
            select: { id: true, karaListe: true, riskLimiti: true, hareketler: { select: { tip: true, tutarTry: true, tarih: true, vadeTarihi: true } } },
          })
        : [];
      const profiller = new Map<string, CariTahsilatProfili>();
      for (const c of cariler) {
        const analiz = cariDavranisAnalizi(
          c.hareketler.map((h) => ({ tip: h.tip as "borc" | "alacak", tutarTry: Number(h.tutarTry), tarih: h.tarih, vadeTarihi: h.vadeTarihi })),
          c.riskLimiti === null ? null : Number(c.riskLimiti),
        );
        profiller.set(c.id, {
          gecikmeGun: analiz.odemeDavranisi === "veri_yetersiz" ? null : analiz.tahminiGecikmeGun,
          karaListe: c.karaListe,
        });
      }

      return { kalemler, hesaplar: [...hesaplar.values()], hesapSayisi: kasalar.length + bankalar.length, profiller };
    });

    // NAK-10: kur yalnız dövizli kalem ya da hesap varsa istenir.
    const uyarilar: string[] = [];
    const dovizGerekli = veri.kalemler.some((k) => k.dovizCinsi !== "TRY") || veri.hesaplar.some((h) => h.doviz !== "TRY");
    // DVZ-10: yalnız kalem ve hesaplarda geçen dövizlerin kuru döner.
    let kur: { tarih: string; kurlar: Record<string, number> } | null = null;
    if (dovizGerekli) {
      try {
        const k = await this.doviz.kurlariGetir(undefined, "alis");
        const gerekenler = new Set([...veri.kalemler.map((x) => x.dovizCinsi), ...veri.hesaplar.map((h) => h.doviz)].filter((d) => d !== "TRY"));
        const kurlar = Object.fromEntries(Object.entries(k.kurlar).filter(([d]) => gerekenler.has(d)));
        if (Object.keys(kurlar).length) kur = { tarih: k.kurTarihi, kurlar };
      } catch (hata) {
        this.logger.warn(`Nakit akışı için kur alınamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
      }
      if (!kur) uyarilar.push("Güncel TCMB kuru alınamadı; dövizli kalemler belgedeki kurla çevrildi, belge kuru olmayanlar tahmine alınmadı.");
    }
    const guncelKur = (doviz: string) => kur?.kurlar[doviz];

    let atlanan = 0;
    const kalemler: NakitKalemi[] = [];
    for (const { belgeKuru, ...k } of veri.kalemler) {
      const oran = k.dovizCinsi === "TRY" ? 1 : guncelKur(k.dovizCinsi) ?? belgeKuru;
      if (!oran) { atlanan += 1; continue; }
      kalemler.push({ ...k, kurus: kurusa(k.dovizTutar * oran) });
    }
    if (atlanan) uyarilar.push(`${atlanan} dövizli kalem kur bulunamadığı için tahmine alınmadı.`);

    const baslangicKurus = veri.hesaplar.reduce((t, h) => {
      const oran = h.doviz === "TRY" ? 1 : guncelKur(h.doviz);
      return t + kurusa(oran ? h.tutar * oran : h.tutarTry);
    }, 0);

    const sonuc = nakitTahmini({ bugun, ufukGun, baslangicKurus, kalemler, profiller: veri.profiller });
    return {
      ...sonuc,
      baslangicBakiye: baslangicKurus / 100,
      hesapSayisi: veri.hesapSayisi,
      kur,
      kapsamDisi: KAPSAM_DISI,
      uyarilar,
      kalemler: sonuc.kalemler.map(({ kurus, tahsilat: _tahsilat, cariId: _cariId, ...k }) => ({ ...k, tutar: kurus / 100 })),
    };
  }
}
