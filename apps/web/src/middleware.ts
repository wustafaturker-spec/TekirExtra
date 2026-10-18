import { NextResponse, type NextRequest } from "next/server";
import { OTURUM_ISARETI_COOKIE, oturumIsaretiGecerli } from "@/lib/oturum-isareti";

/**
 * Rota koruması: `/panel/*` sayfaları geçerli oturum işareti çerezi olmadan
 * sunulmaz, giriş sayfasına yönlendirilir. Veri koruması API'dedir (JWT); bu
 * katman giriş yapmamış ziyaretçiye panel arayüzünün gösterilmesini önler.
 * `OTURUM_ISARETI_SECRET` tanımlı değilse üretimde panel kapalıdır (kapalı
 * varsayılır), geliştirmede uyarıyla açılır.
 */
export async function middleware(istek: NextRequest) {
  const sir = process.env.OTURUM_ISARETI_SECRET?.trim();
  if (!sir || sir.length < 32) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[rota-korumasi] OTURUM_ISARETI_SECRET tanımlı değil; panel geliştirmede korumasız açılıyor.");
      return NextResponse.next();
    }
    return yonlendir(istek, "yapilandirma");
  }
  if (await oturumIsaretiGecerli(istek.cookies.get(OTURUM_ISARETI_COOKIE)?.value, sir)) return NextResponse.next();
  return yonlendir(istek, "gerekli");
}

function yonlendir(istek: NextRequest, neden: string) {
  const hedef = new URL("/giris", istek.url);
  hedef.searchParams.set("oturum", neden);
  hedef.searchParams.set("donus", `${istek.nextUrl.pathname}${istek.nextUrl.search}`);
  return NextResponse.redirect(hedef);
}

export const config = { matcher: ["/panel", "/panel/:path*"] };
