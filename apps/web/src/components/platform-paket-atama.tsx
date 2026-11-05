"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { bugunTR, PAKET_KOTA_KODLARI, PAKET_KOTA_TANIMLARI, PAKET_MODUL_ADLARI, type PaketModulKodu } from "@tekirextra/shared";
import { Alert, Button, Card, Field, Input, Select, TableWrap } from "@/components/ui";
import { platformApi, PlatformApiHata } from "@/lib/platform-api";
import type { PaketAtamaOnizlemesi, PaketFiyatEtkiRaporu } from "@/lib/platform-paketler";

const bedel = (t: { matrah: string; kdv: string; toplam: string } | null) => t
  ? `${t.toplam.replace(".", ",")} TRY (matrah ${t.matrah.replace(".", ",")}, KDV ${t.kdv.replace(".", ",")})` : "Fiyat yok";

export function PlatformPaketAtama({ rapor, onUygulandi }: { rapor: PaketFiyatEtkiRaporu; onUygulandi: (mesaj: string) => void }) {
  const kimlik = useId(), kilit = useRef(false);
  const kapsam = Boolean(rapor.hedefKapsamVar);
  const [secili, setSecili] = useState<string[]>([]), [neden, setNeden] = useState("");
  const [tarih, setTarih] = useState(bugunTR), [tur, setTur] = useState<"bugun" | "tarih" | "donem_sonu">("bugun");
  const [onizleme, setOnizleme] = useState<PaketAtamaOnizlemesi | null>(null);
  const [mesgul, setMesgul] = useState(false), [hata, setHata] = useState("");
  async function islem(uygula: boolean) {
    if (kilit.current) return;
    kilit.current = true; setMesgul(true); setHata("");
    try {
      if (uygula && onizleme) {
        const r = await platformApi<{ tekrar: boolean; firmaAdedi: number; durum?: string }>("/platform/paketler/atama-uygula", { method: "POST", body: JSON.stringify({ onizlemeId: onizleme.id }) });
        setOnizleme(null); setSecili([]);
        onUygulandi(r.durum === "planlandi" ? `${r.firmaAdedi} firma için ${kapsam ? "kapsam" : "fiyat"} geçişi planlandı. Zamanı geldiğinde koşullar yeniden doğrulanacak.`
          : kapsam ? `${r.firmaAdedi} firmanın kapsam sürümü ${r.tekrar ? "daha önce uygulanmıştı" : "uygulandı"}. Modül ve kota koşulları güncellendi; mevcut dönem korundu.`
          : `${r.firmaAdedi} firmanın fiyat sürümü ${r.tekrar ? "daha önce uygulanmıştı" : "uygulandı"}. Mevcut dönem tarihleri ve kotalar korundu.`);
      } else if (!uygula) {
        const r = await platformApi<PaketAtamaOnizlemesi>("/platform/paketler/atama-onizle", { method: "POST", body: JSON.stringify({ surumId: rapor.hedefSurumId, tenantIds: secili,
          uygulamaTuru: tur, uygulamaTarihi: tur === "donem_sonu" ? null : tur === "bugun" ? bugunTR() : tarih, neden,
          ...(kapsam ? { atamaKapsami: "kapsam" } : {}) }) });
        setOnizleme(r);
      }
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Atama işlemi tamamlanamadı.");
      // Ağ hatasında aynı onay kimliği korunur; yeniden deneme ikinci atama oluşturmaz.
      if (e instanceof PlatformApiHata && [403, 404, 409].includes(e.durum)) setOnizleme(null);
    } finally { kilit.current = false; setMesgul(false); }
  }
  function hazirla(e: FormEvent) { e.preventDefault(); void islem(false); }
  return <Card title={kapsam ? "Seçili firmalara kapsam sürümü ata" : "Seçili firmalara fiyat sürümü ata"}>
    <p>Atama uygulandıktan sonra yeni ödeme girişimleri ve yenilemeler hedef fiyatları kullanır. Başlamış ödemeler kendi kayıtlı fiyatlarıyla devam eder. Mevcut dönem tarihi korunur; paket kodu ve kayıtlı koşullar hedef sürüme geçer. Bu işlem ara dönem ücret farkı oluşturmaz. {kapsam ? "Modül erişimleri ve kullanım kotaları da değişir. Kullanımın altındaki hedef limit onaylanamaz." : "Mevcut kotalar korunur."}</p>
    <Alert tone="error">{hata}</Alert>
    {!onizleme ? <form onSubmit={hazirla} className="stack">
      <fieldset className="stack" disabled={mesgul}><legend>Bu sayfadan firma seçin · {secili.length} / 25</legend>
        {rapor.kayitlar.map((r) => {
          const paketGecisineUygun = kapsam && r.kaynakSurumId !== null;
          const secilebilir = r.karsilastirilabilir || paketGecisineUygun;
          return <label key={r.tenantId}><input type="checkbox" checked={secili.includes(r.tenantId)} disabled={!secilebilir || r.kaynakSurumId === rapor.hedefSurumId}
            onChange={(e) => setSecili((s) => e.target.checked ? [...s, r.tenantId] : s.filter((id) => id !== r.tenantId))} /> {r.unvan}{!secilebilir ? " · Kayıtlı abonelik koşulu yok" : !r.karsilastirilabilir ? " · Farklı paket; önizlemede fiyatlar ayrı gösterilir" : r.kaynakSurumId === rapor.hedefSurumId ? " · Zaten hedef sürümde" : ""}</label>;
        })}
      </fieldset>
      <Field label="Uygulama zamanı"><Select disabled={mesgul} value={tur} onChange={(e) => setTur(e.target.value as typeof tur)}><option value="bugun">Bugün</option><option value="tarih">İleri tarih</option><option value="donem_sonu">Firmanın dönem sonunda</option></Select></Field>
      {tur !== "donem_sonu" ? <Field label="Uygulama tarihi (Türkiye)" htmlFor={`${kimlik}-tarih`}><Input id={`${kimlik}-tarih`} required disabled={mesgul} type="date" value={tur === "bugun" ? bugunTR() : tarih} readOnly={tur === "bugun"} onChange={(e) => setTarih(e.target.value)} /><small>İleri tarih Türkiye saatiyle 00.00'da başlar; en çok 366 gün sonrası seçilebilir.</small></Field>
        : <p>Dönem sonunda uygulama için tek firma seçin. Kesin zaman aboneliğin mevcut dönem sonundan alınır.</p>}
      {tur !== "bugun" && <p className="subtle">Planlı geçişe denk gelen erken otomatik tahsilat bekletilir. Uygulama zamanında kaynak veya yetki değişmişse plan inceleme bekler; yönetici çözene kadar yeni ödeme başlatılmaz. Firma başına tek bekleyen plan olabilir.</p>}
      <Field label="Atama nedeni" htmlFor={`${kimlik}-neden`}><textarea id={`${kimlik}-neden`} className="input" required minLength={5} maxLength={1000} value={neden} disabled={mesgul} onChange={(e) => setNeden(e.target.value)} /></Field>
      <Button type="submit" disabled={mesgul || !secili.length || neden.trim().length < 5 || tur === "donem_sonu" && secili.length !== 1}>Atama önizlemesini hazırla</Button>
    </form> : <section aria-label="Atama onayı" className="stack">
      <h3>{onizleme.hedefPaketAdi} · Sürüm {onizleme.hedefSurumNo}</h3>
      <p>{onizleme.kayitlar.length} firma · Uygulama tarihi: {onizleme.uygulamaTarihi} · Onay sonu: {new Date(onizleme.sonOnayAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</p>
      {onizleme.uygulanacakAt && <p>Planlanan uygulama zamanı (Türkiye): {new Date(onizleme.uygulanacakAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}. Bu zamandan sonra koşullar doğrulanarak uygulanır. Bu onay işlemi planı kaydeder; abonelik koşulları uygulama zamanına kadar korunur.</p>}
      <p>Neden: {onizleme.neden}</p>
      <TableWrap><thead><tr><th>Firma / dönem</th><th>Kayıtlı bedel</th><th>Hedef bedel</th><th>Dönem bedeli farkı</th></tr></thead><tbody>
        {onizleme.kayitlar.flatMap((r) => r.donemler.map((d) => <tr key={`${r.tenantId}:${d.aySayisi}`}><td>{r.unvan} · {d.aySayisi} ay</td><td>{bedel(d.once)}</td><td>{bedel(d.sonra)}</td><td>{bedel(d.fark)}</td></tr>))}
      </tbody></TableWrap>
      {onizleme.atamaKapsami === "kapsam" && onizleme.kayitlar.map((r) => <section key={r.tenantId} aria-label={`${r.unvan} kapsam etkisi`}>
        <h4>{r.unvan} · Modül ve kota etkisi</h4>
        <p>Kapanacak modüller: {(r.kapananModuller ?? []).map((m) => PAKET_MODUL_ADLARI[m as PaketModulKodu] ?? m).join(", ") || "Yok"}. Açılacak modüller: {(r.acilanModuller ?? []).map((m) => PAKET_MODUL_ADLARI[m as PaketModulKodu] ?? m).join(", ") || "Yok"}.</p>
        <p>Hesap ve abonelik ayarları korunur; modül seçimi kullanıcının rol yetkisini genişletmez.</p>
        <p>Depolama sınırı: {r.oncekiDepolama?.sinirBayt == null ? "Sınırsız" : `${r.oncekiDepolama.sinirBayt} bayt`} → {r.sonrakiDepolama?.sinirBayt == null ? "Sınırsız" : `${r.sonrakiDepolama.sinirBayt} bayt`}. Hedef uyarı eşiği: %{r.sonrakiDepolama?.uyariYuzdesi ?? 80}. Dosyalar ve açık rezervasyonlar onay anında tekrar sayılır.</p>
        <TableWrap><thead><tr><th>Kota</th><th>Mevcut kullanım</th><th>Eski limit</th><th>Hedef limit</th></tr></thead><tbody>{PAKET_KOTA_KODLARI.map((kod) => <tr key={kod}><td>{PAKET_KOTA_TANIMLARI[kod].ad}</td><td>{r.kullanim?.[kod] ?? "Bilinmiyor"}</td><td>{r.oncekiLimitler[kod] ?? "Sınırsız"}</td><td>{r.sonrakiLimitler[kod] ?? "Sınırsız"}</td></tr>)}</tbody></TableWrap>
      </section>)}
      <p>Onay anında abonelik, yönetici yetkisi ve hedef sürüm tekrar kontrol edilir. Seçili firmaların tamamı tek işlemde uygulanır.</p>
      <div className="platform-row-actions"><Button disabled={mesgul} onClick={() => void islem(true)}>{onizleme.atamaKapsami === "kapsam" ? "Modül, kota ve fiyat atamasını onayla" : "Seçili firmalara atamayı onayla"}</Button><Button disabled={mesgul} onClick={() => { setOnizleme(null); setHata(""); }}>Vazgeç</Button></div>
    </section>}
  </Card>;
}
