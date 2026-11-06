"use client";
import DOMPurify from "dompurify";

const izinliEtiketler = ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "img"];
const apiAdresi = (process.env.NEXT_PUBLIC_API_URL ?? "/api/v1").replace(/\/+$/u, "");
const imagePrefix = apiAdresi.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const izinliGorsel = new RegExp(`^${imagePrefix}/duyurular/gorseller/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\?e=\\d+&h=[a-f0-9]{64}$`, "iu");
export function DuyuruZenginIcerik({ icerik }: { icerik: string }) {
  // API stores only the matching server-side allowlist; the browser sanitizes again.
  const canonical = icerik.replaceAll("/api/v1/duyurular/gorseller/", `${apiAdresi}/duyurular/gorseller/`);
  const guvenli = typeof window === "undefined" ? canonical : DOMPurify.sanitize(canonical, { ALLOWED_TAGS: izinliEtiketler, ALLOWED_ATTR: ["src", "alt"], ALLOWED_URI_REGEXP: izinliGorsel });
  return <div className="duyuru-zengin-icerik" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} dangerouslySetInnerHTML={{ __html: guvenli }} />;
}
