"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, Select, Tarih } from "@/components/ui";

type TelegramDurumu =
  | { kullanilabilir: false }
  | {
      kullanilabilir: true;
      botAdi: string;
      urunEkli: boolean;
      yonetici: boolean;
      tutarGoster?: boolean;
      sesEtkin?: boolean;
      sesOnayAt?: string | null;
      sesKullanilabilir?: boolean;
      bagliKullanici?: number;
      bag: { kullaniciAdi: string | null; baglandiAt: string } | null;
      tercih: Tercih;
    };

interface Tercih { konular: string[]; minOnem: "bilgi" | "uyari" | "kritik"; gunlukSinir: number; brifing: boolean; susBitis: string | null }

/** CNL-07: kendiliğinden mesaj konuları = bildirim türleri. */
const KONULAR: Array<{ deger: string; ad: string }> = [
  { deger: "vade", ad: "Vade ve nakit (eksiye düşen bakiye dahil)" },
  { deger: "onay", ad: "Onay talepleri" },
  { deger: "yapay_zeka", ad: "Asistan onayları" },
  { deger: "ebelge", ad: "e-Belge (ret, hata)" },
  { deger: "donem", ad: "Vergi/SGK son günleri ve dönem" },
  { deger: "cek_senet", ad: "Çek ve senet" },
  { deger: "stok", ad: "Stok" },
  { deger: "satin_alma", ad: "Satın alma" },
  { deger: "teklif", ad: "Teklif takibi" },
  { deger: "entegrasyon", ad: "Banka, POS, entegrasyon" },
  { deger: "duzeltme", ad: "Düzeltme kayıtları" },
  { deger: "mevzuat", ad: "Mevzuat" },
];

interface BaglantiKodu { kod: string; baglanti: string; komut: string; sonGecerlilik: string }

/**
 * CNL-02/05/20: kişisel Telegram bağı ve (yöneticiye) ürün ayarı. Platform botu tanımlı değilse
 * ya da paket asistanı içermiyorsa kart hiç görünmez (CNL-14).
 */
export function TelegramKarti() {
  const [durum, setDurum] = useState<TelegramDurumu | null>(null);
  const [riza, setRiza] = useState(false);
  const [kod, setKod] = useState<BaglantiKodu | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [bilgi, setBilgi] = useState("");

  const yukle = useCallback(async () => {
    try {
      setDurum(await api<TelegramDurumu>("/telegram/durum"));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Telegram durumu okunamadı");
    }
  }, []);

  useEffect(() => { void yukle(); }, [yukle]);

  async function islem(fn: () => Promise<void>, basari?: string) {
    setIsleniyor(true);
    setHata("");
    setBilgi("");
    try {
      await fn();
      if (basari) setBilgi(basari);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem yapılamadı");
    } finally {
      setIsleniyor(false);
    }
  }

  if (!durum || !durum.kullanilabilir) return hata ? <Alert tone="error">{hata}</Alert> : null;

  const tercihKaydet = (yeni: Partial<Tercih> & { susKaldir?: boolean }, basari = "Tercih kaydedildi.") =>
    islem(async () => {
      const t = { ...durum.tercih, ...yeni };
      const kayit = await api<Tercih>("/telegram/tercihler", { method: "PUT", body: JSON.stringify({ konular: t.konular, minOnem: t.minOnem, gunlukSinir: t.gunlukSinir, brifing: t.brifing, ...(yeni.susKaldir ? { susKaldir: true } : {}) }) });
      setDurum({ ...durum, tercih: kayit });
    }, basari);

  const urunKaydet = (etkin: boolean, tutarGoster: boolean, basari: string, sesEtkin?: boolean) =>
    islem(async () => {
      await api("/telegram/urun", { method: "PUT", body: JSON.stringify({ etkin, tutarGoster, ...(sesEtkin === undefined ? {} : { sesEtkin }) }) });
      setKod(null);
      await yukle();
    }, basari);

  return (
    <Card className="mt-1" title={<div><span>TELEGRAM</span><h2>Asistana Telegram'dan ulaşın</h2></div>}>
      {hata && <Alert tone="error">{hata}</Alert>}
      {bilgi && <Alert tone="success">{bilgi}</Alert>}
      <p className="muted" style={{ marginTop: 0 }}>
        Paneldeki asistana @{durum.botAdi} üzerinden aynı yetkinizle yazabilirsiniz. Telegram'dan yalnız okuma, taslak ve onay talebi açılır;
        onay, ödeme ve gönderim kararları panelde verilir. Maaş ve bordro tutarları, kimlik numarası ve tam IBAN Telegram'a yazılmaz.
      </p>

      {!durum.urunEkli && (durum.yonetici ? (
        <Button variant="primary" disabled={isleniyor} onClick={() => void urunKaydet(true, durum.tutarGoster ?? true, "Telegram kanalı firmanıza eklendi. Kullanıcılar artık hesaplarını bağlayabilir.")}>
          Telegram kanalını firmaya ekle
        </Button>
      ) : (
        <p className="muted">Telegram kanalı firmanızda eklenmemiş; yöneticiniz bu sayfadan ekleyebilir.</p>
      ))}

      {durum.urunEkli && (
        <>
          {durum.bag ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
              <Badge variant="success">Bağlı</Badge>
              <span>
                {durum.bag.kullaniciAdi ? `@${durum.bag.kullaniciAdi}` : "Telegram hesabınız"} — <Tarih deger={durum.bag.baglandiAt} saatli />
              </span>
              <Button disabled={isleniyor} onClick={() => {
                if (!window.confirm("Telegram bağlantınız kaldırılacak. Devam edilsin mi?")) return;
                void islem(async () => { await api("/telegram/bag", { method: "DELETE" }); await yukle(); }, "Telegram bağlantısı kaldırıldı.");
              }}>
                Bağlantıyı kaldır
              </Button>
            </div>
          ) : kod ? (
            <div>
              <p style={{ marginTop: 0 }}>
                Bağlantı <Tarih deger={kod.sonGecerlilik} saatli /> saatine kadar ve yalnız bir kez geçerlidir.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
                <a className="btn btn--primary" href={kod.baglanti} target="_blank" rel="noopener noreferrer">Telegram'da aç</a>
                <Button disabled={isleniyor} onClick={() => void islem(async () => { await yukle(); setKod(null); })}>Bağladım, yenile</Button>
              </div>
              <p className="muted">
                Bağlantı açılmazsa Telegram'da @{durum.botAdi} ile sohbet açıp şunu gönderin: <code style={{ wordBreak: "break-all" }}>{kod.komut}</code>
              </p>
            </div>
          ) : (
            <div>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                <input type="checkbox" checked={riza} onChange={(e) => setRiza(e.target.checked)} style={{ marginTop: "0.25rem" }} />
                <span>
                  Telegram'a yazdığım mesajların ve asistanın yanıtlarının Telegram sunucularında saklanacağını biliyorum.
                  Parolam ya da iki adımlı doğrulamam değişirse bağlantının kendiliğinden kalkacağını anladım.
                </span>
              </label>
              <Button className="mt-1" variant="primary" disabled={!riza || isleniyor} onClick={() => void islem(async () => {
                setKod(await api<BaglantiKodu>("/telegram/baglanti-kodu", { method: "POST", body: JSON.stringify({ riza: true }) }));
              })}>
                Telegram'ı bağla
              </Button>
            </div>
          )}

          {durum.bag && (
            <div className="mt-1" style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <strong>Kendiliğinden mesajlar</strong>
              <p className="muted" style={{ margin: "0.25rem 0 0.5rem" }}>
                Seçtiğiniz konulardaki bildirimler Telegram'a da gelir; kritik bildirimler konu seçiminden bağımsız gelir. Yukarıdaki sessiz saat
                Telegram için de geçerlidir: sessiz saatte birikenler bitince tek özet olarak gelir. Telegram'da “sus” yazarsanız 24 saat, “bugünlük yeter” yazarsanız gün sonuna dek mesaj gelmez.
              </p>
              {durum.tercih.susBitis && (
                <Alert tone="warning">
                  Kendiliğinden mesajlar <Tarih deger={durum.tercih.susBitis} saatli /> saatine kadar susturuldu.{" "}
                  <Button size="sm" disabled={isleniyor} onClick={() => void tercihKaydet({ susKaldir: true }, "Kendiliğinden mesajlar yeniden açıldı.")}>Yeniden aç</Button>
                </Alert>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))", gap: "0.35rem 1rem" }}>
                {KONULAR.map((k) => (
                  <label key={k.deger} style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      disabled={isleniyor}
                      checked={durum.tercih.konular.includes(k.deger)}
                      onChange={(e) => void tercihKaydet({ konular: e.target.checked ? [...durum.tercih.konular, k.deger] : durum.tercih.konular.filter((x) => x !== k.deger) })}
                    />
                    <span>{k.ad}</span>
                  </label>
                ))}
              </div>
              <div className="mt-1" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
                <Field label="En düşük önem">
                  <Select value={durum.tercih.minOnem} disabled={isleniyor} onChange={(e) => void tercihKaydet({ minOnem: e.target.value as Tercih["minOnem"] })}>
                    <option value="bilgi">Bilgi ve üstü</option>
                    <option value="uyari">Uyarı ve üstü</option>
                    <option value="kritik">Yalnız kritik</option>
                  </Select>
                </Field>
                <Field label="Günde en çok mesaj">
                  <Input
                    type="number" min={0} max={20} disabled={isleniyor}
                    defaultValue={durum.tercih.gunlukSinir}
                    onBlur={(e) => { const n = Math.max(0, Math.min(20, Math.round(Number(e.target.value)))); if (n !== durum.tercih.gunlukSinir) void tercihKaydet({ gunlukSinir: n }); }}
                  />
                </Field>
                <label style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center", paddingBottom: "0.5rem" }}>
                  <input type="checkbox" disabled={isleniyor} checked={durum.tercih.brifing} onChange={(e) => void tercihKaydet({ brifing: e.target.checked })} />
                  <span>İş günü sabahı brifing (en çok 5 madde)</span>
                </label>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>Günlük sınır kritik bildirimleri durdurmaz. Aylık yapay zekâ bütçesi dolunca yalnız kritik bildirimler gelir.</p>
            </div>
          )}

          {durum.yonetici && (
            <div className="mt-1" style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <strong>Firma ayarı</strong>
              <p className="muted" style={{ margin: "0.25rem 0 0.5rem" }}>Bağlı kullanıcı: {durum.bagliKullanici ?? 0}</p>
              <label style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={durum.tutarGoster ?? true}
                  disabled={isleniyor}
                  onChange={(e) => void urunKaydet(true, e.target.checked, e.target.checked ? "Tutarlar Telegram'da gösterilecek." : "Tutarlar Telegram'da gizlenecek.")}
                />
                <span>Tutarları Telegram'da göster</span>
              </label>
              {(durum.sesKullanilabilir || durum.sesEtkin) && (
                <div className="mt-1">
                  <label style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={durum.sesEtkin ?? false}
                      disabled={isleniyor}
                      onChange={(e) => {
                        const ac = e.target.checked;
                        if (ac && !window.confirm("Sesli mesajlar yazıya çevrilmek için OpenAI'ye (ABD) gönderilir. Ses kaydı TekirExtra'da saklanmaz; çeviri ücreti firmanın aylık yapay zekâ bütçesinden düşer. Onaylıyor musunuz?")) return;
                        void urunKaydet(true, durum.tutarGoster ?? true, ac ? "Sesli mesaj açıldı." : "Sesli mesaj kapatıldı.", ac);
                      }}
                    />
                    <span>Sesli mesajı yazıya çevir (OpenAI, yurt dışı)</span>
                  </label>
                  {durum.sesEtkin && durum.sesOnayAt && (
                    <p className="muted" style={{ margin: "0.25rem 0 0" }}>Onay: <Tarih deger={durum.sesOnayAt} saatli /> · en çok 2 dakikalık mesaj</p>
                  )}
                </div>
              )}
              <div className="mt-1">
                <Button variant="danger" disabled={isleniyor} onClick={() => {
                  if (!window.confirm("Telegram kanalı firmanızdan çıkarılacak; bütün kullanıcıların bağlantısı kalkar. Devam edilsin mi?")) return;
                  void urunKaydet(false, durum.tutarGoster ?? true, "Telegram kanalı çıkarıldı; bütün bağlantılar kaldırıldı.");
                }}>
                  Telegram kanalını firmadan çıkar
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
