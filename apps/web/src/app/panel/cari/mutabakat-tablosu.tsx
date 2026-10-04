"use client";

import { Fragment, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Badge, Button, Input, TableWrap } from "@/components/ui";

export interface DovizBakiyesi { dovizCinsi: string; bakiye: string }
export type MutabakatDurumu = "gonderildi" | "goruldu" | "mutabik" | "itiraz" | "iptal" | "suresi_doldu";
export interface Mutabakat {
  id: string;
  cari: { id: string; kod: string; unvan: string };
  mutabakatTarihi: string;
  sonYanitTarihi: string;
  bakiyeler: DovizBakiyesi[];
  alici: string;
  durum: MutabakatDurumu;
  durumAdi: string;
  gonderimAt: string;
  gorulduAt: string | null;
  yanitAt: string | null;
  hatirlatmaAt: string | null;
  yanitlayan: { ad: string; gorev: string | null; eposta: string | null } | null;
  yanitAciklama: string | null;
  karsiBakiyeler: DovizBakiyesi[] | null;
  farklar: DovizBakiyesi[];
  ek: { dosyaAdi: string | null } | null;
  itirazKapandiAt: string | null;
  itirazKapatmaNotu: string | null;
  yanitIp: string | null;
}

export const DURUM_ROZETI: Record<MutabakatDurumu, "neutral" | "info" | "success" | "danger" | "warning"> = {
  gonderildi: "neutral", goruldu: "info", mutabik: "success", itiraz: "danger", iptal: "neutral", suresi_doldu: "warning",
};

const trTarih = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");
const bakiyeMetni = (b: DovizBakiyesi[] | null) =>
  (b ?? []).filter((x) => Math.abs(Number(x.bakiye)) >= 0.005).map((x) => `${Number(x.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${x.dovizCinsi === "TRY" ? "TL" : x.dovizCinsi}`).join(" · ") || "0,00";

/**
 * CARI-42: mutabakat talepleri tablosu (kart ve takip ekranı). Bekleyen talep
 * iptal edilir ya da yeni bağlantıyla yeniden gönderilir; açık itiraz notla kapatılır.
 */
export function MutabakatTablosu({ kayitlar, cariSutunu, onDegisti, onMesaj }: {
  kayitlar: Mutabakat[];
  cariSutunu?: boolean;
  onDegisti: () => void;
  onMesaj: (m: { hata?: string; basari?: string }) => void;
}) {
  const [acik, setAcik] = useState<string | null>(null);
  const [kapatmaNotu, setKapatmaNotu] = useState("");
  const [islemde, setIslemde] = useState(false);

  async function eylem(yol: string, govde: Record<string, unknown> = {}) {
    setIslemde(true);
    try {
      const sonuc = await api<{ mesaj: string }>(yol, { method: "POST", body: JSON.stringify(govde) });
      onMesaj({ basari: sonuc.mesaj });
      setKapatmaNotu("");
      onDegisti();
    } catch (h) {
      onMesaj({ hata: h instanceof Error ? h.message : "İşlem yapılamadı" });
    } finally {
      setIslemde(false);
    }
  }

  if (!kayitlar.length) return <p className="subtle">Mutabakat talebi yok.</p>;
  return (
    <TableWrap>
      <thead>
        <tr>
          {cariSutunu && <th>Cari</th>}
          <th>Mutabakat tarihi</th>
          <th>Bakiyemiz</th>
          <th>Durum</th>
          <th>Yanıt</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {kayitlar.map((m) => {
          const bekliyor = m.durum === "gonderildi" || m.durum === "goruldu";
          const acikItiraz = m.durum === "itiraz" && !m.itirazKapandiAt;
          return (
            <Fragment key={m.id}>
              <tr>
                {cariSutunu && <td><a href={`/panel/cari/${m.cari.id}`}><strong>{m.cari.unvan}</strong></a><div className="subtle">{m.cari.kod}</div></td>}
                <td>{trTarih(m.mutabakatTarihi)}<div className="subtle">gönderim {new Date(m.gonderimAt).toLocaleDateString("tr-TR")} · son {trTarih(m.sonYanitTarihi)}</div></td>
                <td className="money">{bakiyeMetni(m.bakiyeler)}</td>
                <td>
                  <Badge variant={DURUM_ROZETI[m.durum]}>{m.durumAdi}</Badge>
                  {m.durum === "itiraz" && m.itirazKapandiAt && <div className="subtle">kapatıldı</div>}
                  {m.hatirlatmaAt && bekliyor && <div className="subtle">hatırlatıldı</div>}
                </td>
                <td>
                  {m.yanitlayan ? <>{m.yanitlayan.ad}<div className="subtle">{m.yanitlayan.gorev} · {new Date(m.yanitAt!).toLocaleString("tr-TR")}</div></> : m.gorulduAt ? <span className="subtle">görüldü {new Date(m.gorulduAt).toLocaleString("tr-TR")}</span> : <span className="subtle">{m.alici}</span>}
                  {m.farklar.length > 0 && <div className="is-negative">Fark: {bakiyeMetni(m.farklar)}</div>}
                </td>
                <td>
                  <div className="row-tight">
                    <Button size="sm" onClick={() => setAcik(acik === m.id ? null : m.id)}>{acik === m.id ? "Kapat" : "Ayrıntı"}</Button>
                    {acikItiraz && <Badge variant="danger">İncelenmeli</Badge>}
                  </div>
                </td>
              </tr>
              {acik === m.id && (
                <tr>
                  <td colSpan={cariSutunu ? 6 : 5}>
                    <div className="mutabakat-ayrinti">
                      <div>
                        <div>Alıcı: {m.alici}</div>
                        {m.karsiBakiyeler && <div>Karşı tarafın bakiyesi: <strong>{bakiyeMetni(m.karsiBakiyeler)}</strong> (artı: bize borçlu)</div>}
                        {m.yanitAciklama && <div>Açıklama: {m.yanitAciklama}</div>}
                        {m.yanitlayan?.eposta && <div>Yanıtlayan e-posta: {m.yanitlayan.eposta}</div>}
                        {m.yanitIp && <div className="subtle">Yanıt IP: {m.yanitIp}</div>}
                        {m.itirazKapatmaNotu && <div>Kapatma notu: {m.itirazKapatmaNotu}</div>}
                      </div>
                      <div className="row-tight">
                        <Button size="sm" onClick={() => void apiDosyaIndir(`/cari/mutabakatlar/${m.id}/ekstre`, `ekstre-${m.cari.kod}-${m.mutabakatTarihi}.pdf`)}>📄 Gönderilen ekstre</Button>
                        {m.ek && <Button size="sm" onClick={() => void apiDosyaIndir(`/cari/mutabakatlar/${m.id}/ek`, m.ek!.dosyaAdi ?? "ek")}>📎 {m.ek.dosyaAdi}</Button>}
                        {bekliyor && <Button size="sm" disabled={islemde} onClick={() => { if (window.confirm("Yeni bağlantı aynı alıcıya gönderilecek; önceki bağlantılar geçersiz olacak. Devam edilsin mi?")) void eylem(`/cari/mutabakatlar/${m.id}/yeniden-gonder`); }}>Yeniden gönder</Button>}
                        {bekliyor && <Button size="sm" disabled={islemde} onClick={() => { if (window.confirm("Talep iptal edilsin mi? Karşı taraf bağlantıyı açamaz.")) void eylem(`/cari/mutabakatlar/${m.id}/iptal`); }}>İptal et</Button>}
                      </div>
                      {acikItiraz && (
                        <div className="row-tight">
                          <Input aria-label="Kapatma notu" value={kapatmaNotu} maxLength={1000} onChange={(e) => setKapatmaNotu(e.target.value)} placeholder="Örn. Ödeme kaydı eklendi, fark kapandı" style={{ minWidth: 260 }} />
                          <Button size="sm" variant="primary" disabled={islemde || !kapatmaNotu.trim()} onClick={() => void eylem(`/cari/mutabakatlar/${m.id}/itiraz-kapat`, { not: kapatmaNotu })}>İtirazı kapat</Button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </TableWrap>
  );
}
