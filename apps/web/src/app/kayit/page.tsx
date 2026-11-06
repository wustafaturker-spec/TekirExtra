"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert, Button, Field, Input } from "@/components/ui";
import { ILLER, ilBul, tekVergiDairesi, vergiDaireleriniSirala } from "@tekirextra/shared";

export default function KayitSayfasi() {
  const [hata, setHata] = useState("");
  const [mesaj, setMesaj] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [paketler, setPaketler] = useState<{ surumId: string; planKodu: string; paketAdi: string; denemeGunSayisi: number; kosullar: { fiyatlandirma?: { paraBirimi: string; donemler: { aySayisi: number; matrah: string }[] } | null } }[]>([]);
  const [paketSurumId, setPaketSurumId] = useState("");
  const [kisiTuru, setKisiTuru] = useState<"gercek" | "tuzel">("tuzel");
  const [paketlerYuklendi, setPaketlerYuklendi] = useState(false);
  const [vergiDaireleri, setVergiDaireleri] = useState<{ kod: string; ilKodu: string; il: string; ilce: string; ad: string }[]>([]);
  const [seciliIlKodu, setSeciliIlKodu] = useState("");
  const [seciliIlce, setSeciliIlce] = useState("");
  const [vergiDairesiKodu, setVergiDairesiKodu] = useState("");

  useEffect(() => {
    void api<typeof paketler>("/tenant/kayit/paketler").then((sonuc) => {
      setPaketler(sonuc);
      if (sonuc.length === 1) setPaketSurumId(sonuc[0].surumId);
    }).catch(() => setPaketler([])).finally(() => setPaketlerYuklendi(true));
  }, []);

  useEffect(() => { void api<typeof vergiDaireleri>("/vergi-daireleri").then(setVergiDaireleri).catch(() => setVergiDaireleri([])); }, []);
  // İlçe resmi listeden gelir; GİB büyükşehir dairelerini "Merkez" altında verdiği
  // için daire ilçeye göre değil il içinden seçilir, ilçeye yakın olanlar öne alınır.
  const iller = ILLER;
  const ilceler = ilBul(seciliIlKodu)?.ilceler ?? [];
  const { yakin: yakinDaireler, diger: digerDaireler } = vergiDaireleriniSirala(vergiDaireleri, seciliIlKodu, seciliIlce);
  function ilceSec(ilce: string) {
    setSeciliIlce(ilce);
    setVergiDairesiKodu(tekVergiDairesi(vergiDaireleri, seciliIlKodu, ilce)?.kod ?? "");
  }

  async function gonder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setHata("");
    setGonderiliyor(true);
    const v = new FormData(e.currentTarget);
    try {
      const sonuc = await api<{ mesaj: string }>("/tenant/kayit", {
        method: "POST",
        body: JSON.stringify({
          unvan: v.get("unvan"),
          kisiTuru: v.get("kisiTuru"),
          vkn: v.get("vkn"),
          vergiDairesi: vergiDaireleri.find((d) => d.kod === vergiDairesiKodu)?.ad || undefined,
          vergiDairesiKodu: vergiDairesiKodu || undefined,
          adres: v.get("adres") || undefined,
          postaKodu: v.get("postaKodu") || undefined,
          ilce: ilceler.find((x) => x === seciliIlce) || undefined,
          il: iller.find((x) => x.kod === seciliIlKodu)?.ad || undefined,
          telefon: v.get("telefon") || undefined,
          firmaEposta: v.get("firmaEposta") || undefined,
          webSitesi: v.get("webSitesi") || undefined,
          yoneticiAdSoyad: v.get("adSoyad"),
          yoneticiEposta: v.get("eposta"),
          parola: v.get("parola"),
          ...(paketSurumId ? { paketSurumId } : {}),
        }),
      });
      setMesaj(sonuc.mesaj);
    } catch (h) {
      setHata(h instanceof ApiHata ? h.message : "Kayıt başarısız");
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <main className="kayit-page">
      <div className="kayit-layout">
        <aside className="kayit-aside">
          <a className="kayit-brand" href="/" aria-label="TekirExtra ana sayfa">
            <span className="kayit-brand__mark">TE</span><span>Tekir<strong>Extra</strong></span>
          </a>
          <div className="kayit-aside__content">
            <span className="kayit-eyebrow"><span /> İŞİNİZ İÇİN YENİ BİR BAŞLANGIÇ</span>
            <h1>Şirketiniz için<br /><em>daha düzenli</em><br />bir çalışma alanı.</h1>
            <p>Firma hesabınızı birkaç adımda oluşturun. Bilgileriniz güvenli biçimde saklanır ve hesabınız yalnızca size ait olur.</p>
            <div className="kayit-steps" aria-label="Kayıt adımları">
              <div className="kayit-step kayit-step--active"><span>01</span><div><strong>Firma bilgileri</strong><small>Resmî bilgiler ve iletişim</small></div></div>
              <div className="kayit-step"><span>02</span><div><strong>Yönetici hesabı</strong><small>Güvenli giriş bilgileriniz</small></div></div>
            </div>
          </div>
          <div className="kayit-aside__foot"><span className="kayit-aside__spark">✳</span><span>İşletmenizin temel bilgileri tek yerde,<br />güvenle ve düzen içinde.</span></div>
        </aside>

        <section className="kayit-main" aria-labelledby="kayit-baslik">
          <header className="kayit-main__head">
            <div><span className="kayit-main__eyebrow">HESAP OLUŞTUR</span><h2 id="kayit-baslik">Firma kaydı</h2><p>Devam etmek için firma ve yönetici bilgilerini doldurun.</p></div>
            <span className="kayit-progress"><b>01</b><i />02</span>
          </header>

          {mesaj ? (
            <div className="kayit-success"><span aria-hidden="true">✓</span><h3>Başvurunuz alındı</h3><Alert tone="success">{mesaj}</Alert><a href="/giris">Giriş sayfasına dön</a></div>
          ) : (
            <form onSubmit={gonder} className="kayit-form">
              <fieldset className="kayit-section">
                <legend><span>01</span> Firma bilgileri</legend>
                <p className="kayit-section__hint">Vergi ve iletişim bilgileri firmanızın hesabını tanımlar.</p>
                <div className="kayit-grid">
                  <Field className="kayit-full" label="Firma unvanı"><Input name="unvan" required placeholder="Örn. Yılmaz Ticaret Ltd. Şti." autoComplete="organization" /></Field>
                  <Field label="Firma türü">
                    <select className="input" name="kisiTuru" required value={kisiTuru} onChange={(e) => setKisiTuru(e.target.value as "gercek" | "tuzel")}>
                      <option value="tuzel">Tüzel kişi</option>
                      <option value="gercek">Gerçek kişi · şahıs işletmesi</option>
                    </select>
                  </Field>
                  <Field label={kisiTuru === "gercek" ? "T.C. kimlik numarası" : "Vergi kimlik numarası"}>
                    <Input name="vkn" required inputMode="numeric" pattern={kisiTuru === "gercek" ? "\\d{11}" : "\\d{10}"} maxLength={kisiTuru === "gercek" ? 11 : 10} title={kisiTuru === "gercek" ? "11 haneli T.C. kimlik numarası girin" : "10 haneli vergi kimlik numarası girin"} placeholder={kisiTuru === "gercek" ? "11 haneli TCKN" : "10 haneli VKN"} />
                  </Field>
                  <div className="kayit-identity-note kayit-full"><span aria-hidden="true">ⓘ</span> Vergi kimlik bilgisi kayıt sırasında belirlenir. Değişiklikler destek doğrulamasıyla yapılır.</div>
                  <div className="kayit-grid kayit-grid--location kayit-full">
                    <Field label="İl"><select className="input" required value={seciliIlKodu} onChange={(e) => { setSeciliIlKodu(e.target.value); setSeciliIlce(""); setVergiDairesiKodu(""); }}><option value="">İl seçin</option>{iller.map((i) => <option key={i.kod} value={i.kod}>{i.ad}</option>)}</select></Field>
                    <Field label="İlçe"><select className="input" required value={seciliIlce} disabled={!seciliIlKodu} onChange={(e) => ilceSec(e.target.value)}><option value="">İlçe seçin</option>{ilceler.map((i) => <option key={i} value={i}>{i}</option>)}</select></Field>
                    <Field label="Vergi dairesi"><select className="input" required value={vergiDairesiKodu} disabled={!seciliIlce} onChange={(e) => setVergiDairesiKodu(e.target.value)}><option value="">Daire seçin</option>{yakinDaireler.length > 0 && <optgroup label={`${seciliIlce} ilçesindeki daireler`}>{yakinDaireler.map((d) => <option key={d.kod} value={d.kod}>{d.ad}</option>)}</optgroup>}<optgroup label={yakinDaireler.length ? `${iller.find((i) => i.kod === seciliIlKodu)?.ad ?? ""} ilindeki diğer daireler` : `${iller.find((i) => i.kod === seciliIlKodu)?.ad ?? ""} ilindeki daireler`}>{digerDaireler.map((d) => <option key={d.kod} value={d.kod}>{d.ad}</option>)}</optgroup></select></Field>
                  </div>
                  <Field label="Firma e-postası"><Input name="firmaEposta" type="email" autoComplete="email" placeholder="firma@ornek.com" /></Field>
                  <Field label="Telefon"><Input name="telefon" type="tel" autoComplete="tel" placeholder="05__ ___ __ __" /></Field>
                  <Field className="kayit-full" label="Açık adres"><Input name="adres" autoComplete="street-address" placeholder="Mahalle, cadde, sokak ve kapı no" /></Field>
                  <Field label="Posta kodu"><Input name="postaKodu" inputMode="numeric" pattern="\d{5}" maxLength={5} autoComplete="postal-code" placeholder="34000" /></Field>
                  <Field label="Web sitesi"><Input name="webSitesi" type="url" placeholder="https://ornek.com" /></Field>
                </div>
              </fieldset>

              <fieldset className="kayit-section">
                <legend><span>02</span> Yönetici hesabı</legend>
                <p className="kayit-section__hint">Firma hesabını yönetecek kişinin giriş bilgileri.</p>
                <div className="kayit-grid">
                  <Field className="kayit-full" label="Ad soyad"><Input name="adSoyad" required autoComplete="name" placeholder="Adınız ve soyadınız" /></Field>
                  <Field className="kayit-full" label="Yönetici e-postası"><Input name="eposta" type="email" required autoComplete="email" placeholder="ad@ornek.com" /></Field>
                  <Field className="kayit-full" label="Parola"><Input name="parola" type="password" required minLength={10} autoComplete="new-password" placeholder="En az 10 karakter, harf ve rakam" /></Field>
                </div>
              </fieldset>

              {paketler.length > 0 && (
                <fieldset className="kayit-section kayit-section--plan">
                  <legend><span>03</span> Başlangıç paketi</legend>
                  <div className="kayit-grid">
                    <Field className="kayit-full" label="Kullanmak istediğiniz paket">
                      <select className="input" value={paketSurumId} onChange={(e) => setPaketSurumId(e.target.value)}>
                        {paketler.length > 1 && <option value="">Paket seçin</option>}
                        {paketler.map((p) => {
                          const aylik = p.kosullar.fiyatlandirma?.donemler.find((d) => d.aySayisi === 1);
                          return <option key={p.surumId} value={p.surumId}>{p.paketAdi}{p.denemeGunSayisi ? ` · ${p.denemeGunSayisi} gün deneme` : ""}{aylik ? ` · ${aylik.matrah} ${p.kosullar.fiyatlandirma?.paraBirimi}/ay + KDV` : ""}</option>;
                        })}
                      </select>
                    </Field>
                  </div>
                </fieldset>
              )}

              <Alert tone="error">{hata}</Alert>
              <div className="kayit-form__submit">
                <span>Devam ederek bilgilerin doğruluğunu onaylarsınız.</span>
                <Button variant="primary" type="submit" disabled={gonderiliyor || !paketlerYuklendi || (paketler.length > 1 && !paketSurumId)}>
                  {gonderiliyor ? "Gönderiliyor…" : !paketlerYuklendi ? "Hazırlanıyor…" : "Firma hesabını oluştur"}<span aria-hidden="true">→</span>
                </Button>
              </div>
            </form>
          )}
          <p className="kayit-login">Zaten hesabınız var mı? <a href="/giris">Giriş yapın <span aria-hidden="true">→</span></a></p>
        </section>
      </div>
    </main>
  );
}
