"use client";

import Link from "next/link";
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff, FilePenLine, History, ShieldCheck } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";

export function PlatformAuth({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="platform-auth">
    <aside className="platform-auth-intro">
      <Link href="/platform/giris" className="platform-auth-brand"><span className="auth-brand-mark">TE</span><span><strong>Mevzuat Merkezi</strong><small>TekirExtra · Platform ekibi</small></span></Link>
      <div className="platform-auth-message"><span className="platform-auth-eyebrow">Platform çalışma alanı</span><h2>Düzenlemeleri güvenle yönetin.</h2><p>Hazırlıktan yayına kadar mevzuat değişikliklerini tek yerden takip edin.</p><ul><li><FilePenLine size={20} aria-hidden="true" /><span>Dayanağı ve yürürlük tarihiyle taslak hazırlayın.</span></li><li><ShieldCheck size={20} aria-hidden="true" /><span>İkinci bir yetkilinin kontrolüyle yayınlayın.</span></li><li><History size={20} aria-hidden="true" /><span>Her işlemin geçmişini inceleyin.</span></li></ul></div>
      <p className="platform-auth-footnote">Yalnız platform yetkilileri için.</p>
    </aside>
    <div className="platform-auth-form-side"><div className="platform-auth-card"><header><span className="platform-auth-eyebrow">Mevzuat Merkezi</span><h1>{title}</h1><p>{description}</p></header>{children}</div></div>
  </main>;
}

export function PlatformParola({ label, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  const id = useId();
  const [gorunur, setGorunur] = useState(false);
  return <Field label={label} htmlFor={id}><div className="platform-password"><Input {...props} id={id} type={gorunur ? "text" : "password"} /><Button type="button" aria-label={gorunur ? `${label} alanını gizle` : `${label} alanını göster`} aria-pressed={gorunur} onClick={() => setGorunur(!gorunur)}>{gorunur ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</Button></div></Field>;
}
