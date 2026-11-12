import { Injectable, Optional } from "@nestjs/common";
import type { BildirimGirdisi } from "../bildirimler/bildirim.service";
import { BildirimService } from "../bildirimler/bildirim.service";
import { BildirimUreticiService } from "../bildirimler/bildirim-uretici.service";
import { trSimdi } from "../ai/ai-zaman";
import { aktifBaglam } from "../core/istek-baglami";
import { gunEkle } from "./nakit-akisi.hesap";
import { NakitAkisiService } from "./nakit-akisi.service";

/** Bildirim anahtarının öneki; durum düzelince bu önekle açık kalan bildirim kapanır. */
export const NAKIT_EKSI_ONEKI = "nakit-eksi:";
const ARALIK_MS = 30 * 60 * 1000;
const MAAS_KAYNAKLARI = new Set(["bordro", "bordro_yasal"]);

const tl = (n: number) => `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
const tarihTr = (g: string) => `${g.slice(8, 10)}.${g.slice(5, 7)}.${g.slice(0, 4)}`;

type Tahmin = Awaited<ReturnType<NakitAkisiService["tahmin"]>>;

/**
 * CNL-06: baz senaryoda kasa+banka bakiyesi bugün ya da yarın eksiye düşüyorsa kritik bildirim.
 * Saf işlev: tahmin sonucundan bildirim girdisi (yoksa null). Maaş kalemi adıyla anılmaz (CNL-05).
 */
export function nakitEksiBildirimi(t: Pick<Tahmin, "senaryolar" | "kalemler">, bugun: string): BildirimGirdisi | null {
  const ilk = t.senaryolar?.baz?.ilkEksi;
  if (!ilk || ilk.tarih > gunEkle(bugun, 1)) return null;
  const gunun = t.kalemler.filter((k) => k.yon === "cikis" && (k.tarihler?.baz?.tarih ?? k.vade) === ilk.tarih);
  const cikis = gunun.reduce((s, k) => s + k.tutar, 0);
  const enBuyuk = [...gunun].sort((a, b) => b.tutar - a.tutar)[0];
  const enBuyukMetni = enBuyuk ? (MAAS_KAYNAKLARI.has(enBuyuk.kaynak) ? "maaş ödemeleri" : `${enBuyuk.aciklama.slice(0, 80)} (${tl(enBuyuk.tutar)})`) : null;
  const gun = ilk.tarih === bugun ? "bugün" : "yarın";
  return {
    tur: "vade",
    onem: "kritik",
    baslik: `Nakit ${gun} eksiye düşüyor: ${tl(ilk.bakiye)}`,
    aciklama: [
      `Beklenen tahsilat ve ödemelerle kasa ve banka toplamı ${tarihTr(ilk.tarih)} günü ${tl(ilk.bakiye)} oluyor.`,
      cikis > 0 ? `O gün beklenen çıkış ${tl(cikis)}${enBuyukMetni ? `; en büyüğü ${enBuyukMetni}` : ""}.` : null,
      "Öneri: ödemelerden birini erteleyin, vadesi gelen tahsilatı arayın ya da hesaplar arası aktarım yapın. Ayrıntı Nakit Akışı ekranında.",
    ].filter(Boolean).join(" "),
    birlesimAnahtari: `${NAKIT_EKSI_ONEKI}${ilk.tarih}`,
    kaynakTur: "nakit_akisi",
    hedefYol: "/panel/nakit-akisi",
    roller: ["yonetici", "muhasebe"],
  };
}

/** Bildirim taramasına "nakit eksi" adımını ekler (BildirimUreticiService.ekTaramaKaydet). */
@Injectable()
export class NakitUyariService {
  constructor(
    private readonly nakit: NakitAkisiService,
    private readonly bildirimler: BildirimService,
    @Optional() uretici?: BildirimUreticiService,
  ) {
    uretici?.ekTaramaKaydet("nakit eksi", () => this.tara());
  }

  /** Tahmin ağır bir okuma; bildirim taraması birkaç dakikada bir döner, firma başına 30 dakikada bir yeter. */
  private readonly sonTarama = new Map<string, number>();

  async tara(): Promise<void> {
    const { tenantId } = aktifBaglam();
    const simdi = Date.now();
    if ((this.sonTarama.get(tenantId) ?? 0) > simdi - ARALIK_MS) return;
    this.sonTarama.set(tenantId, simdi);
    if (this.sonTarama.size > 50_000) this.sonTarama.clear();
    const bugun = trSimdi().gun;
    const girdi = nakitEksiBildirimi(await this.nakit.tahmin(7), bugun);
    if (girdi) await this.bildirimler.uret(girdi);
    await this.bildirimler.kapatEksikleri("vade", girdi ? [girdi.birlesimAnahtari] : [], [NAKIT_EKSI_ONEKI]);
  }
}
