import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Rol } from "@tekirextra/shared";
import { aktifBaglam, baglamlaCalistir } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type { ToplamHucresi } from "../core/raporlar/rapor-disa-aktarim";
import { raporErisilebilir, raporTanimiAl, type RaporGirdisi, type RaporTanimi } from "../core/raporlar/rapor-kayit";
import { RaporlarService } from "../core/raporlar/raporlar.service";
import { donemCoz, sonrakiGonderim, yenidenDenemeAni, type GoreliDonem, type Siklik } from "../core/raporlar/rapor-abonelik-zaman";
import { EpostaService } from "../tenant/eposta.service";

export interface AbonelikGirdisi {
  gorunumId: string;
  siklik: Siklik;
  gun: number | null;
  saat: string;
  donem: GoreliDonem;
  bicim: "excel" | "pdf" | "ikisi";
  bosGonder: boolean;
  aliciIdler: string[];
}

const DONEM_ADI: Record<GoreliDonem, string> = {
  dun: "Dün", gecen_hafta: "Geçen hafta", gecen_ay: "Geçen ay", bu_ay: "Bu ay (bugüne kadar)", bu_yil: "Bu yıl (bugüne kadar)", gorunum: "Görünümdeki dönem",
};

/** Raporun başlangıç–bitiş süzgeci var mı (göreli dönem ancak o zaman uygulanır). */
export const donemliRapor = (t: Pick<RaporTanimi, "filtreler">) =>
  t.filtreler.some((f) => f.alan === "baslangic") && t.filtreler.some((f) => f.alan === "bitis");

/** Görünüm girdisine göreli dönemi uygular; "gorunum" ya da dönemsiz raporda girdi aynen kalır. */
export function abonelikGirdisi(t: Pick<RaporTanimi, "filtreler">, girdi: RaporGirdisi, donem: GoreliDonem, an: Date): RaporGirdisi {
  const aralik = donemliRapor(t) ? donemCoz(donem, an) : null;
  return aralik ? { ...girdi, filtreler: { ...(girdi.filtreler ?? {}), ...aralik } } : girdi;
}

const sayi = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** E-posta gövdesi: rapor, dönem/süzgeçler, satır sayısı ve toplamlar. */
export function gonderimMetni(t: Pick<RaporTanimi, "ad" | "kolonlar">, bilgiler: string[], satirSayisi: number, toplamlar: Map<string, ToplamHucresi> | null, gorunumAdi: string): string {
  const satirlar = [`${t.ad} — ${gorunumAdi}`, "", ...bilgiler, "", satirSayisi ? `${satirSayisi.toLocaleString("tr-TR")} satır.` : "Bu dönemde kayıt yok."];
  if (toplamlar) {
    satirlar.push("", "Toplamlar:");
    for (const k of t.kolonlar) {
      const h = toplamlar.get(k.alan);
      if (!h || h === "karisik") continue;
      satirlar.push(`  ${k.baslik}: ${k.tip === "para" ? `${sayi(h.deger)} ${h.doviz && h.doviz !== "TRY" ? h.doviz : "TL"}` : h.deger.toLocaleString("tr-TR")}`);
    }
  }
  satirlar.push("", "Bu ileti TekirExtra zamanlanmış rapor aboneliğinden gönderildi. Aboneliği Raporlar ekranındaki \"Zamanlanmış raporlarım\" listesinden değiştirebilirsiniz.");
  return satirlar.join("\n");
}

const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Sıklık–gün tutarlılığı. */
export function abonelikDogrula(g: Pick<AbonelikGirdisi, "siklik" | "gun" | "saat">): string | null {
  if (!SAAT.test(g.saat)) return "Saat SS:DD biçiminde olmalı";
  if (g.siklik === "haftalik" && !(g.gun && g.gun >= 1 && g.gun <= 7)) return "Haftalık gönderimde gün 1 (Pazartesi) ile 7 (Pazar) arasında olmalı";
  if (g.siklik === "aylik" && !(g.gun && g.gun >= 1 && g.gun <= 28)) return "Aylık gönderimde gün 1 ile 28 arasında olmalı";
  return null;
}

@Injectable()
export class RaporAbonelikService {
  private readonly logger = new Logger(RaporAbonelikService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly raporlar: RaporlarService,
    private readonly eposta: EpostaService,
  ) {}

  /** Raporu görebilen etkin firma kullanıcıları (alıcı seçici). */
  async aliciAdaylari(raporKod: string) {
    const tanim = raporTanimiAl(raporKod);
    if (!tanim) throw new NotFoundException(`'${raporKod}' raporu bulunamadı`);
    const { tenantId } = aktifBaglam();
    const kullanicilar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findMany({ where: { aktif: true }, select: { id: true, adSoyad: true, eposta: true, rol: true }, orderBy: { adSoyad: "asc" } }));
    return kullanicilar.filter((k) => raporErisilebilir(tanim, k.rol as Rol)).map(({ rol: _r, ...k }) => k);
  }

  /** Kullanıcının abonelikleri; yönetici firmadakilerin hepsini görür. */
  async listele() {
    const { tenantId, userId, rol } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.raporAboneligi.findMany({
        where: rol === "yonetici" ? {} : { userId },
        include: { gorunum: { select: { ad: true, raporKod: true } } },
        orderBy: { createdAt: "desc" },
      }));
    const kisiIdler = [...new Set(kayitlar.flatMap((k) => [k.userId, ...k.aliciIdler]))];
    const kisiler = new Map((await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findMany({ where: { id: { in: kisiIdler } }, select: { id: true, adSoyad: true, eposta: true } }))).map((k) => [k.id, k]));
    return kayitlar.map((k) => ({
      ...k,
      raporKod: k.gorunum.raporKod,
      raporAd: raporTanimiAl(k.gorunum.raporKod)?.ad ?? k.gorunum.raporKod,
      gorunumAd: k.gorunum.ad,
      kuran: kisiler.get(k.userId)?.adSoyad ?? "",
      alicilar: k.aliciIdler.map((id) => kisiler.get(id) ?? { id, adSoyad: "(silinmiş kullanıcı)", eposta: "" }),
    }));
  }

  private async girdiDenetle(g: AbonelikGirdisi) {
    const hata = abonelikDogrula(g);
    if (hata) throw new BadRequestException(hata);
    const { tenantId, userId, rol } = aktifBaglam();
    const gorunum = await this.prisma.tenantIslem(tenantId, (tx) => tx.raporGorunumu.findFirst({ where: { id: g.gorunumId, OR: [{ userId }, { firmaGeneli: true }] } }));
    if (!gorunum) throw new NotFoundException("Kayıtlı görünüm bulunamadı");
    const tanim = raporTanimiAl(gorunum.raporKod);
    if (!tanim) throw new NotFoundException(`'${gorunum.raporKod}' raporu bulunamadı`);
    if (!raporErisilebilir(tanim, rol)) throw new ForbiddenException("Bu raporu görme yetkiniz yok");
    if (!g.aliciIdler.length) throw new BadRequestException("En az bir alıcı seçin");
    const uygun = new Set((await this.aliciAdaylari(gorunum.raporKod)).map((k) => k.id));
    const uygunsuz = g.aliciIdler.filter((id) => !uygun.has(id));
    if (uygunsuz.length) throw new BadRequestException("Seçilen alıcılardan bazıları bu raporu göremiyor ya da etkin değil");
    return { tanim, donem: donemliRapor(tanim) ? g.donem : ("gorunum" as const) };
  }

  async olustur(g: AbonelikGirdisi) {
    const { donem } = await this.girdiDenetle(g);
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.raporAboneligi.create({
      data: { tenantId, userId, gorunumId: g.gorunumId, siklik: g.siklik, gun: g.siklik === "gunluk" ? null : g.gun, saat: g.saat, donem, bicim: g.bicim, bosGonder: g.bosGonder, aliciIdler: [...new Set(g.aliciIdler)], sonrakiGonderim: sonrakiGonderim(g, new Date()) },
    }));
  }

  private async sahipli(id: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.raporAboneligi.findUnique({ where: { id } }));
    if (!kayit || (kayit.userId !== userId && rol !== "yonetici")) throw new NotFoundException("Abonelik bulunamadı");
    return kayit;
  }

  async guncelle(id: string, g: AbonelikGirdisi) {
    await this.sahipli(id);
    const { donem } = await this.girdiDenetle(g);
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.raporAboneligi.update({
      where: { id },
      data: { gorunumId: g.gorunumId, siklik: g.siklik, gun: g.siklik === "gunluk" ? null : g.gun, saat: g.saat, donem, bicim: g.bicim, bosGonder: g.bosGonder, aliciIdler: [...new Set(g.aliciIdler)], sonrakiGonderim: sonrakiGonderim(g, new Date()), denemeSayisi: 0 },
    }));
  }

  async aktiflikDegistir(id: string, aktif: boolean) {
    const k = await this.sahipli(id);
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.raporAboneligi.update({
      where: { id },
      data: { aktif, denemeSayisi: 0, ...(aktif ? { sonrakiGonderim: sonrakiGonderim({ siklik: k.siklik as Siklik, gun: k.gun, saat: k.saat }, new Date()), sonHata: null } : {}) },
    }));
  }

  async sil(id: string) {
    await this.sahipli(id);
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.raporAboneligi.delete({ where: { id } }));
  }

  /** "Şimdi gönder": olağan zamanlamayı değiştirmeden bir kez gönderir. */
  async simdiGonder(id: string) {
    await this.sahipli(id);
    const { tenantId } = aktifBaglam();
    return this.gonder(tenantId, id, { elle: true });
  }

  /**
   * Bir aboneliği gönderir. Kuran kullanıcının rolüyle çalışır; kullanıcı
   * silinmiş, pasif ya da raporu artık göremiyorsa abonelik duraklar ve
   * kurana (hâlâ etkinse) e-postayla bildirilir. Alıcı yetkisi her seferinde
   * yeniden denetlenir. Hata yeniden denenir (15 dk, 1 sa, 4 sa), sonra
   * sıradaki olağan zamana kalır.
   */
  async gonder(tenantId: string, id: string, secenek: { elle?: boolean } = {}): Promise<{ durum: string; alici: number; hata?: string }> {
    const simdi = new Date();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.raporAboneligi.findUnique({ where: { id }, include: { gorunum: true } }));
    if (!kayit) return { durum: "yok", alici: 0 };
    const siradaki = sonrakiGonderim({ siklik: kayit.siklik as Siklik, gun: kayit.gun, saat: kayit.saat }, simdi);
    const yaz = (data: Record<string, unknown>) => this.prisma.tenantIslem(tenantId, (tx) => tx.raporAboneligi.update({ where: { id }, data }));
    const tanim = raporTanimiAl(kayit.gorunum.raporKod);
    const kuran = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findUnique({ where: { id: kayit.userId }, select: { id: true, aktif: true, rol: true, eposta: true, adSoyad: true } }));

    const duraklat = async (neden: string) => {
      await yaz({ aktif: false, sonDurum: "duraklatildi", sonHata: neden, denemeSayisi: 0 });
      if (kuran?.aktif) {
        await baglamlaCalistir({ tenantId, userId: kuran.id, rol: kuran.rol as Rol }, () => this.eposta.iletiGonder({
          alici: kuran.eposta, konu: `Zamanlanmış rapor duraklatıldı: ${kayit.gorunum.ad}`,
          metin: `Merhaba ${kuran.adSoyad},\n\n"${kayit.gorunum.ad}" görünümü için kurduğunuz zamanlanmış rapor duraklatıldı: ${neden}\n\nRaporlar ekranındaki "Zamanlanmış raporlarım" listesinden düzenleyip yeniden başlatabilirsiniz.`,
        })).catch(() => undefined);
      }
      return { durum: "duraklatildi", alici: 0, hata: neden };
    };
    if (!tanim) return duraklat(`'${kayit.gorunum.raporKod}' raporu artık yok`);
    if (!kuran?.aktif) return duraklat("aboneliği kuran kullanıcı etkin değil");
    if (!raporErisilebilir(tanim, kuran.rol as Rol)) return duraklat("aboneliği kuran kullanıcının bu raporu görme yetkisi kalmadı");

    const alicilar = (await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findMany({ where: { id: { in: kayit.aliciIdler }, aktif: true }, select: { eposta: true, rol: true } })))
      .filter((a) => raporErisilebilir(tanim, a.rol as Rol));
    if (!alicilar.length) return duraklat("raporu görebilen etkin alıcı kalmadı");

    try {
      const girdi = abonelikGirdisi(tanim, kayit.gorunum.girdi as RaporGirdisi, kayit.donem as GoreliDonem, simdi);
      const bicim = { excel: kayit.bicim !== "pdf", pdf: kayit.bicim !== "excel" };
      const sonuc = await baglamlaCalistir({ tenantId, userId: kuran.id, rol: kuran.rol as Rol }, async () => {
        const paket = await this.raporlar.paket(tanim.kod, girdi, bicim);
        if (!paket.satirSayisi && !kayit.bosGonder && !secenek.elle) return { durum: "bos_atlandi", alici: 0 };
        const donem = girdi.filtreler?.baslangic ? `${girdi.filtreler.baslangic}_${girdi.filtreler.bitis}` : simdi.toISOString().slice(0, 10);
        const dosya = `${tanim.kod.replace(/\./g, "-")}_${donem}`;
        const ekler = [
          ...(paket.excel ? [{ dosyaAdi: `${dosya}.xlsx`, icerik: paket.excel, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }] : []),
          ...(paket.pdf ? [{ dosyaAdi: `${dosya}.pdf`, icerik: paket.pdf, mime: "application/pdf" }] : []),
        ];
        const metin = gonderimMetni(tanim, [`${DONEM_ADI[kayit.donem as GoreliDonem]}`, ...paket.bilgi.bilgiler], paket.satirSayisi, paket.toplamlar, kayit.gorunum.ad);
        const konu = `${paket.bilgi.firma ? `${paket.bilgi.firma} — ` : ""}${tanim.ad}: ${kayit.gorunum.ad}`;
        for (const a of alicilar) await this.eposta.raporGonder({ alici: a.eposta, konu, metin, ekler });
        return { durum: "gonderildi", alici: alicilar.length };
      });
      await yaz({ sonGonderim: simdi, sonDurum: sonuc.durum, sonHata: null, denemeSayisi: 0, ...(secenek.elle ? {} : { sonrakiGonderim: siradaki }) });
      return sonuc;
    } catch (hata) {
      const mesaj = (hata instanceof Error ? hata.message : String(hata)).slice(0, 500);
      const deneme = kayit.denemeSayisi + 1;
      const yeniden = secenek.elle ? null : yenidenDenemeAni(deneme, simdi);
      await yaz({ sonDurum: "basarisiz", sonHata: mesaj, denemeSayisi: yeniden ? deneme : 0, ...(secenek.elle ? {} : { sonrakiGonderim: yeniden ?? siradaki }) });
      this.logger.warn(JSON.stringify({ event: "report_subscription_failed", tenantId, id, deneme, error: mesaj }));
      return { durum: "basarisiz", alici: 0, hata: mesaj };
    }
  }
}
