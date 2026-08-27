"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, TableWrap } from "@/components/ui";

type Modul = "fatura" | "stok" | "cari" | "kasaBanka" | "personel" | "uretim" | "raporlar";
type Eylem = "oku" | "olustur" | "duzenle" | "sil" | "onayla" | "disaAktar";
type Rol = "yonetici" | "muhasebe" | "satis" | "depo" | "mali_musavir" | "uretim_planlama";

interface IzinKural {
  modul: Modul;
  modulAd: string;
  eylemler: Record<Eylem, Record<Rol, boolean>>;
}

const ROLLER: Array<{ id: Rol; ad: string; renk: string }> = [
  { id: "yonetici", ad: "Yönetici", renk: "#714b67" },
  { id: "muhasebe", ad: "Muhasebe", renk: "#0284c7" },
  { id: "satis", ad: "Satış Temsilcisi", renk: "#16a34a" },
  { id: "depo", ad: "Depo Sorumlusu", renk: "#d97706" },
  { id: "mali_musavir", ad: "Mali Müşavir", renk: "#9333ea" },
  { id: "uretim_planlama", ad: "Üretim Planlama", renk: "#0891b2" },
];

const EYLEM_ETIKETLERI: Record<Eylem, string> = {
  oku: "Görüntüleme (Read)",
  olustur: "Oluşturma (Create)",
  duzenle: "Düzenleme (Update)",
  sil: "Silme (Delete)",
  onayla: "Onaylama / Kesinleştirme",
  disaAktar: "Dışa Aktarma (Excel/PDF)",
};

const VARSAYILAN_IZINLER: IzinKural[] = [
  {
    modul: "fatura",
    modulAd: "🧾 Fatura Yönetimi",
    eylemler: {
      oku: { yonetici: true, muhasebe: true, satis: true, depo: false, mali_musavir: true, uretim_planlama: false },
      olustur: { yonetici: true, muhasebe: true, satis: true, depo: false, mali_musavir: false, uretim_planlama: false },
      duzenle: { yonetici: true, muhasebe: true, satis: false, depo: false, mali_musavir: false, uretim_planlama: false },
      sil: { yonetici: true, muhasebe: false, satis: false, depo: false, mali_musavir: false, uretim_planlama: false },
      onayla: { yonetici: true, muhasebe: true, satis: false, depo: false, mali_musavir: false, uretim_planlama: false },
      disaAktar: { yonetici: true, muhasebe: true, satis: true, depo: false, mali_musavir: true, uretim_planlama: false },
    },
  },
  {
    modul: "stok",
    modulAd: "📦 Stok & Depo Yönetimi",
    eylemler: {
      oku: { yonetici: true, muhasebe: true, satis: true, depo: true, mali_musavir: true, uretim_planlama: true },
      olustur: { yonetici: true, muhasebe: true, satis: false, depo: true, mali_musavir: false, uretim_planlama: true },
      duzenle: { yonetici: true, muhasebe: true, satis: false, depo: true, mali_musavir: false, uretim_planlama: true },
      sil: { yonetici: true, muhasebe: false, satis: false, depo: false, mali_musavir: false, uretim_planlama: false },
      onayla: { yonetici: true, muhasebe: true, satis: false, depo: true, mali_musavir: false, uretim_planlama: true },
      disaAktar: { yonetici: true, muhasebe: true, satis: true, depo: true, mali_musavir: true, uretim_planlama: true },
    },
  },
  {
    modul: "cari",
    modulAd: "👥 Müşteri & Tedarikçi (Cari)",
    eylemler: {
      oku: { yonetici: true, muhasebe: true, satis: true, depo: false, mali_musavir: true, uretim_planlama: false },
      olustur: { yonetici: true, muhasebe: true, satis: true, depo: false, mali_musavir: false, uretim_planlama: false },
      duzenle: { yonetici: true, muhasebe: true, satis: true, depo: false, mali_musavir: false, uretim_planlama: false },
      sil: { yonetici: true, muhasebe: false, satis: false, depo: false, mali_musavir: false, uretim_planlama: false },
      onayla: { yonetici: true, muhasebe: true, satis: false, depo: false, mali_musavir: false, uretim_planlama: false },
      disaAktar: { yonetici: true, muhasebe: true, satis: true, depo: false, mali_musavir: true, uretim_planlama: false },
    },
  },
  {
    modul: "kasaBanka",
    modulAd: "🏛 Kasa & Banka Hareketleri",
    eylemler: {
      oku: { yonetici: true, muhasebe: true, satis: false, depo: false, mali_musavir: true, uretim_planlama: false },
      olustur: { yonetici: true, muhasebe: true, satis: false, depo: false, mali_musavir: false, uretim_planlama: false },
      duzenle: { yonetici: true, muhasebe: true, satis: false, depo: false, mali_musavir: false, uretim_planlama: false },
      sil: { yonetici: true, muhasebe: false, satis: false, depo: false, mali_musavir: false, uretim_planlama: false },
      onayla: { yonetici: true, muhasebe: true, satis: false, depo: false, mali_musavir: false, uretim_planlama: false },
      disaAktar: { yonetici: true, muhasebe: true, satis: false, depo: false, mali_musavir: true, uretim_planlama: false },
    },
  },
  {
    modul: "uretim",
    modulAd: "⚙️ Üretim & Reçete (MRP/MES)",
    eylemler: {
      oku: { yonetici: true, muhasebe: true, satis: false, depo: true, mali_musavir: false, uretim_planlama: true },
      olustur: { yonetici: true, muhasebe: false, satis: false, depo: false, mali_musavir: false, uretim_planlama: true },
      duzenle: { yonetici: true, muhasebe: false, satis: false, depo: false, mali_musavir: false, uretim_planlama: true },
      sil: { yonetici: true, muhasebe: false, satis: false, depo: false, mali_musavir: false, uretim_planlama: false },
      onayla: { yonetici: true, muhasebe: true, satis: false, depo: true, mali_musavir: false, uretim_planlama: true },
      disaAktar: { yonetici: true, muhasebe: true, satis: false, depo: true, mali_musavir: false, uretim_planlama: true },
    },
  },
];

export default function IzinMatrisiSayfasi() {
  const [izinler, setIzinler] = useState<IzinKural[]>(VARSAYILAN_IZINLER);
  const [seciliRol, setSeciliRol] = useState<Rol>("satis");
  const [basari, setBasari] = useState("");

  const izinDegistir = (modulIndex: number, eylem: Eylem, rol: Rol) => {
    if (rol === "yonetici") return; // Yönetici izinleri kilitlidir
    setIzinler((prev) => {
      const yeni = JSON.parse(JSON.stringify(prev)) as IzinKural[];
      yeni[modulIndex].eylemler[eylem][rol] = !yeni[modulIndex].eylemler[eylem][rol];
      return yeni;
    });
  };

  const kaydet = () => {
    setBasari("Rol ve modül bazlı izin matrisi başarıyla güncellendi ve kaydedildi.");
    setTimeout(() => setBasari(""), 4000);
  };

  return (
    <div style={{ backgroundColor: "#f8fafc", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#0f172a", padding: "24px" }}>
      
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: "800", margin: 0, color: "#0f172a" }}>🛡️ İnce Ayarlı İzin Matrisi (Fine-Grained RBAC)</h1>
          <p style={{ fontSize: "12px", color: "#64748b", margin: "4px 0 0 0" }}>
            Kullanıcı rollerine özel modül ve aksiyon bazlı (Görüntüleme, Oluşturma, Silme, Onaylama) erişim kısıtlamalarını yönetin.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <Link href="/panel/ayarlar/kullanicilar" style={{ padding: "8px 16px", backgroundColor: "#e2e8f0", color: "#334155", borderRadius: "6px", textDecoration: "none", fontSize: "12px", fontWeight: "700" }}>
            ← Kullanıcılar Listesi
          </Link>
          <Button variant="primary" onClick={kaydet}>
            💾 İzin Matrisini Kaydet
          </Button>
        </div>
      </div>

      {basari && <div style={{ marginBottom: "16px" }}><Alert tone="success">{basari}</Alert></div>}

      {/* Role Selection Tabs */}
      <Card style={{ marginBottom: "20px", padding: "16px" }}>
        <div style={{ fontSize: "12px", fontWeight: "700", color: "#475569", marginBottom: "10px" }}>Düzenlemek İçin Rol Seçin:</div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {ROLLER.map((r) => (
            <button
              key={r.id}
              onClick={() => setSeciliRol(r.id)}
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                border: "1px solid",
                borderColor: seciliRol === r.id ? r.renk : "#cbd5e1",
                backgroundColor: seciliRol === r.id ? r.renk : "#ffffff",
                color: seciliRol === r.id ? "#ffffff" : "#334155",
                fontSize: "12px",
                fontWeight: "700",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {r.ad} {r.id === "yonetici" && "🔒"}
            </button>
          ))}
        </div>
      </Card>

      {/* Permission Matrix Table */}
      <Card pad={false}>
        <div style={{ padding: "14px 20px", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "13px", fontWeight: "800", color: "#334155" }}>
            Seçili Rol Yetki Haritası: <Badge variant="info">{ROLLER.find((r) => r.id === seciliRol)?.ad}</Badge>
          </span>
          {seciliRol === "yonetici" && (
            <span style={{ fontSize: "11px", color: "#714b67", fontWeight: "700" }}>
              🔒 Yönetici rolü tüm sistem uçlarına tam yetkilidir.
            </span>
          )}
        </div>

        <TableWrap>
          <thead>
            <tr style={{ backgroundColor: "#f8fafc", color: "#475569" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", width: "260px" }}>Modül / Alan</th>
              {(Object.keys(EYLEM_ETIKETLERI) as Eylem[]).map((eylem) => (
                <th key={eylem} style={{ padding: "12px 16px", textAlign: "center" }}>
                  {EYLEM_ETIKETLERI[eylem]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {izinler.map((modulKurali, mIdx) => (
              <tr key={modulKurali.modul} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>
                  {modulKurali.modulAd}
                </td>
                {(Object.keys(EYLEM_ETIKETLERI) as Eylem[]).map((eylem) => {
                  const izinli = modulKurali.eylemler[eylem][seciliRol];
                  return (
                    <td key={eylem} style={{ padding: "14px 16px", textAlign: "center" }}>
                      <button
                        type="button"
                        disabled={seciliRol === "yonetici"}
                        onClick={() => izinDegistir(mIdx, eylem, seciliRol)}
                        style={{
                          width: "34px",
                          height: "34px",
                          borderRadius: "8px",
                          border: "none",
                          cursor: seciliRol === "yonetici" ? "not-allowed" : "pointer",
                          backgroundColor: izinli ? "#dcfce7" : "#fee2e2",
                          color: izinli ? "#16a34a" : "#dc2626",
                          fontWeight: "900",
                          fontSize: "14px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {izinli ? "✓" : "✕"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

    </div>
  );
}
