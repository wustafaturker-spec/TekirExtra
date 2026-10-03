"use client";

import { useEffect, useMemo, useState } from "react";
import { MUHASEBE_KODU_DESENI } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { Alert, Button, Card, Input, Select, TableWrap } from "@/components/ui";

type Tur = "cari" | "kasa" | "banka" | "pos" | "kart" | "kredi";
interface AltHesap { tur: Tur; id: string; kod: string | null; ad: string; tip: string; muhasebeKodu: string | null; varsayilan: string }

const TUR_ADI: Record<Tur, string> = { cari: "Cari", kasa: "Kasa", banka: "Banka", pos: "POS", kart: "Kredi kartı", kredi: "Banka kredisi" };
const CARI_TIPI: Record<string, string> = { musteri: "Müşteri", tedarikci: "Tedarikçi", her_ikisi: "Müşteri + tedarikçi" };

/**
 * MUH-03: alt hesap kodları toplu düzenlenir. Boş satır varsayılanı (ana hesap
 * + .01. + cari kodu / sıra) kullanır. Carinin kodu bir tarafa yazılır; öbür
 * tarafta ana hesap değiştirilir (120.01.5 ↔ 320.01.5).
 */
export function AltHesaplar() {
  const [kayitlar, setKayitlar] = useState<AltHesap[]>([]);
  const [degisen, setDegisen] = useState<Record<string, string>>({});
  const [arama, setArama] = useState("");
  const [tur, setTur] = useState<"" | Tur>("");
  const [mesaj, setMesaj] = useState<{ tur: "success" | "error"; metin: string } | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const uygula = (v: { hesaplar: AltHesap[]; cariler: AltHesap[] }) => {
    setKayitlar([...v.hesaplar, ...v.cariler]);
    setDegisen({});
  };
  useEffect(() => {
    void api<{ hesaplar: AltHesap[]; cariler: AltHesap[] }>("/mali-musavir/muhasebe/alt-hesaplar").then(uygula).catch((e) => setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Alt hesaplar okunamadı" }));
  }, []);

  const anahtar = (k: AltHesap) => `${k.tur}:${k.id}`;
  const gorunen = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    return kayitlar.filter((k) => (!tur || k.tur === tur) && (!q || `${k.ad} ${k.kod ?? ""} ${k.muhasebeKodu ?? ""}`.toLocaleLowerCase("tr-TR").includes(q)));
  }, [kayitlar, arama, tur]);
  const hatali = Object.values(degisen).some((k) => k.trim() && !MUHASEBE_KODU_DESENI.test(k.trim()));

  async function kaydet() {
    setKaydediliyor(true);
    setMesaj(null);
    try {
      const govde = Object.entries(degisen).map(([a, kod]) => {
        const [t, id] = a.split(":");
        return { tur: t, id, muhasebeKodu: kod.trim() || null };
      });
      uygula(await api("/mali-musavir/muhasebe/alt-hesaplar", { method: "PUT", body: JSON.stringify(govde) }));
      setMesaj({ tur: "success", metin: `${govde.length} alt hesap kaydedildi.` });
    } catch (e) {
      setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Kaydedilemedi" });
    } finally {
      setKaydediliyor(false);
    }
  }

  const sayi = Object.keys(degisen).length;
  return (
    <Card
      pad={false}
      title={<div><span className="muh-ust">ALT HESAPLAR</span><h2>Cari, kasa, banka, POS ve kart kodları</h2><small>Boş bırakılan satır gri görünen varsayılan kodu kullanır.</small></div>}
      actions={<Button variant="primary" size="sm" onClick={() => void kaydet()} disabled={!sayi || hatali || kaydediliyor}>{kaydediliyor ? "Kaydediliyor…" : sayi ? `${sayi} değişikliği kaydet` : "Kaydet"}</Button>}
    >
      {mesaj && <Alert tone={mesaj.tur}>{mesaj.metin}</Alert>}
      <div className="muh-arama muh-arama--iki">
        <Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Ad, cari kodu ya da hesap koduyla ara…" aria-label="Alt hesaplarda ara" />
        <Select value={tur} onChange={(e) => setTur(e.target.value as "" | Tur)} aria-label="Tür süzgeci">
          <option value="">Tüm türler</option>
          {(Object.keys(TUR_ADI) as Tur[]).map((t) => <option key={t} value={t}>{TUR_ADI[t]}</option>)}
        </Select>
      </div>
      <TableWrap>
        <thead><tr><th>Tür</th><th>Ad</th><th>Bilgi</th><th>Muhasebe kodu</th></tr></thead>
        <tbody>
          {gorunen.slice(0, 300).map((k) => {
            const deger = degisen[anahtar(k)] ?? k.muhasebeKodu ?? "";
            return (
              <tr key={anahtar(k)}>
                <td>{TUR_ADI[k.tur]}</td>
                <td>{k.ad}{k.kod && <small className="mono muh-alt"> {k.kod}</small>}</td>
                <td>{k.tur === "cari" ? CARI_TIPI[k.tip] ?? k.tip : k.tip}</td>
                <td>
                  <Input
                    className="mono muh-kod"
                    aria-label={`${k.ad} muhasebe kodu`}
                    value={deger}
                    placeholder={k.varsayilan}
                    onChange={(e) => setDegisen({ ...degisen, [anahtar(k)]: e.target.value })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      {gorunen.length > 300 && <p className="muh-bos">İlk 300 kayıt gösteriliyor; aramayla daraltın.</p>}
    </Card>
  );
}
