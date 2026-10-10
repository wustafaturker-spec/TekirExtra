import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ayEkle, bugunTR, DOVIZ_CINSLERI, hareketKurTipi, rotatifFaizOnerisi } from "@tekirextra/shared";
import { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { kurZorunlu } from "../doviz/kur-coz";
import { KasaBankaService } from "./kasa-banka.service";

/**
 * KRD-01…08: banka kredileri. Her kredi işlemi (kullanım, taksit, rotatif
 * geri ödeme/faiz) tek banka hareketi yazar (`kaynakTur "banka_kredisi"`,
 * `kaynakRef` = kredi); faiz ve vergiler ödenmiş "Finansman Giderleri"
 * masrafıdır. Masraf hareketle bağlanmaz: muhasebe aktarımında hareketin
 * karşısı anapara (300/400) ve masrafın karşı hesabı (329) olarak ayrışır.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const gun = (t: Date) => t.toISOString().slice(0, 10);
const tarih = (s: string) => new Date(`${s}T00:00:00.000Z`);
const FINANSMAN_KATEGORISI = { ad: "Finansman Giderleri", muhasebeKodu: "780" };
const ondalik = z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(",", ".")).pipe(z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, "Tutar en fazla iki ondalıklı pozitif sayı olmalıdır"));
const oran = (enCok: number) => z.coerce.number().min(0).max(enCok);
const gunSemasi = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalıdır");

const planSatiriSemasi = z.object({ vadeTarihi: gunSemasi, anapara: ondalik, faiz: ondalik, bsmv: ondalik, kkdf: ondalik });

export const krediOlusturSemasi = z.object({
  bankaHesapId: z.uuid(),
  ad: z.string().trim().min(2).max(120),
  tur: z.enum(["taksitli", "spot", "rotatif"]),
  planTuru: z.enum(["esit_taksit", "esit_anapara"]).optional().nullable(),
  anapara: ondalik,
  aylikFaiz: oran(50),
  bsmvOrani: oran(100).default(5),
  kkdfOrani: oran(100).default(0),
  kullanimTarihi: gunSemasi,
  taksitSayisi: z.coerce.number().int().min(1).max(360).optional().nullable(),
  ilkTaksitTarihi: gunSemasi.optional().nullable(),
  vadeTarihi: gunSemasi.optional().nullable(),
  tahsisUcreti: ondalik.default("0"),
  aciklama: z.string().trim().max(500).optional().nullable(),
  /** Taksitli/spotta ekranda hesaplanıp gerekirse düzeltilmiş plan. */
  plan: z.array(planSatiriSemasi).max(360).optional(),
  eksiBakiyeOnay: z.boolean().optional(),
});

export const planGuncelleSemasi = z.object({ satirlar: z.array(planSatiriSemasi.extend({ id: z.uuid() })).min(1).max(360) });

export const krediIslemSemasi = z.object({
  tip: z.enum(["taksit", "kullanim", "geri_odeme", "faiz"]),
  taksitId: z.uuid().optional().nullable(),
  /** Ödemenin yapıldığı banka hesabı; boşsa kredinin hesabı (kullanımda hep kredinin hesabı). */
  bankaHesapId: z.uuid().optional().nullable(),
  tarih: gunSemasi,
  anapara: ondalik.default("0"),
  faiz: ondalik.default("0"),
  bsmv: ondalik.default("0"),
  kkdf: ondalik.default("0"),
  aciklama: z.string().trim().max(500).optional().nullable(),
  eksiBakiyeOnay: z.boolean().optional(),
});

export type KrediIslemGirdisi = z.infer<typeof krediIslemSemasi>;

@Injectable()
export class KrediService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kasaBanka: KasaBankaService,
    private readonly donemKilidi: DonemKilidiService,
  ) {}

  // ─── Okuma ──────────────────────────────────────────────────────────────

  async listele() {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [krediler, hesaplar] = await Promise.all([
        tx.bankaKredisi.findMany({ orderBy: [{ durum: "asc" }, { kullanimTarihi: "desc" }], include: { taksitler: { orderBy: { sira: "asc" } }, islemler: true } }),
        tx.bankaHesap.findMany({ select: { id: true, ad: true, bankaAdi: true } }),
      ]);
      return krediler.map((k) => ({ ...this.ozet(k, bugun), banka: hesaplar.find((h) => h.id === k.bankaHesapId) ?? null }));
    });
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.bankaKredisi.findUnique({ where: { id }, include: { taksitler: { orderBy: { sira: "asc" } }, islemler: { orderBy: [{ tarih: "asc" }, { createdAt: "asc" }] } } });
      if (!k) throw new NotFoundException("Kredi bulunamadı");
      const [banka, hareketler] = await Promise.all([
        tx.bankaHesap.findUnique({ where: { id: k.bankaHesapId }, select: { id: true, ad: true, bankaAdi: true, dovizCinsi: true } }),
        tx.kasaBankaHareket.findMany({ where: { id: { in: k.islemler.map((i) => i.hareketId) } }, select: { id: true, tutar: true, ekstreSatirId: true, bankaHesap: { select: { id: true, ad: true, bankaAdi: true } } } }),
      ]);
      return {
        ...this.ozet(k, bugun),
        banka,
        taksitler: k.taksitler.map((t) => ({ id: t.id, sira: t.sira, vadeTarihi: gun(t.vadeTarihi), anapara: t.anapara.toFixed(2), faiz: t.faiz.toFixed(2), bsmv: t.bsmv.toFixed(2), kkdf: t.kkdf.toFixed(2), toplam: t.anapara.add(t.faiz).add(t.bsmv).add(t.kkdf).toFixed(2), islemId: t.islemId, gecikti: !t.islemId && gun(t.vadeTarihi) < bugun })),
        islemler: k.islemler.map((i) => {
          const h = hareketler.find((x) => x.id === i.hareketId);
          return { id: i.id, tip: i.tip, tarih: gun(i.tarih), anapara: i.anapara.toFixed(2), faiz: i.faiz.toFixed(2), bsmv: i.bsmv.toFixed(2), kkdf: i.kkdf.toFixed(2), masraf: i.masraf.toFixed(2), tutar: h?.tutar.toFixed(2) ?? null, ekstreyeBagli: Boolean(h?.ekstreSatirId), aciklama: i.aciklama, banka: h?.bankaHesap ?? null };
        }),
      };
    });
  }

  private ozet(k: Prisma.BankaKredisiGetPayload<{ include: { taksitler: true; islemler: true } }>, bugun: string) {
    const kullanilan = k.islemler.reduce((t, i) => (i.tip === "kullanim" ? t.add(i.anapara) : i.tip === "taksit" || i.tip === "geri_odeme" ? t.sub(i.anapara) : t), D(0));
    const acik = k.taksitler.filter((t) => !t.islemId);
    const siradaki = acik[0];
    return {
      id: k.id, ad: k.ad, tur: k.tur, planTuru: k.planTuru, dovizCinsi: k.dovizCinsi, bankaHesapId: k.bankaHesapId,
      anapara: k.anapara.toFixed(2), aylikFaiz: k.aylikFaiz.toString(), bsmvOrani: k.bsmvOrani.toString(), kkdfOrani: k.kkdfOrani.toString(),
      kullanimTarihi: gun(k.kullanimTarihi), vadeTarihi: k.vadeTarihi ? gun(k.vadeTarihi) : null, taksitSayisi: k.taksitSayisi, tahsisUcreti: k.tahsisUcreti.toFixed(2),
      durum: k.durum, aciklama: k.aciklama, muhasebeKodu: k.muhasebeKodu,
      kalanAnapara: kullanilan.toFixed(2),
      kullanilabilir: k.tur === "rotatif" ? k.anapara.sub(kullanilan).toFixed(2) : null,
      odenenTaksit: k.taksitler.length - acik.length,
      siradakiTaksit: siradaki ? { id: siradaki.id, sira: siradaki.sira, vadeTarihi: gun(siradaki.vadeTarihi), toplam: siradaki.anapara.add(siradaki.faiz).add(siradaki.bsmv).add(siradaki.kkdf).toFixed(2) } : null,
      gecikenTaksit: acik.filter((t) => gun(t.vadeTarihi) < bugun).length,
    };
  }

  /** KRD-04: rotatif kredinin son faiz tahsilinden (yoksa kullanımdan) bu güne faiz önerisi. */
  async rotatifFaizi(id: string, bitis = bugunTR()) {
    const { tenantId } = aktifBaglam();
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaKredisi.findUnique({ where: { id }, include: { islemler: true } }));
    if (!k || k.tur !== "rotatif") throw new NotFoundException("Rotatif kredi bulunamadı");
    const sonFaiz = k.islemler.filter((i) => i.tip === "faiz").map((i) => gun(i.tarih)).sort().pop();
    const baslangic = sonFaiz ?? gun(k.kullanimTarihi);
    const hareketler = k.islemler.filter((i) => i.tip !== "faiz").map((i) => ({ tarih: gun(i.tarih), anaparaDegisimi: Number(i.tip === "kullanim" ? i.anapara : i.anapara.neg()) }));
    return { baslangic, bitis, ...rotatifFaizOnerisi(hareketler, baslangic, bitis, Number(k.aylikFaiz), Number(k.bsmvOrani), Number(k.kkdfOrani)) };
  }

  // ─── Oluşturma ve plan ─────────────────────────────────────────────────

  async olustur(g: z.infer<typeof krediOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    const anapara = D(g.anapara);
    const tahsis = D(g.tahsisUcreti);
    if (!anapara.gt(0)) throw new BadRequestException("Kredi tutarı sıfırdan büyük olmalıdır");
    if (g.tur !== "rotatif") {
      if (!g.plan?.length) throw new BadRequestException("Ödeme planı gönderilmelidir");
      const planAnapara = g.plan.reduce((t, s) => t.add(s.anapara), D(0));
      if (!planAnapara.equals(anapara)) throw new BadRequestException(`Plandaki anapara toplamı (${planAnapara.toFixed(2)}) kredi tutarıyla (${anapara.toFixed(2)}) tutmuyor`);
      if (g.plan.some((s) => s.vadeTarihi < g.kullanimTarihi)) throw new BadRequestException("Taksit vadesi kullanım tarihinden önce olamaz");
      if (tahsis.gte(anapara)) throw new BadRequestException("Tahsis ücreti kredi tutarından küçük olmalıdır");
      await this.donemKilidi.tarihDogrula(tenantId, tarih(g.kullanimTarihi), "kredi kullanımı");
    }
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const banka = await tx.bankaHesap.findUnique({ where: { id: g.bankaHesapId } });
      if (!banka?.aktif) throw new BadRequestException("Aktif banka hesabı bulunamadı");
      if (!(DOVIZ_CINSLERI as readonly string[]).includes(banka.dovizCinsi)) throw new BadRequestException("Banka hesabının dövizi desteklenmiyor");
      const kredi = await tx.bankaKredisi.create({
        data: {
          tenantId, bankaHesapId: banka.id, ad: g.ad, tur: g.tur, planTuru: g.tur === "taksitli" ? g.planTuru ?? "esit_taksit" : null, dovizCinsi: banka.dovizCinsi,
          anapara, aylikFaiz: D(g.aylikFaiz), bsmvOrani: D(g.bsmvOrani), kkdfOrani: D(g.kkdfOrani), kullanimTarihi: tarih(g.kullanimTarihi),
          taksitSayisi: g.tur === "taksitli" ? g.plan?.length ?? g.taksitSayisi ?? null : g.tur === "spot" ? 1 : null,
          ilkTaksitTarihi: g.tur === "taksitli" && g.plan?.[0] ? tarih(g.plan[0].vadeTarihi) : null,
          vadeTarihi: g.tur === "rotatif" ? (g.vadeTarihi ? tarih(g.vadeTarihi) : null) : tarih(g.plan![g.plan!.length - 1].vadeTarihi),
          tahsisUcreti: tahsis, aciklama: g.aciklama ?? null,
        },
      });
      if (g.tur === "rotatif") return { id: kredi.id };
      await tx.bankaKrediTaksiti.createMany({
        data: g.plan!.map((s, i) => ({ tenantId, krediId: kredi.id, sira: i + 1, vadeTarihi: tarih(s.vadeTarihi), anapara: D(s.anapara), faiz: D(s.faiz), bsmv: D(s.bsmv), kkdf: D(s.kkdf) })),
      });
      // KRD-08: 12 ay sonrasına düşen anapara uzun vadeli (400) yazılır.
      const sinir = ayEkle(g.kullanimTarihi, 12);
      const uzun = g.plan!.filter((s) => s.vadeTarihi > sinir).reduce((t, s) => t.add(s.anapara), D(0));
      await this.islemYaz(tx, tenantId, kredi, { tip: "kullanim", tarih: g.kullanimTarihi, anapara: anapara.toFixed(2), faiz: "0", bsmv: "0", kkdf: "0", masraf: tahsis, uzunVadeli: uzun, aciklama: g.aciklama ?? null });
      return { id: kredi.id };
    });
  }

  /** KRD-02: ödenmemiş taksitlerin tarih ve tutarları bankanın planına uydurulur. */
  async planGuncelle(id: string, satirlar: z.infer<typeof planGuncelleSemasi>["satirlar"]) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.bankaKredisi.findUnique({ where: { id }, include: { taksitler: true } });
      if (!k || k.tur === "rotatif") throw new NotFoundException("Taksitli kredi bulunamadı");
      for (const s of satirlar) {
        const t = k.taksitler.find((x) => x.id === s.id);
        if (!t) throw new BadRequestException("Taksit bu krediye ait değil");
        if (t.islemId) throw new ConflictException(`${t.sira}. taksit ödendi; önce ödemeyi geri alın`);
      }
      const yeni = k.taksitler.map((t) => {
        const s = satirlar.find((x) => x.id === t.id);
        return s ? { ...t, vadeTarihi: tarih(s.vadeTarihi), anapara: D(s.anapara), faiz: D(s.faiz), bsmv: D(s.bsmv), kkdf: D(s.kkdf) } : t;
      });
      const toplam = yeni.reduce((t, s) => t.add(s.anapara), D(0));
      if (!toplam.equals(k.anapara)) throw new BadRequestException(`Plandaki anapara toplamı (${toplam.toFixed(2)}) kredi tutarıyla (${k.anapara.toFixed(2)}) tutmuyor`);
      for (const s of satirlar) await tx.bankaKrediTaksiti.update({ where: { id: s.id }, data: { vadeTarihi: tarih(s.vadeTarihi), anapara: D(s.anapara), faiz: D(s.faiz), bsmv: D(s.bsmv), kkdf: D(s.kkdf) } });
      await tx.bankaKredisi.update({ where: { id }, data: { vadeTarihi: yeni.reduce((m, s) => (s.vadeTarihi > m ? s.vadeTarihi : m), yeni[0].vadeTarihi) } });
    });
    return this.getir(id);
  }

  // ─── İşlemler ──────────────────────────────────────────────────────────

  /** KRD-03/04: taksit ödemesi ya da rotatif işlem; ekstre eşleştirmesi de bunu kullanır. */
  async islem(id: string, g: KrediIslemGirdisi) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, tarih(g.tarih), "kredi işlemi");
    await this.prisma.tenantIslem(tenantId, (tx) => this.islemTx(tx, tenantId, id, g));
    return this.getir(id);
  }

  async islemTx(tx: Prisma.TransactionClient, tenantId: string, krediId: string, g: KrediIslemGirdisi, ekstreSatirId?: string): Promise<string> {
    const k = await tx.bankaKredisi.findUnique({ where: { id: krediId }, include: { taksitler: true, islemler: true } });
    if (!k) throw new NotFoundException("Kredi bulunamadı");
    const kullanilan = k.islemler.reduce((t, i) => (i.tip === "kullanim" ? t.add(i.anapara) : i.tip === "taksit" || i.tip === "geri_odeme" ? t.sub(i.anapara) : t), D(0));
    const anapara = D(g.anapara);
    const faizToplam = D(g.faiz).add(g.bsmv).add(g.kkdf);

    if (g.tip === "taksit") {
      if (k.tur === "rotatif") throw new BadRequestException("Rotatif kredide taksit yoktur; geri ödeme ya da faiz işlemi girin");
      const t = k.taksitler.find((x) => x.id === g.taksitId);
      if (!t) throw new BadRequestException("Ödenecek taksit seçilmelidir");
      if (t.islemId) throw new ConflictException(`${t.sira}. taksit zaten ödendi`);
      if (anapara.add(faizToplam).lte(0)) throw new BadRequestException("Ödeme tutarı sıfırdan büyük olmalıdır");
    } else {
      if (k.tur !== "rotatif") throw new BadRequestException("Bu işlem yalnız rotatif kredide yapılır");
      if (g.tip === "kullanim" && kullanilan.add(anapara).gt(k.anapara)) throw new BadRequestException(`Kullanım limiti aşıyor; kullanılabilir ${k.anapara.sub(kullanilan).toFixed(2)} ${k.dovizCinsi}`);
      if (g.tip === "geri_odeme" && anapara.gt(kullanilan)) throw new BadRequestException(`Geri ödeme kullanılan tutarı (${kullanilan.toFixed(2)} ${k.dovizCinsi}) aşıyor`);
      if (g.tip !== "faiz" && !anapara.gt(0)) throw new BadRequestException("Tutar sıfırdan büyük olmalıdır");
      if (g.tip === "faiz" && !faizToplam.gt(0)) throw new BadRequestException("Faiz tutarı sıfırdan büyük olmalıdır");
    }
    // Ödemenin yapıldığı hesap seçilebilir; kredinin dövizinde aktif bir banka hesabı olmalıdır.
    const hesapId = g.tip === "kullanim" ? k.bankaHesapId : g.bankaHesapId || k.bankaHesapId;
    if (g.tip === "kullanim" && g.bankaHesapId && g.bankaHesapId !== k.bankaHesapId) throw new BadRequestException("Rotatif kullanım kredinin bağlı olduğu hesaba girer");
    if (hesapId !== k.bankaHesapId) {
      const hesap = await tx.bankaHesap.findUnique({ where: { id: hesapId }, select: { aktif: true, dovizCinsi: true } });
      if (!hesap?.aktif) throw new BadRequestException("Ödeme yapılacak aktif banka hesabı bulunamadı");
      if (hesap.dovizCinsi !== k.dovizCinsi) throw new BadRequestException(`Ödeme hesabı kredinin dövizinde (${k.dovizCinsi}) olmalıdır`);
    }
    const islemId = await this.islemYaz(tx, tenantId, { ...k, bankaHesapId: hesapId }, {
      tip: g.tip, tarih: g.tarih, anapara: g.tip === "faiz" ? "0" : g.anapara, faiz: g.faiz, bsmv: g.bsmv, kkdf: g.kkdf, masraf: D(0),
      uzunVadeli: g.tip === "taksit" ? this.uzunVadeliMi(k, g.taksitId!) : D(0), aciklama: g.aciklama ?? null, eksiBakiyeOnay: g.eksiBakiyeOnay, ekstreSatirId,
    });
    if (g.tip === "taksit") {
      await tx.bankaKrediTaksiti.update({ where: { id: g.taksitId! }, data: { islemId } });
      if (k.taksitler.every((x) => x.islemId || x.id === g.taksitId)) await tx.bankaKredisi.update({ where: { id: k.id }, data: { durum: "kapandi" } });
    }
    return (await tx.bankaKrediIslemi.findUniqueOrThrow({ where: { id: islemId } })).hareketId;
  }

  /** Taksitin anaparası kullanımda 400'e yazıldıysa ödemesi de 400'ü kapatır (KRD-08). */
  private uzunVadeliMi(k: { kullanimTarihi: Date; taksitler: Array<{ id: string; vadeTarihi: Date; anapara: Prisma.Decimal }> }, taksitId: string) {
    const t = k.taksitler.find((x) => x.id === taksitId)!;
    return gun(t.vadeTarihi) > ayEkle(gun(k.kullanimTarihi), 12) ? t.anapara : D(0);
  }

  private async islemYaz(
    tx: Prisma.TransactionClient,
    tenantId: string,
    k: { id: string; ad: string; bankaHesapId: string; dovizCinsi: string },
    g: { tip: "kullanim" | "taksit" | "geri_odeme" | "faiz"; tarih: string; anapara: string; faiz: string; bsmv: string; kkdf: string; masraf: Prisma.Decimal; uzunVadeli: Prisma.Decimal; aciklama: string | null; eksiBakiyeOnay?: boolean; ekstreSatirId?: string },
  ): Promise<string> {
    const { userId } = aktifBaglam();
    const giris = g.tip === "kullanim";
    const hareketTipi = giris ? "tahsilat" : "tediye";
    const anapara = D(g.anapara);
    const finansman = D(g.faiz).add(g.bsmv).add(g.kkdf);
    const banka = giris ? anapara.sub(g.masraf) : anapara.add(finansman);
    const kur = k.dovizCinsi === "TRY" ? D(1) : await kurZorunlu(tx, k.dovizCinsi, tarih(g.tarih), hareketKurTipi(hareketTipi), tenantId);
    const hesap = { bankaHesapId: k.bankaHesapId };
    const once = giris ? null : await this.kasaBanka.hesapBakiyesi(tx, hesap);
    const ad = { kullanim: "kullanımı", taksit: "taksiti", geri_odeme: "anapara geri ödemesi", faiz: "faizi" }[g.tip];
    const aciklama = (g.aciklama || `${k.ad} kredi ${ad}`).slice(0, 500);
    const hareket = await tx.kasaBankaHareket.create({
      data: {
        tenantId, ...hesap, tip: hareketTipi, tutar: banka, dovizCinsi: k.dovizCinsi as never, kur, tutarTry: banka.mul(kur).toDecimalPlaces(2),
        tarih: tarih(g.tarih), aciklama, kaynakTur: "banka_kredisi", kaynakRef: k.id, ekstreSatirId: g.ekstreSatirId ?? null,
      },
    });
    await this.kasaBanka.eksiBakiyeDenetle(tx, hesap, once, g.eksiBakiyeOnay);
    const gider = g.tip === "kullanim" ? g.masraf : finansman;
    let masrafId: string | null = null;
    if (gider.gt(0)) {
      const kategori = await tx.masrafKategori.findFirst({ where: { ad: FINANSMAN_KATEGORISI.ad } })
        ?? await tx.masrafKategori.create({ data: { tenantId, ad: FINANSMAN_KATEGORISI.ad, muhasebeKodu: FINANSMAN_KATEGORISI.muhasebeKodu, varsayilanKdvOrani: D(0) } });
      const banka2 = await tx.bankaHesap.findUnique({ where: { id: k.bankaHesapId }, select: { bankaAdi: true } });
      masrafId = (await tx.masraf.create({
        data: {
          tenantId, kategoriId: kategori.id, belgeTuru: "dekont", tarih: tarih(g.tarih), saticiUnvan: banka2?.bankaAdi ?? null,
          aciklama: g.tip === "kullanim" ? `${k.ad} kredi tahsis ücreti` : `${k.ad} kredi faizi ve vergileri`,
          matrah: gider, kdvOrani: D(0), kdvTutari: D(0), toplam: gider, dovizCinsi: k.dovizCinsi as never, kur,
          durum: "onaylandi", odemeDurumu: "odendi", odenenTutar: gider, odemeTarihi: tarih(g.tarih), kaynakTur: "banka_kredisi",
        },
      })).id;
    }
    const islem = await tx.bankaKrediIslemi.create({
      data: {
        tenantId, krediId: k.id, tip: g.tip, tarih: tarih(g.tarih), anapara, faiz: D(g.faiz), bsmv: D(g.bsmv), kkdf: D(g.kkdf), masraf: g.tip === "kullanim" ? g.masraf : D(0),
        uzunVadeliAnapara: g.uzunVadeli, hareketId: hareket.id, masrafId, aciklama: g.aciklama, userId,
      },
    });
    return islem.id;
  }

  // ─── Geri alma ve silme ────────────────────────────────────────────────

  /** KRD-05: açık dönemde işlemi geri alır; ekstreye bağlıysa önce ekstreden. */
  async islemGeriAl(islemId: string) {
    const { tenantId } = aktifBaglam();
    const islem = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaKrediIslemi.findUnique({ where: { id: islemId }, include: { kredi: { include: { islemler: true } } } }));
    if (!islem) throw new NotFoundException("Kredi işlemi bulunamadı");
    if (islem.tip === "kullanim" && islem.kredi.tur !== "rotatif") throw new BadRequestException("Kullanım krediyle birlikte silinir");
    if (islem.tip === "kullanim") {
      // Rotatifte kullanım geri alınınca geri ödemeler kullanılanı aşmamalı.
      const kalan = islem.kredi.islemler.filter((i) => i.id !== islem.id).reduce((t, i) => (i.tip === "kullanim" ? t.add(i.anapara) : i.tip === "geri_odeme" ? t.sub(i.anapara) : t), D(0));
      if (kalan.isNegative()) throw new BadRequestException("Bu kullanımdan sonra yapılan geri ödemeler kullanılanı aşar; önce geri ödemeyi geri alın");
    }
    await this.donemKilidi.tarihDogrula(tenantId, islem.tarih, "kredi işlemini geri alma");
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const h = await tx.kasaBankaHareket.findUnique({ where: { id: islem.hareketId }, select: { ekstreSatirId: true } });
      if (h?.ekstreSatirId) throw new BadRequestException("Bu işlem banka ekstresinden eşleştirildi; Banka Ekstreleri ekranından geri alın");
      await this.islemSilTx(tx, islem.hareketId);
    });
    return this.getir(islem.krediId);
  }

  /** Banka hareketine göre kredi işlemini, masrafını ve hareketi siler; taksit yeniden açılır. */
  async islemSilTx(tx: Prisma.TransactionClient, hareketId: string) {
    const islem = await tx.bankaKrediIslemi.findUnique({ where: { hareketId } });
    if (!islem) return;
    await tx.bankaKrediIslemi.delete({ where: { id: islem.id } }); // taksit.islemId SetNull ile açılır
    if (islem.masrafId) await tx.masraf.deleteMany({ where: { id: islem.masrafId } });
    await tx.kasaBankaHareket.delete({ where: { id: hareketId } });
    await tx.bankaKredisi.update({ where: { id: islem.krediId }, data: { durum: "aktif" } });
  }

  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.bankaKredisi.findUnique({ where: { id }, include: { islemler: true } });
      if (!k) throw new NotFoundException("Kredi bulunamadı");
      // Rotatifte her kullanım ayrı işlemdir; yalnız işlemsiz rotatif, taksitli/spotta yalnız açılış kullanımı olan silinir.
      const silinebilir = k.tur === "rotatif" ? k.islemler.length === 0 : k.islemler.length <= 1 && k.islemler.every((i) => i.tip === "kullanim");
      if (!silinebilir) throw new ConflictException("Ödemesi ya da işlemi olan kredi silinemez; önce işlemleri geri alın");
      const kullanim = k.islemler.find((i) => i.tip === "kullanim");
      if (kullanim) {
        await this.donemKilidi.tarihDogrula(tenantId, kullanim.tarih, "kredi silme", tx);
        const h = await tx.kasaBankaHareket.findUnique({ where: { id: kullanim.hareketId }, select: { ekstreSatirId: true } });
        if (h?.ekstreSatirId) throw new BadRequestException("Kredi kullanımı banka ekstresine bağlı; önce ekstre eşleşmesini geri alın");
        await this.islemSilTx(tx, kullanim.hareketId);
      }
      await tx.bankaKredisi.delete({ where: { id } });
    });
    return { silindi: true };
  }
}
