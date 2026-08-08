"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CalismaAlani, type HizliEylem, type IsKuyrugu } from "@/components/calisma-alani";
import { Alert, Card, Stat, StatGrid } from "@/components/ui";
import { api, ApiHata, tokenAl, tokenYaz, tumSayfalariAl } from "@/lib/api";

type Rol = "yonetici" | "muhasebe" | "satis" | "salt_okunur";
interface FinansOzet { nakitVarliklar: string; envanterDegeri: string; toplamAlacaklar: string; toplamBorclar: string; netVarlikDegeri: string; }
interface Fatura { tip: string; durum: string; ebelge?: { durum: string } | null; odemeOzeti?: { durum: string }; }
interface Stok { kritikSeviye?: string | null; mevcutMiktar?: string; kullanilabilirMiktar?: string; }

const tl = (deger: string) => Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";
const rolAdi: Record<Rol, string> = { yonetici: "Yönetim", muhasebe: "Muhasebe", satis: "Satış", salt_okunur: "Genel görünüm" };
const rolAciklama: Record<Rol, string> = {
  yonetici: "Nakit, kârlılık ve kritik operasyonları birlikte izleyin.",
  muhasebe: "e-Belge, ödeme ve banka eşleştirme işlerinizi tamamlayın.",
  satis: "Satış belgeleri, müşteri riski ve tahsilat işlerinizi yönetin.",
  salt_okunur: "Finansal durumu ve operasyon listelerini inceleyin.",
};

export default function PanelSayfasi() {
  const router = useRouter();
  const [firma, setFirma] = useState("Yükleniyor…");
  const [rol, setRol] = useState<Rol | null>(null);
  const [ozet, setOzet] = useState<FinansOzet | null>(null);
  const [eylemler, setEylemler] = useState<HizliEylem[]>([]);
  const [kuyruklar, setKuyruklar] = useState<IsKuyrugu[]>([]);
  const [hata, setHata] = useState("");

  const yukle = useCallback(async () => {
    try {
      const [ben, firmaVeri, faturalar, stoklar] = await Promise.all([
        api<{ rol: Rol }>("/auth/ben"), api<{ unvan: string }>("/firma"),
        tumSayfalariAl<Fatura>("/fatura"), tumSayfalariAl<Stok>("/stok"),
      ]);
      setRol(ben.rol); setFirma(firmaVeri.unvan);
      const fs = faturalar;
      const say = (test: (f: Fatura) => boolean) => fs.filter(test).length;
      const taslakSatis = say((f) => f.durum === "taslak" && ["satis", "satis_iade", "proforma"].includes(f.tip));
      const taslakAlis = say((f) => f.durum === "taslak" && ["alis", "alis_iade"].includes(f.tip));
      const ebelgeHata = say((f) => ["hata", "ret"].includes(f.ebelge?.durum ?? ""));
      const acikTahsilat = say((f) => ["satis", "alis_iade"].includes(f.tip) && ["odenmedi", "kismi"].includes(f.odemeOzeti?.durum ?? ""));
      const acikOdeme = say((f) => ["alis", "satis_iade"].includes(f.tip) && ["odenmedi", "kismi"].includes(f.odemeOzeti?.durum ?? ""));
      const kritik = stoklar.filter((s) => s.kritikSeviye != null && Number(s.mevcutMiktar ?? s.kullanilabilirMiktar ?? 0) <= Number(s.kritikSeviye)).length;
      let ekstre = 0; let gelen = 0;
      if (["yonetici", "muhasebe"].includes(ben.rol)) {
        const [e, g] = await Promise.all([api<unknown[]>("/kasa-banka/ekstre/satirlar?durum=beklemede"), api<unknown[]>("/ebelge/gelen?durum=beklemede")]);
        ekstre = e.length; gelen = g.length;
      }
      const stokKuyrugu: IsKuyrugu = { href: "/panel/stok?durum=kritik", baslik: "Kritik stoklar", aciklama: "Kritik seviyeye ulaşan ürünler", sayi: kritik, ton: kritik ? "danger" : "default" };
      if (ben.rol === "satis") {
        setEylemler([
          { href: "/panel/fatura?yon=satis&yeni=1", baslik: "Satış faturası", aciklama: "Yeni müşteri faturası", ikon: "SF", vurgu: true },
          { href: "/panel/belgeler?yon=satis&tur=teklif&yeni=1", baslik: "Teklif oluştur", aciklama: "Yeni satış teklifi", ikon: "TK" },
          { href: "/panel/belgeler?yon=satis&tur=siparis&yeni=1", baslik: "Sipariş oluştur", aciklama: "Müşteri siparişi", ikon: "SP" },
          { href: "/panel/fatura?yon=satis&odeme=acik", baslik: "Tahsilat takibi", aciklama: "Açık müşteri faturaları", ikon: "TH" },
        ]);
        setKuyruklar([
          { href: "/panel/fatura?yon=satis&durum=taslak", baslik: "Taslak satış faturaları", aciklama: "Kesinleştirilmeyi bekleyen kayıtlar", sayi: taslakSatis, ton: "warning" },
          { href: "/panel/fatura?yon=satis&odeme=acik", baslik: "Açık tahsilatlar", aciklama: "Tahsilatı tamamlanmamış faturalar", sayi: acikTahsilat, ton: acikTahsilat ? "danger" : "default" }, stokKuyrugu,
        ]);
      } else {
        const salt = ben.rol === "salt_okunur";
        setEylemler(salt ? [
          { href: "/panel/fatura", baslik: "Faturalar", aciklama: "Fatura listesini incele", ikon: "FT" },
          { href: "/panel/cari", baslik: "Cari hesaplar", aciklama: "Bakiye ve hareketler", ikon: "CR" },
          { href: "/panel/stok", baslik: "Stoklar", aciklama: "Mevcut stok durumu", ikon: "ST" },
          { href: "/panel/raporlar", baslik: "Raporlar", aciklama: "Analiz ve dökümler", ikon: "RP" },
        ] : [
          { href: "/panel/fatura?yon=alis&yeni=1", baslik: "Alış faturası", aciklama: "Tedarikçi faturası", ikon: "AF", vurgu: true },
          { href: "/panel/fatura/gelen-kutusu", baslik: "Gelen e-Belgeler", aciklama: "Kontrol ve eşleştirme", ikon: "GB" },
          { href: "/panel/kasa-banka?islem=tediye", baslik: "Ödeme yap", aciklama: "Tedarikçi ödemesi", ikon: "ÖD" },
          { href: "/panel/kasa-banka/ekstre", baslik: "Banka ekstresi", aciklama: "Hareketleri eşleştir", ikon: "BK" },
        ]);
        setKuyruklar(salt ? [
          { href: "/panel/fatura?durum=taslak", baslik: "Bekleyen fatura taslakları", aciklama: "Satış ve alış tarafındaki açık kayıtlar", sayi: taslakSatis + taslakAlis, ton: "warning" },
          { href: "/panel/fatura?ebelge=hata", baslik: "e-Belge hataları", aciklama: "Operasyonu durduran kayıtlar", sayi: ebelgeHata, ton: ebelgeHata ? "danger" : "default" }, stokKuyrugu,
        ] : [
          { href: "/panel/fatura?ebelge=hata", baslik: "e-Belge hataları", aciklama: "Düzeltilip yeniden gönderilecek belgeler", sayi: ebelgeHata, ton: ebelgeHata ? "danger" : "default" },
          { href: "/panel/fatura/gelen-kutusu?durum=beklemede", baslik: "Bekleyen alış e-Belgeleri", aciklama: "Kontrol ve eşleştirme bekleyen belgeler", sayi: gelen, ton: "warning" },
          { href: "/panel/kasa-banka/ekstre?durum=beklemede", baslik: "Eşleşmemiş banka hareketleri", aciklama: "Cari veya faturayla ilişkilendirilecek satırlar", sayi: ekstre, ton: "warning" },
          { href: "/panel/fatura?yon=alis&odeme=acik", baslik: "Açık ödemeler", aciklama: "Ödemesi tamamlanmamış alış faturaları", sayi: acikOdeme, ton: acikOdeme ? "danger" : "default" }, stokKuyrugu,
        ]);
        setOzet(await api<FinansOzet>("/rapor/ozet"));
      }
    } catch (h) {
      if (h instanceof ApiHata && h.durum === 401) { tokenYaz(null); router.push("/giris"); }
      else setHata(h instanceof Error ? h.message : "Çalışma özeti yüklenemedi");
    }
  }, [router]);

  useEffect(() => { if (!tokenAl()) router.push("/giris"); else void yukle(); }, [router, yukle]);

  return <div className="stack">
    <Alert tone="error">{hata}</Alert>
    {rol && <CalismaAlani baslik={firma} aciklama={rolAdi[rol] + " · " + rolAciklama[rol]} anaEylem={{ href: eylemler[0]?.href ?? "/panel", baslik: eylemler[0]?.baslik ?? "Aç" }} hizliEylemler={eylemler} kuyruklar={kuyruklar} altBaslik="Bugün ilgilenilecekler" />}
    {ozet && <section><h2 className="section-title">Finansal görünüm</h2><StatGrid><Stat label="Nakit varlıklar" value={tl(ozet.nakitVarliklar)} tone="success" /><Stat label="Stok değeri" value={tl(ozet.envanterDegeri)} tone="info" /><Stat label="Müşteri alacakları" value={tl(ozet.toplamAlacaklar)} tone="info" /><Stat label="Tedarikçi borçları" value={tl(ozet.toplamBorclar)} tone="danger" /></StatGrid><Card><div className="stat__label">Net varlık değeri</div><div className="stat__value">{tl(ozet.netVarlikDegeri)}</div></Card></section>}
  </div>;
}
