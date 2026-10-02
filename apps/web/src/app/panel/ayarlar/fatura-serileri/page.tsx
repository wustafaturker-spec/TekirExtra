"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";

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
        title="Fatura ve Makbuz Serileri"
        subtitle="Satış faturaları yılına ve serisine göre kesintisiz numaralanır (FTR-06); numara fatura kesinleştirilirken üretilir. Tahsilat ve ödeme makbuzlarının serileri aşağıdadır."
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

      <MakbuzSerileri />
    </div>
  );
}

interface MakbuzSerisi {
  tur: "tahsilat" | "tediye";
  yil: number;
  onek: string;
  sonSira: number;
  tanimli: boolean;
  onekKilitli: boolean;
  siradakiNo: string;
}

const MAKBUZ_TURU = { tahsilat: "Tahsilat makbuzu", tediye: "Ödeme (tediye) makbuzu" } as const;
const makbuzNo = (onek: string, yil: string | number, sira: number) => `${onek}${yil}-${String(sira).padStart(6, "0")}`;

/** KSB-09: tahsilat/tediye makbuz serileri — önek ve devir sırası. */
function MakbuzSerileri() {
  const [seriler, setSeriler] = useState<MakbuzSerisi[]>([]);
  const [tur, setTur] = useState<MakbuzSerisi["tur"]>("tahsilat");
  const [yil, setYil] = useState(new Date().getFullYear().toString());
  const [onek, setOnek] = useState("");
  const [sonSira, setSonSira] = useState("0");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    try {
      setSeriler(await api<MakbuzSerisi[]>("/kasa-banka/makbuz-serileri"));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Makbuz serileri yüklenemedi");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) void yukle();
  }, [yukle]);

  // Seçilen tür/yılın mevcut değerleri forma gelir; yoksa son kullanılan önek önerilir.
  useEffect(() => {
    const mevcut = seriler.find((s) => s.tur === tur && s.yil === Number(yil));
    const onceki = seriler.find((s) => s.tur === tur);
    setOnek(mevcut?.onek ?? onceki?.onek ?? (tur === "tahsilat" ? "TM" : "TD"));
    setSonSira(String(mevcut?.sonSira ?? 0));
  }, [seriler, tur, yil]);

  async function kaydet() {
    setHata("");
    setBasari("");
    try {
      await api("/kasa-banka/makbuz-serileri", {
        method: "PUT",
        body: JSON.stringify({ tur, yil: Number(yil), onek, sonSira: Number(sonSira || "0") }),
      });
      setBasari(`${MAKBUZ_TURU[tur]} serisi ${yil} yılı için kaydedildi; sıradaki numara ${makbuzNo(onek, yil, Number(sonSira || "0") + 1)}.`);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Makbuz serisi kaydedilemedi");
    }
  }

  const mevcut = seriler.find((s) => s.tur === tur && s.yil === Number(yil));
  const onekGecerli = /^[A-Z]{1,5}$/.test(onek);
  const yilGecerli = Number(yil) >= 2000 && Number(yil) <= 2100;
  const siraGecerli = Number(sonSira) >= (mevcut?.sonSira ?? 0);
  const onekKilitli = Boolean(mevcut?.onekKilitli);

  return (
    <>
      <h2 className="section-title" style={{ marginTop: "2rem" }}>Makbuz serileri</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Kasa, banka ve POS tahsilat/ödeme fişleri kaydedilirken makbuz numarası alır (KSB-09). Sıra her yıl 1&apos;den başlar;
        geri alınan fişin numarası yanar, yeniden kullanılmaz.
      </p>
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <Card style={{ marginBottom: "1.5rem", maxWidth: 720 }}>
        <div className="card__title">Seriyi ayarla</div>
        <div className="row">
          <div style={{ flex: 2, minWidth: 180 }}>
            <Field label="Makbuz türü">
              <Select value={tur} onChange={(e) => setTur(e.target.value as MakbuzSerisi["tur"])}>
                <option value="tahsilat">{MAKBUZ_TURU.tahsilat}</option>
                <option value="tediye">{MAKBUZ_TURU.tediye}</option>
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <Field label="Yıl">
              <Input type="number" min="2000" max="2100" value={yil} onChange={(e) => setYil(e.target.value)} />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <Field label="Önek (1-5 harf)">
              <Input
                value={onek}
                disabled={onekKilitli}
                onChange={(e) => setOnek(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5))}
                style={{ textTransform: "uppercase" }}
              />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <Field label="Son sıra">
              <Input type="number" min={mevcut?.sonSira ?? 0} value={sonSira} onChange={(e) => setSonSira(e.target.value)} />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button variant="primary" onClick={kaydet} disabled={!onekGecerli || !yilGecerli || !siraGecerli}>
              Kaydet
            </Button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
          {onekKilitli
            ? <>Bu yıl bu seride numara verildi; önek ancak gelecek yıl için değiştirilebilir. Son sıra yalnız ileri alınabilir (ör. kâğıt makbuz koçanından devir).</>
            : <>Başka bir sistemden ya da kâğıt koçandan devrediyorsanız son kullanılan numarayı <strong>Son sıra</strong>ya yazın.</>}
          {onekGecerli && yilGecerli && (
            <> Sıradaki numara: <strong className="mono">{makbuzNo(onek, yil, Number(sonSira || "0") + 1)}</strong></>
          )}
        </p>
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Tür</th>
              <th className="num">Yıl</th>
              <th>Önek</th>
              <th className="num">Verilen</th>
              <th>Sıradaki numara</th>
            </tr>
          </thead>
          <tbody>
            {seriler.map((s) => (
              <tr key={`${s.tur}-${s.yil}`} className="row-link" onClick={() => { setTur(s.tur); setYil(String(s.yil)); }}>
                <td>{MAKBUZ_TURU[s.tur]}</td>
                <td className="num">{s.yil}</td>
                <td className="mono" style={{ fontWeight: 700 }}>{s.onek}</td>
                <td className="num">{s.sonSira}</td>
                <td>
                  <Badge variant={s.tanimli ? "accent" : "neutral"}>{s.siradakiNo}</Badge>
                  {!s.tanimli && <small className="muted"> · ilk fişte açılır</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}
