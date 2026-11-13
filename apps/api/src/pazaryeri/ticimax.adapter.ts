import { XMLParser } from "fast-xml-parser";
import type { PazaryeriAdaptoru, SiparisSayfasi } from "./adaptor";
import { doviz, enGec, guvenliIstek, imlecOku, imlecYaz, IPTAL_DURUMU, KARGO_SKU, kurus, sayi, siteKoku, vknTcknBul } from "./eticaret-ortak";
import type { NormalizeSiparis, PazaryeriConfig, PazaryeriStokFiyat } from "./trendyol.adapter";

/**
 * ETC-11: Ticimax web servisi (WCF/SOAP 1.1). Site adresi (`servisAdresi`) ve paneldeki web servis
 * yetki kodu (`apiAnahtari`, `UyeKodu`). Sözleşme demo.ticimax.com WSDL'inden (2026-11-13):
 * `SiparisServis.SelectSiparis(UyeKodu, WebSiparisFiltre, WebSiparisSayfalama)`, `UrunGetir=true` ile
 * kalemler siparişle gelir; stok `UrunServis.StokAdediGuncelle`, fiyat `UrunServis.UpdateUrunFiyat`.
 * DataContract alanları WSDL sırasıyla yazılır (WCF sırayı arar); sayı süzgeçlerinde -1 "tümü"dür.
 */
const SAYFA = 50;
const NS_DC = "http://schemas.datacontract.org/2004/07/";
const ayristirici = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, isArray: (ad) => ["WebSiparis", "WebSiparisUrun"].includes(ad) });

const kac = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const zarf = (govde: string) => `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${govde}</s:Body></s:Envelope>`;

/** Siparişin durumu: 0 ön sipariş (alınmaz), 8 iptal, 9 iade. */
const ON_SIPARIS = 0, IPTAL = new Set([8, 9]);

export function ticimaxSiparisIstegi(uyeKodu: string, duzenlemeBas: string, baslangic: number): string {
  // WebSiparisFiltre üyeleri WSDL sırasıyla; tarih yalnız düzenleme başlangıcı.
  const f = `<f xmlns:a="${NS_DC}"><a:DuzenlemeTarihiBas>${duzenlemeBas}</a:DuzenlemeTarihiBas><a:EFaturaURL>-1</a:EFaturaURL><a:EntegrasyonAktarildi>-1</a:EntegrasyonAktarildi><a:IptalEdilmisUrunler>true</a:IptalEdilmisUrunler><a:KampanyaGetir>false</a:KampanyaGetir><a:KargoEntegrasyonTakipDurumu>-1</a:KargoEntegrasyonTakipDurumu><a:KargoFirmaID>-1</a:KargoFirmaID><a:OdemeDurumu>-1</a:OdemeDurumu><a:OdemeGetir>false</a:OdemeGetir><a:OdemeTamamlandi>-1</a:OdemeTamamlandi><a:OdemeTipi>-1</a:OdemeTipi><a:PaketlemeDurumu>-1</a:PaketlemeDurumu><a:PazaryeriIhracat>-1</a:PazaryeriIhracat><a:SiparisDurumu>-1</a:SiparisDurumu><a:SiparisID>-1</a:SiparisID><a:TedarikciID>-1</a:TedarikciID><a:TeslimatMagazaID>-1</a:TeslimatMagazaID><a:UrunGetir>true</a:UrunGetir><a:UyeID>-1</a:UyeID></f>`;
  const s = `<s xmlns:a="${NS_DC}"><a:BaslangicIndex>${baslangic}</a:BaslangicIndex><a:KayitSayisi>${SAYFA}</a:KayitSayisi><a:SiralamaDegeri>ID</a:SiralamaDegeri><a:SiralamaYonu>ASC</a:SiralamaYonu></s>`;
  return zarf(`<SelectSiparis xmlns="http://tempuri.org/"><UyeKodu>${kac(uyeKodu)}</UyeKodu>${f}${s}</SelectSiparis>`);
}

type Deger = string | undefined;
interface TicimaxUrun { ID?: Deger; StokKodu?: Deger; Barkod?: Deger; UrunAdi?: Deger; Adet?: Deger; Tutar?: Deger; KdvTutari?: Deger; KdvOrani?: Deger; Durum?: Deger }
export interface TicimaxSiparis {
  ID?: Deger; SiparisNo?: Deger; Durum?: Deger; SiparisTarihi?: Deger; DuzenlemeTarihi?: Deger; AdiSoyadi?: Deger; Mail?: Deger; ParaBirimi?: Deger;
  SiparisToplamTutari?: Deger; ToplamTutar?: Deger; KargoTutari?: Deger;
  FaturaAdresi?: { Adres?: Deger; Il?: Deger; Ilce?: Deger; FirmaAdi?: Deger; VergiDairesi?: Deger; VergiNo?: Deger; AliciTelefon?: Deger; PostaKodu?: Deger; Ulke?: Deger; isKurumsal?: Deger };
  TeslimatAdresi?: Record<string, Deger>;
  Urunler?: { WebSiparisUrun?: TicimaxUrun[] };
}

/** WCF tarihleri saat dilimsiz yazılır (sunucu yerel saati, İstanbul); UTC'ye çevrilir. */
export function ticimaxTarih(t: Deger): string | undefined {
  if (!t || t.startsWith("0001-")) return undefined;
  const d = /[zZ]|[+-]\d\d:\d\d$/.test(t) ? new Date(t) : new Date(`${t}+03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function ticimaxSiparisDonustur(s: TicimaxSiparis): NormalizeSiparis | null {
  const durum = Number(s.Durum ?? -1);
  if (durum === ON_SIPARIS) return null;
  const satirlar: NormalizeSiparis["satirlar"] = (s.Urunler?.WebSiparisUrun ?? []).map((u) => {
    // Tutar ve KdvTutari birim başınadır (Tutar KDV hariç).
    const miktar = sayi(u.Adet) || 1;
    return { hariciSatirId: String(u.ID ?? ""), sku: (u.StokKodu || u.Barkod || String(u.ID)).trim(), barkod: u.Barkod || undefined, urunAdi: u.UrunAdi || "Ürün", miktar, birimFiyat: kurus(sayi(u.Tutar) + sayi(u.KdvTutari)), kdvOrani: u.KdvOrani !== undefined ? sayi(u.KdvOrani) : null };
  });
  const kargo = sayi(s.KargoTutari);
  if (kargo > 0) satirlar.push({ hariciSatirId: "kargo", sku: KARGO_SKU, urunAdi: "Kargo", miktar: 1, birimFiyat: kurus(kargo), kdvOrani: null });
  const fa = s.FaturaAdresi ?? {};
  return {
    hariciId: String(s.ID ?? s.SiparisNo), siparisNo: s.SiparisNo || String(s.ID), hariciDurum: IPTAL.has(durum) ? IPTAL_DURUMU : String(durum),
    siparisTarihi: ticimaxTarih(s.SiparisTarihi) ?? new Date().toISOString(),
    musteriUnvani: (fa.FirmaAdi || s.AdiSoyadi || "Web müşterisi").slice(0, 200), musteriEposta: s.Mail || undefined, musteriTelefon: fa.AliciTelefon || undefined,
    vknTckn: vknTcknBul(fa.VergiNo), dovizCinsi: doviz(s.ParaBirimi), toplam: kurus(sayi(s.SiparisToplamTutari ?? s.ToplamTutar)),
    teslimatAdresi: { fatura: { ad: s.AdiSoyadi, firma: fa.FirmaAdi, adres: fa.Adres, il: fa.Il, ilce: fa.Ilce, postaKodu: fa.PostaKodu, ulke: fa.Ulke, vergiDairesi: fa.VergiDairesi }, teslimat: s.TeslimatAdresi },
    satirlar,
  };
}

export class TicimaxAdapter implements PazaryeriAdaptoru {
  private async cagir(config: PazaryeriConfig, servis: "SiparisServis" | "UrunServis", islem: string, govde: string): Promise<Record<string, unknown>> {
    if (!config.apiAnahtari) throw new Error("Ticimax web servis yetki kodu zorunludur");
    const yanit = await guvenliIstek(`${siteKoku(config.servisAdresi)}/Servis/${servis}.svc`, {
      method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"http://tempuri.org/I${servis}/${islem}"` }, body: govde,
    });
    const metin = await yanit.text();
    const xml = ayristirici.parse(metin) as { Envelope?: { Body?: Record<string, unknown> } };
    const body = xml.Envelope?.Body ?? {};
    const hata = body.Fault as { faultstring?: string } | undefined;
    if (!yanit.ok || hata) throw new Error(`Ticimax ${islem}: ${hata?.faultstring ? String(hata.faultstring).slice(0, 200) : `HTTP ${yanit.status}`}`);
    return (body[`${islem}Response`] ?? {}) as Record<string, unknown>;
  }

  async siparisleriCek(config: PazaryeriConfig, imlec?: string | null): Promise<SiparisSayfasi> {
    const durum = imlecOku(imlec);
    const baslangic = ((durum.sayfa ?? 1) - 1) * SAYFA;
    // WCF tarihi saat dilimsiz İstanbul yerel saatiyle beklenir.
    const yerel = new Date(Date.parse(durum.sonra) + 3 * 3_600_000).toISOString().slice(0, 19);
    const r = await this.cagir(config, "SiparisServis", "SelectSiparis", ticimaxSiparisIstegi(config.apiAnahtari!, yerel, baslangic));
    const ham = ((r.SelectSiparisResult as { WebSiparis?: TicimaxSiparis[] } | undefined)?.WebSiparis) ?? [];
    let enSon = durum.enSon;
    for (const s of ham) enSon = enGec(enSon, ticimaxTarih(s.DuzenlemeTarihi));
    const siparisler = ham.map(ticimaxSiparisDonustur).filter((s): s is NormalizeSiparis => Boolean(s));
    const devamVar = ham.length === SAYFA;
    return { siparisler, sonrakiImlec: imlecYaz(devamVar ? { ...durum, sayfa: (durum.sayfa ?? 1) + 1, enSon } : { sonra: enSon ?? durum.sonra }), devamVar };
  }

  /** Stok stok koduna, fiyat (KDV dahil satış fiyatı) barkoda göre güncellenir. */
  async stokFiyatGonder(config: PazaryeriConfig, kalemler: PazaryeriStokFiyat[]): Promise<{ gonderilen: number; islemIdleri: string[]; bulunamayan: number }> {
    const kodlu = kalemler.filter((k) => k.sku);
    for (let i = 0; i < kodlu.length; i += 100) {
      const parca = kodlu.slice(i, i + 100).map((k) => `<a:Varyasyon><a:StokAdedi>${Math.max(0, Math.floor(k.miktar))}</a:StokAdedi><a:StokKodu>${kac(k.sku)}</a:StokKodu></a:Varyasyon>`).join("");
      await this.cagir(config, "UrunServis", "StokAdediGuncelle", zarf(`<StokAdediGuncelle xmlns="http://tempuri.org/"><UyeKodu>${kac(config.apiAnahtari ?? "")}</UyeKodu><urunler xmlns:a="${NS_DC}">${parca}</urunler></StokAdediGuncelle>`));
    }
    const fiyatli = kalemler.filter((k) => k.barkod && k.fiyat > 0);
    for (let i = 0; i < fiyatli.length; i += 100) {
      const parca = fiyatli.slice(i, i + 100).map((k) => `<a:UpdateUrunFiyat><a:Barkod>${kac(k.barkod)}</a:Barkod><a:Fiyatlar><a:KDVDahil>true</a:KDVDahil><a:SatisFiyati>${k.fiyat.toFixed(2)}</a:SatisFiyati></a:Fiyatlar></a:UpdateUrunFiyat>`).join("");
      const ayar = `<ayar xmlns:a="${NS_DC}"><a:BarkodKodunaGoreGuncelle>true</a:BarkodKodunaGoreGuncelle><a:IndirimliFiyatGuncelle>false</a:IndirimliFiyatGuncelle><a:KDVDahilGuncelle>true</a:KDVDahilGuncelle><a:KdvOraniGuncelle>false</a:KdvOraniGuncelle><a:PiyasaFiyatiGuncelle>false</a:PiyasaFiyatiGuncelle><a:VaryasyonGuncelle>true</a:VaryasyonGuncelle></ayar>`;
      await this.cagir(config, "UrunServis", "UpdateUrunFiyat", zarf(`<UpdateUrunFiyat xmlns="http://tempuri.org/"><UyeKodu>${kac(config.apiAnahtari ?? "")}</UyeKodu><request xmlns:a="${NS_DC}">${parca}</request>${ayar}</UpdateUrunFiyat>`));
    }
    return { gonderilen: kodlu.length, islemIdleri: [], bulunamayan: kalemler.length - kodlu.length };
  }

  async sina(config: PazaryeriConfig) {
    const yedi = new Date(Date.now() - 7 * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 19);
    const r = await this.cagir(config, "SiparisServis", "SelectSiparis", ticimaxSiparisIstegi(config.apiAnahtari ?? "", yedi, 0));
    const n = ((r.SelectSiparisResult as { WebSiparis?: unknown[] } | undefined)?.WebSiparis ?? []).length;
    return { mesaj: `Ticimax bağlantısı çalışıyor; son 7 günde ${n}${n === SAYFA ? "+" : ""} sipariş güncellenmiş.` };
  }
}
