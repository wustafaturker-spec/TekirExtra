import { NextResponse, type NextRequest } from "next/server";
import { sayfaCsp } from "@/lib/sayfa-csp";
import { OTURUM_ISARETI_COOKIE, PLATFORM_OTURUM_ISARETI_COOKIE, oturumIsaretiGecerli } from "@/lib/oturum-isareti";

/**
 * Rota koruması: `/panel/*` sayfaları geçerli oturum işareti çerezi olmadan
 * sunulmaz, giriş sayfasına yönlendirilir. Veri koruması API'dedir (JWT); bu
 * katman giriş yapmamış ziyaretçiye panel arayüzünün gösterilmesini önler.
 * `OTURUM_ISARETI_SECRET` tanımlı değilse üretimde panel kapalıdır (kapalı
 * varsayılır), geliştirmede uyarıyla açılır.
 *
 * PLT-08: `/platform/*` (giriş ve davet sayfaları hariç) aynı yöntemle, platform
 * girişinin koyduğu ayrı işaretle korunur; yönlendirme platform girişinedir.
 */
export async function middleware(istek: NextRequest) {
  const yol = istek.nextUrl.pathname;
  const devam = guvenliDevam(istek);
  // SAH-01: saha ekranları panelle aynı oturum işaretiyle korunur.
  const saha = yol === "/saha" || yol.startsWith("/saha/");
  if (!saha && yol !== "/panel" && !yol.startsWith("/panel/") && yol !== "/platform" && !yol.startsWith("/platform/")) return devam();
  const platform = yol === "/platform" || yol.startsWith("/platform/");
  // PLT-07: davet sayfası oturumsuz açılır (bağlantıdaki tek kullanımlık anahtarla).
  if (platform && (yol === "/platform/giris" || yol === "/platform/davet")) return devam();
  const sir = process.env.OTURUM_ISARETI_SECRET?.trim();
  if (!sir || sir.length < 32) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[rota-korumasi] OTURUM_ISARETI_SECRET tanımlı değil; panel geliştirmede korumasız açılıyor.");
      return devam();
    }
    return platform ? platformGirisine(istek, "yapilandirma") : yonlendir(istek, "yapilandirma");
  }
  if (platform) {
    if (await oturumIsaretiGecerli(istek.cookies.get(PLATFORM_OTURUM_ISARETI_COOKIE)?.value, sir, undefined, "p1")) return devam();
    return platformGirisine(istek, "gerekli");
  }
  if (await oturumIsaretiGecerli(istek.cookies.get(OTURUM_ISARETI_COOKIE)?.value, sir)) return devam();
  return yonlendir(istek, "gerekli");
}

/**
 * SEC-15: sayfa CSP'si. Satır içi betik yalnız bu isteğin nonce'uyla çalışır (Next'in
 * önyükleme betikleri ve tema betiği). Next nonce'u istek başlığındaki CSP'den okur.
 */
function guvenliDevam(istek: NextRequest): () => NextResponse {
  const nonce = btoa(crypto.randomUUID());
  const csp = sayfaCsp(nonce, process.env.NODE_ENV === "development");
  const basliklar = new Headers(istek.headers);
  basliklar.set("x-nonce", nonce);
  basliklar.set("Content-Security-Policy", csp);
  return () => {
    const yanit = NextResponse.next({ request: { headers: basliklar } });
    yanit.headers.set("Content-Security-Policy", csp);
    return yanit;
  };
}

function yonlendir(istek: NextRequest, neden: string) {
  const hedef = new URL("/giris", istek.url);
  hedef.searchParams.set("oturum", neden);
  hedef.searchParams.set("donus", `${istek.nextUrl.pathname}${istek.nextUrl.search}`);
  return NextResponse.redirect(hedef);
}

function platformGirisine(istek: NextRequest, neden: string) {
  const hedef = new URL("/platform/giris", istek.url);
  hedef.searchParams.set("oturum", neden);
  return NextResponse.redirect(hedef);
}

// SEC-15: nonce'lu CSP her sayfaya gerekir; yalnız API aktarımı ve durağan dosyalar hariç.
export const config = { matcher: ["/((?!api/|_next/static|_next/image|belge-cerceve\\.html|.*\\.(?:png|jpe?g|gif|svg|ico|webp|js|css|map|json|txt|woff2?)$).*)"] };
