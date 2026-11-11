"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ROLLER, type Rol } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { ROL_ADI } from "@/lib/rol-adlari";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, TableWrap } from "@/components/ui";

type Islem = "fatura_kesinlestir_satis" | "fatura_kesinlestir_alis" | "belge_onayla_satis" | "masraf_onayla" | "kasa_banka_odeme";
type Adim = { rol: Rol } | { kullaniciId: string };
interface Kural { id: string; islem: Islem; ad: string; aktif: boolean; tutarEsigi: string | null; iskontoEsigi: string | null; riskAsimi: boolean; adimlar: Adim[] }
interface Yanit { kurallar: Kural[]; islemler: { islem: Islem; ad: string }[]; satinAlmaEsigi: number | null; gorevAyriligiKapali: boolean; tekYonetici: boolean }
interface Kullanici { id: string; adSoyad: string; rol: string; aktif: boolean }

/** API'deki KOSUL_KAPSAMI ile aynı: iskonto ve risk koşulu yalnız satış/alış belgelerinde anlamlı. */
const KOSUL: Record<Islem, { iskonto: boolean; risk: boolean }> = {
  fatura_kesinlestir_satis: { iskonto: true, risk: true },
  fatura_kesinlestir_alis: { iskonto: true, risk: false },
  belge_onayla_satis: { iskonto: true, risk: true },
  masraf_onayla: { iskonto: false, risk: false },
  kasa_banka_odeme: { iskonto: false, risk: false },
};
const ONAYCI_ROLLERI = ROLLER.filter((r) => !["salt_okunur", "b2b_bayi", "calisan", "mali_musavir"].includes(r));

interface Form { id: string | null; islem: Islem; ad: string; aktif: boolean; tutarEsigi: string; iskontoEsigi: string; riskAsimi: boolean; adimlar: { tur: "rol" | "kisi"; deger: string }[] }
const bosForm = (): Form => ({ id: null, islem: "fatura_kesinlestir_satis", ad: "", aktif: true, tutarEsigi: "", iskontoEsigi: "", riskAsimi: false, adimlar: [{ tur: "rol", deger: "yonetici" }] });
const tl = (s: string) => `${Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

/**
 * ONY-01/04/08: onay kuralları. Hangi işlemin hangi koşulda (tutar, iskonto, risk aşımı) kimin
 * onayına düşeceği; satın alma eşiği ve tek yöneticili firmada görev ayrılığı ayarı da burada.
 */
export default function OnayKurallariSayfasi() {
  const [veri, setVeri] = useState<Yanit | null>(null);
  const [kullanicilar, setKullanicilar] = useState<Kullanici[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [satinAlma, setSatinAlma] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [mesgul, setMesgul] = useState(false);

  const yukle = useCallback(async () => {
    try {
      const [v, k] = await Promise.all([api<Yanit>("/onay-kurallari"), api<Kullanici[]>("/kullanicilar")]);
      setVeri(v); setKullanicilar(k.filter((x) => x.aktif)); setSatinAlma(v.satinAlmaEsigi == null ? "" : String(v.satinAlmaEsigi));
    } catch (e) { setHata(e instanceof Error ? e.message : "Kurallar alınamadı"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  const islemAdi = (i: Islem) => veri?.islemler.find((x) => x.islem === i)?.ad ?? i;
  const adimAdi = (a: Adim) => ("rol" in a ? `${ROL_ADI[a.rol] ?? a.rol} rolü` : kullanicilar.find((k) => k.id === a.kullaniciId)?.adSoyad ?? "Kullanıcı");

  async function calistir(fn: () => Promise<unknown>, mesaj: string) {
    setMesgul(true); setHata(""); setBasari("");
    try { await fn(); setBasari(mesaj); await yukle(); return true; }
    catch (e) { setHata(e instanceof Error ? e.message : "İşlem yapılamadı"); return false; }
    finally { setMesgul(false); }
  }

  async function kaydet(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const k = KOSUL[form.islem];
    const govde = {
      islem: form.islem, ad: form.ad, aktif: form.aktif,
      tutarEsigi: form.tutarEsigi.trim() ? Number(form.tutarEsigi.replace(",", ".")) : null,
      iskontoEsigi: k.iskonto && form.iskontoEsigi.trim() ? Number(form.iskontoEsigi.replace(",", ".")) : null,
      riskAsimi: k.risk && form.riskAsimi,
      adimlar: form.adimlar.map((a) => (a.tur === "rol" ? { rol: a.deger } : { kullaniciId: a.deger })),
    };
    const ok = await calistir(() => api(form.id ? `/onay-kurallari/${form.id}` : "/onay-kurallari", { method: form.id ? "PUT" : "POST", body: JSON.stringify(govde) }), form.id ? "Kural güncellendi." : "Kural eklendi.");
    if (ok) setForm(null);
  }

  function duzenle(k: Kural) {
    setForm({
      id: k.id, islem: k.islem, ad: k.ad, aktif: k.aktif, tutarEsigi: k.tutarEsigi ?? "", iskontoEsigi: k.iskontoEsigi ?? "", riskAsimi: k.riskAsimi,
      adimlar: k.adimlar.map((a) => ("rol" in a ? { tur: "rol" as const, deger: a.rol } : { tur: "kisi" as const, deger: a.kullaniciId })),
    });
  }

  const adimGuncelle = (i: number, deger: Partial<Form["adimlar"][number]>) => setForm((f) => f && { ...f, adimlar: f.adimlar.map((a, j) => (j === i ? { ...a, ...deger } : a)) });

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <PageHeader
        title="Onay Kuralları"
        subtitle="Kurala uyan işlem hemen yapılmaz; onaycının kutusuna düşer ve son adım onaylanınca talep edenin adına yapılır. Kural yoksa işlemler bugünkü gibi doğrudan yapılır."
        actions={<><Link className="btn btn--ghost" href="/panel/onaylar">Onay kutusu</Link>{!form && <Button variant="primary" onClick={() => setForm(bosForm())}>Kural ekle</Button>}</>}
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <div className="stack">
        {form && (
          <Card title={form.id ? "Kuralı düzenle" : "Yeni kural"}>
            <form className="stack" onSubmit={(e) => void kaydet(e)}>
              <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                <Field label="İşlem">
                  <Select value={form.islem} onChange={(e) => setForm({ ...form, islem: e.target.value as Islem })}>
                    {veri?.islemler.map((i) => <option key={i.islem} value={i.islem}>{i.ad}</option>)}
                  </Select>
                </Field>
                <Field label="Kural adı"><Input required minLength={2} maxLength={120} value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} placeholder="Örn. 100.000 TL üstü satış faturası" /></Field>
                <div><Field label="Tutar eşiği (TL karşılığı)"><Input inputMode="decimal" value={form.tutarEsigi} onChange={(e) => setForm({ ...form, tutarEsigi: e.target.value })} /></Field><p className="subtle" style={{ margin: "0.25rem 0 0", fontSize: "0.85em" }}>Bu tutar ve üstündeki işlemler onaya düşer. Boş bırakılırsa tutar koşulu yok.</p></div>
                {KOSUL[form.islem].iskonto && (
                  <div><Field label="İskonto eşiği (%)"><Input inputMode="decimal" value={form.iskontoEsigi} onChange={(e) => setForm({ ...form, iskontoEsigi: e.target.value })} /></Field><p className="subtle" style={{ margin: "0.25rem 0 0", fontSize: "0.85em" }}>Herhangi bir satırdaki ya da belge altı iskonto bu orana ulaşırsa onaya düşer.</p></div>
                )}
              </div>
              {KOSUL[form.islem].risk && (
                <label className="row" style={{ gap: "0.5rem" }}>
                  <input type="checkbox" checked={form.riskAsimi} onChange={(e) => setForm({ ...form, riskAsimi: e.target.checked })} />
                  Carinin risk limiti aşılıyorsa onaya düşsün
                </label>
              )}
              <p className="subtle" style={{ margin: 0 }}>Birden çok koşul seçilirse hepsi birlikte sağlandığında kural uygulanır. Hiç koşul seçilmezse bu işlemin tamamı onaya düşer.</p>

              <div className="stack" style={{ gap: "0.5rem" }}>
                <strong>Onay adımları</strong>
                {form.adimlar.map((a, i) => (
                  <div key={i} className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                    <span style={{ minWidth: 70 }}>{i + 1}. adım</span>
                    <Select aria-label={`${i + 1}. adım türü`} value={a.tur} onChange={(e) => adimGuncelle(i, { tur: e.target.value as "rol" | "kisi", deger: e.target.value === "rol" ? "yonetici" : kullanicilar[0]?.id ?? "" })}>
                      <option value="rol">Rol</option>
                      <option value="kisi">Kişi</option>
                    </Select>
                    <Select aria-label={`${i + 1}. adım onaycısı`} value={a.deger} onChange={(e) => adimGuncelle(i, { deger: e.target.value })}>
                      {a.tur === "rol"
                        ? ONAYCI_ROLLERI.map((r) => <option key={r} value={r}>{ROL_ADI[r]}</option>)
                        : kullanicilar.map((k) => <option key={k.id} value={k.id}>{k.adSoyad} ({ROL_ADI[k.rol as Rol] ?? k.rol})</option>)}
                    </Select>
                    {form.adimlar.length > 1 && <Button size="sm" type="button" onClick={() => setForm({ ...form, adimlar: form.adimlar.filter((_, j) => j !== i) })}>Adımı kaldır</Button>}
                  </div>
                ))}
                {form.adimlar.length < 2 && <div><Button size="sm" type="button" onClick={() => setForm({ ...form, adimlar: [...form.adimlar, { tur: "rol", deger: "yonetici" }] })}>İkinci adım ekle</Button></div>}
                <p className="subtle" style={{ margin: 0 }}>Rol adımını o roldeki herkes ya da bir yönetici onaylayabilir. Talep eden kendi talebini, aynı kişi de iki adımı birden onaylayamaz.</p>
              </div>

              <label className="row" style={{ gap: "0.5rem" }}>
                <input type="checkbox" checked={form.aktif} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} />
                Kural etkin
              </label>
              <div className="row" style={{ gap: "0.5rem", justifyContent: "flex-end" }}>
                <Button type="button" onClick={() => setForm(null)}>Vazgeç</Button>
                <Button type="submit" variant="primary" disabled={mesgul}>{mesgul ? "Kaydediliyor…" : "Kaydet"}</Button>
              </div>
            </form>
          </Card>
        )}

        <Card title="Kurallar">
          {veri === null ? <p className="subtle" role="status" style={{ margin: 0 }}>Yükleniyor…</p>
            : veri.kurallar.length === 0 ? <p className="subtle" style={{ margin: 0 }}>Henüz onay kuralı yok; işlemler doğrudan yapılıyor.</p>
            : (
              <TableWrap>
                <Table>
                  <thead><tr><th>Kural</th><th>İşlem</th><th>Koşul</th><th>Onaycılar</th><th>Durum</th><th aria-label="Eylemler" /></tr></thead>
                  <tbody>
                    {veri.kurallar.map((k) => (
                      <tr key={k.id}>
                        <td>{k.ad}</td>
                        <td>{islemAdi(k.islem)}</td>
                        <td>{[k.tutarEsigi && `≥ ${tl(k.tutarEsigi)}`, k.iskontoEsigi && `iskonto ≥ %${Number(k.iskontoEsigi)}`, k.riskAsimi && "risk aşımı"].filter(Boolean).join(" ve ") || "Her işlem"}</td>
                        <td>{k.adimlar.map((a, i) => `${i + 1}. ${adimAdi(a)}`).join(" → ")}</td>
                        <td><Badge variant={k.aktif ? "success" : "neutral"}>{k.aktif ? "Etkin" : "Kapalı"}</Badge></td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                          <Button size="sm" onClick={() => duzenle(k)}>Düzenle</Button>{" "}
                          <Button size="sm" variant="danger" disabled={mesgul} onClick={() => { if (window.confirm(`"${k.ad}" kuralı silinecek. Açık talepler etkilenmez. Devam edilsin mi?`)) void calistir(() => api(`/onay-kurallari/${k.id}`, { method: "DELETE" }), "Kural silindi."); }}>Sil</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
        </Card>

        <Card title="Satın alma talebi onayı">
          <form className="row" style={{ gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); void calistir(() => api("/onay-kurallari/satin-alma-esigi", { method: "PUT", body: JSON.stringify({ tutar: Number(satinAlma.replace(",", ".") || 25000) }) }), "Satın alma eşiği kaydedildi."); }}>
            <div><Field label="Onay eşiği (TL)"><Input inputMode="decimal" value={satinAlma} onChange={(e) => setSatinAlma(e.target.value)} /></Field><p className="subtle" style={{ margin: "0.25rem 0 0", fontSize: "0.85em" }}>Bu tutara kadar olan talepleri muhasebe ya da yönetici, üstündekileri yalnız yönetici onaylar. Boşsa 25.000 TL.</p></div>
            <Button type="submit" disabled={mesgul}>Kaydet</Button>
          </form>
        </Card>

        {veri?.tekYonetici && (
          <Card title="Görev ayrılığı">
            <p className="subtle" style={{ marginTop: 0 }}>Firmanızda tek etkin yönetici olduğu için, onaycısı bulunamayan talepleri yöneticinin kendisinin onaylamasına izin verebilirsiniz. İkinci bir yönetici eklendiğinde bu ayar kendiliğinden geçersiz olur.</p>
            <label className="row" style={{ gap: "0.5rem" }}>
              <input type="checkbox" checked={veri.gorevAyriligiKapali} disabled={mesgul} onChange={(e) => void calistir(() => api("/onay-kurallari/gorev-ayriligi", { method: "PUT", body: JSON.stringify({ kapali: e.target.checked }) }), e.target.checked ? "Görev ayrılığı kapatıldı." : "Görev ayrılığı açıldı.")} />
              Yönetici kendi talebini onaylayabilsin (görev ayrılığını kapat)
            </label>
          </Card>
        )}
      </div>
    </div>
  );
}
