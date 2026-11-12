"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Tarih } from "@/components/ui";

type TelegramDurumu =
  | { kullanilabilir: false }
  | {
      kullanilabilir: true;
      botAdi: string;
      urunEkli: boolean;
      yonetici: boolean;
      tutarGoster?: boolean;
      bagliKullanici?: number;
      bag: { kullaniciAdi: string | null; baglandiAt: string } | null;
    };

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

  const urunKaydet = (etkin: boolean, tutarGoster: boolean, basari: string) =>
    islem(async () => {
      await api("/telegram/urun", { method: "PUT", body: JSON.stringify({ etkin, tutarGoster }) });
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
