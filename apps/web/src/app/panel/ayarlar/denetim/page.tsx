"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert, Button, Card, Field, PageHeader, Select, TableWrap } from "@/components/ui";

interface DenetimKullanicisi {
  id: string;
  adSoyad: string;
  eposta: string;
}

interface DenetimKaydi {
  id: string;
  islem: string;
  varlik: string;
  varlikId: string | null;
  zaman: string;
  kullanici: DenetimKullanicisi | null;
  detay: unknown;
}

/** Yönetim P1-4/P2-4: adlandırılmış yönetim olaylarının okunur karşılıkları. */
const ISLEM_ADI: Record<string, string> = {
  giris_yapildi: "Giriş yapıldı",
  giris_kilitlendi: "Giriş kilitlendi (çok fazla hatalı deneme)",
  kullanici_yetkisi_degisti: "Kullanıcı yetkisi değişti",
  kullanici_parolasi_sifirlandi: "Kullanıcı parolası sıfırlandı",
  kullanici_2fa_sifirlandi: "Kullanıcının 2FA'sı sıfırlandı",
  kullanici_oturumlari_kapatildi: "Kullanıcının oturumları kapatıldı",
  parola_degistirildi: "Parola değiştirildi",
  parola_baglantiyla_sifirlandi: "Parola e-posta bağlantısıyla sıfırlandı",
  iki_adimli_dogrulama_acildi: "2FA açıldı",
  iki_adimli_dogrulama_kapatildi: "2FA kapatıldı",
  kurtarma_kodu_kullanildi: "2FA kurtarma kodu kullanıldı",
  kurtarma_kodlari_yenilendi: "2FA kurtarma kodları yenilendi",
  diger_oturumlar_kapatildi: "Diğer oturumlar kapatıldı",
  firma_bilgisi_degisti: "Firma bilgisi değişti",
  modul_ayari_degisti: "Modül ayarı değişti",
  eposta_ayari_degisti: "E-posta ayarı değişti",
  baglanti_eklendi: "Bağlantı eklendi",
  baglanti_guncellendi: "Bağlantı güncellendi",
  baglanti_etkinlestirildi: "Bağlantı etkinleştirildi",
  baglanti_silindi: "Bağlantı silindi",
};

const goster = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

function Ayrinti({ detay }: { detay: unknown }) {
  if (!detay || typeof detay !== "object") return <span className="subtle">—</span>;
  const { degisiklikler, ...diger } = detay as { degisiklikler?: Record<string, { eski: unknown; yeni: unknown }> } & Record<string, unknown>;
  const ozet = Object.entries(diger).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object");
  return (
    <div className="denetim-ayrinti">
      {ozet.length > 0 && <div className="subtle">{ozet.map(([k, v]) => `${k}: ${goster(v)}`).join(" · ")}</div>}
      {degisiklikler && (
        <ul>
          {Object.entries(degisiklikler).map(([alan, d]) => (
            <li key={alan}><strong>{alan}</strong>: {goster(d.eski)} → {goster(d.yeni)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface DenetimSayfasiVeri {
  kayitlar: DenetimKaydi[];
  sonrakiImlec: string | null;
}

const ADET = 50;

export default function DenetimIziSayfasi() {
  const [kayitlar, setKayitlar] = useState<DenetimKaydi[]>([]);
  const [varliklar, setVarliklar] = useState<string[]>([]);
  const [varlik, setVarlik] = useState("");
  const [baslangic, setBaslangic] = useState("");
  const [bitis, setBitis] = useState("");
  const [sonrakiImlec, setSonrakiImlec] = useState<string | null>(null);
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);

  const sorgu = useCallback(
    (imlec?: string) => {
      const p = new URLSearchParams({ adet: String(ADET) });
      if (varlik) p.set("varlik", varlik);
      if (baslangic) p.set("baslangic", baslangic);
      if (bitis) p.set("bitis", bitis);
      if (imlec) p.set("imlec", imlec);
      return `/denetim?${p.toString()}`;
    },
    [varlik, baslangic, bitis],
  );

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const veri = await api<DenetimSayfasiVeri>(sorgu());
      setKayitlar(veri.kayitlar);
      setSonrakiImlec(veri.sonrakiImlec);
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "Denetim izi yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [sorgu]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  useEffect(() => {
    api<string[]>("/denetim/varliklar")
      .then((v) => setVarliklar(Array.isArray(v) ? v : []))
      .catch(() => setVarliklar([]));
  }, []);

  async function dahaGetir() {
    if (!sonrakiImlec) return;
    setYukleniyor(true);
    try {
      const veri = await api<DenetimSayfasiVeri>(sorgu(sonrakiImlec));
      setKayitlar((mevcut) => [...mevcut, ...veri.kayitlar]);
      setSonrakiImlec(veri.sonrakiImlec);
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "Denetim izi yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="🛡️ Denetim İzi"
        subtitle="Kritik işlemlerin kim tarafından, ne zaman yapıldığını gösterir (KLN-04). Kayıtlar salt-okunurdur; silinemez veya değiştirilemez."
      />

      <Card className="stack">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ minWidth: 180 }}>
            <Field label="Varlık">
              <Select value={varlik} onChange={(e) => setVarlik(e.target.value)}>
                <option value="">Tümü</option>
                {varliklar.map((v) => (<option key={v} value={v}>{v}</option>))}
              </Select>
            </Field>
          </div>
          <div style={{ minWidth: 160 }}>
            <Field label="Başlangıç">
              <input className="input" type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} />
            </Field>
          </div>
          <div style={{ minWidth: 160 }}>
            <Field label="Bitiş">
              <input className="input" type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} />
            </Field>
          </div>
        </div>

        <Alert tone="error">{hata}</Alert>

        <TableWrap>
          <thead>
            <tr>
              <th>Zaman</th>
              <th>Kullanıcı</th>
              <th>Varlık</th>
              <th>İşlem</th>
              <th>Ayrıntı</th>
              <th>Kayıt</th>
            </tr>
          </thead>
          <tbody>
            {kayitlar.map((k) => (
              <tr key={k.id}>
                <td>{new Date(k.zaman).toLocaleString("tr-TR")}</td>
                <td>{k.kullanici?.adSoyad ?? "—"}</td>
                <td>{k.varlik}</td>
                <td>{ISLEM_ADI[k.islem] ?? k.islem}</td>
                <td><Ayrinti detay={k.detay} /></td>
                <td className="subtle mono" style={{ fontSize: "0.8rem" }}>{k.varlikId ?? "—"}</td>
              </tr>
            ))}
            {kayitlar.length === 0 && !yukleniyor && (
              <tr><td className="empty" colSpan={6}>Kayıt bulunamadı</td></tr>
            )}
          </tbody>
        </TableWrap>

        {sonrakiImlec && (
          <div>
            <Button type="button" onClick={dahaGetir} disabled={yukleniyor}>
              {yukleniyor ? "Yükleniyor…" : "Daha fazla getir"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
