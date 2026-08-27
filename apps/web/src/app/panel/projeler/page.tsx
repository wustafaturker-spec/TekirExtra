"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
} from "@/components/ui";

const PROJE_DURUM_ETIKETLERI: Record<string, { etiket: string; variant: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  planlanan: { etiket: "📋 Planlanan", variant: "warning" },
  aktif: { etiket: "🚀 Aktif", variant: "success" },
  tamamlandi: { etiket: "✅ Tamamlandı", variant: "info" },
  durduruldu: { etiket: "⏸️ Durduruldu", variant: "neutral" },
  iptal: { etiket: "🚫 İptal", variant: "danger" },
};

interface Proje {
  id: string;
  kod: string;
  ad: string;
  aciklama: string | null;
  baslangicTarihi: string | null;
  bitisTarihi: string | null;
  durum: string;
  hedefGelir: string;
  hedefGider: string;
  toplamGelir: string;
  toplamGider: string;
  netKarZarar: string;
  gelirButceOrani: number | null;
  giderButceOrani: number | null;
  cari?: { id: string; unvan: string; kod: string } | null;
  sorumlu?: { id: string; adSoyad: string; eposta: string } | null;
  _count: { asamalar: number; altKirilimlar: number; notlarListesi: number };
}

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

export default function ProjelerSayfasi() {
  const router = useRouter();
  const [projeler, setProjeler] = useState<Proje[]>([]);
  const [arama, setArama] = useState("");
  const [durumFiltresi, setDurumFiltresi] = useState("tumu");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(true);

  // Form state
  const [kod, setKod] = useState("");
  const [ad, setAd] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [cariId, setCariId] = useState("");
  const [baslangicTarihi, setBaslangicTarihi] = useState("");
  const [bitisTarihi, setBitisTarihi] = useState("");
  const [durum, setDurum] = useState("planlanan");
  const [sorumluUserId, setSorumluUserId] = useState("");
  const [hedefGelir, setHedefGelir] = useState("");
  const [hedefGider, setHedefGider] = useState("");
  const [notlar, setNotlar] = useState("");

  const [cariler, setCariler] = useState<{ id: string; unvan: string }[]>([]);
  const [kullanicilar, setKullanicilar] = useState<{ id: string; adSoyad: string }[]>([]);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const [projelerRes, carilerRes, crmRes] = await Promise.all([
        api<Proje[]>("/projeler"),
        api<{ kayitlar: { id: string; unvan: string }[] }>("/cari?adet=100"),
        api<{ kullanicilar: { id: string; adSoyad: string }[] }>("/cari/crm/veri").catch(() => ({ kullanicilar: [] })),
      ]);
      setProjeler(Array.isArray(projelerRes) ? projelerRes : []);
      setCariler(carilerRes.kayitlar ?? []);
      setKullanicilar(crmRes.kullanicilar ?? []);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Projeler yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) void yukle();
  }, [yukle]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    try {
      await api("/projeler", {
        method: "POST",
        body: JSON.stringify({
          kod: kod.trim(),
          ad: ad.trim(),
          aciklama: aciklama.trim() || undefined,
          cariId: cariId || undefined,
          baslangicTarihi: baslangicTarihi || undefined,
          bitisTarihi: bitisTarihi || undefined,
          durum,
          sorumluUserId: sorumluUserId || undefined,
          hedefGelir: hedefGelir || undefined,
          hedefGider: hedefGider || undefined,
          notlar: notlar.trim() || undefined,
        }),
      });
      setBasari("Proje başarıyla oluşturuldu.");
      setFormAcik(false);
      setKod("");
      setAd("");
      setAciklama("");
      setCariId("");
      setBaslangicTarihi("");
      setBitisTarihi("");
      setDurum("planlanan");
      setSorumluUserId("");
      setHedefGelir("");
      setHedefGider("");
      setNotlar("");
      void yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Proje kaydedilemedi");
    }
  }

  const filtreliProjeler = projeler.filter((p) => {
    const metin = `${p.kod} ${p.ad} ${p.aciklama ?? ""} ${p.cari?.unvan ?? ""}`.toLocaleLowerCase("tr-TR");
    const aramaUygun = metin.includes(arama.trim().toLocaleLowerCase("tr-TR"));
    const durumUygun = durumFiltresi === "tumu" || p.durum === durumFiltresi;
    return aramaUygun && durumUygun;
  });

  const toplamHedefGider = projeler.reduce((top, p) => top + Number(p.hedefGider), 0);
  const toplamGerceklesenGider = projeler.reduce((top, p) => top + Number(p.toplamGider), 0);
  const toplamGerceklesenGelir = projeler.reduce((top, p) => top + Number(p.toplamGelir), 0);
  const toplamKarZarar = toplamGerceklesenGelir - toplamGerceklesenGider;

  return (
    <div>
      <PageHeader
        title="Projeler & Analitik Yevmiye"
        subtitle="Proje aşamalarını, maliyet merkezlerini ve bütçe gerçekleşmelerini analitik kırılımlarla takip edin."
        actions={
          <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
            {formAcik ? "✖ Formu Kapat" : "➕ Yeni Proje Oluştur"}
          </Button>
        }
      />

      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}

      <StatGrid>
        <Stat
          label="Toplam Aktif Proje"
          value={projeler.filter((p) => p.durum === "aktif").length.toString()}
          hint={`${projeler.length} toplam projeden`}
        />
        <Stat
          label="Gerçekleşen Gelir"
          value={tl(toplamGerceklesenGelir)}
          tone="success"
          hint="Projelere bağlı fatura/tahsilat"
        />
        <Stat
          label="Gerçekleşen Gider"
          value={tl(toplamGerceklesenGider)}
          tone={toplamGerceklesenGider > 0 ? "danger" : "default"}
          hint={`Hedef Bütçe: ${tl(toplamHedefGider)}`}
        />
        <Stat
          label="Toplam Net Kar / Zarar"
          value={tl(toplamKarZarar)}
          tone={toplamKarZarar >= 0 ? "success" : "danger"}
          hint="Tüm projeler performansı"
        />
      </StatGrid>

      {formAcik && (
        <Card className="record-editor" style={{ marginBottom: "1.5rem" }}>
          <div className="card__title">🚀 Yeni Proje ve Bütçe Kartı</div>
          <form className="stack" onSubmit={kaydet}>
            <div className="row">
              <Field label="Proje Kodu *"><Input value={kod} onChange={(e) => setKod(e.target.value)} required placeholder="PRJ-2026-001" /></Field>
              <Field label="Proje Adı *"><Input value={ad} onChange={(e) => setAd(e.target.value)} required placeholder="Örn. A Binası İnşaat İşi" /></Field>
              <Field label="İşveren / Müşteri (Cari)">
                <Select value={cariId} onChange={(e) => setCariId(e.target.value)}>
                  <option value="">Seçiniz (İsteğe bağlı)</option>
                  {cariler.map((c) => <option key={c.id} value={c.id}>{c.unvan}</option>)}
                </Select>
              </Field>
            </div>
            <div className="row">
              <Field label="Başlangıç Tarihi"><Input type="date" value={baslangicTarihi} onChange={(e) => setBaslangicTarihi(e.target.value)} /></Field>
              <Field label="Bitiş Tarihi"><Input type="date" value={bitisTarihi} onChange={(e) => setBitisTarihi(e.target.value)} /></Field>
              <Field label="Proje Durumu">
                <Select value={durum} onChange={(e) => setDurum(e.target.value)}>
                  <option value="planlanan">Planlanan</option>
                  <option value="aktif">Aktif</option>
                  <option value="tamamlandi">Tamamlandı</option>
                  <option value="durduruldu">Durduruldu</option>
                  <option value="iptal">İptal</option>
                </Select>
              </Field>
              <Field label="Proje Sorumlusu">
                <Select value={sorumluUserId} onChange={(e) => setSorumluUserId(e.target.value)}>
                  <option value="">Seçiniz</option>
                  {kullanicilar.map((u) => <option key={u.id} value={u.id}>{u.adSoyad}</option>)}
                </Select>
              </Field>
            </div>
            <div className="row">
              <Field label="Hedef Bütçelenen Gelir (TL)"><Input type="number" step="0.01" value={hedefGelir} onChange={(e) => setHedefGelir(e.target.value)} placeholder="0.00" /></Field>
              <Field label="Hedef Bütçelenen Gider (TL)"><Input type="number" step="0.01" value={hedefGider} onChange={(e) => setHedefGider(e.target.value)} placeholder="0.00" /></Field>
            </div>
            <Field label="Açıklama &amp; Kapsam"><Input value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Projenin amacı, teslimat şartları ve kapsamı..." /></Field>
            <Field label="Notlar"><Input value={notlar} onChange={(e) => setNotlar(e.target.value)} placeholder="Özel yönetici notları..." /></Field>
            <div className="row-tight" style={{ justifyContent: "flex-end", marginTop: "0.5rem" }}>
              <Button type="button" onClick={() => setFormAcik(false)}>Vazgeç</Button>
              <Button type="submit" variant="primary">Projeyi Kaydet</Button>
            </div>
          </form>
        </Card>
      )}

      <Card pad={false}>
        <div style={{ padding: "1rem", borderBottom: "1px solid var(--border)", display: "flex", gap: "1rem", alignItems: "center" }}>
          <Input className="grow" placeholder="Proje kodu, adı veya müşteri ara..." value={arama} onChange={(e) => setArama(e.target.value)} />
          <Select value={durumFiltresi} onChange={(e) => setDurumFiltresi(e.target.value)}>
            <option value="tumu">Tüm Durumlar</option>
            <option value="aktif">Aktif Projeler</option>
            <option value="planlanan">Planlananlar</option>
            <option value="tamamlandi">Tamamlananlar</option>
            <option value="durduruldu">Durdurulanlar</option>
          </Select>
          <span style={{ fontSize: "0.85rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{filtreliProjeler.length} proje</span>
        </div>

        <TableWrap>
          <thead>
            <tr>
              <th>Kod / Proje Adı</th>
              <th>Müşteri / Cari</th>
              <th>Sorumlu</th>
              <th>Tarih Aralığı</th>
              <th>Analitik Kırılımlar</th>
              <th>Bütçe &amp; Gerçekleşen Gider</th>
              <th>Kar / Zarar</th>
              <th>Durum</th>
              <th className="center">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {yukleniyor ? (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: "2rem" }}>Projeler yükleniyor...</td></tr>
            ) : filtreliProjeler.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: "2rem" }}>Kayıtlı proje bulunamadı.</td></tr>
            ) : (
              filtreliProjeler.map((p) => {
                const durumBilgi = PROJE_DURUM_ETIKETLERI[p.durum] ?? { etiket: p.durum, variant: "neutral" };
                const karZararNum = Number(p.netKarZarar);
                return (
                  <tr key={p.id}>
                    <td>
                      <a href={`/panel/projeler/${p.id}`} className="btn-link" style={{ fontWeight: 600 }}>{p.ad}</a>
                      <small style={{ display: "block", color: "var(--muted)" }}>#{p.kod}</small>
                    </td>
                    <td>{p.cari?.unvan ?? "—"}</td>
                    <td>{p.sorumlu?.adSoyad ?? "—"}</td>
                    <td>
                      <small>
                        {p.baslangicTarihi ? new Date(p.baslangicTarihi).toLocaleDateString("tr-TR") : "—"}
                        {" - "}
                        {p.bitisTarihi ? new Date(p.bitisTarihi).toLocaleDateString("tr-TR") : "—"}
                      </small>
                    </td>
                    <td>
                      <Badge variant="neutral">{p._count.altKirilimlar ?? 0} Maliyet Merkezi</Badge>
                      <small style={{ display: "block", color: "var(--muted)" }}>{p._count.asamalar} Aşama</small>
                    </td>
                    <td>
                      <strong>{tl(p.toplamGider)}</strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        Hedef: {tl(p.hedefGider)}
                        {p.giderButceOrani !== null && ` (%${p.giderButceOrani})`}
                      </small>
                    </td>
                    <td>
                      <strong style={{ color: karZararNum >= 0 ? "var(--success)" : "var(--danger)" }}>
                        {tl(karZararNum)}
                      </strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>Gelir: {tl(p.toplamGelir)}</small>
                    </td>
                    <td><Badge variant={durumBilgi.variant}>{durumBilgi.etiket}</Badge></td>
                    <td className="center">
                      <ButtonLabel as="a" href={`/panel/projeler/${p.id}`}>
                        Detay &amp; Analiz 🔍
                      </ButtonLabel>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
