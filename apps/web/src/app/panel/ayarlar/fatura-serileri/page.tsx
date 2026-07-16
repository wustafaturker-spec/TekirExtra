"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, TableWrap } from "@/components/ui";

interface Seri {
  id: string;
  seri: string;
  yil: number;
  sonSira: number;
}

export default function FaturaSerileriSayfasi() {
  const [seriler, setSeriler] = useState<Seri[]>([]);
  const [seri, setSeri] = useState("");
  const [yil, setYil] = useState(new Date().getFullYear().toString());
  const [sonSira, setSonSira] = useState("0");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    try {
      setSeriler(await api<Seri[]>("/fatura/seriler"));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Seriler yüklenemedi");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) void yukle();
  }, [yukle]);

  async function ekle() {
    setHata("");
    setBasari("");
    try {
      await api("/fatura/seriler", {
        method: "POST",
        body: JSON.stringify({
          seri: seri.toUpperCase(),
          yil: Number(yil),
          sonSira: Number(sonSira || "0"),
        }),
      });
      setBasari(`'${seri.toUpperCase()}' serisi ${yil} yılı için tanımlandı.`);
      setSeri("");
      setSonSira("0");
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Seri eklenemedi");
    }
  }

  const seriGecerli = /^[A-Za-z]{3}$/.test(seri);
  const yilGecerli = Number(yil) >= 2000 && Number(yil) <= 2100;

  /** Sıradaki numara: kesinleştirmede sayaç 1 artırılıp bu biçimde üretilir. */
  const ornekNo = (s: Seri) =>
    `${s.seri}${s.yil}${String(s.sonSira + 1).padStart(9, "0")}`;

  return (
    <div>
      <PageHeader
        title="Fatura Serileri"
        subtitle="Satış faturaları, yılına ve serisine göre kesintisiz numaralanır (FTR-06). Numara, fatura kesinleştirilirken otomatik üretilir."
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <Card style={{ marginBottom: "1.5rem", maxWidth: 720 }}>
        <div className="card__title">Yeni Seri</div>
        <div className="row">
          <div style={{ flex: 1, minWidth: 140 }}>
            <Field label="Seri Kodu * (3 harf)">
              <Input
                value={seri}
                onChange={(e) => setSeri(e.target.value.toUpperCase().slice(0, 3))}
                placeholder="TKR"
                style={{ textTransform: "uppercase" }}
              />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <Field label="Yıl *">
              <Input type="number" min="2000" max="2100" value={yil} onChange={(e) => setYil(e.target.value)} />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Son Sıra">
              <Input type="number" min="0" value={sonSira} onChange={(e) => setSonSira(e.target.value)} />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button variant="primary" onClick={ekle} disabled={!seriGecerli || !yilGecerli}>
              ➕ Ekle
            </Button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
          <strong>Son Sıra</strong>, o seride en son kullanılmış numaradır; bir sonraki fatura bunun bir fazlasını
          alır. Başka bir sistemden devrediyorsanız son numarayı buraya yazın, aksi hâlde 0 bırakın.
          {seriGecerli && yilGecerli && (
            <>
              {" "}
              İlk numara:{" "}
              <strong className="mono">
                {seri.toUpperCase()}
                {yil}
                {String(Number(sonSira || "0") + 1).padStart(9, "0")}
              </strong>
            </>
          )}
        </p>
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Seri</th>
              <th className="num">Yıl</th>
              <th className="num">Son Sıra</th>
              <th>Sıradaki Numara</th>
            </tr>
          </thead>
          <tbody>
            {seriler.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">
                  Tanımlı seri yok. Seri tanımlanmadıysa ilk satış faturası kesinleştirilirken varsayılan{" "}
                  <span className="mono">TKR</span> serisi otomatik açılır.
                </td>
              </tr>
            ) : (
              seriler.map((s) => (
                <tr key={s.id}>
                  <td className="mono" style={{ fontWeight: 700 }}>
                    {s.seri}
                  </td>
                  <td className="num">{s.yil}</td>
                  <td className="num">{s.sonSira}</td>
                  <td>
                    <Badge variant="accent">{ornekNo(s)}</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
