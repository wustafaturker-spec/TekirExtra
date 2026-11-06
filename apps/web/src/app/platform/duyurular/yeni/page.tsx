"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PlatformDuyuruEditoru } from "@/components/platform-duyuru-editoru";

export default function YeniDuyuru() {
  const router = useRouter();
  return <div className="stack duyuru-sayfasi"><Link className="duyuru-geri" href="/platform/duyurular"><ArrowLeft size={15} aria-hidden="true" />Duyurulara dön</Link><PageHeader title="Yeni duyuru" subtitle="Duyuru taslağı hazırlayın." /><PlatformDuyuruEditoru onKayit={(d) => router.replace(`/platform/duyurular/${d.id}`)} /></div>;
}
