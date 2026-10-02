"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, tokenAl } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Stat,
  StatGrid,
  TableWrap,
  Tabs,
} from "@/components/ui";

const PROJE_DURUM_ETIKETLERI: Record<string, { etiket: string; variant: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  planlanan: { etiket: "📋 Planlanan", variant: "warning" },
  aktif: { etiket: "🚀 Aktif", variant: "success" },
  tamamlandi: { etiket: "✅ Tamamlandı", variant: "info" },
  durduruldu: { etiket: "⏸️ Durduruldu", variant: "neutral" },
  iptal: { etiket: "🚫 İptal", variant: "danger" },
};

interface Asama {
  id: string;
  sira: number;
  ad: string;
  aciklama: string | null;
  baslangicTarihi: string | null;
  bitisTarihi: string | null;
  tamamlandi: boolean;
  tamamlanmaTarihi: string | null;
}

interface AltKirilim {
  id: string;
  kod: string;
  ad: string;
  tip: string;
  butceTutari: string;
  gerceklesenTutar: string;
  sapma: string;
  kullanimOrani: number | null;
  aciklama: string | null;
}

interface ProjeNot {
  id: string;
  icerik: string;
  createdAt: string;
  user: { id: string; adSoyad: string };
}

interface ProjeDetay {
  id: string;
  kod: string;
  ad: string;
  aciklama: string | null;
  baslangicTarihi: string | null;
  bitisTarihi: string | null;
  durum: string;
  hedefGelir: string;
  hedefGider: string;
  notlar: string | null;
  cari?: { id: string; unvan: string; kod: string } | null;
  sorumlu?: { id: string; adSoyad: string; eposta: string } | null;
  asamalar: Asama[];
  altKirilimlar: AltKirilim[];
  notlarListesi: ProjeNot[];
  finansalOzet: {
    toplamGelir: string;
    toplamGider: string;
    netKarZarar: string;
    detay: {
      satisFaturaGeliri: string;
      satisIadesi: string;
      alisIadesi: string;
      ekstraGelir: string;
      kasaTahsilat: string;
      alisFaturaGideri: string;
      masrafGideri: string;
      kasaTediye: string;
    };
  };
  analitikKirilimlar: AltKirilim[];
}

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

type Sekme = "genel" | "asamalar" | "analitik" | "notlar";

export default function ProjeDetaySayfasi() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [proje, setProje] = useState<ProjeDetay | null>(null);
  const [aktifSekme, setAktifSekme] = useState<Sekme>("genel");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);

  // Düzenleme state
  const [duzenlemeAcik, setDuzenlemeAcik] = useState(false);
  const [durum, setDurum] = useState("");
  const [hedefGelir, setHedefGelir] = useState("");
  const [hedefGider, setHedefGider] = useState("");

  // Aşama ekleme state
  const [asamaAd, setAsamaAd] = useState("");
  const [asamaAciklama, setAsamaAciklama] = useState("");
  const [asamaBaslangic, setAsamaBaslangic] = useState("");
  const [asamaBitis, setAsamaBitis] = useState("");

  // Analitik kırılım ekleme state
  const [kirilimKod, setKirilimKod] = useState("");
  const [kirilimAd, setKirilimAd] = useState("");
  const [kirilimTip, setKirilimTip] = useState("gider");
  const [kirilimButce, setKirilimButce] = useState("");
  const [kirilimAciklama, setKirilimAciklama] = useState("");

  // Not ekleme state
  const [yeniNot, setYeniNot] = useState("");

  const yukle = useCallback(async () => {
    if (!id) return;
    setYukleniyor(true);
    try {
      const res = await api<ProjeDetay>(`/projeler/${id}`);
      setProje(res);
      setDurum(res.durum);
      setHedefGelir(res.hedefGelir);
      setHedefGider(res.hedefGider);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Proje detayı yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [id]);

  useEffect(() => {
    if (tokenAl()) void yukle();
  }, [yukle]);

  async function projeGuncelle(e: React.FormEvent) {
    e.preventDefault();
    setHata(""); setBasari("");
    try {
      await api(`/projeler/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          durum,
          hedefGelir: hedefGelir || undefined,
          hedefGider: hedefGider || undefined,
        }),
      });
      setBasari("Proje bilgileri güncellendi.");
      setDuzenlemeAcik(false);
      void yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Güncelleme hatası");
    }
  }

  async function asamaEkle(e: React.FormEvent) {
    e.preventDefault();
    if (!asamaAd.trim()) return;
    setHata(""); setBasari("");
    try {
      await api(`/projeler/${id}/asamalar`, {
        method: "POST",
        body: JSON.stringify({
          sira: (proje?.asamalar.length ?? 0) + 1,
          ad: asamaAd.trim(),
          aciklama: asamaAciklama.trim() || undefined,
          baslangicTarihi: asamaBaslangic || undefined,
          bitisTarihi: asamaBitis || undefined,
        }),
      });
      setAsamaAd(""); setAsamaAciklama(""); setAsamaBaslangic(""); setAsamaBitis("");
      setBasari("Proje aşaması eklendi.");
      void yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Aşama eklenemedi");
    }
  }

  async function asamaTamamla(asamaId: string, mevcutTamam: boolean) {
    try {
      await api(`/projeler/${id}/asamalar/${asamaId}`, {
        method: "PATCH",
        body: JSON.stringify({ tamamlandi: !mevcutTamam }),
      });
      void yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Aşama durumu güncellenemedi");
    }
  }

  async function asamaSil(asamaId: string) {
    if (!confirm("Aşama silinsin mi?")) return;
    try {
      await api(`/projeler/${id}/asamalar/${asamaId}`, { method: "DELETE" });
      void yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Aşama silinemedi");
    }
  }

  async function altKirilimEkle(e: React.FormEvent) {
    e.preventDefault();
    if (!kirilimKod.trim() || !kirilimAd.trim()) return;
    setHata(""); setBasari("");
    try {
      await api(`/projeler/${id}/alt-kirilimlar`, {
        method: "POST",
        body: JSON.stringify({
          kod: kirilimKod.trim(),
          ad: kirilimAd.trim(),
          tip: kirilimTip,
          butceTutari: kirilimButce || undefined,
          aciklama: kirilimAciklama.trim() || undefined,
        }),
      });
      setKirilimKod(""); setKirilimAd(""); setKirilimButce(""); setKirilimAciklama("");
      setBasari("Analitik yevmiye maliyet kırılımı eklendi.");
      void yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Kırılım eklenemedi");
    }
  }

  async function altKirilimSil(kirilimId: string) {
    if (!confirm("Bu analitik kırılım silinsin mi?")) return;
    try {
      await api(`/projeler/${id}/alt-kirilimlar/${kirilimId}`, { method: "DELETE" });
      void yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Analitik kırılım silinemedi");
    }
  }

  async function notEkle(e: React.FormEvent) {
    e.preventDefault();
    if (!yeniNot.trim()) return;
    try {
      await api(`/projeler/${id}/notlar`, {
        method: "POST",
        body: JSON.stringify({ icerik: yeniNot.trim() }),
      });
      setYeniNot("");
      void yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Not eklenemedi");
    }
  }

  if (yukleniyor) {
    return <div style={{ padding: "3rem", textAlign: "center" }}>Proje bilgileri yükleniyor...</div>;
  }

  if (!proje) {
    return <Alert tone="error">Proje bulunamadı veya erişim yetkiniz yok.</Alert>;
  }

  const durumBilgi = PROJE_DURUM_ETIKETLERI[proje.durum] ?? { etiket: proje.durum, variant: "neutral" };
  const karZararNum = Number(proje.finansalOzet.netKarZarar);

  return (
    <div>
      <PageHeader
        title={`${proje.ad} (#${proje.kod})`}
        subtitle={proje.aciklama ?? "Proje detayları, analitik maliyet kırılımları ve finansal gerçekleşmeler."}
        actions={
          <div className="row-tight">
            <Button onClick={() => router.push("/panel/projeler")}>← Projelere Dön</Button>
            <Button variant="primary" onClick={() => setDuzenlemeAcik(!duzenlemeAcik)}>
              {duzenlemeAcik ? "✖ Düzenlemeyi Kapat" : "✏️ Projeyi Düzenle"}
            </Button>
          </div>
        }
      />

      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}

      <Card style={{ marginBottom: "1.5rem", borderColor: "var(--accent)" }}>
        <div className="between">
          <div>
            <div className="row-tight" style={{ gap: "0.75rem", marginBottom: "0.5rem" }}>
              <Badge variant={durumBilgi.variant}>{durumBilgi.etiket}</Badge>
              {proje.cari && <Badge variant="info">Müşteri: {proje.cari.unvan}</Badge>}
              {proje.sorumlu && <Badge variant="neutral">Sorumlu: {proje.sorumlu.adSoyad}</Badge>}
            </div>
            <small style={{ color: "var(--muted)" }}>
              Tarih: {proje.baslangicTarihi ? new Date(proje.baslangicTarihi).toLocaleDateString("tr-TR") : "Belirtilmedi"}
              {" — "}
              {proje.bitisTarihi ? new Date(proje.bitisTarihi).toLocaleDateString("tr-TR") : "Belirtilmedi"}
            </small>
          </div>

          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>Net Kar / Zarar</span>
            <h2 style={{ margin: 0, color: karZararNum >= 0 ? "var(--success)" : "var(--danger)" }}>
              {tl(karZararNum)}
            </h2>
          </div>
        </div>

        <div style={{ marginTop: "1rem" }}>
          <Tabs<Sekme>
            ariaLabel="Proje bölümleri"
            idPrefix="proje-detay"
            value={aktifSekme}
            onChange={setAktifSekme}
            items={[
              { deger: "genel", baslik: "Genel Bakış & Finans" },
              { deger: "analitik", baslik: "Analitik Yevmiye & Maliyet Merkezleri" },
              { deger: "asamalar", baslik: `Aşamalar (${proje.asamalar.length})` },
              { deger: "notlar", baslik: `Notlar (${proje.notlarListesi.length})` },
            ]}
          />
        </div>
      </Card>

      {duzenlemeAcik && (
        <Card className="record-editor" style={{ marginBottom: "1.5rem" }}>
          <div className="card__title">✏️ Proje Bilgilerini Güncelle</div>
          <form className="row" onSubmit={projeGuncelle}>
            <FormAlan flex={1} min={150}>
              <Field label="Proje Durumu">
                <Select value={durum} onChange={(e) => setDurum(e.target.value)}>
                  <option value="planlanan">Planlanan</option>
                  <option value="aktif">Aktif</option>
                  <option value="tamamlandi">Tamamlandı</option>
                  <option value="durduruldu">Durduruldu</option>
                  <option value="iptal">İptal</option>
                </Select>
              </Field>
            </FormAlan>
            <FormAlan flex={1} min={180}>
              <Field label="Hedef Bütçelenen Gelir (TL)"><Input type="number" step="0.01" value={hedefGelir} onChange={(e) => setHedefGelir(e.target.value)} /></Field>
            </FormAlan>
            <FormAlan flex={1} min={180}>
              <Field label="Hedef Bütçelenen Gider (TL)"><Input type="number" step="0.01" value={hedefGider} onChange={(e) => setHedefGider(e.target.value)} /></Field>
            </FormAlan>
            <div className="row-tight" style={{ width: "100%", justifyContent: "flex-end", marginTop: "0.5rem" }}>
              <Button type="submit" variant="primary">Değişiklikleri Kaydet</Button>
            </div>
          </form>
        </Card>
      )}

      {aktifSekme === "genel" && (
        <div className="stack">
          <StatGrid>
            <Stat label="Gerçekleşen Toplam Gelir" value={tl(proje.finansalOzet.toplamGelir)} tone="success" hint={`Hedef Bütçe: ${tl(proje.hedefGelir)}`} />
            <Stat label="Gerçekleşen Toplam Gider" value={tl(proje.finansalOzet.toplamGider)} tone={Number(proje.finansalOzet.toplamGider) > 0 ? "danger" : "default"} hint={`Hedef Bütçe: ${tl(proje.hedefGider)}`} />
            <Stat label="Net Kar / Zarar" value={tl(proje.finansalOzet.netKarZarar)} tone={karZararNum >= 0 ? "success" : "danger"} hint="Proje kar marjı performansı" />
            <Stat label="Tanımlı Maliyet Merkezleri" value={proje.analitikKirilimlar.length.toString()} hint="Analitik Yevmiye Kırılımları" />
          </StatGrid>

          <Card title="Kârlılık dökümü" actions={<small className="muted">KDV hariç · belge kuruyla TL · yalnız kesinleşmiş faturalar</small>}>
            <TableWrap>
              <thead>
                <tr>
                  <th>Kalem</th>
                  <th>Kaynak</th>
                  <th className="num">Tutar (TL)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Satış faturaları</strong></td>
                  <td>Projeye bağlı satış faturası satırlarının matrahı</td>
                  <td className="num" style={{ color: "var(--success)" }}>{tl(proje.finansalOzet.detay.satisFaturaGeliri)}</td>
                </tr>
                {Number(proje.finansalOzet.detay.satisIadesi) > 0 && (
                  <tr>
                    <td><strong>Satış iadeleri</strong></td>
                    <td>Gelirden düşülür</td>
                    <td className="num" style={{ color: "var(--danger)" }}>−{tl(proje.finansalOzet.detay.satisIadesi)}</td>
                  </tr>
                )}
                <tr>
                  <td><strong>Faaliyet dışı gelirler</strong></td>
                  <td>Projeye işlenen gelir kayıtları (brüt)</td>
                  <td className="num" style={{ color: "var(--success)" }}>{tl(proje.finansalOzet.detay.ekstraGelir)}</td>
                </tr>
                <tr className="table-subtotal">
                  <td colSpan={2}><strong>Toplam gelir</strong></td>
                  <td className="num"><strong>{tl(proje.finansalOzet.toplamGelir)}</strong></td>
                </tr>
                <tr>
                  <td><strong>Alış faturaları</strong></td>
                  <td>Projeye bağlı alış faturası satırlarının matrahı</td>
                  <td className="num" style={{ color: "var(--danger)" }}>{tl(proje.finansalOzet.detay.alisFaturaGideri)}</td>
                </tr>
                {Number(proje.finansalOzet.detay.alisIadesi) > 0 && (
                  <tr>
                    <td><strong>Alış iadeleri</strong></td>
                    <td>Giderden düşülür</td>
                    <td className="num" style={{ color: "var(--success)" }}>−{tl(proje.finansalOzet.detay.alisIadesi)}</td>
                  </tr>
                )}
                <tr>
                  <td><strong>Masraflar</strong></td>
                  <td>Projeye bağlı onaylı masrafların matrahı</td>
                  <td className="num" style={{ color: "var(--danger)" }}>{tl(proje.finansalOzet.detay.masrafGideri)}</td>
                </tr>
                <tr className="table-subtotal">
                  <td colSpan={2}><strong>Toplam gider</strong></td>
                  <td className="num"><strong>{tl(proje.finansalOzet.toplamGider)}</strong></td>
                </tr>
                <tr className="table-subtotal">
                  <td colSpan={2}><strong>Net kâr / zarar</strong></td>
                  <td className="num" style={{ color: karZararNum >= 0 ? "var(--success)" : "var(--danger)" }}><strong>{tl(proje.finansalOzet.netKarZarar)}</strong></td>
                </tr>
              </tbody>
            </TableWrap>
          </Card>

          <Card title="Nakit hareketleri (bilgi)" actions={<small className="muted">Kârlılığa eklenmez; faturaların tahsilatı/ödemesi zaten yukarıda sayılır</small>}>
            <TableWrap>
              <tbody>
                <tr>
                  <td><strong>Proje koduyla girilen tahsilatlar</strong></td>
                  <td className="num" style={{ color: "var(--success)" }}>{tl(proje.finansalOzet.detay.kasaTahsilat)}</td>
                </tr>
                <tr>
                  <td><strong>Proje koduyla yapılan ödemeler</strong></td>
                  <td className="num" style={{ color: "var(--danger)" }}>{tl(proje.finansalOzet.detay.kasaTediye)}</td>
                </tr>
              </tbody>
            </TableWrap>
          </Card>
        </div>
      )}

      {aktifSekme === "analitik" && (
        <div className="stack">
          <Card title="📐 Analitik Yevmiye & Maliyet Merkezleri (WBS)">
            <TableWrap>
              <thead>
                <tr>
                  <th>Analitik Kod</th>
                  <th>Kırılım / Maliyet Adı</th>
                  <th>Tipi</th>
                  <th className="num">Planlanan Bütçe</th>
                  <th className="num">Gerçekleşen Harcama</th>
                  <th className="num">Sapma (Bakiye)</th>
                  <th>Kullanım %</th>
                  <th className="center">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {proje.analitikKirilimlar.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: "2rem" }}>Henüz analitik yevmiye maliyet kırılımı tanımlanmamış. Aşağıdaki formdan ekleyin.</td></tr>
                ) : (
                  proje.analitikKirilimlar.map((k) => {
                    const butce = Number(k.butceTutari);
                    const gerceklesen = Number(k.gerceklesenTutar);
                    const sapma = Number(k.sapma);
                    const asim = butce > 0 && gerceklesen > butce;
                    return (
                      <tr key={k.id}>
                        <td><strong className="mono">{k.kod}</strong></td>
                        <td>
                          <strong>{k.ad}</strong>
                          {k.aciklama && <small style={{ display: "block", color: "var(--muted)" }}>{k.aciklama}</small>}
                        </td>
                        <td><Badge variant={k.tip === "gelir" ? "success" : k.tip === "gider" ? "danger" : "neutral"}>{k.tip}</Badge></td>
                        <td className="num"><strong>{tl(k.butceTutari)}</strong></td>
                        <td className="num" style={{ color: k.tip === "gider" ? "var(--danger)" : "var(--success)" }}><strong>{tl(k.gerceklesenTutar)}</strong></td>
                        <td className="num" style={{ color: sapma >= 0 ? "var(--success)" : "var(--danger)" }}>
                          <strong>{tl(sapma)}</strong>
                        </td>
                        <td>
                          {k.kullanimOrani !== null ? (
                            <Badge variant={asim ? "danger" : k.kullanimOrani > 80 ? "warning" : "success"}>
                              %{k.kullanimOrani}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="center">
                          <Button size="sm" variant="danger" onClick={() => void altKirilimSil(k.id)}>Sil</Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </TableWrap>

            <form onSubmit={altKirilimEkle} className="stack" style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              <strong>➕ Yeni Analitik Maliyet Kırılımı Ekle</strong>
              <div className="row">
                <FormAlan flex={1} min={110}>
                  <Field label="Analitik Kod *"><Input value={kirilimKod} onChange={(e) => setKirilimKod(e.target.value)} placeholder="1.1" required /></Field>
                </FormAlan>
                <FormAlan flex={2} min={180}>
                  <Field label="Kırılım Adı *"><Input value={kirilimAd} onChange={(e) => setKirilimAd(e.target.value)} placeholder="Örn. Kaba İnşaat Giderleri" required /></Field>
                </FormAlan>
                <FormAlan flex={1} min={120}>
                  <Field label="Tipi">
                    <Select value={kirilimTip} onChange={(e) => setKirilimTip(e.target.value)}>
                      <option value="gider">Gider</option>
                      <option value="gelir">Gelir</option>
                      <option value="her_ikisi">Her İkisi</option>
                    </Select>
                  </Field>
                </FormAlan>
                <FormAlan flex={1} min={140}>
                  <Field label="Hedef Bütçe (TL)"><Input type="number" step="0.01" value={kirilimButce} onChange={(e) => setKirilimButce(e.target.value)} placeholder="0.00" /></Field>
                </FormAlan>
              </div>
              <div className="row-tight">
                <Input className="grow" value={kirilimAciklama} onChange={(e) => setKirilimAciklama(e.target.value)} placeholder="Kırılım açıklaması ve kapsadığı fatura/masraf kalemleri..." />
                <Button type="submit" variant="primary">Kırılımı Ekle</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {aktifSekme === "asamalar" && (
        <div className="stack">
          <Card title="🏁 Proje Aşamaları &amp; Milestones">
            <TableWrap>
              <thead>
                <tr>
                  <th>Sıra</th>
                  <th>Aşama Adı</th>
                  <th>Tarih Aralığı</th>
                  <th>Durum</th>
                  <th className="center">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {proje.asamalar.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", padding: "2rem" }}>Henüz proje aşaması eklenmemiş. Aşağıdaki formdan yeni aşama tanımlayın.</td></tr>
                ) : (
                  proje.asamalar.map((a) => (
                    <tr key={a.id}>
                      <td><strong>#{a.sira}</strong></td>
                      <td>
                        <strong style={{ textDecoration: a.tamamlandi ? "line-through" : "none" }}>{a.ad}</strong>
                        {a.aciklama && <small style={{ display: "block", color: "var(--muted)" }}>{a.aciklama}</small>}
                      </td>
                      <td>
                        <small>
                          {a.baslangicTarihi ? new Date(a.baslangicTarihi).toLocaleDateString("tr-TR") : "—"}
                          {" - "}
                          {a.bitisTarihi ? new Date(a.bitisTarihi).toLocaleDateString("tr-TR") : "—"}
                        </small>
                      </td>
                      <td>
                        <Badge variant={a.tamamlandi ? "success" : "warning"}>
                          {a.tamamlandi ? `✅ Tamamlandı (${a.tamamlanmaTarihi ? new Date(a.tamamlanmaTarihi).toLocaleDateString("tr-TR") : ""})` : "⏳ Devam Ediyor"}
                        </Badge>
                      </td>
                      <td className="center">
                        <div className="row-tight">
                          <Button size="sm" onClick={() => void asamaTamamla(a.id, a.tamamlandi)}>
                            {a.tamamlandi ? "Geri Al" : "Tamamlandı İşaretle"}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => void asamaSil(a.id)}>Sil</Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </TableWrap>

            <form onSubmit={asamaEkle} className="stack" style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              <strong>➕ Yeni Proje Aşaması Ekle</strong>
              <div className="row">
                <FormAlan flex={2} min={180}>
                  <Field label="Aşama Adı *"><Input value={asamaAd} onChange={(e) => setAsamaAd(e.target.value)} placeholder="Örn. Hafriyat &amp; Temel Yapımı" required /></Field>
                </FormAlan>
                <FormAlan flex={1} min={130}>
                  <Field label="Başlangıç Tarihi"><Input type="date" value={asamaBaslangic} onChange={(e) => setAsamaBaslangic(e.target.value)} /></Field>
                </FormAlan>
                <FormAlan flex={1} min={130}>
                  <Field label="Bitiş Tarihi"><Input type="date" value={asamaBitis} onChange={(e) => setAsamaBitis(e.target.value)} /></Field>
                </FormAlan>
              </div>
              <div className="row-tight">
                <Input className="grow" value={asamaAciklama} onChange={(e) => setAsamaAciklama(e.target.value)} placeholder="Aşama detayları..." />
                <Button type="submit" variant="primary">Aşama Ekle</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {aktifSekme === "notlar" && (
        <div className="stack">
          <Card title="📝 Proje Notları &amp; Aktivite Geçmişi">
            <form onSubmit={notEkle} className="stack" style={{ marginBottom: "1.5rem" }}>
              <Field label="Yeni Not / Güncelleme Yazın">
                <Input value={yeniNot} onChange={(e) => setYeniNot(e.target.value)} placeholder="Proje ile ilgili saha notu, karar veya güncelleme ekleyin..." required />
              </Field>
              <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                <Button type="submit" variant="primary">Notu Ekle</Button>
              </div>
            </form>

            <div className="stack">
              {proje.notlarListesi.length === 0 ? (
                <p className="subtle">Henüz not eklenmemiş.</p>
              ) : (
                proje.notlarListesi.map((n) => (
                  <div key={n.id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem" }}>
                    <div className="between">
                      <strong>{n.user.adSoyad}</strong>
                      <small className="subtle">{new Date(n.createdAt).toLocaleString("tr-TR")}</small>
                    </div>
                    <p style={{ margin: "0.3rem 0 0", whiteSpace: "pre-wrap" }}>{n.icerik}</p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function FormAlan({ children, flex, min }: { children: React.ReactNode; flex?: number; min?: number }) {
  return <div style={{ flex: flex ?? 1, minWidth: min ?? 140 }}>{children}</div>;
}
