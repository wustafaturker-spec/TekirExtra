"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { YETKI_ISLEM_ADI, YETKI_ISLEMLERI, YETKI_MODULLERI, yetkiAnahtari, type Rol } from "@tekirextra/shared";
import { api, tokenAl } from "@/lib/api";
import { ROL_ADI } from "@/lib/rol-adlari";
import { Alert, Badge, Button, Card, Field, Input, Modal, ModalEylem, PageHeader, Select, TableWrap } from "@/components/ui";

interface OzelRol {
  id: string;
  ad: string;
  sablonRol: Rol;
  kapaliKutular: string[];
  aktif: boolean;
  kullaniciSayisi: number;
}

/** Düzenlenen rol; `id` yoksa yeni. */
interface Taslak {
  id?: string;
  ad: string;
  sablonRol: Rol;
  kapali: Set<string>;
}

/**
 * KLN-20: özel roller. Bir hazır rol şablon alınır; matriste yalnız şablonun
 * erişebildiği kutular seçilebilir ve kapatılabilir. Aynı matris API'de,
 * menüde ve asistan araçlarında uygulanır.
 */
export default function OzelRollerSayfasi() {
  const [roller, setRoller] = useState<OzelRol[]>([]);
  const [matris, setMatris] = useState<Record<string, string[]>>({});
  const [taslak, setTaslak] = useState<Taslak | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);

  const yukle = useCallback(async () => {
    const [r, m] = await Promise.all([api<OzelRol[]>("/ozel-roller"), api<Record<string, string[]>>("/ozel-roller/sablon-matrisi")]);
    setRoller(r);
    setMatris(m);
  }, []);
  useEffect(() => { if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi (yalnız yönetici görebilir)")); }, [yukle]);

  const sablonlar = Object.keys(matris) as Rol[];

  async function calistir(is: () => Promise<string>) {
    setIsleniyor(true);
    setHata("");
    setBasari("");
    try {
      setBasari(await is());
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "İşlem başarısız");
    } finally {
      setIsleniyor(false);
    }
  }

  function kaydet(e: React.FormEvent) {
    e.preventDefault();
    if (!taslak) return;
    const t = taslak;
    void calistir(async () => {
      const kapaliKutular = [...t.kapali];
      if (t.id) await api(`/ozel-roller/${t.id}`, { method: "PATCH", body: JSON.stringify({ ad: t.ad, kapaliKutular }) });
      else await api("/ozel-roller", { method: "POST", body: JSON.stringify({ ad: t.ad, sablonRol: t.sablonRol, kapaliKutular }) });
      setTaslak(null);
      return t.id ? `${t.ad} güncellendi; kullanıcılarına en geç 10 saniyede yansır.` : `${t.ad} oluşturuldu. Kullanıcılar ekranından atayabilirsiniz.`;
    });
  }

  const durumDegistir = (r: OzelRol) => void calistir(async () => {
    await api(`/ozel-roller/${r.id}`, { method: "PATCH", body: JSON.stringify({ aktif: !r.aktif }) });
    return r.aktif ? `${r.ad} pasife alındı; yeni kullanıcıya atanamaz, mevcut kullanıcıları etkilenmez.` : `${r.ad} yeniden aktif.`;
  });
  const sil = (r: OzelRol) => void calistir(async () => {
    await api(`/ozel-roller/${r.id}`, { method: "DELETE" });
    return `${r.ad} silindi.`;
  });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }} className="stack">
      <PageHeader
        title="Özel Roller"
        subtitle="Bir hazır rolü şablon alın ve yetkilerinden istediklerinizi kapatın. Özel rol şablonunu aşamaz; kapatılan modülün ekranı menüden kalkar, işlemleri sunucuda ve asistanda da reddedilir — KLN-20."
        actions={<div className="row-tight">
          <Link className="btn btn--ghost" href="/panel/ayarlar/kullanicilar">← Kullanıcılar</Link>
          <Button variant="primary" disabled={!sablonlar.length} onClick={() => setTaslak({ ad: "", sablonRol: "muhasebe", kapali: new Set() })}>Yeni özel rol</Button>
        </div>}
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      <Card pad={false}>
        <TableWrap>
          <table className="table">
            <thead><tr><th>Ad</th><th>Şablon</th><th className="num">Kapalı kutu</th><th className="num">Kullanıcı</th><th>Durum</th><th /></tr></thead>
            <tbody>
              {roller.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.ad}</strong></td>
                  <td>{ROL_ADI[r.sablonRol] ?? r.sablonRol}</td>
                  <td className="num">{r.kapaliKutular.length}</td>
                  <td className="num">{r.kullaniciSayisi}</td>
                  <td>{r.aktif ? <Badge variant="success">Aktif</Badge> : <Badge variant="neutral">Pasif</Badge>}</td>
                  <td>
                    <div className="row-tight" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <Button size="sm" disabled={isleniyor} onClick={() => setTaslak({ id: r.id, ad: r.ad, sablonRol: r.sablonRol, kapali: new Set(r.kapaliKutular) })}>Düzenle</Button>
                      <Button size="sm" disabled={isleniyor} onClick={() => durumDegistir(r)}>{r.aktif ? "Pasife al" : "Aktif et"}</Button>
                      {!r.kullaniciSayisi && <Button size="sm" variant="danger" disabled={isleniyor} onClick={() => sil(r)}>Sil</Button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!roller.length && <tr><td colSpan={6} className="empty">Henüz özel rol yok.</td></tr>}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      {taslak && (
        <Modal genis baslik={taslak.id ? `${taslak.ad} — yetkiler` : "Yeni özel rol"} aciklama="İşaretli kutular açıktır. Gri kutulara şablon rol zaten erişemez." onKapat={() => setTaslak(null)}>
          <form onSubmit={kaydet} className="stack">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
              <Field label="Ad"><Input required minLength={2} maxLength={80} value={taslak.ad} onChange={(e) => setTaslak({ ...taslak, ad: e.target.value })} placeholder="ör. Muhasebe – kasa-bankasız" /></Field>
              <Field label="Şablon rol">
                <Select value={taslak.sablonRol} disabled={Boolean(taslak.id)} onChange={(e) => setTaslak({ ...taslak, sablonRol: e.target.value as Rol, kapali: new Set() })}>
                  {sablonlar.map((s) => <option key={s} value={s}>{ROL_ADI[s] ?? s}</option>)}
                </Select>
              </Field>
            </div>
            {taslak.id && <p className="subtle" style={{ margin: 0 }}>Şablon sonradan değişmez; farklı şablon için yeni özel rol açın.</p>}
            <TableWrap>
              <table className="table">
                <thead><tr><th>Modül</th>{YETKI_ISLEMLERI.map((i) => <th key={i} style={{ textAlign: "center" }}>{YETKI_ISLEM_ADI[i]}</th>)}</tr></thead>
                <tbody>
                  {YETKI_MODULLERI.map((m) => (
                    <tr key={m.kod}>
                      <td>{m.ad}</td>
                      {YETKI_ISLEMLERI.map((i) => {
                        const anahtar = yetkiAnahtari(m.kod, i);
                        const sablondaVar = (matris[taslak.sablonRol] ?? []).includes(anahtar);
                        const ortakOkuma = i === "goruntule" && m.yalnizYazma && !m.korunanOkuma?.length;
                        return (
                          <td key={i} style={{ textAlign: "center" }}>
                            {ortakOkuma ? <span className="subtle" title="Ortak ayarlar her ekranda okunur">—</span> : (
                              <input
                                type="checkbox"
                                aria-label={`${m.ad} — ${YETKI_ISLEM_ADI[i]}`}
                                title={i === "goruntule" && m.korunanOkuma?.length ? "Denetim izi, e-posta geçmişi ve yönetim ekranları; ortak ayarlar yine okunur" : undefined}
                                disabled={!sablondaVar}
                                checked={sablondaVar && !taslak.kapali.has(anahtar)}
                                onChange={(e) => {
                                  const kapali = new Set(taslak.kapali);
                                  if (e.target.checked) kapali.delete(anahtar);
                                  else kapali.add(anahtar);
                                  setTaslak({ ...taslak, kapali });
                                }}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="subtle" style={{ margin: 0 }}>
              Görüntülemesi kapatılan modülün verisi başka ekranlarda da okunamaz (ör. Cari kapalıysa fatura formunda cari seçilemez).
            </p>
            <ModalEylem onVazgec={() => setTaslak(null)} isleniyor={isleniyor} metin={taslak.id ? "Kaydet" : "Oluştur"} />
          </form>
        </Modal>
      )}
    </div>
  );
}
