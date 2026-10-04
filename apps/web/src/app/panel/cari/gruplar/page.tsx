"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader, Status, TableWrap } from "@/components/ui";

interface RiskOzeti { cekSenetRiski: string; mevcutRisk: string; limit: string | null; teminat: string; kullanilabilirLimit: string | null; kalanLimit: string | null; asim: boolean; kurEksik: string[] }
interface Grup { id: string; ad: string; notlar: string | null; riskLimiti: string | null; uyeSayisi: number; bakiyeTry: string; vadesiGecmis: string; risk: RiskOzeti }
interface Uye {
  id: string; kod: string; unvan: string; aktif: boolean; karaListe: boolean;
  bakiyeler: { dovizCinsi: string; bakiye: string }[];
  bakiyeTry: string; cekSenetRiski: string; mevcutRisk: string; teminat: string; riskLimiti: string | null; limitAsimi: boolean; vadesiGecmis: string; pay: string | null;
}
interface GrupDetay extends Grup { uyeler: Uye[] }

const tl = (v: string | number) => `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
const doluluk = (r: RiskOzeti) => (r.kullanilabilirLimit && Number(r.kullanilabilirLimit) > 0 ? Math.round((Number(r.mevcutRisk) / Number(r.kullanilabilirLimit)) * 100) : null);

/**
 * CARI-41 (P3-2): holding / ana firma grupları. Grup riski üyelerin riskleri
 * toplamı; limit = grup risk limiti + üyelerin geçerli teminatları. Belge
 * kesilirken carinin kendi limitinden sonra grup limiti de denetlenir.
 * Üye ataması cari kartından ya da listede toplu işlemle yapılır.
 */
export default function CariGruplariSayfasi() {
  const [gruplar, setGruplar] = useState<Grup[] | null>(null);
  const [secili, setSecili] = useState<GrupDetay | null>(null);
  const [form, setForm] = useState<{ id: string | null; ad: string; riskLimiti: string; notlar: string } | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    try { setGruplar(await api<Grup[]>("/cari/gruplar")); }
    catch (h) { setHata(h instanceof Error ? h.message : "Gruplar yüklenemedi"); }
  }, []);

  const ac = useCallback(async (id: string) => {
    setHata("");
    try {
      setSecili(await api<GrupDetay>(`/cari/gruplar/${id}`));
      window.history.replaceState(null, "", `/panel/cari/gruplar?id=${id}`);
    } catch (h) { setHata(h instanceof Error ? h.message : "Grup açılamadı"); }
  }, []);

  useEffect(() => {
    void yukle();
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) void ac(id);
  }, [yukle, ac]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault(); if (!form) return;
    setHata(""); setBasari("");
    try {
      const govde = JSON.stringify({ ad: form.ad, riskLimiti: form.riskLimiti.trim().replace(",", ".") || null, notlar: form.notlar.trim() || null });
      const kayit = await api<{ id: string }>(form.id ? `/cari/gruplar/${form.id}` : "/cari/gruplar", { method: form.id ? "PATCH" : "POST", body: govde });
      setBasari(form.id ? "Grup güncellendi." : "Grup oluşturuldu. Üyeleri cari kartından ya da listede toplu işlemle ekleyin.");
      setForm(null);
      await yukle();
      await ac(kayit.id);
    } catch (h) { setHata(h instanceof Error ? h.message : "Grup kaydedilemedi"); }
  }

  async function sil(g: Grup) {
    if (!window.confirm(`'${g.ad}' grubu silinsin mi? ${g.uyeSayisi} cari gruptan çıkar; cariler ve hareketleri kalır.`)) return;
    setHata(""); setBasari("");
    try {
      await api(`/cari/gruplar/${g.id}`, { method: "DELETE" });
      setSecili(null); window.history.replaceState(null, "", "/panel/cari/gruplar");
      setBasari(`'${g.ad}' silindi.`); await yukle();
    } catch (h) { setHata(h instanceof Error ? h.message : "Grup silinemedi"); }
  }

  async function excel(g: Grup) {
    try { await apiDosyaIndir(`/cari/gruplar/${g.id}/excel`, `cari-grubu-${g.ad}.xlsx`); }
    catch (h) { setHata(h instanceof Error ? h.message : "Excel indirilemedi"); }
  }

  return (
    <div>
      <PageHeader
        title="🏢 Cari Grupları"
        subtitle="Holding / ana firma bazında toplam bakiye ve risk; grup limiti gruptaki her cariye kesilen belgede denetlenir."
        actions={<>
          <ButtonLabel as="a" href="/panel/cari">← Cari Hesaplar</ButtonLabel>
          <Button variant="primary" onClick={() => setForm({ id: null, ad: "", riskLimiti: "", notlar: "" })}>➕ Yeni grup</Button>
        </>}
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {form && (
        <Card>
          <form className="cari-grup__form" onSubmit={kaydet}>
            <Field label="Grup adı"><Input autoFocus required maxLength={120} value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} placeholder="Örn. ABC Holding" /></Field>
            <Field label="Grup risk limiti (TL, boşsa limitsiz)"><Input inputMode="decimal" value={form.riskLimiti} onChange={(e) => setForm({ ...form, riskLimiti: e.target.value })} placeholder="Örn. 2000000" /></Field>
            <Field label="Not"><Input maxLength={1000} value={form.notlar} onChange={(e) => setForm({ ...form, notlar: e.target.value })} /></Field>
            <div className="cari-grup__form-dugmeler">
              <Button type="submit" variant="primary">{form.id ? "Kaydet" : "Oluştur"}</Button>
              <Button type="button" onClick={() => setForm(null)}>Vazgeç</Button>
            </div>
          </form>
        </Card>
      )}

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Grup</th>
              <th className="num">Üye</th>
              <th className="num" title="Güncel kurla; alacaklıysak artı">Bakiye</th>
              <th className="num">Vadesi geçmiş</th>
              <th className="num">Grup riski</th>
              <th className="num" title="Grup risk limiti + üyelerin geçerli teminatları">Limit</th>
              <th>Doluluk</th>
            </tr>
          </thead>
          <tbody>
            {gruplar === null ? (
              <tr><td colSpan={7} className="empty">Yükleniyor…</td></tr>
            ) : gruplar.length === 0 ? (
              <tr><td colSpan={7} className="empty">Henüz grup yok. Holding ya da aynı patrona bağlı şirketleri bir grupta toplayıp toplam riskini izleyin.</td></tr>
            ) : gruplar.map((g) => {
              const yuzde = doluluk(g.risk);
              return (
                <tr key={g.id} className={`row-link${secili?.id === g.id ? " is-selected" : ""}`} tabIndex={0} onClick={() => void ac(g.id)} onKeyDown={(e) => { if (e.key === "Enter") void ac(g.id); }}>
                  <td><strong>{g.ad}</strong>{g.notlar && <div className="subtle">{g.notlar}</div>}</td>
                  <td className="num">{g.uyeSayisi}</td>
                  <td className={`num money ${Number(g.bakiyeTry) > 0 ? "pos" : Number(g.bakiyeTry) < 0 ? "neg" : ""}`}>{tl(g.bakiyeTry)}</td>
                  <td className={`num money ${Number(g.vadesiGecmis) > 0 ? "neg" : ""}`}>{tl(g.vadesiGecmis)}</td>
                  <td className="num money">{tl(g.risk.mevcutRisk)}</td>
                  <td className="num">{g.risk.kullanilabilirLimit ? tl(g.risk.kullanilabilirLimit) : "—"}</td>
                  <td>{yuzde === null ? <span className="subtle">Limit yok</span> : <Status tone={g.risk.asim ? "danger" : yuzde >= 80 ? "warn" : "ok"}>%{yuzde}{g.risk.asim ? " · aşıldı" : ""}</Status>}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {secili && (
        <Card>
          <div className="cari-grup__bas">
            <div>
              <h3 style={{ margin: 0 }}>{secili.ad}</h3>
              <div className="subtle">
                {secili.uyeSayisi} üye · grup riski {tl(secili.risk.mevcutRisk)}
                {secili.riskLimiti && <> · limit {tl(secili.riskLimiti)}{Number(secili.risk.teminat) > 0 && <> + teminat {tl(secili.risk.teminat)}</>}</>}
                {secili.risk.kalanLimit !== null && <> · kalan {tl(secili.risk.kalanLimit)}</>}
              </div>
              {secili.risk.kurEksik.length > 0 && <small className="muted">{secili.risk.kurEksik.join(", ")} için güncel kur yok; tarihî kurla hesaplandı.</small>}
            </div>
            <div className="row-tight">
              <ButtonLabel as="a" href={`/panel/cari?grup=${secili.id}`}>Listede göster</ButtonLabel>
              <Button size="sm" disabled={!secili.uyeSayisi} onClick={() => void excel(secili)}>📊 Excel</Button>
              <Button size="sm" onClick={() => setForm({ id: secili.id, ad: secili.ad, riskLimiti: secili.riskLimiti ?? "", notlar: secili.notlar ?? "" })}>Düzenle</Button>
              <Button size="sm" onClick={() => void sil(secili)}>Sil</Button>
            </div>
          </div>
          {secili.uyeler.length === 0 ? (
            <p className="subtle">Bu grupta cari yok. Cari kartında "Risk ve finans koşulları"ndan ya da listede seçip <b>🏢 Grup</b> toplu işlemiyle ekleyin.</p>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>Cari</th>
                  <th className="num">Bakiye</th>
                  <th className="num">Çek/senet</th>
                  <th className="num">Risk</th>
                  <th className="num">Pay</th>
                  <th className="num">Vadesi geçmiş</th>
                  <th className="num">Cari limiti</th>
                </tr>
              </thead>
              <tbody>
                {secili.uyeler.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <a href={`/panel/cari/${u.id}`}><strong>{u.unvan}</strong></a>
                      <div className="subtle">{u.kod}{u.karaListe && <> · <Badge variant="danger">Bloke</Badge></>}{!u.aktif && <> · <Badge variant="warning">Pasif</Badge></>}</div>
                    </td>
                    <td className={`num money ${Number(u.bakiyeTry) > 0 ? "pos" : Number(u.bakiyeTry) < 0 ? "neg" : ""}`}>
                      {tl(u.bakiyeTry)}
                      {u.bakiyeler.filter((b) => b.dovizCinsi !== "TRY" && Number(b.bakiye) !== 0).map((b) => <small key={b.dovizCinsi} className="muted cari-grup__doviz">{Number(b.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {b.dovizCinsi}</small>)}
                    </td>
                    <td className="num">{Number(u.cekSenetRiski) ? tl(u.cekSenetRiski) : "—"}</td>
                    <td className="num money">{tl(u.mevcutRisk)}</td>
                    <td className="num">{u.pay === null ? "—" : `%${Number(u.pay).toLocaleString("tr-TR")}`}</td>
                    <td className={`num money ${Number(u.vadesiGecmis) > 0 ? "neg" : ""}`}>{tl(u.vadesiGecmis)}</td>
                    <td className="num">{u.riskLimiti ? <>{tl(u.riskLimiti)}{u.limitAsimi && <div><Badge variant="danger">Aşıldı</Badge></div>}</> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}
    </div>
  );
}
