"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ROLLER, type Rol } from "@tekirextra/shared";
import { Alert, Badge, Card, Field, PageHeader, Select } from "@/components/ui";
import { AYARLAR, MENU, type MenuOge } from "@/lib/menu";
import { ROL_ADI } from "@/lib/rol-adlari";
import { rolMenuYoluGorebilir } from "@/lib/rol-yetkileri";

/**
 * Rol yetkileri özeti. Menünün ve sayfa korumasının kullandığı kuraldan
 * (`rolMenuYoluGorebilir`) üretilir; burada değiştirilmez. Önceki "İzin
 * Matrisi" hiçbir yere kaydetmediği hâlde "kaydedildi" diyordu.
 */
export default function RolYetkileriSayfasi() {
  const [rol, setRol] = useState<Rol>("muhasebe");
  const gruplar = useMemo(
    () => [...MENU.map((a) => ({ baslik: a.baslik, ogeler: a.ogeler })), { baslik: "Ayarlar", ogeler: AYARLAR }],
    [],
  );
  const erisir = (o: MenuOge) => rolMenuYoluGorebilir(rol, o.href);
  const toplam = gruplar.reduce((t, g) => t + g.ogeler.length, 0);
  const acik = gruplar.reduce((t, g) => t + g.ogeler.filter(erisir).length, 0);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <PageHeader
        title="Rol Yetkileri"
        subtitle="Her rolün hangi ekranlara girebildiği. Liste sistemin uyguladığı kuraldan üretilir; bir kullanıcının yetkisini değiştirmek için rolünü Kullanıcılar ekranından değiştirin."
        actions={<Link className="btn btn--ghost" href="/panel/ayarlar/kullanicilar">← Kullanıcılar</Link>}
      />
      <Alert tone="warning">
        Rollerin yetkileri sabittir ve bu ekrandan değiştirilemez. Yönetici her ekrana girer. Ekranın içindeki işlemler (onaylama, silme gibi) ayrıca sunucuda rolle denetlenir.
      </Alert>
      <Card className="stack">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ minWidth: 240 }}>
            <Field label="Rol">
              <Select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
                {ROLLER.map((r) => <option key={r} value={r}>{ROL_ADI[r]}</option>)}
              </Select>
            </Field>
          </div>
          <p className="muted" style={{ margin: 0 }}>{ROL_ADI[rol]} rolü {toplam} ekrandan <strong>{acik}</strong> tanesine girebilir.</p>
        </div>
        {gruplar.map((g) => {
          const acikOgeler = g.ogeler.filter(erisir);
          return (
            <section key={g.baslik} aria-label={g.baslik}>
              <h3 className="card__title" style={{ fontSize: "1rem" }}>
                {g.baslik} <Badge variant={acikOgeler.length ? "success" : "neutral"}>{acikOgeler.length} / {g.ogeler.length}</Badge>
              </h3>
              <ul className="rol-yetki-listesi">
                {g.ogeler.map((o) => (
                  <li key={o.href} className={erisir(o) ? "is-acik" : "is-kapali"}>
                    <span aria-hidden="true">{erisir(o) ? "✓" : "—"}</span> {o.baslik}
                    <span className="sr-only">{erisir(o) ? " (erişebilir)" : " (erişemez)"}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </Card>
    </div>
  );
}
