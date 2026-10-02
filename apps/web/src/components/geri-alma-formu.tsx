"use client";

/**
 * KSB-08: geri alma onayı. Gerekçe zorunludur ve denetim izine yazılır; kural
 * her yerde aynıdır: açık dönemde kayıt silinir, kapalı dönemde bugün tarihli
 * ters kayıt atılır. Tarayıcı onay penceresi kullanılmaz.
 */
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Field } from "@/components/ui";

export type GeriAlmaYontemi = "silindi" | "ters_kayit";

export function GeriAlmaFormu<T extends { yontem: GeriAlmaYontemi }>({
  baslik,
  uc,
  aciklama,
  onVazgec,
  onTamam,
}: {
  baslik: string;
  /** POST edilecek geri alma ucu; gövde `{ neden }`. */
  uc: string;
  /** Bu kayda özgü ek bilgi (fatura kalanı yeniden açılır, iki bacak birlikte gider…). */
  aciklama?: ReactNode;
  onVazgec: () => void;
  onTamam: (sonuc: T) => void;
}) {
  const [neden, setNeden] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState("");

  async function gonder(e: React.FormEvent) {
    e.preventDefault();
    setIsleniyor(true);
    setHata("");
    try {
      onTamam(await api<T>(uc, { method: "POST", body: JSON.stringify({ neden }) }));
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Geri alınamadı");
    } finally {
      setIsleniyor(false);
    }
  }

  return (
    <form className="undo-form" onSubmit={gonder}>
      <h3>{baslik}</h3>
      <p>
        Açık dönemdeki kayıt bağlı cari hareketleriyle birlikte silinir ve görüntüsü denetim izine yazılır. Dönemi kapanmışsa
        kayıt değişmez; bugün tarihli ters kayıt atılır.
        {aciklama && <> {aciklama}</>}
      </p>
      <Field label="Gerekçe">
        <textarea
          autoFocus
          className="input"
          required
          minLength={3}
          maxLength={300}
          rows={2}
          value={neden}
          onChange={(e) => setNeden(e.target.value)}
          placeholder="Ör. Mükerrer giriş, yanlış cari seçildi"
        />
      </Field>
      {hata && <Alert tone="error">{hata}</Alert>}
      <footer>
        <Button type="button" onClick={onVazgec} disabled={isleniyor}>Vazgeç</Button>
        <Button type="submit" variant="danger" disabled={isleniyor || neden.trim().length < 3}>
          {isleniyor ? "Geri alınıyor…" : baslik}
        </Button>
      </footer>
    </form>
  );
}
