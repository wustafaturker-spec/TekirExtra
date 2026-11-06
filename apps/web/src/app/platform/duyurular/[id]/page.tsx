"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { use, useState } from "react";
import { Alert, Button, PageHeader } from "@/components/ui";
import { PlatformDuyuruEditoru } from "@/components/platform-duyuru-editoru";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import type { Duyuru } from "@/lib/platform-duyurulari";

export default function DuyuruDetayi({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { veri, hata, yukleniyor, yenile } = usePlatformVerisi<Duyuru>(`/platform/duyurular/${id}`);
  const [baslik, setBaslik] = useState<string | null>(null);
  return <div className="stack duyuru-sayfasi"><Link className="duyuru-geri" href="/platform/duyurular"><ArrowLeft size={15} aria-hidden="true" />Duyurulara dön</Link><PageHeader title={baslik ?? veri?.baslik ?? "Duyuru"} subtitle="İçerik, önizleme ve değişiklik geçmişi." />{yukleniyor && <p role="status">Duyuru yükleniyor…</p>}{hata && <Alert tone="error">{hata}<Button onClick={yenile}>Tekrar dene</Button></Alert>}{veri && <PlatformDuyuruEditoru key={veri.id} ilk={veri} onKayit={(d) => setBaslik(d.baslik)} />}</div>;
}
