"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Field, PageHeader, Select, TableWrap, Tarih } from "@/components/ui";

type Onem = "bilgi" | "uyari" | "kritik";
type Durum = "yeni" | "okundu" | "ustlenildi" | "aksiyon_alindi" | "yoksayildi";

interface Bildirim {
  id: string;
  tur: string;
  onem: Onem;
  baslik: string;
  aciklama: string;
  hedefYol: string | null;
  sonTarih: string | null;
  yukseltildiAt: string | null;
  kapandiAt: string | null;
  createdAt: string;
}

interface Teslimat {
  id: string;
  durum: Durum;
  okunduAt: string | null;
  aksiyonNotu: string | null;
  createdAt: string;
  bildirim: Bildirim;
  kullanici: { id: string; adSoyad: string };
}

const TUR_ADLARI: Record<string, string> = {
  duzeltme: "Düzeltme",
  ebelge: "e-Belge",
  vade: "Vade",
  cek_senet: "Çek & Senet",
  stok: "Stok",
  donem: "Dönem",
  entegrasyon: "Entegrasyon",
  satin_alma: "Satın Alma",
  personel: "Personel / İK",
};

const DURUM_ADLARI: Record<Durum, string> = {
  yeni: "Yeni",
  okundu: "Okundu",
  ustlenildi: "Üstlenildi",
  aksiyon_alindi: "Aksiyon alındı",
  yoksayildi: "Yok sayıldı",
};

const ONEM_ROZETI: Record<Onem, "danger" | "warning" | "info"> = { kritik: "danger", uyari: "warning", bilgi: "info" };

export default function BildirimlerSayfasi() {
  const [kayitlar, setKayitlar] = useState<Teslimat[]>([]);
  const [toplam, setToplam] = useState(0);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");
  const [tur, setTur] = useState("");
  const [onem, setOnem] = useState("");
  const [durum, setDurum] = useState("");
  const [kapanmis, setKapanmis] = useState("false");
  const [islemdeki, setIslemdeki] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const sorgu = new URLSearchParams({ limit: "50", kapanmis });
      if (tur) sorgu.set("tur", tur);
      if (onem) sorgu.set("onem", onem);
      if (durum) sorgu.set("durum", durum);
      const veri = await api<{ kayitlar: Teslimat[]; toplam: number }>(`/bildirimler?${sorgu.toString()}`);
      setKayitlar(veri.kayitlar);
      setToplam(veri.toplam);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Bildirimler yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [tur, onem, durum, kapanmis]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  async function eylem(id: string, yol: string, govde?: unknown) {
    setIslemdeki(id);
    setHata("");
    try {
      await api(`/bildirimler/${id}/${yol}`, { method: "PATCH", body: JSON.stringify(govde ?? {}) });
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem tamamlanamadı");
    } finally {
      setIslemdeki(null);
    }
  }

  async function tumunuOkunduYap() {
    setHata("");
    try {
      await api("/bildirimler/tumunu-okundu", { method: "POST" });
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem tamamlanamadı");
    }
  }

  return (
    <div>
      <PageHeader
        title="Bildirimler"
        subtitle="İlgilenmeniz gereken kayıtlar; okundu ile aksiyon alındı ayrı izlenir."
        actions={
          <>
            <ButtonLabel as="a" href="/panel/ayarlar/bildirimler">Bildirim tercihleri</ButtonLabel>
            <Button onClick={() => void tumunuOkunduYap()} type="button">Tümünü okundu işaretle</Button>
          </>
        }
      />

      {hata && <Alert tone="error">{hata}</Alert>}

      <Card className="filter-card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <Field label="Tür">
            <Select value={tur} onChange={(e) => setTur(e.target.value)}>
              <option value="">Tümü</option>
              {Object.entries(TUR_ADLARI).map(([deger, ad]) => (
                <option key={deger} value={deger}>{ad}</option>
              ))}
            </Select>
          </Field>
          <Field label="Önem">
            <Select value={onem} onChange={(e) => setOnem(e.target.value)}>
              <option value="">Tümü</option>
              <option value="kritik">Kritik</option>
              <option value="uyari">Uyarı</option>
              <option value="bilgi">Bilgi</option>
            </Select>
          </Field>
          <Field label="Durum">
            <Select value={durum} onChange={(e) => setDurum(e.target.value)}>
              <option value="">Tümü</option>
              {Object.entries(DURUM_ADLARI).map(([deger, ad]) => (
                <option key={deger} value={deger}>{ad}</option>
              ))}
            </Select>
          </Field>
          <Field label="Kapsam">
            <Select value={kapanmis} onChange={(e) => setKapanmis(e.target.value)}>
              <option value="false">Açık kayıtlar</option>
              <option value="true">Kapanmış kayıtlar</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card pad={false} title={<div><span>BİLDİRİM MERKEZİ</span><h2>{toplam} kayıt</h2></div>}>
        <TableWrap>
          <thead>
            <tr>
              <th>Önem</th>
              <th>Bildirim</th>
              <th>Tür</th>
              <th>Durum</th>
              <th>Oluşma</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {yukleniyor && kayitlar.length === 0 ? (
              <tr><td colSpan={6} className="empty">Yükleniyor…</td></tr>
            ) : kayitlar.length === 0 ? (
              <tr><td colSpan={6} className="empty">Bu filtrede bildirim yok.</td></tr>
            ) : (
              kayitlar.map((kayit) => (
                <tr key={kayit.id}>
                  <td>
                    <Badge variant={ONEM_ROZETI[kayit.bildirim.onem]}>{kayit.bildirim.onem}</Badge>
                    {kayit.bildirim.yukseltildiAt && <small style={{ display: "block", color: "var(--danger)" }}>yükseltildi</small>}
                  </td>
                  <td>
                    <strong>{kayit.bildirim.baslik}</strong>
                    <small style={{ display: "block", color: "var(--text-muted)" }}>{kayit.bildirim.aciklama}</small>
                    {kayit.aksiyonNotu && <small style={{ display: "block", color: "var(--text-subtle)" }}>Not: {kayit.aksiyonNotu}</small>}
                  </td>
                  <td>{TUR_ADLARI[kayit.bildirim.tur] ?? kayit.bildirim.tur}</td>
                  <td>
                    {DURUM_ADLARI[kayit.durum]}
                    {kayit.bildirim.sonTarih && kayit.durum !== "aksiyon_alindi" && (
                      <small style={{ display: "block", color: "var(--text-muted)" }}>Son tarih <Tarih deger={kayit.bildirim.sonTarih} saatli /></small>
                    )}
                  </td>
                  <td><Tarih deger={kayit.bildirim.createdAt} saatli /></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {kayit.bildirim.hedefYol && (
                      <Link className="btn btn--sm" href={kayit.bildirim.hedefYol}>Kayda git</Link>
                    )}
                    {kayit.durum !== "aksiyon_alindi" && kayit.durum !== "yoksayildi" && (
                      <>
                        {kayit.durum !== "ustlenildi" && (
                          <Button size="sm" disabled={islemdeki === kayit.id} onClick={() => void eylem(kayit.id, "ustlen")} type="button">Üstlen</Button>
                        )}
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={islemdeki === kayit.id}
                          onClick={() => {
                            const not = window.prompt("Ne yapıldı? (isteğe bağlı)") ?? undefined;
                            void eylem(kayit.id, "aksiyon", not ? { not } : {});
                          }}
                          type="button"
                        >
                          Aksiyon alındı
                        </Button>
                        <Button size="sm" disabled={islemdeki === kayit.id} onClick={() => void eylem(kayit.id, "yoksay")} type="button">Yok say</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
