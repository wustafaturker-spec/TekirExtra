"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Select, TableWrap } from "@/components/ui";

/**
 * PZR-18: pazaryeri otomatik çekim işleri. Aralık kaydedilince durmuş iş yeniden
 * başlar; "Şimdi çalıştır" düğmenin servisini çağırır (otomatik çekimle aynı
 * anda çalışmaz). Otomatik çekim siparişi yalnız içe aktarır, faturalandırmaz.
 */
interface Is { is: "siparis" | "finans"; ad: string; aralikDk: number; varsayilan: boolean; sonDeneme: string | null; sonBasari: string | null; ardisikHata: number; sonHata: string | null; durduNedeni: string | null; sonraki: string | null }
export interface OtomatikBaglanti { baglantiId: string; saglayici: string; durum: string; isler: Is[] }

const ARALIKLAR: [number, string][] = [[0, "Kapalı"], [15, "15 dakika"], [30, "30 dakika"], [60, "Saatlik"], [360, "6 saatte bir"], [1440, "Günde bir"]];
const ADLAR: Record<string, string> = { amazon_tr: "Amazon", trendyol: "Trendyol", hepsiburada: "Hepsiburada", n11: "n11" };
const zaman = (v: string | null) => v ? new Date(v).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—";

/** "x dk/saat/gün önce" (ekran üstü bilgi için). */
export function oncesi(v: string | null): string {
  if (!v) return "henüz yok";
  const dk = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 60_000));
  return dk < 1 ? "az önce" : dk < 60 ? `${dk} dk önce` : dk < 1440 ? `${Math.round(dk / 60)} saat önce` : `${Math.round(dk / 1440)} gün önce`;
}

export function PazaryeriOtomatikCekim({ yonetici }: { yonetici: boolean }) {
  const [liste, setListe] = useState<OtomatikBaglanti[]>([]);
  const [islem, setIslem] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    try { setListe(await api<OtomatikBaglanti[]>("/pazaryeri/otomatik")); } catch (e) { setHata(e instanceof Error ? e.message : "Otomatik çekim ayarları yüklenemedi"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  async function aralikKaydet(b: OtomatikBaglanti, is: Is, aralikDk: number) {
    setIslem(`aralik:${b.baglantiId}:${is.is}`); setHata(""); setBasari("");
    try {
      await api(`/pazaryeri/baglantilar/${b.baglantiId}/otomatik`, { method: "POST", body: JSON.stringify({ is: is.is, aralikDk }) });
      setBasari(`${ADLAR[b.saglayici] ?? b.saglayici} · ${is.ad}: ${aralikDk ? `${ARALIKLAR.find((a) => a[0] === aralikDk)?.[1].toLocaleLowerCase("tr-TR")} çekilecek` : "otomatik çekim kapatıldı"}.`);
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Aralık kaydedilemedi"); }
    finally { setIslem(""); }
  }

  async function calistir(b: OtomatikBaglanti, is: Is) {
    setIslem(`calistir:${b.baglantiId}:${is.is}`); setHata(""); setBasari("");
    try {
      const yol = is.is === "siparis" ? "/pazaryeri/senkronize" : "/pazaryeri/kesintiler/senkronize";
      const r = await api<{ sonuclar: { alinan: number; eklenen: number; hata?: string }[] }>(yol, { method: "POST", body: JSON.stringify({ baglantiId: b.baglantiId }) });
      const s = r.sonuclar[0];
      if (s?.hata) setHata(s.hata); else setBasari(`${ADLAR[b.saglayici] ?? b.saglayici} · ${is.ad}: ${s?.alinan ?? 0} kayıt kontrol edildi, ${s?.eklenen ?? 0} yeni kayıt eklendi.`);
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Çekim başarısız"); }
    finally { setIslem(""); }
  }

  if (!liste.length) return hata ? <Alert tone="error">{hata}</Alert> : null;
  return (
    <Card title="Otomatik çekim" pad={false}>
      <div style={{ display: "grid", gap: "0.6rem", padding: "0.75rem 1rem" }}>
        <small className="subtle">Siparişler ve finans hareketleri (kesinti, stopaj, ödeme dönemi) seçilen aralıkla arka planda çekilir. Siparişler yalnız içe aktarılır; faturalandırma elle yapılır. Üst üste 3 başarısız çekimde Bildirim Merkezi'ne uyarı düşer; pazaryeri kimlik bilgisini reddederse çekim durur ve bilgi düzeltilip yeniden çalıştırılınca sürer.</small>
        {hata && <Alert tone="error">{hata}</Alert>}
        {basari && <Alert tone="success">{basari}</Alert>}
      </div>
      <TableWrap>
        <thead><tr><th>Bağlantı</th><th>İş</th><th>Aralık</th><th>Son başarılı</th><th>Sonraki</th><th>Durum</th><th></th></tr></thead>
        <tbody>
          {liste.flatMap((b) => b.isler.map((is) => (
            <tr key={`${b.baglantiId}:${is.is}`}>
              <td><strong>{ADLAR[b.saglayici] ?? b.saglayici}</strong>{b.durum !== "aktif" && <small> · pasif</small>}</td>
              <td>{is.ad}</td>
              <td>
                <Select aria-label={`${ADLAR[b.saglayici] ?? b.saglayici} ${is.ad} aralığı`} value={is.aralikDk} disabled={!yonetici || islem === `aralik:${b.baglantiId}:${is.is}`} onChange={(e) => void aralikKaydet(b, is, Number(e.target.value))}>
                  {ARALIKLAR.map(([dk, ad]) => <option key={dk} value={dk}>{ad}</option>)}
                </Select>
                {is.varsayilan && <small className="subtle"> varsayılan</small>}
              </td>
              <td>{zaman(is.sonBasari)}</td>
              <td>{b.durum !== "aktif" ? "Bağlantı pasif" : is.sonraki ? zaman(is.sonraki) : "—"}</td>
              <td>
                {is.durduNedeni ? <Badge variant="danger">Durdu</Badge>
                  : is.ardisikHata ? <Badge variant="warning">{is.ardisikHata} hata</Badge>
                  : is.sonBasari ? <Badge variant="success">Çalışıyor</Badge> : <Badge variant="neutral">Bekliyor</Badge>}
                {(is.durduNedeni || is.sonHata) && <div><small className="subtle">{is.durduNedeni ?? is.sonHata}</small></div>}
              </td>
              <td><Button size="sm" disabled={b.durum !== "aktif" || Boolean(islem)} onClick={() => void calistir(b, is)}>{islem === `calistir:${b.baglantiId}:${is.is}` ? "Çalışıyor…" : "Şimdi çalıştır"}</Button></td>
            </tr>
          )))}
        </tbody>
      </TableWrap>
    </Card>
  );
}

/** PZR-18: sipariş/kesinti ekranında "son otomatik çekim" satırı. */
export function PazaryeriSonCekim({ is }: { is: "siparis" | "finans" }) {
  const [liste, setListe] = useState<OtomatikBaglanti[]>([]);
  useEffect(() => { void api<OtomatikBaglanti[]>("/pazaryeri/otomatik").then(setListe).catch(() => setListe([])); }, []);
  const satirlar = liste.filter((b) => b.durum === "aktif").flatMap((b) => b.isler.filter((x) => x.is === is).map((x) => ({ b, x })));
  if (!satirlar.length) return null;
  return (
    <small className="subtle" style={{ display: "block" }}>
      Son otomatik çekim: {satirlar.map(({ b, x }) => `${ADLAR[b.saglayici] ?? b.saglayici} ${x.aralikDk ? oncesi(x.sonBasari) : "kapalı"}${x.durduNedeni ? " (durdu)" : x.ardisikHata ? ` (${x.ardisikHata} hata)` : ""}`).join(" · ")}
    </small>
  );
}
