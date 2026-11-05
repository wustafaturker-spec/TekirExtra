"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PAKET_KOTA_KODLARI, PAKET_KOTA_TANIMLARI, PAKET_MODUL_KODLARI, PAKET_MODUL_ADLARI, type PaketModulKodu, type PaketKapsamSozlesmesi } from "@tekirextra/shared";
import { Alert, Button, Card, Field, Input, TableWrap } from "@/components/ui";
import { platformApi, PlatformApiHata } from "@/lib/platform-api";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { DepolamaKotaEditoru } from "@/components/platform-paket-kapsami";

interface Kosullar {
  planAdi: string; limitler: Record<string, number | null>; kapsamSozlesmesi?: PaketKapsamSozlesmesi;
  fiyatlandirma: { paraBirimi: "TRY"; vergiDahil: false; kdvOrani: string; donemler: { aySayisi: number; matrah: string }[] } | null;
}
interface Kayit { id: string; baslangic: string; bitis: string; onay_at: string | null; iptal_at: string | null; iptal_nedeni: string | null; veri: { neden: string; kapsamSozlesmesi?: unknown; fiyatlandirma?: unknown }; kaynak_kosullar: Kosullar; hedef_kosullar: Kosullar }
interface Uygunluk { id: string; kontrolAt: string; kosullarUygun: boolean; engeller: string[]; kullanim: Record<string, number>; hedefLimitler: Record<string, number | null>; standartLimitler: Record<string, number | null>; bitis: string; depolama?: { kayitliBayt: string; bekleyenBayt: string; hedefSinirBayt: string | null; standartSinirBayt: string | null } }
const ENGEL: Record<string, string> = { iptal_edildi: "Taslak iptal edilmiş.", suresi_doldu: "Taslağın süresi dolmuş.", kaynak_degisti: "Kaynak paket veya kayıtlı koşullar değişmiş; yeni taslak hazırlayın.", abonelik_uygun_degil: "Abonelik aktif veya deneme durumunda değil.", bekleyen_paket_atamasi: "Bekleyen bir paket ataması var." };
const zaman = (v: string) => new Date(v).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });

export function FirmaIstisnalari({ tenantId }: { tenantId: string }) {
  const [sayfa, setSayfa] = useState(1), [hata, setHata] = useState(""), [mesaj, setMesaj] = useState("");
  const [iptalId, setIptalId] = useState<string | null>(null), [neden, setNeden] = useState(""), [mesgul, setMesgul] = useState(false);
  const [uygunluk, setUygunluk] = useState<Uygunluk | null>(null);
  const [onayId, setOnayId] = useState<string | null>(null);
  const kilit = useRef(false);
  const kaynak = usePlatformVerisi<{ paketSurumId: string; kosullar: Kosullar }>(`/platform/firma-istisnalari/${tenantId}/kaynak`);
  const [sonKaynak, setSonKaynak] = useState<{ tenantId: string; veri: { paketSurumId: string; kosullar: Kosullar } } | null>(null);
  useEffect(() => { if (kaynak.veri) setSonKaynak({ tenantId, veri: kaynak.veri }); }, [tenantId, kaynak.veri]);
  const kaynakVerisi = kaynak.veri ?? (sonKaynak?.tenantId === tenantId ? sonKaynak.veri : null);
  const liste = usePlatformVerisi<{ kayitlar: Kayit[]; toplam: number }>(`/platform/firma-istisnalari/${tenantId}?sayfa=${sayfa}`);
  async function fiyatOnayla(id: string) {
    if (kilit.current) return;
    kilit.current = true; setMesgul(true); setHata("");
    try {
      await platformApi(`/platform/firma-istisnalari/${tenantId}/${id}/onayla`, { method: "POST" });
      setOnayId(null); setMesaj("Özel koşullar onaylandı. Belirtilen süre içinde fiyat, modül ve kota kontrollerinde kullanılır."); liste.yenile();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Onay tamamlanamadı.");
      if (e instanceof PlatformApiHata && [403, 404, 409].includes(e.durum)) {
        setOnayId(null); setUygunluk(null); kaynak.yenile(); liste.yenile();
      }
    }
    finally { kilit.current = false; setMesgul(false); }
  }
  async function kontrolEt(id: string) {
    if (kilit.current) return;
    kilit.current = true; setMesgul(true); setHata(""); setUygunluk(null);
    try { setUygunluk(await platformApi<Uygunluk>(`/platform/firma-istisnalari/${tenantId}/${id}/uygunluk`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Uygunluk kontrol edilemedi."); }
    finally { kilit.current = false; setMesgul(false); }
  }
  async function iptal(e: FormEvent) {
    e.preventDefault(); if (kilit.current || !iptalId) return;
    kilit.current = true; setMesgul(true); setHata("");
    try {
      await platformApi(`/platform/firma-istisnalari/${tenantId}/${iptalId}/iptal`, { method: "POST", body: JSON.stringify({ neden }) });
      setIptalId(null); setNeden(""); setUygunluk(null); setMesaj("Özel koşullar iptal edildi. Standart koşullar yeniden geçerlidir."); liste.yenile();
    } catch (e) { setHata(e instanceof Error ? e.message : "İptal tamamlanamadı."); }
    finally { kilit.current = false; setMesgul(false); }
  }
  return <Card id="firma-istisnalari" title="Firmaya özel koşul taslakları">
    <p>Onaylanan koşullar belirtilen süre içinde uygulanır; süre bitince standart fiyat, modüller ve kotalar geri gelir. Mevcut kayıtlar korunur; standart kotanın üzerindeki kullanımda yeni kayıt açılması engellenir.</p>
    <Button onClick={kaynak.yenile}>Kayıtlı koşulları yenile</Button>
    <Alert tone="success">{mesaj}</Alert><Alert tone="error">{hata}</Alert>
    {kaynak.hata && kaynakVerisi && <Alert tone="error">{kaynak.hata} <Button onClick={kaynak.yenile}>Tekrar dene</Button></Alert>}
    {kaynak.yukleniyor && !kaynakVerisi ? <p role="status">Kayıtlı koşullar yükleniyor…</p> : kaynak.hata && !kaynakVerisi ? <Alert tone="error">{kaynak.hata} <Button onClick={kaynak.yenile}>Tekrar dene</Button></Alert> : kaynakVerisi &&
      <IstisnaFormu key={kaynakVerisi.paketSurumId} tenantId={tenantId} kaynak={kaynakVerisi} onKayit={() => { setMesaj("Özel koşullar taslak olarak kaydedildi; abonelik değişmedi."); setSayfa(1); liste.yenile(); }} />}
    <h3>Hazırlık geçmişi</h3>
    {liste.hata && <Alert tone="error">{liste.hata} <Button onClick={liste.yenile}>Geçmişi yeniden yükle</Button></Alert>}
    {liste.yukleniyor && <p role="status">Geçmiş yükleniyor…</p>}
    {!liste.yukleniyor && liste.veri?.kayitlar.length === 0 && <p>Bu sayfada istisna taslağı yok.</p>}
    {liste.veri?.kayitlar.map((r) => <section key={r.id} className="stack">
      <h4>{r.iptal_at ? "İptal edilmiş koşullar" : r.onay_at ? "Onaylı özel koşullar" : "Taslak"} · {zaman(r.baslangic)} – {zaman(r.bitis)}</h4>
      <p>{r.veri.neden}</p><KosulKarsilastirma once={r.kaynak_kosullar} sonra={r.hedef_kosullar} />
      {!r.iptal_at && !r.onay_at ? <Button disabled={mesgul} onClick={() => setOnayId(r.id)}>Özel koşul onayını aç</Button> : null}
      {onayId === r.id && <section aria-label="Özel koşul onayı"><p>Yukarıdaki fiyat, modül ve kota koşulları belirtilen tarihler arasında uygulanacak. Başlamış ödemeler kendi fiyatlarını korur. Süre bitince standart koşullar geri gelir. Onaylı koşulları iptal etmeden paket değiştirilemez.</p><Button disabled={mesgul} onClick={() => void fiyatOnayla(r.id)}>Özel koşulları onayla</Button><Button disabled={mesgul} onClick={() => setOnayId(null)}>Vazgeç</Button></section>}
      <Button disabled={mesgul} onClick={() => void kontrolEt(r.id)}>Güncel uygunluğu kontrol et</Button>
      {uygunluk?.id === r.id && <section aria-label="İstisna uygunluk sonucu" className="stack">
        <p>Kontrol: {zaman(uygunluk.kontrolAt)}. {uygunluk.kosullarUygun ? "Kaynak koşullar, tarih ve mevcut kullanım uygun." : "Uygulamayı engelleyen koşullar var."} Bu kontrol taslağı etkinleştirmez.</p>
        {uygunluk.engeller.length > 0 && <ul>{uygunluk.engeller.map((e) => <li key={e}>{e.startsWith("kota_asimi:") ? `${PAKET_KOTA_TANIMLARI[e.split(":")[1] as keyof typeof PAKET_KOTA_TANIMLARI]?.ad ?? "Kota"}: kullanım hedef sınırı aşıyor.` : ENGEL[e] ?? "Koşullar yeniden incelenmeli."}</li>)}</ul>}
        <TableWrap><thead><tr><th>Kota</th><th>Güncel kullanım</th><th>Özel sınır</th><th>Süre sonunda standart sınır</th><th>Bugünkü kullanımla dönüş</th></tr></thead><tbody>{PAKET_KOTA_KODLARI.map((kod) => {
          const standart = uygunluk.standartLimitler[kod];
          const asim = standart != null && uygunluk.kullanim[kod] > standart;
          return <tr key={kod}><td>{PAKET_KOTA_TANIMLARI[kod].ad}</td><td>{uygunluk.kullanim[kod]}</td><td>{uygunluk.hedefLimitler[kod] ?? "Sınırsız"}</td><td>{standart ?? "Sınırsız"}</td><td>{asim ? `${uygunluk.kullanim[kod] - standart!} sınır aşımı` : "Sınır içinde"}</td></tr>;
        })}</tbody></TableWrap>
        <p>Özel koşulların bitişi: {zaman(uygunluk.bitis)}. Bu karşılaştırma bugünkü kullanıma dayanır; süre içinde kullanım artabilir. Süre sonundaki gerçek kullanım dönüş anında yeniden kontrol edilmelidir.</p>
        {uygunluk.depolama && <p>Depolama: {uygunluk.depolama.kayitliBayt} kayıtlı + {uygunluk.depolama.bekleyenBayt} ayrılmış bayt. Özel sınır: {uygunluk.depolama.hedefSinirBayt ?? "Sınırsız"}; standart sınır: {uygunluk.depolama.standartSinirBayt ?? "Sınırsız"}. {uygunluk.engeller.includes("depolama_asimi") && "Dosyalar ve açık rezervasyonlar özel depolama sınırını aşıyor."}</p>}
      </section>}
      {r.iptal_at ? <p>İptal: {zaman(r.iptal_at)} · {r.iptal_nedeni}</p> : <Button disabled={mesgul} onClick={() => { setIptalId(r.id); setNeden(""); }}>{r.onay_at ? "Özel koşulları iptal et" : "Taslağı iptal et"}</Button>}
      {iptalId === r.id && <form onSubmit={(e) => void iptal(e)} className="stack"><Field label="İptal gerekçesi"><Input required minLength={5} maxLength={1000} value={neden} disabled={mesgul} onChange={(e) => setNeden(e.target.value)} /></Field><div><Button type="submit" disabled={mesgul || neden.trim().length < 5}>İptali onayla</Button><Button type="button" disabled={mesgul} onClick={() => setIptalId(null)}>Vazgeç</Button></div></form>}
    </section>)}
    {liste.veri && <div className="platform-pagination"><span>{liste.veri.toplam} taslak · Sayfa {sayfa}</span><Button disabled={sayfa === 1 || mesgul} onClick={() => setSayfa(sayfa - 1)}>Önceki</Button><Button disabled={sayfa * 25 >= liste.veri.toplam || mesgul} onClick={() => setSayfa(sayfa + 1)}>Sonraki</Button></div>}
  </Card>;
}

function IstisnaFormu({ tenantId, kaynak, onKayit }: { tenantId: string; kaynak: { paketSurumId: string; kosullar: Kosullar }; onKayit: () => void }) {
  const [mesgul, setMesgul] = useState(false), [hata, setHata] = useState("");
  const [fiyat, setFiyat] = useState(false), [kota, setKota] = useState(false);
  const [moduller, setModuller] = useState<PaketModulKodu[]>(kaynak.kosullar.kapsamSozlesmesi?.moduller ?? [...PAKET_MODUL_KODLARI]);
  const [depolama, setDepolama] = useState(kaynak.kosullar.kapsamSozlesmesi?.depolama);
  const kilit = useRef(false);
  async function kaydet(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (kilit.current) return;
    const form = e.currentTarget, f = new FormData(form); kilit.current = true; setMesgul(true); setHata("");
    try {
      const k = kaynak.kosullar, kapsam = k.kapsamSozlesmesi;
      await platformApi("/platform/firma-istisnalari/taslak", { method: "POST", body: JSON.stringify({ tenantId, paketSurumId: kaynak.paketSurumId,
        neden: f.get("neden"), baslangic: new Date(String(f.get("baslangic"))).toISOString(), bitis: new Date(String(f.get("bitis"))).toISOString(),
        ...(fiyat && k.fiyatlandirma ? { fiyatlandirma: { ...k.fiyatlandirma, donemler: k.fiyatlandirma.donemler.map((d) => ({ aySayisi: d.aySayisi, matrah: String(f.get(`fiyat-${d.aySayisi}`)) })) } } : {}),
        ...(kota ? { kapsamSozlesmesi: { semaSurumu: 1, moduller, ...(depolama ? { depolama } : {}), kotalar: Object.fromEntries(PAKET_KOTA_KODLARI.map((kod) => [kod, { sinir: String(f.get(kod)).trim() === "" ? null : Number(f.get(kod)), uyariYuzdesi: kapsam?.kotalar[kod].uyariYuzdesi ?? 80 }])) } } : {}),
      }) });
      form.reset(); setFiyat(false); setKota(false); setModuller(kaynak.kosullar.kapsamSozlesmesi?.moduller ?? [...PAKET_MODUL_KODLARI]); setDepolama(kaynak.kosullar.kapsamSozlesmesi?.depolama); onKayit();
    } catch (e) { setHata(e instanceof Error ? e.message : "Taslak kaydedilemedi."); }
    finally { kilit.current = false; setMesgul(false); }
  }
  return <form onSubmit={(e) => void kaydet(e)} className="stack"><h3>Yeni taslak · {kaynak.kosullar.planAdi}</h3>
    <Alert tone="error">{hata}</Alert><fieldset disabled={mesgul} className="stack">
      <Field label="Başlangıç (bu cihazın yerel saati)"><Input name="baslangic" type="datetime-local" required /></Field>
      <Field label="Bitiş (bu cihazın yerel saati)"><Input name="bitis" type="datetime-local" required /></Field>
      <label><input type="checkbox" checked={fiyat} disabled={!kaynak.kosullar.fiyatlandirma} onChange={(e) => setFiyat(e.target.checked)} /> Özel dönem fiyatı hazırla</label>
      {fiyat && kaynak.kosullar.fiyatlandirma?.donemler.map((d) => <Field key={d.aySayisi} label={`${d.aySayisi} ay · TRY, KDV hariç`}><Input name={`fiyat-${d.aySayisi}`} type="number" min="0" step="0.01" required defaultValue={d.matrah} /></Field>)}
      <label><input type="checkbox" checked={kota} onChange={(e) => setKota(e.target.checked)} /> Özel modül ve kullanım kotaları hazırla</label>
      {kota && <><fieldset><legend>Modüller</legend>{PAKET_MODUL_KODLARI.map((kod) => <label key={kod}><input type="checkbox" checked={moduller.includes(kod)} onChange={(e) => setModuller((v) => e.target.checked ? [...v, kod] : v.filter((m) => m !== kod))} /> {PAKET_MODUL_ADLARI[kod]}</label>)}</fieldset><p>Boş bırakılan kota sınırsızdır. Uyarı eşikleri mevcut koşullardan alınır.</p>{PAKET_KOTA_KODLARI.map((kod) => <Field key={kod} label={PAKET_KOTA_TANIMLARI[kod].ad}><Input name={kod} type="number" min="0" max="2147483647" step="1" defaultValue={kaynak.kosullar.limitler[kod] ?? ""} /></Field>)}</>}
      <Field label="Gerekçe"><Input name="neden" minLength={5} maxLength={1000} required /></Field>
      {kota && <DepolamaKotaEditoru deger={depolama} onDegis={setDepolama} />}
      <Button type="submit" disabled={mesgul || (!fiyat && !kota)}>{mesgul ? "Kaydediliyor…" : "Koşulları taslak olarak kaydet"}</Button>
    </fieldset>
  </form>;
}

function KosulKarsilastirma({ once, sonra }: { once: Kosullar; sonra: Kosullar }) {
  return <TableWrap><thead><tr><th>Koşul</th><th>Mevcut</th><th>Önerilen</th></tr></thead><tbody>
    <tr><td>Depolama (bayt)</td><td>{once.kapsamSozlesmesi?.depolama?.sinirBayt ?? "Sınırsız"}</td><td>{sonra.kapsamSozlesmesi?.depolama?.sinirBayt ?? "Sınırsız"}</td></tr>
    <tr><td>Modüller</td><td>{(once.kapsamSozlesmesi?.moduller ?? [...PAKET_MODUL_KODLARI]).map((m) => PAKET_MODUL_ADLARI[m]).join(", ")}</td><td>{(sonra.kapsamSozlesmesi?.moduller ?? [...PAKET_MODUL_KODLARI]).map((m) => PAKET_MODUL_ADLARI[m]).join(", ")}</td></tr>
    {PAKET_KOTA_KODLARI.map((kod) => <tr key={kod}><td>{PAKET_KOTA_TANIMLARI[kod].ad}</td><td>{once.limitler[kod] ?? "Sınırsız"}</td><td>{sonra.limitler[kod] ?? "Sınırsız"}</td></tr>)}
    {sonra.fiyatlandirma?.donemler.map((d) => <tr key={`fiyat-${d.aySayisi}`}><td>{d.aySayisi} ay · TRY, KDV hariç</td><td>{once.fiyatlandirma?.donemler.find((v) => v.aySayisi === d.aySayisi)?.matrah ?? "Fiyat yok"}</td><td>{d.matrah}</td></tr>)}
  </tbody></TableWrap>;
}
