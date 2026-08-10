import Link from "next/link";
import type { ReactNode } from "react";

export interface HizliEylem {
  href: string;
  baslik: string;
  aciklama: string;
  ikon: ReactNode;
  vurgu?: boolean;
}

export interface IsKuyrugu {
  href: string;
  baslik: string;
  aciklama: string;
  sayi?: number;
  ton?: "default" | "warning" | "danger";
}

export function CalismaAlani({
  baslik,
  aciklama,
  anaEylem,
  hizliEylemler,
  kuyruklar,
  altBaslik = "Sıradaki işler",
}: {
  baslik: string;
  aciklama: string;
  anaEylem: { href: string; baslik: string };
  hizliEylemler: HizliEylem[];
  kuyruklar: IsKuyrugu[];
  altBaslik?: string;
}) {
  return (
    <div className="workspace-page">
      <header className="workspace-head">
        <div>
          <p className="workspace-eyebrow">Çalışma alanı</p>
          <h1>{baslik}</h1>
          <p>{aciklama}</p>
        </div>
        <Link className="btn btn--primary workspace-primary" href={anaEylem.href}>
          <span aria-hidden="true">+</span>
          {anaEylem.baslik}
        </Link>
      </header>

      <section aria-labelledby="hizli-islemler">
        <h2 className="section-title" id="hizli-islemler">Hızlı işlemler</h2>
        <div className="action-grid">
          {hizliEylemler.map((eylem) => (
            <Link
              className={`action-tile${eylem.vurgu ? " is-primary" : ""}`}
              href={eylem.href}
              key={eylem.baslik}
            >
              <span className="action-tile__icon" aria-hidden="true">{eylem.ikon}</span>
              <span className="action-tile__body">
                <strong>{eylem.baslik}</strong>
                <small>{eylem.aciklama}</small>
              </span>
              <span className="action-tile__arrow" aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="is-kuyruklari">
        <div className="section-heading">
          <h2 className="section-title" id="is-kuyruklari">{altBaslik}</h2>
          <span className="section-meta">İlgili listeye gitmek için bir satır seçin</span>
        </div>
        <div className="queue-list">
          {kuyruklar.map((kuyruk) => (
            <Link className="queue-row" href={kuyruk.href} key={kuyruk.baslik}>
              <span aria-hidden="true" className={`queue-row__status is-${kuyruk.ton ?? "default"}`} />
              <span className="queue-row__body">
                <strong>{kuyruk.baslik}</strong>
                <small>{kuyruk.aciklama}</small>
              </span>
              {kuyruk.sayi !== undefined && (
                <span className="queue-row__count">{kuyruk.sayi}</span>
              )}
              <span className="queue-row__arrow" aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
