"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiHata, tokenAl, tokenYaz } from "@/lib/api";
import { Alert, Card, PageHeader, Stat, StatGrid, TableWrap } from "@/components/ui";

interface Firma {
  unvan: string;
  vkn: string;
}

interface FinansOzet {
  nakitVarliklar: string;
  envanterDegeri: string;
  toplamAlacaklar: string;
  toplamBorclar: string;
  netVarlikDegeri: string;
}

interface KarMarjiSatiri {
  grup: string;
  ciro: string;
  maliyet: string;
  kar: string;
  marj: number | null;
}

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

export default function PanelSayfasi() {
  const yonlendir = useRouter();
  const [firma, setFirma] = useState<Firma | null>(null);
  const [ozet, setOzet] = useState<FinansOzet | null>(null);
  const [rapor, setRapor] = useState<KarMarjiSatiri[] | null>(null);
  const [hata, setHata] = useState("");

  const yukle = useCallback(async () => {
    try {
      setFirma(await api<Firma>("/firma"));
      setOzet(await api<FinansOzet>("/rapor/ozet"));
      // Kâr marjı raporu RPR-06 araç setinden (fatura.kar-marji, ürün kırılımı)
      const karMarji = await api<{ satirlar: KarMarjiSatiri[] }>(
        "/raporlar/fatura.kar-marji/calistir",
        { method: "POST", body: JSON.stringify({ gruplama: "urun" }) },
      );
      setRapor(karMarji.satirlar);
    } catch (h) {
      if (h instanceof ApiHata && h.durum === 401) {
        tokenYaz(null);
        yonlendir.push("/giris");
      } else {
        setHata(h instanceof Error ? h.message : "Yükleme hatası");
      }
    }
  }, [yonlendir]);

  useEffect(() => {
    if (!tokenAl()) {
      yonlendir.push("/giris");
      return;
    }
    void yukle();
  }, [yonlendir, yukle]);

  return (
    <div>
      <PageHeader
        title={firma?.unvan ?? "Yükleniyor…"}
        subtitle="Hoş geldiniz. Şirketinizin anlık finansal durum özeti aşağıdadır."
      />

      <Alert tone="error">{hata}</Alert>

      {ozet && (
        <section style={{ marginBottom: "2rem" }}>
          <StatGrid>
            <Stat label="Nakit Varlıklar (Kasa/Banka)" value={tl(ozet.nakitVarliklar)} tone="success" />
            <Stat label="Stok Envanter Değeri" value={tl(ozet.envanterDegeri)} tone="info" />
            <Stat label="Toplam Müşteri Alacakları" value={tl(ozet.toplamAlacaklar)} tone="info" />
            <Stat label="Toplam Tedarikçi Borçları" value={tl(ozet.toplamBorclar)} tone="danger" />
          </StatGrid>

          <Card style={{ background: "var(--accent-soft)", borderColor: "var(--accent)" }}>
            <div className="stat__label">Konsolide Net Varlık Değeri</div>
            <div className="stat__value" style={{ fontSize: "2.1rem", color: "var(--accent-text)" }}>
              {tl(ozet.netVarlikDegeri)}
            </div>
          </Card>
        </section>
      )}

      {rapor && (() => {
        const toplam = rapor.reduce(
          (t, u) => ({
            ciro: t.ciro + Number(u.ciro),
            maliyet: t.maliyet + Number(u.maliyet),
            kar: t.kar + Number(u.kar),
          }),
          { ciro: 0, maliyet: 0, kar: 0 },
        );
        const marj = toplam.ciro > 0 ? (toplam.kar / toplam.ciro) * 100 : 0;
        return (
          <Card>
            <h2 className="card__title" style={{ fontSize: "1.15rem" }}>📈 Satış Kârlılık ve Kâr/Zarar Analizi</h2>

            <StatGrid>
              <Stat label="Toplam Ciro" value={tl(toplam.ciro)} />
              <Stat label="Toplam Maliyet" value={tl(toplam.maliyet)} />
              <Stat label="Net Satış Kârı" value={tl(toplam.kar)} tone={toplam.kar >= 0 ? "success" : "danger"} />
              <Stat label="Kârlılık Oranı" value={`%${marj.toFixed(2)}`} tone="accent" />
            </StatGrid>

            <h3 className="card__title" style={{ fontSize: "0.95rem" }}>Ürün Bazlı Kârlılık Kırılımı</h3>
            <TableWrap>
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th className="num">Toplam Ciro</th>
                  <th className="num">Maliyet</th>
                  <th className="num">Kâr/Zarar</th>
                  <th className="num">Kârlılık Oranı</th>
                </tr>
              </thead>
              <tbody>
                {rapor.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">Henüz kesinleşmiş satış faturası bulunmuyor.</td>
                  </tr>
                ) : (
                  rapor.map((u) => (
                    <tr key={u.grup}>
                      <td>{u.grup}</td>
                      <td className="num">{tl(u.ciro)}</td>
                      <td className="num muted">{tl(u.maliyet)}</td>
                      <td className={`num money ${Number(u.kar) >= 0 ? "pos" : "neg"}`}>{tl(u.kar)}</td>
                      <td className="num" style={{ color: "var(--accent-text)", fontWeight: 700 }}>
                        {u.marj === null ? "—" : `%${u.marj.toFixed(2)}`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </TableWrap>
          </Card>
        );
      })()}
    </div>
  );
}
