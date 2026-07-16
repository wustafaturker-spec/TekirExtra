"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert, Button, Card, Field, PageHeader, Select, TableWrap } from "@/components/ui";

interface DenetimKullanicisi {
  id: string;
  adSoyad: string;
  eposta: string;
}

interface DenetimKaydi {
  id: string;
  islem: string;
  varlik: string;
  varlikId: string | null;
  zaman: string;
  kullanici: DenetimKullanicisi | null;
}

interface DenetimSayfasiVeri {
  kayitlar: DenetimKaydi[];
  sonrakiImlec: string | null;
}

const ADET = 50;

export default function DenetimIziSayfasi() {
  const [kayitlar, setKayitlar] = useState<DenetimKaydi[]>([]);
  const [varliklar, setVarliklar] = useState<string[]>([]);
  const [varlik, setVarlik] = useState("");
  const [baslangic, setBaslangic] = useState("");
  const [bitis, setBitis] = useState("");
  const [sonrakiImlec, setSonrakiImlec] = useState<string | null>(null);
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);

  const sorgu = useCallback(
    (imlec?: string) => {
      const p = new URLSearchParams({ adet: String(ADET) });
      if (varlik) p.set("varlik", varlik);
      if (baslangic) p.set("baslangic", baslangic);
      if (bitis) p.set("bitis", bitis);
      if (imlec) p.set("imlec", imlec);
      return `/denetim?${p.toString()}`;
    },
    [varlik, baslangic, bitis],
  );

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const veri = await api<DenetimSayfasiVeri>(sorgu());
      setKayitlar(veri.kayitlar);
      setSonrakiImlec(veri.sonrakiImlec);
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "Denetim izi yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [sorgu]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  useEffect(() => {
    api<string[]>("/denetim/varliklar")
      .then(setVarliklar)
      .catch(() => setVarliklar([]));
  }, []);

  async function dahaGetir() {
    if (!sonrakiImlec) return;
    setYukleniyor(true);
    try {
      const veri = await api<DenetimSayfasiVeri>(sorgu(sonrakiImlec));
      setKayitlar((mevcut) => [...mevcut, ...veri.kayitlar]);
      setSonrakiImlec(veri.sonrakiImlec);
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "Denetim izi yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="🛡️ Denetim İzi"
        subtitle="Kritik işlemlerin kim tarafından, ne zaman yapıldığını gösterir (KLN-04). Kayıtlar salt-okunurdur; silinemez veya değiştirilemez."
      />

      <Card className="stack">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ minWidth: 180 }}>
            <Field label="Varlık">
              <Select value={varlik} onChange={(e) => setVarlik(e.target.value)}>
                <option value="">Tümü</option>
                {varliklar.map((v) => (<option key={v} value={v}>{v}</option>))}
              </Select>
            </Field>
          </div>
          <div style={{ minWidth: 160 }}>
            <Field label="Başlangıç">
              <input className="input" type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} />
            </Field>
          </div>
          <div style={{ minWidth: 160 }}>
            <Field label="Bitiş">
              <input className="input" type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} />
            </Field>
          </div>
        </div>

        <Alert tone="error">{hata}</Alert>

        <TableWrap>
          <thead>
            <tr>
              <th>Zaman</th>
              <th>Kullanıcı</th>
              <th>Varlık</th>
              <th>İşlem</th>
              <th>Kayıt</th>
            </tr>
          </thead>
          <tbody>
            {kayitlar.map((k) => (
              <tr key={k.id}>
                <td>{new Date(k.zaman).toLocaleString("tr-TR")}</td>
                <td>{k.kullanici?.adSoyad ?? "—"}</td>
                <td>{k.varlik}</td>
                <td>{k.islem}</td>
                <td className="subtle mono" style={{ fontSize: "0.8rem" }}>{k.varlikId ?? "—"}</td>
              </tr>
            ))}
            {kayitlar.length === 0 && !yukleniyor && (
              <tr><td className="empty" colSpan={5}>Kayıt bulunamadı</td></tr>
            )}
          </tbody>
        </TableWrap>

        {sonrakiImlec && (
          <div>
            <Button type="button" onClick={dahaGetir} disabled={yukleniyor}>
              {yukleniyor ? "Yükleniyor…" : "Daha fazla getir"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
