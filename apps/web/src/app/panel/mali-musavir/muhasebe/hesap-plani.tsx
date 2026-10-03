"use client";

import { useEffect, useState } from "react";
import { MUHASEBE_KODU_DESENI } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { Alert, Button, Card, Input, TableWrap } from "@/components/ui";

interface HesapAyari { anahtar: string; ad: string; varsayilan: string; kod: string | null }

/** MUH-02: kayıt türü başına Tekdüzen varsayılanı; firma kendi kodunu yazar, boş bırakılan varsayılana döner. */
export function HesapPlani() {
  const [hesaplar, setHesaplar] = useState<HesapAyari[]>([]);
  const [kodlar, setKodlar] = useState<Record<string, string>>({});
  const [mesaj, setMesaj] = useState<{ tur: "success" | "error"; metin: string } | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const uygula = (liste: HesapAyari[]) => {
    setHesaplar(liste);
    setKodlar(Object.fromEntries(liste.map((h) => [h.anahtar, h.kod ?? ""])));
  };
  useEffect(() => {
    void api<{ hesaplar: HesapAyari[] }>("/mali-musavir/muhasebe/ayarlar").then((a) => uygula(a.hesaplar)).catch((e) => setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Hesap planı okunamadı" }));
  }, []);

  const hatali = Object.entries(kodlar).filter(([, k]) => k.trim() && !MUHASEBE_KODU_DESENI.test(k.trim())).map(([a]) => a);

  async function kaydet() {
    setKaydediliyor(true);
    setMesaj(null);
    try {
      const a = await api<{ hesaplar: HesapAyari[] }>("/mali-musavir/muhasebe/ayarlar/hesap-kodlari", { method: "PUT", body: JSON.stringify(kodlar) });
      uygula(a.hesaplar);
      setMesaj({ tur: "success", metin: "Hesap kodları kaydedildi; sonraki önizleme ve aktarım bunları kullanır." });
    } catch (e) {
      setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Kaydedilemedi" });
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <Card
      pad={false}
      title={<div><span className="muh-ust">TEKDÜZEN</span><h2>Hesap planı eşlemesi</h2><small>Boş bırakılan satır varsayılan kodu kullanır. Masraf ve gelir kategorilerinin kendi kodu varsa o geçerlidir.</small></div>}
      actions={<Button variant="primary" size="sm" onClick={() => void kaydet()} disabled={kaydediliyor || hatali.length > 0}>{kaydediliyor ? "Kaydediliyor…" : "Kaydet"}</Button>}
    >
      {mesaj && <Alert tone={mesaj.tur}>{mesaj.metin}</Alert>}
      <TableWrap>
        <thead><tr><th>Kayıt türü</th><th>Varsayılan</th><th>Firmanın kodu</th></tr></thead>
        <tbody>
          {hesaplar.map((h) => (
            <tr key={h.anahtar}>
              <td>{h.ad}</td>
              <td className="mono">{h.varsayilan}</td>
              <td>
                <Input
                  className="mono muh-kod"
                  aria-label={`${h.ad} hesap kodu`}
                  aria-invalid={hatali.includes(h.anahtar)}
                  value={kodlar[h.anahtar] ?? ""}
                  placeholder={h.varsayilan}
                  onChange={(e) => setKodlar({ ...kodlar, [h.anahtar]: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {hatali.length > 0 && <p className="muh-bos">Hesap kodu rakamla başlamalı; nokta ve tireyle alt hesaba inebilir.</p>}
    </Card>
  );
}
