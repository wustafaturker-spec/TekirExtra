/**
 * TekirExtra UI bileşen kütüphanesi.
 * globals.css'teki tasarım sistemi sınıflarını saran, tiplenmiş React bileşenleri.
 * Renk/ölçü bilgisi burada DEĞİL — hepsi CSS token'larından gelir.
 */
import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
} from "react";

/* ─── Sınıf birleştirici ─────────────────────────────────────────────────── */
function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ─── Buton ──────────────────────────────────────────────────────────────── */
type ButtonVariant = "primary" | "ghost" | "danger";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  block?: boolean;
}
export function Button({ variant = "ghost", size = "md", block, className, ...rest }: ButtonProps) {
  return (
    <button
      className={cx("btn", `btn--${variant}`, size === "sm" && "btn--sm", block && "btn--block", className)}
      {...rest}
    />
  );
}

/* Buton görünümlü etiket/bağlantı (dosya seçimi, <a> vb. için) */
export function ButtonLabel({
  as = "label",
  variant = "ghost",
  size = "md",
  className,
  children,
  href,
  ...rest
}: {
  as?: "label" | "a";
  variant?: ButtonVariant;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
  href?: string;
} & Record<string, unknown>) {
  const cls = cx("btn", `btn--${variant}`, size === "sm" && "btn--sm", className);
  if (as === "a") return <a className={cls} href={href} {...rest}>{children}</a>;
  return <label className={cls} style={{ cursor: "pointer" }} {...rest}>{children}</label>;
}

/* ─── Kart ───────────────────────────────────────────────────────────────── */
export function Card({
  pad = true,
  title,
  actions,
  className,
  style,
  children,
  ...rest
}: {
  pad?: boolean;
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "title">) {
  return (
    <div className={cx("card", pad && "card--pad", className)} style={style} {...rest}>
      {(title || actions) && (
        <div className="between" style={{ marginBottom: "1rem" }}>
          {title && <div className="card__title" style={{ margin: 0 }}>{title}</div>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

/* ─── Sayfa başlığı ──────────────────────────────────────────────────────── */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/* ─── KPI kartları ───────────────────────────────────────────────────────── */
type StatTone = "default" | "accent" | "success" | "danger" | "info";
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}
export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className="stat">
      <p className="stat__label">{label}</p>
      <p className={cx("stat__value", tone !== "default" && `is-${tone}`)}>{value}</p>
      {hint && <p className="stat__hint">{hint}</p>}
    </div>
  );
}

/* ─── Rozet ──────────────────────────────────────────────────────────────── */
type BadgeVariant = "neutral" | "accent" | "success" | "info" | "danger" | "warning";
export function Badge({ variant = "neutral", children }: { variant?: BadgeVariant; children: ReactNode }) {
  return <span className={cx("badge", `badge--${variant}`)}>{children}</span>;
}

/* ─── Durum noktası ──────────────────────────────────────────────────────── */
export function Status({ tone, children }: { tone: "ok" | "warn" | "danger"; children: ReactNode }) {
  return (
    <span className="status">
      <span aria-hidden="true" className={cx("status__dot", `is-${tone}`)} />
      {children}
    </span>
  );
}

/* ─── Avatar (isimden deterministik renk) ────────────────────────────────── */
const AVATAR_RENKLERI = ["#e8792b", "#2563eb", "#db2777", "#059669", "#7c3aed", "#0891b2", "#d97706", "#dc2626"];
export function Avatar({ isim }: { isim: string }) {
  const harf = isim.trim().charAt(0).toUpperCase() || "?";
  const renk = AVATAR_RENKLERI[harf.charCodeAt(0) % AVATAR_RENKLERI.length];
  return <span aria-hidden="true" className="avatar" style={{ background: renk }}>{harf}</span>;
}

/* ─── Sekmeler ───────────────────────────────────────────────────────────── */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel = "Sekmeler",
  idPrefix,
}: {
  items: { deger: T; baslik: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
  idPrefix?: string;
}) {
  function klavyeGezin(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let hedef = index;
    if (e.key === "ArrowRight") hedef = (index + 1) % items.length;
    else if (e.key === "ArrowLeft") hedef = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") hedef = 0;
    else if (e.key === "End") hedef = items.length - 1;
    else return;

    e.preventDefault();
    onChange(items[hedef].deger);
    const dugmeler = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]");
    dugmeler?.[hedef]?.focus();
  }

  return (
    <div aria-label={ariaLabel} className="tabs" role="tablist">
      {items.map((it, index) => (
        <button
          aria-controls={idPrefix ? `${idPrefix}-panel-${it.deger}` : undefined}
          aria-selected={value === it.deger}
          id={idPrefix ? `${idPrefix}-tab-${it.deger}` : undefined}
          key={it.deger}
          type="button"
          className={cx("tab", value === it.deger && "is-active")}
          onClick={() => onChange(it.deger)}
          onKeyDown={(e) => klavyeGezin(e, index)}
          role="tab"
          tabIndex={value === it.deger ? 0 : -1}
        >
          {it.baslik}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  idPrefix,
  value,
  children,
}: {
  idPrefix: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-labelledby={`${idPrefix}-tab-${value}`}
      id={`${idPrefix}-panel-${value}`}
      role="tabpanel"
      tabIndex={0}
    >
      {children}
    </div>
  );
}

/* ─── Segmented control ──────────────────────────────────────────────────── */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  ariaLabel = "Görünüm seçenekleri",
}: {
  items: { deger: T; baslik: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div aria-label={ariaLabel} className="segmented" role="group">
      {items.map((it) => (
        <button
          aria-pressed={value === it.deger}
          key={it.deger}
          type="button"
          className={cx("segmented__btn", value === it.deger && "is-active")}
          onClick={() => onChange(it.deger)}
        >
          {it.baslik}
        </button>
      ))}
    </div>
  );
}

/* ─── Form ───────────────────────────────────────────────────────────────── */
export function Field({
  label,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  const uretilenId = useId();
  const cocukTipi = isValidElement(children)
    ? children.type as unknown as { name?: string; displayName?: string; render?: { name?: string } }
    : null;
  const cocukAdi = cocukTipi?.displayName ?? cocukTipi?.name ?? cocukTipi?.render?.name ?? "";
  const dogrudanKontrol = isValidElement<{ id?: string }>(children)
    && ["Input", "Select", "SearchInput"].includes(cocukAdi);
  const kontrolId = htmlFor ?? (dogrudanKontrol ? children.props.id ?? uretilenId : undefined);
  const icerik = dogrudanKontrol && !children.props.id
    ? cloneElement(children, { id: kontrolId })
    : children;
  return (
    <div className={cx("field", className)}>
      {label && <label className="field-label" htmlFor={kontrolId}>{label}</label>}
      {icerik}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input className={cx("input", className)} ref={ref} {...rest} />;
  },
);

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("select", className)} {...rest} />;
}

export function SearchInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx("search", className)}>
      <span aria-hidden="true" className="search__icon">🔍</span>
      <Input {...rest} />
    </div>
  );
}

/* ─── Uyarı satırı ───────────────────────────────────────────────────────── */
export function Alert({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  if (!children) return null;
  const isError = tone === "error";

  return (
    <div
      aria-atomic="true"
      aria-live={isError ? "assertive" : "polite"}
      className={cx("alert", `alert--${tone}`)}
      role={isError ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

/* ─── Tablo (ince sarmalayıcı) ───────────────────────────────────────────── */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="table">{children}</table>
    </div>
  );
}
