/**
 * KSB-11: çek/senet bordrosu.
 *
 * Giriş ve borç çeki çıkışı bordroları satır satır yeni evrak yazar; ciro,
 * tahsile ve teminata verme bordroları portföydeki evrakların durumunu tek
 * işlemde değiştirir. Her evrak olayı bordroya bağlanır; bordro bütün olarak
 * geri alınır (evrak bazında tek başına geri alınamaz). Geri alınan
 * bordronun numarası yanar.
 */
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type CekSenetBordroTur } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { PdfService } from "../core/pdf/pdf.service";
import { kacis, paraBicim, sayfaSablonu, tarihBicim } from "../core/pdf/pdf-sablon";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { DepoService } from "../ekler/depo.service";
import { EklerService, type YuklenenDosya } from "../ekler/ekler.service";
import { BORDRO_BASLIGI, bordroNoBicimle, ortalamaVade, siradakiPortfoyNolari } from "./cek-bordro-hesap";
import type { cekBordroCikisSemasi, cekBordroGirisSemasi } from "./cek-bordro.semalar";
import { KasaBankaService } from "./kasa-banka.service";
import { type DovizKodu } from "@tekirextra/shared";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);
const gunMetni = (t: Date) => t.toISOString().slice(0, 10);
const GORUNUM_MIMELERI = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const CIKIS_DURUMU = { ciro: "ciro_edildi", tahsile: "tahsile_verildi", teminata: "teminata_verildi" } as const;

@Injectable()
export class CekBordroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kasaBanka: KasaBankaService,
    private readonly donemKilidi: DonemKilidiService,
    private readonly pdf: PdfService,
    private readonly ekler: EklerService,
    private readonly depo: DepoService,
  ) {}

  async listele(sorgu: { tur?: CekSenetBordroTur; baslangic?: string; bitis?: string }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cekSenetBordro.findMany({
        where: {
          tur: sorgu.tur,
          tarih: { ...(sorgu.baslangic ? { gte: new Date(sorgu.baslangic) } : {}), ...(sorgu.bitis ? { lte: new Date(sorgu.bitis) } : {}) },
        },
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        take: 200,
        include: { cari: { select: { id: true, kod: true, unvan: true } }, bankaHesap: { select: { id: true, ad: true } } },
      }),
    );
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const bordro = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cekSenetBordro.findUnique({
        where: { id },
        include: {
          cari: { select: { id: true, kod: true, unvan: true } },
          bankaHesap: { select: { id: true, ad: true, bankaAdi: true, iban: true } },
          olaylar: {
            where: { geriAlma: false },
            orderBy: { createdAt: "asc" },
            include: {
              cekSenet: {
                select: {
                  id: true,
                  tur: true,
                  yon: true,
                  portfoyNo: true,
                  cekNo: true,
                  vadeTarihi: true,
                  tutar: true,
                  dovizCinsi: true,
                  borclu: true,
                  banka: true,
                  sube: true,
                  hesapNo: true,
                  kesideYeri: true,
                  durum: true,
                  onYuzEkId: true,
                  arkaYuzEkId: true,
                },
              },
            },
          },
        },
      }),
    );
    if (!bordro) throw new NotFoundException("Bordro bulunamadı");
    return bordro;
  }

  /** Giriş ve borç çeki çıkışı: satırlardaki evraklar tek işlemde yazılır. */
  async giris(girdi: z.infer<typeof cekBordroGirisSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "çek/senet bordrosu");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const cari = await tx.cariHesap.findUnique({ where: { id: girdi.cariId }, select: { id: true, aktif: true, unvan: true } });
      if (!cari?.aktif) throw new BadRequestException("Aktif cari hesap bulunamadı");
      const firma = girdi.tur === "borc_cikis" ? await tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }) : null;
      const verilenNolar = girdi.satirlar.map((s) => s.portfoyNo).filter((n): n is string => Boolean(n));
      if (new Set(verilenNolar).size !== verilenNolar.length)
        throw new BadRequestException("Bordroda aynı portföy numarası iki kez kullanılmış");
      const eksik = girdi.satirlar.filter((s) => !s.portfoyNo).length;
      const mevcut = eksik ? (await tx.cekSenet.findMany({ select: { portfoyNo: true } })).map((c) => c.portfoyNo) : [];
      const otomatik = siradakiPortfoyNolari([...mevcut, ...verilenNolar], eksik);

      const bordro = await this.bordroAc(tx, tenantId, userId, {
        tur: girdi.tur,
        tarih: girdi.tarih,
        cariId: cari.id,
        bankaHesapId: null,
        dovizCinsi: girdi.dovizCinsi,
        aciklama: girdi.aciklama ?? null,
        evraklar: girdi.satirlar.map((s) => ({ vadeTarihi: s.vadeTarihi, tutar: s.tutar })),
      });
      const cekler = [];
      for (const satir of girdi.satirlar) {
        cekler.push(
          await this.kasaBanka.cekKaydiYaz(
            tx,
            tenantId,
            userId,
            {
              tur: satir.tur,
              yon: girdi.tur === "borc_cikis" ? "verilen" : "alinan",
              portfoyNo: satir.portfoyNo || otomatik.shift()!,
              cekNo: satir.cekNo ?? null,
              islemTarihi: girdi.tarih,
              vadeTarihi: satir.vadeTarihi,
              tutar: satir.tutar,
              dovizCinsi: girdi.dovizCinsi,
              kur: girdi.kur,
              borclu: satir.borclu || firma?.unvan || cari.unvan,
              kesideYeri: satir.kesideYeri ?? null,
              banka: satir.banka ?? null,
              sube: satir.sube ?? null,
              hesapNo: satir.hesapNo ?? null,
              cariId: cari.id,
              aciklama: girdi.aciklama ?? null,
              fizikselKonum: null,
            },
            bordro,
          ),
        );
      }
      return { ...bordro, cekler: cekler.map((c) => ({ id: c.id, portfoyNo: c.portfoyNo })) };
    });
  }

  /** Ciro, tahsile ve teminata verme: portföydeki evraklar tek işlemde. */
  async cikis(girdi: z.infer<typeof cekBordroCikisSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    const durum = CIKIS_DURUMU[girdi.tur];
    const evraklar = await Promise.all(girdi.cekIdleri.map((id) => this.kasaBanka.cekSenetGetir(id)));
    const dovizler = new Set(evraklar.map((e) => e.dovizCinsi));
    if (dovizler.size > 1) throw new BadRequestException("Bir bordrodaki evraklar aynı para biriminde olmalıdır");
    for (const e of evraklar) {
      if (e.yon !== "alinan" || e.durum !== "portfoyde")
        throw new BadRequestException(
          `${e.portfoyNo} portföyde değil; yalnız portföydeki müşteri evrakı ${girdi.tur === "ciro" ? "ciro edilir" : "bankaya verilir"}`,
        );
    }
    const gecis = {
      durum,
      islemTarihi: girdi.tarih,
      aciklama: girdi.aciklama ?? null,
      ciroCariId: girdi.tur === "ciro" ? (girdi.cariId ?? null) : null,
      bankaHesapId: girdi.tur === "ciro" ? null : (girdi.bankaHesapId ?? null),
    };
    for (const e of evraklar) await this.kasaBanka.cekGecisiniDenetle(tenantId, e, gecis);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (girdi.tur === "ciro") {
        const cari = girdi.cariId ? await tx.cariHesap.findUnique({ where: { id: girdi.cariId }, select: { aktif: true } }) : null;
        if (!cari?.aktif) throw new BadRequestException("Ciro edilecek aktif cari seçin");
      } else {
        const banka = girdi.bankaHesapId
          ? await tx.bankaHesap.findUnique({ where: { id: girdi.bankaHesapId }, select: { aktif: true, dovizCinsi: true } })
          : null;
        if (!banka?.aktif) throw new BadRequestException("Evrakın verileceği aktif banka hesabını seçin");
        if (banka.dovizCinsi !== evraklar[0].dovizCinsi)
          throw new BadRequestException("Banka hesabı ile evrakların para birimi aynı olmalıdır");
      }
      const bordro = await this.bordroAc(tx, tenantId, userId, {
        tur: girdi.tur,
        tarih: girdi.tarih,
        cariId: girdi.tur === "ciro" ? girdi.cariId! : null,
        bankaHesapId: girdi.tur === "ciro" ? null : girdi.bankaHesapId!,
        dovizCinsi: evraklar[0].dovizCinsi,
        aciklama: girdi.aciklama ?? null,
        evraklar: evraklar.map((e) => ({ vadeTarihi: gunMetni(e.vadeTarihi), tutar: e.tutar })),
      });
      for (const e of evraklar) await this.kasaBanka.cekGecisiYaz(tx, tenantId, userId, e, gecis, bordro);
      return bordro;
    });
  }

  /**
   * Bordroyu bütün olarak geri alır: her evrakın bordro olayı, o evrakın son
   * işlemi olmalıdır. Giriş bordrosunda açık dönemdeki evraklar silinir
   * (görüntüleriyle), kapalı dönemde ters kayıt atılır.
   */
  async geriAl(id: string, neden: string) {
    const { tenantId, userId } = aktifBaglam();
    const silinecekAnahtarlar: string[] = [];
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM cek_senet_bordrolari WHERE id = ${id}::uuid FOR UPDATE`;
      const bordro = await tx.cekSenetBordro.findUnique({
        where: { id },
        include: { olaylar: { where: { geriAlindi: false, geriAlma: false }, select: { cekSenetId: true } } },
      });
      if (!bordro) throw new NotFoundException("Bordro bulunamadı");
      if (bordro.durum === "geri_alindi") throw new BadRequestException("Bordro zaten geri alındı");
      const cekIdleri = [...new Set(bordro.olaylar.map((o) => o.cekSenetId))];
      const sonuclar = [];
      for (const cekId of cekIdleri)
        sonuclar.push(
          await this.kasaBanka.cekSonIslemiGeriAlTx(tx, tenantId, userId, cekId, `${bordro.no} bordrosu geri alındı: ${neden}`, id),
        );
      // Silinen evrakların görüntüleri sahipsiz kalmasın.
      const kalan = new Set((await tx.cekSenet.findMany({ where: { id: { in: cekIdleri } }, select: { id: true } })).map((c) => c.id));
      const silinen = cekIdleri.filter((c) => !kalan.has(c));
      if (silinen.length) {
        const ekler = await tx.ek.findMany({
          where: { sahipTur: "cek_senet", sahipId: { in: silinen } },
          select: { id: true, depoAnahtari: true },
        });
        await tx.ek.deleteMany({ where: { id: { in: ekler.map((e) => e.id) } } });
        silinecekAnahtarlar.push(...ekler.map((e) => e.depoAnahtari));
      }
      await tx.cekSenetBordro.update({ where: { id }, data: { durum: "geri_alindi", geriAlmaNedeni: neden } });
      const tersKayit = sonuclar.some((s) => s.yontem === "ters_kayit");
      return {
        yontem: tersKayit ? ("ters_kayit" as const) : ("silindi" as const),
        no: bordro.no,
        evrak: cekIdleri.length,
        silinen: silinen.length,
        tersKayit,
      };
    });
    for (const anahtar of silinecekAnahtarlar) await this.depo.sil(anahtar).catch(() => undefined);
    return sonuc;
  }

  /** Bordro çıktısı; istenirse evrak görüntüleri ek sayfada. */
  async pdfUret(id: string, gorunumler: boolean): Promise<{ buffer: Buffer; dosyaAdi: string }> {
    const { tenantId } = aktifBaglam();
    const bordro = await this.getir(id);
    const firma = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }),
    );
    const satirlar = bordro.olaylar.filter((o) => o.cekSenet);
    const d = bordro.dovizCinsi;
    const karsi = bordro.bankaHesap
      ? `<b>Banka hesabı</b><br>${kacis(bordro.bankaHesap.ad)}${bordro.bankaHesap.iban ? `<br><span style="color:#6b7280">${kacis(bordro.bankaHesap.iban)}</span>` : ""}`
      : `<b>${bordro.tur === "giris" ? "Teslim eden (müşteri)" : bordro.tur === "ciro" ? "Ciro edilen" : "Lehtar"}</b><br>${kacis(bordro.cari?.unvan ?? "—")}${bordro.cari?.kod ? `<br><span style="color:#6b7280">${kacis(bordro.cari.kod)}</span>` : ""}`;
    let gorunumHtml = "";
    if (gorunumler) {
      const parcalar: string[] = [];
      for (const o of satirlar) {
        const resimler: string[] = [];
        for (const [ad, ekId] of [
          ["Ön yüz", o.cekSenet.onYuzEkId],
          ["Arka yüz", o.cekSenet.arkaYuzEkId],
        ] as const) {
          if (!ekId) continue;
          const { ek, icerik } = await this.ekler.indir(ekId);
          resimler.push(
            ek.mimeTip.startsWith("image/")
              ? `<figure style="flex:1;margin:0"><img src="data:${ek.mimeTip};base64,${icerik.toString("base64")}" style="width:100%;max-height:230px;object-fit:contain;border:1px solid #e5e7eb"><figcaption style="font-size:8pt;color:#6b7280">${ad}</figcaption></figure>`
              : `<div class="kutu" style="flex:1">${ad}: PDF olarak yüklendi (${kacis(ek.dosyaAdi)})</div>`,
          );
        }
        if (resimler.length)
          parcalar.push(
            `<div style="break-inside:avoid;margin-bottom:14px"><b>${kacis(o.cekSenet.portfoyNo)}</b> · ${kacis(o.cekSenet.cekNo ?? "")} · ${paraBicim(o.cekSenet.tutar.toString())} ${kacis(d)}<div style="display:flex;gap:10px;margin-top:6px">${resimler.join("")}</div></div>`,
          );
      }
      if (parcalar.length)
        gorunumHtml = `<div style="break-before:page"><h3 style="margin:0 0 10px">Evrak görüntüleri</h3>${parcalar.join("")}</div>`;
    }
    const html = sayfaSablonu({
      baslik: BORDRO_BASLIGI[bordro.tur],
      altBaslik: `${firma?.unvan ?? ""} · Bordro No: ${bordro.no}${bordro.durum === "geri_alindi" ? " · GERİ ALINDI" : ""}`,
      tema: await this.pdf.belgeTemasi(),
      icerik: `
        <div style="display:flex;gap:16px;margin:18px 0">
          <div class="kutu" style="flex:1"><b>Bordro tarihi</b><br>${tarihBicim(bordro.tarih)}</div>
          <div class="kutu" style="flex:2">${karsi}</div>
          <div class="kutu" style="flex:1"><b>Ortalama vade</b><br>${tarihBicim(bordro.ortalamaVade)}</div>
        </div>
        <table class="veri"><thead><tr><th>#</th><th>Portföy no</th><th>Evrak no</th><th>Keşideci / borçlu</th><th>Banka / şube</th><th>Vade</th><th class="sag">Tutar</th></tr></thead>
        <tbody>${satirlar.map((o, i) => `<tr><td>${i + 1}</td><td>${kacis(o.cekSenet.portfoyNo)}</td><td>${kacis(`${o.cekSenet.tur === "senet" ? "Senet " : ""}${o.cekSenet.cekNo ?? ""}`)}</td><td>${kacis(o.cekSenet.borclu)}</td><td>${kacis([o.cekSenet.banka, o.cekSenet.sube].filter(Boolean).join(" / ") || "—")}</td><td>${tarihBicim(o.cekSenet.vadeTarihi)}</td><td class="sag">${paraBicim(o.cekSenet.tutar.toString())} ${kacis(d)}</td></tr>`).join("")}</tbody></table>
        <div style="display:flex;justify-content:space-between;margin-top:14px;font-size:11pt"><span>${bordro.adet} evrak</span><b>TOPLAM: ${paraBicim(bordro.toplam.toString())} ${kacis(d)}</b></div>
        ${bordro.aciklama ? `<div class="kutu" style="margin-top:12px"><b>Açıklama</b><br>${kacis(bordro.aciklama)}</div>` : ""}
        <div style="display:flex;gap:50px;margin-top:55px;text-align:center"><div style="flex:1;border-top:1px solid #9ca3af;padding-top:7px">Teslim eden<br><small>Ad, soyad ve imza</small></div><div style="flex:1;border-top:1px solid #9ca3af;padding-top:7px">Teslim alan<br><small>Ad, soyad ve imza</small></div></div>
        ${gorunumHtml}`,
    });
    return { buffer: await this.pdf.htmlToPdf(html), dosyaAdi: `${bordro.no}.pdf` };
  }

  /** Evrakın ön/arka yüz görüntüsünü yükler; öncekinin yerini alır. */
  async gorunumYukle(cekId: string, yuz: "on" | "arka", dosya: YuklenenDosya) {
    if (!GORUNUM_MIMELERI.has(dosya.mimetype)) throw new BadRequestException("Çek görüntüsü JPG, PNG, WEBP ya da PDF olmalıdır");
    const { tenantId } = aktifBaglam();
    const ek = await this.ekler.yukle("cek_senet", cekId, dosya);
    const onceki = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const cs = await tx.cekSenet.findUnique({ where: { id: cekId }, select: { onYuzEkId: true, arkaYuzEkId: true } });
      await tx.cekSenet.update({ where: { id: cekId }, data: yuz === "on" ? { onYuzEkId: ek.id } : { arkaYuzEkId: ek.id } });
      return yuz === "on" ? cs?.onYuzEkId : cs?.arkaYuzEkId;
    });
    if (onceki) await this.ekler.sil(onceki).catch(() => undefined);
    return { ekId: ek.id };
  }

  async gorunumSil(cekId: string, yuz: "on" | "arka") {
    const { tenantId } = aktifBaglam();
    const ekId = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const cs = await tx.cekSenet.findUnique({ where: { id: cekId }, select: { onYuzEkId: true, arkaYuzEkId: true } });
      if (!cs) throw new NotFoundException("Çek/Senet bulunamadı");
      return yuz === "on" ? cs.onYuzEkId : cs.arkaYuzEkId;
    });
    if (ekId) await this.ekler.sil(ekId);
    return { silindi: Boolean(ekId) };
  }

  /** Tek evrak geri alınıp silindiyse görüntüleri de silinir. */
  async silinenEvrakGorunumleriniTemizle(cekId: string) {
    const { tenantId } = aktifBaglam();
    const ekler = await this.prisma.tenantIslem(tenantId, async (tx) => {
      if (await tx.cekSenet.findUnique({ where: { id: cekId }, select: { id: true } })) return [];
      return tx.ek.findMany({ where: { sahipTur: "cek_senet", sahipId: cekId }, select: { id: true } });
    });
    for (const ek of ekler) await this.ekler.sil(ek.id).catch(() => undefined);
  }

  // ─── YARDIMCILAR ───────────────────────────────────────────────────────────

  private async bordroAc(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    g: {
      tur: CekSenetBordroTur;
      tarih: string;
      cariId: string | null;
      bankaHesapId: string | null;
      dovizCinsi: DovizKodu;
      aciklama: string | null;
      evraklar: Array<{ vadeTarihi: string; tutar: Prisma.Decimal.Value }>;
    },
  ) {
    const yil = Number(g.tarih.slice(0, 4));
    const [{ son_sira: sira }] = await tx.$queryRaw<Array<{ son_sira: number }>>`
      INSERT INTO cek_senet_bordro_sayaclari (tenant_id, yil, son_sira) VALUES (${tenantId}::uuid, ${yil}, 1)
      ON CONFLICT (tenant_id, yil) DO UPDATE SET son_sira = cek_senet_bordro_sayaclari.son_sira + 1
      RETURNING son_sira`;
    return tx.cekSenetBordro.create({
      data: {
        tenantId,
        no: bordroNoBicimle(yil, sira),
        tur: g.tur,
        tarih: new Date(g.tarih),
        cariId: g.cariId,
        bankaHesapId: g.bankaHesapId,
        dovizCinsi: g.dovizCinsi,
        toplam: g.evraklar.reduce((t, e) => t.add(D(e.tutar)), D(0)),
        adet: g.evraklar.length,
        ortalamaVade: new Date(ortalamaVade(g.evraklar)),
        aciklama: g.aciklama,
        userId,
      },
    });
  }
}
