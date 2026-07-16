"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  Segmented,
  Select,
  Stat,
  StatGrid,
  TableWrap,
} from "@/components/ui";

/* ─── Tipler ─────────────────────────────────────────────────────────────── */

interface CariOzet {
  id: string;
  kod: string;
  unvan: string;
}

interface Hesap {
  id: string;
  ad: string;
  dovizCinsi: string;
}

interface CekSenet {
  id: string;
  tur: "cek" | "senet";
  portfoyNo: string;
  vadeTarihi: string;
  tutar: string;
  dovizCinsi: string;
  kur: string;
  tutarTry: string;
  borclu: string;
  kesideYeri: string | null;
  banka: string | null;
  sube: string | null;
  hesapNo: string | null;
  durum: string;
  aciklama: string | null;
  cari: CariOzet | null;
  ciroCari: CariOzet | null;
}

type TurFiltre = "hepsi" | "cek" | "senet";

/* ─── Sabitler ───────────────────────────────────────────────────────────── */

const DURUMLAR: Record<string, { baslik: string; renk: "warning" | "success" | "info" | "danger" | "neutral" }> = {
  portfoyde: { baslik: "📁 Portföyde", renk: "warning" },
  ciro_edildi: { baslik: "↪️ Ciro Edildi", renk: "info" },
  tahsil_edildi: { baslik: "✅ Tahsil Edildi", renk: "success" },
  karsiliksiz: { baslik: "⛔ Karşılıksız", renk: "danger" },
  iade_edildi: { baslik: "↩️ İade Edildi", renk: "neutral" },
};

const para = (deger: string | number, doviz = "TRY"): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " " + doviz;

const bugun = () => new Date().toISOString().slice(0, 10);

/** Vade günü dahil; saat farkını dışlamak için gün başına normalize edilir. */
function vadeyeKalanGun(vade: string): number {
  const v = new Date(vade.slice(0, 10) + "T00:00:00");
  const b = new Date(bugun() + "T00:00:00");
  return Math.round((v.getTime() - b.getTime()) / 86400000);
}

/* ─── Sayfa ──────────────────────────────────────────────────────────────── */

export default function CekSenetSayfasi() {
  const [kayitlar, setKayitlar] = useState<CekSenet[]>([]);
  const [cariler, setCariler] = useState<CariOzet[]>([]);
  const [kasalar, setKasalar] = useState<Hesap[]>([]);
  const [bankalar, setBankalar] = useState<Hesap[]>([]);
  const [tur, setTur] = useState<TurFiltre>("hepsi");
  const [durumFiltre, setDurumFiltre] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [islemYapilan, setIslemYapilan] = useState<{ kayit: CekSenet; durum: string } | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (tur !== "hepsi") qs.set("tur", tur);
      if (durumFiltre) qs.set("durum", durumFiltre);
      const ek = qs.toString() ? `?${qs}` : "";
      setKayitlar(await api<CekSenet[]>(`/kasa-banka/cek-senet${ek}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Çek/senet listesi yüklenemedi");
    }
  }, [tur, durumFiltre]);

  useEffect(() => {
    if (!tokenAl()) return;
    void yukle();
  }, [yukle]);

  useEffect(() => {
    if (!tokenAl()) return;
    void api<{ kayitlar: CariOzet[] }>("/cari").then((v) => setCariler(v.kayitlar)).catch(() => {});
    void api<Hesap[]>("/kasa-banka/kasalar").then(setKasalar).catch(() => {});
    void api<Hesap[]>("/kasa-banka/bankalar").then(setBankalar).catch(() => {});
  }, []);

  const ozet = useMemo(() => {
    const portfoy = kayitlar.filter((k) => k.durum === "portfoyde");
    const toplam = portfoy.reduce((t, k) => t + Number(k.tutarTry), 0);
    const geciken = portfoy.filter((k) => vadeyeKalanGun(k.vadeTarihi) < 0);
    const yaklasan = portfoy.filter((k) => {
      const g = vadeyeKalanGun(k.vadeTarihi);
      return g >= 0 && g <= 30;
    });
    return {
      adet: portfoy.length,
      toplam,
      geciken: geciken.reduce((t, k) => t + Number(k.tutarTry), 0),
      gecikenAdet: geciken.length,
      yaklasan: yaklasan.reduce((t, k) => t + Number(k.tutarTry), 0),
      yaklasanAdet: yaklasan.length,
    };
  }, [kayitlar]);

  async function durumGuncelle(govde: Record<string, unknown>) {
    if (!islemYapilan) return;
    setHata("");
    setBasari("");
    try {
      await api(`/kasa-banka/cek-senet/${islemYapilan.kayit.id}`, {
        method: "PATCH",
        body: JSON.stringify(govde),
      });
      setBasari(
        `${islemYapilan.kayit.portfoyNo} nolu ${islemYapilan.kayit.tur === "cek" ? "çek" : "senet"}: ` +
          `${DURUMLAR[islemYapilan.durum]?.baslik ?? islemYapilan.durum} olarak işlendi.`,
      );
      setIslemYapilan(null);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Durum güncellenemedi");
    }
  }

  return (
    <div>
      <PageHeader
        title="Çek & Senet"
        subtitle="Portföyünüzdeki çek ve senetleri takip edin; ciro, tahsil, karşılıksız ve iade işlemlerini kaydedin."
        actions={
          <>
            <ButtonLabel as="a" href="/panel/kasa-banka">
              ← Kasa & Banka
            </ButtonLabel>
            <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
              {formAcik ? "Vazgeç" : "➕ Yeni Çek/Senet"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <StatGrid>
        <Stat label="Portföydeki" value={para(ozet.toplam)} tone="accent" hint={`${ozet.adet} adet`} />
        <Stat
          label="Vadesi Geçmiş"
          value={para(ozet.geciken)}
          tone={ozet.gecikenAdet > 0 ? "danger" : "default"}
          hint={`${ozet.gecikenAdet} adet`}
        />
        <Stat
          label="30 Gün İçinde"
          value={para(ozet.yaklasan)}
          tone={ozet.yaklasanAdet > 0 ? "info" : "default"}
          hint={`${ozet.yaklasanAdet} adet vadesi yaklaşan`}
        />
      </StatGrid>

      {formAcik && (
        <CekSenetFormu
          cariler={cariler}
          onKaydet={async (govde) => {
            setHata("");
            setBasari("");
            try {
              await api("/kasa-banka/cek-senet", { method: "POST", body: JSON.stringify(govde) });
              setBasari("Çek/senet portföye eklendi.");
              setFormAcik(false);
              await yukle();
              return true;
            } catch (h) {
              setHata(h instanceof Error ? h.message : "Kayıt başarısız");
              return false;
            }
          }}
        />
      )}

      <div className="toolbar" style={{ marginTop: "1.25rem" }}>
        <Segmented<TurFiltre>
          value={tur}
          onChange={setTur}
          items={[
            { deger: "hepsi", baslik: "Tümü" },
            { deger: "cek", baslik: "Çekler" },
            { deger: "senet", baslik: "Senetler" },
          ]}
        />
        <Select value={durumFiltre} onChange={(e) => setDurumFiltre(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Tüm durumlar</option>
          {Object.entries(DURUMLAR).map(([deger, d]) => (
            <option key={deger} value={deger}>
              {d.baslik}
            </option>
          ))}
        </Select>
      </div>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Portföy No</th>
              <th>Tür</th>
              <th>Borçlu</th>
              <th>Vade</th>
              <th className="num">Tutar</th>
              <th>Durum</th>
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {kayitlar.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  Filtreye uyan çek/senet bulunamadı.
                </td>
              </tr>
            ) : (
              kayitlar.map((k) => {
                const kalan = vadeyeKalanGun(k.vadeTarihi);
                const portfoyde = k.durum === "portfoyde";
                const gecikti = portfoyde && kalan < 0;
                return (
                  <tr key={k.id}>
                    <td className="mono">{k.portfoyNo}</td>
                    <td>
                      <Badge variant={k.tur === "cek" ? "info" : "neutral"}>
                        {k.tur === "cek" ? "🧾 Çek" : "📜 Senet"}
                      </Badge>
                    </td>
                    <td>
                      <div className="cell-entity__name">{k.borclu}</div>
                      {k.cari && <div className="cell-entity__meta">{k.cari.unvan}</div>}
                      {k.ciroCari && <div className="cell-entity__meta">Ciro: {k.ciroCari.unvan}</div>}
                    </td>
                    <td>
                      <div className="mono">{k.vadeTarihi.slice(0, 10)}</div>
                      {portfoyde && (
                        <div
                          className="cell-entity__meta"
                          style={{ color: gecikti ? "var(--danger)" : undefined }}
                        >
                          {gecikti
                            ? `${Math.abs(kalan)} gün gecikti`
                            : kalan === 0
                              ? "Bugün"
                              : `${kalan} gün kaldı`}
                        </div>
                      )}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {para(k.tutar, k.dovizCinsi)}
                      {k.dovizCinsi !== "TRY" && (
                        <div className="cell-entity__meta">≈ {para(k.tutarTry)}</div>
                      )}
                    </td>
                    <td>
                      <Badge variant={DURUMLAR[k.durum]?.renk ?? "neutral"}>
                        {DURUMLAR[k.durum]?.baslik ?? k.durum}
                      </Badge>
                    </td>
                    <td className="center">
                      {portfoyde ? (
                        <div className="row-tight" style={{ justifyContent: "center", flexWrap: "wrap" }}>
                          <Button size="sm" variant="primary" onClick={() => setIslemYapilan({ kayit: k, durum: "tahsil_edildi" })}>
                            Tahsil Et
                          </Button>
                          <Button size="sm" onClick={() => setIslemYapilan({ kayit: k, durum: "ciro_edildi" })}>
                            Ciro Et
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setIslemYapilan({ kayit: k, durum: "karsiliksiz" })}>
                            Karşılıksız
                          </Button>
                          <Button size="sm" onClick={() => setIslemYapilan({ kayit: k, durum: "iade_edildi" })}>
                            İade Et
                          </Button>
                        </div>
                      ) : (
                        <span className="muted" style={{ fontSize: "0.85rem" }}>
                          İşlem tamamlandı
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>

      {islemYapilan && (
        <DurumKarti
          kayit={islemYapilan.kayit}
          durum={islemYapilan.durum}
          cariler={cariler}
          kasalar={kasalar}
          bankalar={bankalar}
          onVazgec={() => setIslemYapilan(null)}
          onOnayla={durumGuncelle}
        />
      )}
    </div>
  );
}

/* ─── Giriş formu ────────────────────────────────────────────────────────── */

function CekSenetFormu({
  cariler,
  onKaydet,
}: {
  cariler: CariOzet[];
  onKaydet: (govde: Record<string, unknown>) => Promise<boolean>;
}) {
  const [tur, setTur] = useState<"cek" | "senet">("cek");
  const [portfoyNo, setPortfoyNo] = useState("");
  const [vadeTarihi, setVadeTarihi] = useState(bugun());
  const [tutar, setTutar] = useState("");
  const [dovizCinsi, setDovizCinsi] = useState("TRY");
  const [kur, setKur] = useState("1");
  const [borclu, setBorclu] = useState("");
  const [kesideYeri, setKesideYeri] = useState("");
  const [banka, setBanka] = useState("");
  const [sube, setSube] = useState("");
  const [hesapNo, setHesapNo] = useState("");
  const [cariId, setCariId] = useState("");
  const [aciklama, setAciklama] = useState("");

  const bosNull = (d: string) => (d.trim() === "" ? null : d.trim());

  async function kaydet() {
    const ok = await onKaydet({
      tur,
      portfoyNo: portfoyNo.trim(),
      vadeTarihi,
      tutar,
      dovizCinsi,
      kur: dovizCinsi === "TRY" ? "1" : kur || "1",
      borclu: borclu.trim(),
      kesideYeri: bosNull(kesideYeri),
      banka: bosNull(banka),
      sube: bosNull(sube),
      hesapNo: bosNull(hesapNo),
      cariId: cariId === "" ? null : cariId,
      aciklama: bosNull(aciklama),
    });
    if (ok) {
      setPortfoyNo("");
      setTutar("");
      setBorclu("");
      setKesideYeri("");
      setBanka("");
      setSube("");
      setHesapNo("");
      setCariId("");
      setAciklama("");
    }
  }

  return (
    <Card className="stack" style={{ marginTop: "1.25rem" }}>
      <div className="card__title">Yeni Çek/Senet</div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Tür *">
            <Select value={tur} onChange={(e) => setTur(e.target.value as "cek" | "senet")}>
              <option value="cek">🧾 Çek</option>
              <option value="senet">📜 Senet</option>
            </Select>
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Field label="Portföy No *">
            <Input value={portfoyNo} onChange={(e) => setPortfoyNo(e.target.value)} placeholder="CK-2026-001" />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Field label="Vade Tarihi *">
            <Input type="date" value={vadeTarihi} onChange={(e) => setVadeTarihi(e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Tutar *">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={tutar}
              onChange={(e) => setTutar(e.target.value)}
              placeholder="0,00"
            />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 110 }}>
          <Field label="Döviz">
            <Select value={dovizCinsi} onChange={(e) => setDovizCinsi(e.target.value)}>
              <option value="TRY">TRY</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </Select>
          </Field>
        </div>
        {dovizCinsi !== "TRY" && (
          <div style={{ flex: 1, minWidth: 130 }}>
            <Field label="Kur *">
              <Input type="number" step="0.000001" min="0" value={kur} onChange={(e) => setKur(e.target.value)} />
            </Field>
          </div>
        )}
      </div>

      <div className="row">
        <div style={{ flex: 2, minWidth: 220 }}>
          <Field label="Borçlu (keşideci) *">
            <Input value={borclu} onChange={(e) => setBorclu(e.target.value)} placeholder="Çeki keşide eden kişi/firma" />
          </Field>
        </div>
        <div style={{ flex: 2, minWidth: 220 }}>
          <Field label="İlgili Cari">
            <Select value={cariId} onChange={(e) => setCariId(e.target.value)}>
              <option value="">— Cari bağlantısı yok —</option>
              {cariler.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kod} · {c.unvan}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Keşide Yeri">
            <Input value={kesideYeri} onChange={(e) => setKesideYeri(e.target.value)} placeholder="İstanbul" />
          </Field>
        </div>
      </div>

      {cariId && (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          Seçili cariye çek/senet tutarı kadar <strong>alacak</strong> kaydı yazılır (borcu azalır).
        </p>
      )}

      {tur === "cek" && (
        <div className="row">
          <div style={{ flex: 1, minWidth: 170 }}>
            <Field label="Banka">
              <Input value={banka} onChange={(e) => setBanka(e.target.value)} placeholder="Örn. Ziraat Bankası" />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <Field label="Şube">
              <Input value={sube} onChange={(e) => setSube(e.target.value)} />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <Field label="Hesap No">
              <Input value={hesapNo} onChange={(e) => setHesapNo(e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      <Field label="Açıklama">
        <Input value={aciklama} onChange={(e) => setAciklama(e.target.value)} />
      </Field>

      <div>
        <Button
          variant="primary"
          onClick={kaydet}
          disabled={portfoyNo.trim() === "" || borclu.trim().length < 2 || !tutar || Number(tutar) <= 0}
        >
          Portföye Ekle
        </Button>
      </div>
    </Card>
  );
}

/* ─── Durum işlem kartı ──────────────────────────────────────────────────── */

function DurumKarti({
  kayit,
  durum,
  cariler,
  kasalar,
  bankalar,
  onVazgec,
  onOnayla,
}: {
  kayit: CekSenet;
  durum: string;
  cariler: CariOzet[];
  kasalar: Hesap[];
  bankalar: Hesap[];
  onVazgec: () => void;
  onOnayla: (govde: Record<string, unknown>) => void;
}) {
  const [ciroCariId, setCiroCariId] = useState("");
  const [hesap, setHesap] = useState("");
  const [tahsilTarihi, setTahsilTarihi] = useState(bugun());
  const [aciklama, setAciklama] = useState("");

  const tahsil = durum === "tahsil_edildi";
  const ciro = durum === "ciro_edildi";

  // Karışık para birimi engellendiği için yalnız aynı dövizli hesaplar seçilebilir
  const uygunKasalar = kasalar.filter((k) => k.dovizCinsi === kayit.dovizCinsi);
  const uygunBankalar = bankalar.filter((b) => b.dovizCinsi === kayit.dovizCinsi);

  function onayla() {
    const govde: Record<string, unknown> = { durum };
    if (aciklama.trim() !== "") govde.aciklama = aciklama.trim();
    if (ciro) govde.ciroCariId = ciroCariId;
    if (tahsil) {
      const [tip, id] = hesap.split(":");
      if (tip === "kasa") govde.tahsilKasaId = id;
      else govde.tahsilBankaHesapId = id;
      govde.tahsilTarihi = tahsilTarihi;
    }
    onOnayla(govde);
  }

  const gecerli = ciro ? ciroCariId !== "" : tahsil ? hesap !== "" : true;

  return (
    <Card className="stack" style={{ marginTop: "1.5rem", borderColor: "var(--accent)" }}>
      <div className="between">
        <div className="card__title" style={{ margin: 0 }}>
          {DURUMLAR[durum]?.baslik ?? durum} — {kayit.portfoyNo}
        </div>
        <Button size="sm" onClick={onVazgec}>
          ✖ Vazgeç
        </Button>
      </div>

      <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
        {kayit.borclu} · vade {kayit.vadeTarihi.slice(0, 10)} · <strong>{para(kayit.tutar, kayit.dovizCinsi)}</strong>
      </p>

      {ciro && (
        <>
          <Field label="Ciro Edilen Cari *">
            <Select value={ciroCariId} onChange={(e) => setCiroCariId(e.target.value)}>
              <option value="">— Cari seçin —</option>
              {cariler.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kod} · {c.unvan}
                </option>
              ))}
            </Select>
          </Field>
          <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
            Ciro edilen cariye tutar kadar <strong>alacak</strong> yazılır (ona olan borcumuz azalır).
          </p>
        </>
      )}

      {tahsil && (
        <>
          <div className="row">
            <div style={{ flex: 2, minWidth: 220 }}>
              <Field label="Paranın Gireceği Hesap *">
                <Select value={hesap} onChange={(e) => setHesap(e.target.value)}>
                  <option value="">— Kasa ya da banka seçin —</option>
                  {uygunKasalar.map((k) => (
                    <option key={k.id} value={`kasa:${k.id}`}>
                      💵 {k.ad} ({k.dovizCinsi})
                    </option>
                  ))}
                  {uygunBankalar.map((b) => (
                    <option key={b.id} value={`banka:${b.id}`}>
                      🏦 {b.ad} ({b.dovizCinsi})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <Field label="Tahsil Tarihi">
                <Input type="date" value={tahsilTarihi} onChange={(e) => setTahsilTarihi(e.target.value)} />
              </Field>
            </div>
          </div>
          {uygunKasalar.length + uygunBankalar.length === 0 && (
            <Alert tone="error">
              {kayit.dovizCinsi} cinsinden tanımlı kasa/banka hesabı yok. Tahsil için önce Kasa &amp; Banka
              ekranından {kayit.dovizCinsi} hesabı açmalısınız.
            </Alert>
          )}
          <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
            Seçilen hesaba <strong>{para(kayit.tutar, kayit.dovizCinsi)}</strong> tutarında tahsilat fişi yazılır.
            {kayit.cari
              ? " Cari, çek alımında zaten alacaklandırıldığı için yeniden cari hareketi oluşturulmaz."
              : ""}
          </p>
        </>
      )}

      {durum === "karsiliksiz" && (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          Karşılıksız işaretlenen çek/senet portföyden düşer; para hareketi oluşmaz. Borçludan tahsilat için
          cari hareketi elle girilmelidir.
        </p>
      )}

      {durum === "iade_edildi" && (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          İade edilen çek/senet portföyden düşer; para hareketi oluşmaz.
        </p>
      )}

      <Field label="Açıklama">
        <Input
          value={aciklama}
          onChange={(e) => setAciklama(e.target.value)}
          placeholder="İsteğe bağlı not"
        />
      </Field>

      <div>
        <Button variant="primary" onClick={onayla} disabled={!gecerli}>
          Onayla
        </Button>
      </div>
    </Card>
  );
}
