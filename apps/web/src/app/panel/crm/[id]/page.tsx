"use client";
import { useParams } from "next/navigation";
import { useEkranKaydi } from "@/lib/asistan-baglami";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { CrmTeklifBaglari } from "@/components/crm-teklif-baglari";
export default function FirsatTeklifleriSayfasi() {
 const { id } = useParams<{id:string}>();
 // AI-113: açık fırsat asistanın ekran kaydıdır; adı sunucu okur.
 useEkranKaydi(id ? { tur: "crm_firsati", id, etiket: "Fırsat" } : null);
 return <div className="stack"><PageHeader title="Fırsatın teklifleri" subtitle="Fırsatla ilişkili satış teklifleri ve bağ geçmişi" /><Link href="/panel/crm">CRM fırsatlarına dön</Link><CrmTeklifBaglari key={id} firsatId={id} /></div>;
}
