"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui";
import { IletiSablonEditoru } from "@/components/ileti-sablon-editoru";

/** ILT-09: firmanın belge ve cari ileti metinleri. */
export default function IletiSablonlariSayfasi() {
  return <div>
    <PageHeader title="E-posta ve SMS Şablonları" subtitle="Müşterilerinize giden iletilerin konusu ve metni." />
    <p className="muted">Vade hatırlatma ve ihtar e-postalarının metni <Link href="/panel/ayarlar/moduller">Modül Ayarları</Link> altındaki Cari bölümünden düzenlenir.</p>
    <IletiSablonEditoru baslik="Şablonlar" istek={api} taban="/ileti-sablonlari" />
  </div>;
}
