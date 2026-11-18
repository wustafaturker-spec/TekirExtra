"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ROLLER, type Rol } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { ROL_ADI } from "@/lib/rol-adlari";
import { Alert, Badge, Button, Card, Field, Input, Modal, ModalEylem, PageHeader, Select, Table, TableWrap } from "@/components/ui";

type Islem = "fatura_kesinlestir_satis" | "fatura_kesinlestir_alis" | "belge_onayla_satis" | "masraf_onayla" | "kasa_banka_odeme" | "fiyat_listesi_guncelle";
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
  fiyat_listesi_guncelle: { iskonto: false, risk: false },
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
  const [listeHatasi, setListeHatasi] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [silinecek, setSilinecek] = useState<Kural | null>(null);
  const [basari, setBasari] = useState("");
  const [mesgul, setMesgul] = useState(false);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setListeHatasi("");
    try {
      const [v, k] = await Promise.all([api<Yanit>("/onay-kurallari"), api<Kullanici[]>("/kullanicilar")]);
      setVeri(v); setKullanicilar(k.filter((x) => x.aktif)); setSatinAlma(v.satinAlmaEsigi == null ? "" : String(v.satinAlmaEsigi));
    } catch (e) {
      setListeHatasi(e instanceof Error ? e.message : "Kurallar alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);
  const islemHazir = Boolean(veri && !yukleniyor && !listeHatasi && !mesgul);

  const islemAdi = (i: Islem) => veri?.islemler.find((x) => x.islem === i)?.ad ?? i;
  const adimAdi = (a: Adim) => ("rol" in a ? `${ROL_ADI[a.rol] ?? a.rol} rolü` : kullanicilar.find((k) => k.id === a.kullaniciId)?.adSoyad ?? "Kullanıcı");

  async function calistir(fn: () => Promise<unknown>, mesaj: string) {
    if (!islemHazir) return false;
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

  async function sil(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!silinecek) return;
    const ok = await calistir(() => api(`/onay-kurallari/${silinecek.id}`, { method: "DELETE" }), "Kural silindi.");
    if (ok) {
      setForm((mevcut) => mevcut?.id === silinecek.id ? null : mevcut);
      setSilinecek(null);
    }
  }

  function silmeyiKapat() {
    if (mesgul) return;
    setSilinecek(null);
    setHata("");
  }

  const adimGuncelle = (i: number, deger: Partial<Form["adimlar"][number]>) => setForm((f) => f && { ...f, adimlar: f.adimlar.map((a, j) => (j === i ? { ...a, ...deger } : a)) });

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <PageHeader
        title="Onay Kuralları"
        subtitle="Kurala uyan işlem hemen yapılmaz; onaycının kutusuna düşer ve son adım onaylanınca talep edenin adına yapılır. Kural yoksa işlemler bugünkü gibi doğrudan yapılır."
        actions={<><Link className="btn btn--ghost" href="/panel/onaylar">Onay kutusu</Link>{!form && <Button variant="primary" disabled={!islemHazir} onClick={() => setForm(bosForm())}>Kural ekle</Button>}</>}
      />
      {!silinecek && <Alert tone="error">{hata}</Alert>}
      <Alert tone="success">{basari}</Alert>

      <div className="stack">
        {form && (
          <Card title={form.id ? "Kuralı düzenle" : "Yeni kural"}>
            <form className="stack" onSubmit={(e) => void kaydet(e)}>
              <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))" }}>
                <Field label="İşlem">
                  <Select value={form.islem} onChange={(e) => setForm({ ...form, islem: e.target.value as Islem })}>
                    {veri?.islemler.map((i) => <option key={i.islem} value={i.islem}>{i.ad}</option>)}
                  </Select>
                </Field>
                <Field label="Kural adı"><Input required minLength={2} maxLength={120} value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} placeholder="Örn. 100.000 TL üstü satış faturası" /></Field>
                <div><Field label="Tutar eşiği (TL karşılığı)"><Input inputMode="decimal" value={form.tutarEsigi} onChange={(e) => setForm({ ...form, tutarEsigi: e.target.value })} /></Field><p className="subtle" style={{ margin: "0.25rem 0 0", fontSize: "0.85em" }}>{form.islem === "fiyat_listesi_guncelle" ? "Önerilen birim fiyatların toplamının TL karşılığı esas alınır. " : ""}Bu tutar ve üstündeki işlemler onaya düşer. Boş bırakılırsa tutar koşulu yok.</p></div>
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
                <Button type="submit" variant="primary" disabled={!islemHazir}>{mesgul ? "Kaydediliyor…" : "Kaydet"}</Button>
              </div>
            </form>
          </Card>
        )}

        <Card title="Kurallar">
          {yukleniyor ? <p className="subtle" role="status">Kurallar yükleniyor…</p>
            : listeHatasi ? <Alert tone="error"><div className="stack">
              <span>{listeHatasi}</span>
              <div><Button size="sm" onClick={() => void yukle()}>Tekrar dene</Button></div>
            </div></Alert>
            : !veri ? null
            : veri.kurallar.length === 0 ? <p className="subtle" style={{ margin: 0 }}>Henüz onay kuralı yok; işlemler doğrudan yapılıyor.</p>
            : (
              <TableWrap className="platform-responsive-table">
                <Table>
                  <thead><tr><th>Kural</th><th>İşlem türü</th><th>Koşul</th><th>Onaycılar</th><th>Durum</th><th>İşlem</th></tr></thead>
                  <tbody>
                    {veri.kurallar.map((k) => (
                      <tr key={k.id}>
                        <td className="platform-cell-title"><strong>{k.ad}</strong></td>
                        <td data-label="İşlem türü">{islemAdi(k.islem)}</td>
                        <td data-label="Koşul">{[k.tutarEsigi && `≥ ${tl(k.tutarEsigi)}`, k.iskontoEsigi && `iskonto ≥ %${Number(k.iskontoEsigi)}`, k.riskAsimi && "risk aşımı"].filter(Boolean).join(" ve ") || "Her işlem"}</td>
                        <td data-label="Onaycılar">{k.adimlar.map((a, i) => `${i + 1}. ${adimAdi(a)}`).join(" → ")}</td>
                        <td data-label="Durum"><Badge variant={k.aktif ? "success" : "neutral"}>{k.aktif ? "Etkin" : "Kapalı"}</Badge></td>
                        <td data-label="İşlem">
                          <div className="platform-row-actions">
                            <Button size="sm" disabled={!islemHazir} onClick={() => duzenle(k)}>Düzenle</Button>
                            <Button size="sm" variant="danger" disabled={!islemHazir} onClick={() => { setHata(""); setSilinecek(k); }}>Sil</Button>
                          </div>
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
            <div><Field label="Onay eşiği (TL)"><Input inputMode="decimal" disabled={!islemHazir} value={satinAlma} onChange={(e) => setSatinAlma(e.target.value)} /></Field><p className="subtle" style={{ margin: "0.25rem 0 0", fontSize: "0.85em" }}>Bu tutara kadar olan talepleri muhasebe ya da yönetici, üstündekileri yalnız yönetici onaylar. Boşsa 25.000 TL.</p></div>
            <Button type="submit" disabled={!islemHazir}>Kaydet</Button>
          </form>
        </Card>

        {veri?.tekYonetici && (
          <Card title="Görev ayrılığı">
            <p className="subtle" style={{ marginTop: 0 }}>Firmanızda tek etkin yönetici olduğu için, onaycısı bulunamayan talepleri yöneticinin kendisinin onaylamasına izin verebilirsiniz. İkinci bir yönetici eklendiğinde bu ayar kendiliğinden geçersiz olur.</p>
            <label className="row" style={{ gap: "0.5rem" }}>
              <input type="checkbox" checked={veri.gorevAyriligiKapali} disabled={!islemHazir} onChange={(e) => void calistir(() => api("/onay-kurallari/gorev-ayriligi", { method: "PUT", body: JSON.stringify({ kapali: e.target.checked }) }), e.target.checked ? "Görev ayrılığı kapatıldı." : "Görev ayrılığı açıldı.")} />
              Yönetici kendi talebini onaylayabilsin (görev ayrılığını kapat)
            </label>
          </Card>
        )}
      </div>
      {silinecek && <Modal baslik="Kuralı sil" onKapat={silmeyiKapat}>
        <form className="stack" onSubmit={(e) => void sil(e)}>
          <Alert tone="error">{hata}</Alert>
          <p><strong>{silinecek.ad}</strong> kuralı silinecek. Açık talepler etkilenmez.</p>
          <ModalEylem onVazgec={silmeyiKapat} isleniyor={mesgul} metin="Kuralı sil" tehlikeli />
        </form>
      </Modal>}
    </div>
  );
}
