"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, PageHeader, Table, Tarih } from "@/components/ui";
import { AbonelikPenceresi, DONEM_ADLARI, zamanlamaOzeti, type Abonelik } from "@/components/rapor-abonelik";

/** RPR-24: kullanıcının (yöneticide firmanın) zamanlanmış rapor abonelikleri. */

const DURUM: Record<string, { ad: string; ton: "success" | "warning" | "danger" | "neutral" }> = {
  gonderildi: { ad: "Gönderildi", ton: "success" },
  bos_atlandi: { ad: "Boş, gönderilmedi", ton: "neutral" },
  basarisiz: { ad: "Başarısız", ton: "danger" },
  duraklatildi: { ad: "Duraklatıldı", ton: "warning" },
};

interface RaporMeta { kod: string; filtreler: { alan: string }[] }

export default function ZamanlanmisRaporlarSayfasi() {
  const [liste, setListe] = useState<Abonelik[] | null>(null);
  const [katalog, setKatalog] = useState<RaporMeta[]>([]);
  const [hata, setHata] = useState("");
  const [bilgi, setBilgi] = useState("");
  const [duzenlenen, setDuzenlenen] = useState<{ kayit: Abonelik; gorunumler: { id: string; ad: string }[] } | null>(null);
  const [isleniyor, setIsleniyor] = useState("");

  const yukle = useCallback(async () => {
    try { setListe(await api<Abonelik[]>("/rapor-abonelikleri")); } catch (h) { setHata(h instanceof Error ? h.message : "Liste alınamadı"); setListe([]); }
  }, []);
  useEffect(() => { void yukle(); void api<RaporMeta[]>("/raporlar").then(setKatalog).catch(() => undefined); }, [yukle]);

  async function eylem(a: Abonelik, yol: string, mesaj: string, yontem = "POST") {
    setHata(""); setBilgi(""); setIsleniyor(a.id);
    try {
      const sonuc = await api<{ durum?: string; alici?: number; hata?: string } | undefined>(`/rapor-abonelikleri/${a.id}${yol}`, { method: yontem });
      if (sonuc?.durum === "basarisiz" || sonuc?.durum === "duraklatildi") setHata(`Gönderilemedi: ${sonuc.hata ?? sonuc.durum}`);
      else setBilgi(sonuc?.durum === "gonderildi" ? `${sonuc.alici} alıcıya gönderildi.` : mesaj);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem başarısız");
    } finally { setIsleniyor(""); }
  }

  async function duzenle(a: Abonelik) {
    try { setDuzenlenen({ kayit: a, gorunumler: await api<{ id: string; ad: string }[]>(`/raporlar/${a.raporKod}/gorunumler`) }); }
    catch (h) { setHata(h instanceof Error ? h.message : "Görünümler alınamadı"); }
  }

  const donemli = (kod: string) => {
    const f = katalog.find((r) => r.kod === kod)?.filtreler ?? [];
    return f.some((x) => x.alan === "baslangic") && f.some((x) => x.alan === "bitis");
  };

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/raporlar">← Raporlar</Link>
      <PageHeader
        title="Zamanlanmış raporlar"
        subtitle="Kayıtlı görünümlerin düzenli e-posta gönderimleri. Yenisini kurmak için Raporlar'da raporu açıp Görünümler menüsünden “E-postayla düzenli gönder” deyin."
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{bilgi}</Alert>
      <Card pad={false}>
        <Table>
          <thead><tr><th>Rapor / görünüm</th><th>Zamanlama</th><th>Alıcılar</th><th>Son gönderim</th><th>Sonraki</th><th /></tr></thead>
          <tbody>
            {liste === null && <tr><td colSpan={6} className="muted">Yükleniyor…</td></tr>}
            {liste?.length === 0 && <tr><td colSpan={6} className="muted">Henüz zamanlanmış rapor yok.</td></tr>}
            {liste?.map((a) => {
              const d = a.sonDurum ? DURUM[a.sonDurum] : null;
              return (
                <tr key={a.id}>
                  <td>
                    <strong>{a.raporAd}</strong> <span className="muted">· {a.gorunumAd}</span>
                    {!a.aktif && <> <Badge variant="warning">Duraklatıldı</Badge></>}
                    <div className="muted" style={{ fontSize: "0.78rem" }}>Kuran: {a.kuran}</div>
                  </td>
                  <td>{zamanlamaOzeti(a)}<div className="muted" style={{ fontSize: "0.78rem" }}>{DONEM_ADLARI[a.donem]} · {a.bicim === "ikisi" ? "Excel + PDF" : a.bicim.toUpperCase()}</div></td>
                  <td style={{ fontSize: "0.85rem" }}>{a.alicilar.map((k) => k.adSoyad).join(", ")}</td>
                  <td>
                    {a.sonGonderim ? <Tarih deger={a.sonGonderim} saatli /> : <span className="muted">—</span>}
                    {d && <div><Badge variant={d.ton}>{d.ad}</Badge></div>}
                    {a.sonHata && <div className="muted" style={{ fontSize: "0.75rem", maxWidth: 260 }}>{a.sonHata}</div>}
                  </td>
                  <td>{a.aktif ? <Tarih deger={a.sonrakiGonderim} saatli /> : <span className="muted">—</span>}</td>
                  <td>
                    <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                      <Button size="sm" disabled={isleniyor === a.id} onClick={() => void eylem(a, "/simdi-gonder", "Gönderildi.")}>Şimdi gönder</Button>
                      <Button size="sm" onClick={() => void duzenle(a)}>Düzenle</Button>
                      {a.aktif
                        ? <Button size="sm" disabled={isleniyor === a.id} onClick={() => void eylem(a, "/duraklat", "Duraklatıldı.")}>Duraklat</Button>
                        : <Button size="sm" disabled={isleniyor === a.id} onClick={() => void eylem(a, "/devam", "Yeniden başlatıldı.")}>Devam</Button>}
                      <Button size="sm" variant="danger" disabled={isleniyor === a.id} onClick={() => { if (window.confirm(`"${a.gorunumAd}" aboneliği silinsin mi?`)) void eylem(a, "", "Silindi.", "DELETE"); }}>Sil</Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      {duzenlenen && (
        <AbonelikPenceresi
          raporKod={duzenlenen.kayit.raporKod}
          gorunumler={duzenlenen.gorunumler}
          donemli={donemli(duzenlenen.kayit.raporKod)}
          kayit={duzenlenen.kayit}
          onKapat={() => setDuzenlenen(null)}
          onKaydedildi={(m) => { setDuzenlenen(null); setBilgi(m); void yukle(); }}
        />
      )}
    </div>
  );
}
