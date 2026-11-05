"use client";
import { useId, useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";
import { type PaketIcerigi } from "@/lib/platform-paketler";
import { paketKapsamSemasi } from "@tekirextra/shared";
import { bosPaketKapsami, PlatformPaketKapsamEditoru } from "./platform-paket-kapsami";

export function PlatformPaketFormu({ ilk, kodGerekli = false, mesgul, onKaydet, onVazgec }: {
  ilk: PaketIcerigi; kodGerekli?: boolean; mesgul: boolean;
  onKaydet: (g: PaketIcerigi & { kod: string }) => Promise<void>; onVazgec: () => void;
}) {
  const kimlik = useId();
  const [ad, setAd] = useState(ilk.ad), [kod, setKod] = useState("");
  const [aciklama, setAciklama] = useState(ilk.aciklama), [ozellikler, setOzellikler] = useState(ilk.ozellikler.join("\n"));
  const [siralama, setSiralama] = useState(String(ilk.siralama));
  const [denemeGunSayisi, setDenemeGunSayisi] = useState(String(ilk.denemeGunSayisi ?? 0));
  const [fiyatVar, setFiyatVar] = useState(!!ilk.fiyatlandirma);
  const [kdvOrani, setKdvOrani] = useState(ilk.fiyatlandirma?.kdvOrani ?? "20");
  const [gecerlilikTarihi, setGecerlilikTarihi] = useState(ilk.fiyatlandirma?.gecerlilikTarihi ?? "");
  const sureler = [1, 3, 6, 12] as const;
  const [bedeller, setBedeller] = useState<Record<number, string>>(() => Object.fromEntries(sureler.map((ay) => [ay, ilk.fiyatlandirma?.donemler.find((d) => d.aySayisi === ay)?.matrah ?? ""])));
  const [fiyatHatasi, setFiyatHatasi] = useState("");
  const [kapsamVar, setKapsamVar] = useState(!!ilk.kapsamSozlesmesi), [kapsam, setKapsam] = useState(() => ilk.kapsamSozlesmesi ?? bosPaketKapsami());
  const [kapsamHatasi, setKapsamHatasi] = useState("");
  function gonder(e: FormEvent) {
    e.preventDefault();
    if (mesgul) return;
    setFiyatHatasi("");
    setKapsamHatasi("");
    const sonuc = kapsamVar ? paketKapsamSemasi.safeParse(kapsam) : null;
    if (sonuc && !sonuc.success) { setKapsamHatasi(sonuc.error.issues.map((i) => i.message).join("; ")); return; }
    const donemler = sureler.filter((ay) => bedeller[ay].trim() !== "").map((aySayisi) => ({ aySayisi, matrah: bedeller[aySayisi].trim().replace(",", ".") }));
    if (fiyatVar && !donemler.length) { setFiyatHatasi("En az bir dönem bedeli girin."); return; }
    void onKaydet({ kod: kod.trim(), ad: ad.trim(), aciklama: aciklama.trim(), ozellikler: ozellikler.split("\n").map((v) => v.trim()).filter(Boolean), siralama: Number(siralama),
      kapsamSozlesmesi: sonuc?.success ? sonuc.data : null, denemeGunSayisi: Number(denemeGunSayisi),
      fiyatlandirma: fiyatVar ? { paraBirimi: "TRY", vergiDahil: false, kdvOrani: kdvOrani.trim().replace(",", "."), gecerlilikTarihi, donemler } : null });
  }
  return <form className="stack" onSubmit={gonder}>
    {kodGerekli && <Field label="Paket kodu" htmlFor={`${kimlik}-kod`}><Input id={`${kimlik}-kod`} required maxLength={40} minLength={2} pattern="[a-z][a-z0-9_]{1,39}" value={kod} onChange={(e) => setKod(e.target.value)} disabled={mesgul} autoComplete="off" /><small>Küçük harf, rakam ve alt çizgi; kayıttan sonra değişmez. v1 eski Profesyonel kodu olarak ayrılmıştır.</small></Field>}
    <Field label="Paket adı"><Input required maxLength={100} value={ad} onChange={(e) => setAd(e.target.value)} disabled={mesgul} /></Field>
    <Field label="Paket açıklaması" htmlFor={`${kimlik}-aciklama`}><textarea id={`${kimlik}-aciklama`} className="input" rows={3} maxLength={2000} value={aciklama} onChange={(e) => setAciklama(e.target.value)} disabled={mesgul} /></Field>
    <Field label="Paket özellikleri" htmlFor={`${kimlik}-ozellikler`}><textarea id={`${kimlik}-ozellikler`} className="input" rows={5} maxLength={6030} value={ozellikler} onChange={(e) => setOzellikler(e.target.value)} disabled={mesgul} /><small>Her satıra bir özellik; en çok 30 satır, her biri 200 karakter. Yayın için en az bir özellik gerekir.</small></Field>
    <Field label="Katalog sırası"><Input required type="number" min={0} max={10000} step={1} value={siralama} onChange={(e) => setSiralama(e.target.value)} disabled={mesgul} /></Field>
    <Field label="Yeni firma deneme süresi (gün)" htmlFor={`${kimlik}-deneme`}><Input id={`${kimlik}-deneme`} required type="number" min={0} max={365} step={1} value={denemeGunSayisi} onChange={(e) => setDenemeGunSayisi(e.target.value)} disabled={mesgul} /><small>0 deneme sunmaz; en çok 365 gün. Yayımlanmış sürüm değişmez, ayar yalnız yeni kayıtları etkiler.</small></Field>
    <fieldset className="stack" disabled={mesgul}><legend>Sürüm fiyatları</legend>
      <label><input type="checkbox" checked={fiyatVar} onChange={(e) => setFiyatVar(e.target.checked)} /> Bu sürüm için fiyat tanımla</label>
      <p className="subtle">Bedeller TRY ve KDV hariç dönem toplamıdır. Boş bırakılan dönem için fiyat tanımlanmaz. Geçerlilik tarihi fiyatı otomatik uygulamaz; mevcut abonelerin koşulları korunur.</p>
      {fiyatVar && <>
        <Field label="Fiyat geçerlilik tarihi"><Input required type="date" value={gecerlilikTarihi} onChange={(e) => setGecerlilikTarihi(e.target.value)} /></Field>
        <Field label="KDV oranı (%)" htmlFor={`${kimlik}-kdv`}><Input id={`${kimlik}-kdv`} required inputMode="decimal" pattern="(0|[1-9][0-9]{0,2})([.,][0-9]{1,2})?" value={kdvOrani} onChange={(e) => setKdvOrani(e.target.value)} /><small>0–100 arasında, en fazla iki ondalık.</small></Field>
        {sureler.map((ay) => <Field key={ay} label={`${ay} aylık dönem bedeli (TRY, KDV hariç)`}><Input inputMode="decimal" pattern="(0|[1-9][0-9]{0,11})([.,][0-9]{1,2})?" value={bedeller[ay]} onChange={(e) => setBedeller((once) => ({ ...once, [ay]: e.target.value }))} /></Field>)}
      </>}
      {fiyatHatasi && <p role="alert">{fiyatHatasi}</p>}
    </fieldset>
    <PlatformPaketKapsamEditoru etkin={kapsamVar} onEtkin={setKapsamVar} deger={kapsam} onDegis={setKapsam} mesgul={mesgul} hata={kapsamHatasi} />
    <div className="platform-row-actions"><Button type="submit" disabled={mesgul}>{mesgul ? "Kaydediliyor…" : "Taslağı kaydet"}</Button><Button type="button" disabled={mesgul} onClick={onVazgec}>Düzenlemeyi kapat</Button></div>
  </form>;
}
