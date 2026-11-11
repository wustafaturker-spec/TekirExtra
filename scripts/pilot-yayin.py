#!/usr/bin/env python3
"""Yerel pilot yayını: tek komut.

  python3 scripts/pilot-yayin.py hazirla <ad> [--yalniz-api | --yalniz-web]
  python3 scripts/pilot-yayin.py yayin   <ad> [--yalniz-api | --yalniz-web]
  python3 scripts/pilot-yayin.py geri-don <ad>
  python3 scripts/pilot-yayin.py durum

`hazirla` yalnız paketi kurar (.release-candidates/<ad>); konteynere ve veritabanına
dokunmaz. `yayin` paketi (yoksa) kurar, bekleyen göç varsa yedek alıp uygular, servisleri
yeni pakete geçirir; sağlık denetimi geçmezse önceki pakete kendiliğinden döner.

Paket, çalışan paketin sabit bağlı kopyasıdır; yalnız değişen dosyalar yeniden yazılır.
Anahtarlar çalışan konteynerlerden bellekte devralınır, diske yazılmaz.
"""
import filecmp, glob, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.parse, urllib.request
from pathlib import Path

KOK = Path(__file__).resolve().parent.parent
ADAYLAR = KOK / ".release-candidates"
PROJE = "tekir-yerel-pilot-20261019"
SERVISLER = ["api", "worker", "soz-hatirlatma", "web", "yedekleme"]
POSTGRES, REDIS = "tekirextra-postgres-1", "tekirextra-redis-1"
KUYRUKLAR = ["tekirextra-ebelge", "tekirextra-ileti"]
AD_KALIBI = re.compile(r"^[a-z0-9][a-z0-9-]{2,40}$")


def dur(mesaj):
    print(f"DURDU: {mesaj}", file=sys.stderr)
    sys.exit(1)


def adim(mesaj):
    print(f"[{time.strftime('%H:%M:%S')}] {mesaj}", flush=True)


def calistir(komut, **kw):
    return subprocess.run(komut, check=True, **kw)


def konteyner(servis):
    return f"{PROJE}-{servis}-1"


def incele(ad):
    return json.loads(subprocess.check_output(["docker", "inspect", ad]))[0]


def calisan_paketler():
    """Çalışan konteynerlerin bağlı olduğu paket klasörleri ve compose dosyası."""
    api, web = incele(konteyner("api")), incele(konteyner("web"))
    kaynak = lambda v, hedef: next(Path(m["Source"]) for m in v["Mounts"] if m["Destination"] == hedef)
    runtime, web_yolu = kaynak(api, "/runtime"), kaynak(web, "/web")
    # Yalnız web (ya da yalnız api) yayınında değişmeyen konteyner yeniden kurulmaz ve etiketi eski
    # compose dosyasını gösterir; çalışan iki yolu birden içeren dosya geçerli olandır.
    adaylar = [Path(v["Config"]["Labels"]["com.docker.compose.project.config_files"].split(",")[0]) for v in (web, api)]
    for compose in adaylar:
        metin = compose.read_text(encoding="utf-8") if compose.exists() else ""
        if f'"{runtime}"' in metin and f'"{web_yolu}"' in metin:
            return {"runtime": runtime, "web": web_yolu, "compose": compose}
    dur(f"Çalışan api ({runtime}) ve web ({web_yolu}) yollarını birlikte içeren compose dosyası yok: {', '.join(map(str, adaylar))}")


def anahtarlar():
    """Konteyner silinmiş olabilir; aynı anahtarlar api, worker ve söz sürecinde vardır."""
    ortam = dict(os.environ)
    for servis in ["api", "worker", "soz-hatirlatma"]:
        try:
            e = dict(v.split("=", 1) for v in incele(konteyner(servis))["Config"]["Env"])
        except subprocess.CalledProcessError:
            continue
        for k in ["JWT_SECRET", "PLATFORM_JWT_SECRET", "BAGLANTI_SIFRELEME_ANAHTARI"]:
            if e.get(k):
                ortam["PILOT_KEEP_" + k] = e[k]
        ortam["YEDEK_DB_URL"] = e["DATABASE_URL_MIGRATE"]
        ortam.setdefault("OTURUM_ISARETI_SECRET", e.get("OTURUM_ISARETI_SECRET", ""))
        ortam["_REDIS_URL"] = e.get("REDIS_URL", "")
        break
    else:
        dur("Anahtarları devralacak çalışan api, worker ya da söz konteyneri yok")
    try:
        w = dict(v.split("=", 1) for v in incele(konteyner("web"))["Config"]["Env"])
        ortam["OTURUM_ISARETI_SECRET"] = w["OTURUM_ISARETI_SECRET"]
    except subprocess.CalledProcessError:
        pass
    return ortam


def env_dosyasi():
    e = {}
    for satir in (KOK / "apps/api/.env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*([A-Z_0-9]+)=(.*)", satir)
        if m:
            e[m[1]] = m[2].strip().strip("\"'")
    return e


def yaz(kaynak, hedef):
    """Paket dosyaları önceki paketle sabit bağlıdır: üzerine yazma, önce sil."""
    hedef.parent.mkdir(parents=True, exist_ok=True)
    if hedef.is_symlink() or hedef.exists():
        hedef.unlink()
    shutil.copy2(kaynak, hedef)


def harita_satirsiz(yol):
    return re.sub(rb"\n?//# sourceMappingURL=.*\s*$", b"", Path(yol).read_bytes()).rstrip()


def js_esitle(yeni, eski):
    """Derleme çıktısından yalnız içeriği değişen .js dosyalarını pakete yazar."""
    degisen = []
    for kok, _, dosyalar in os.walk(yeni):
        for ad in dosyalar:
            if not ad.endswith(".js") or ad.endswith(".test.js"):
                continue
            k = Path(kok) / ad
            h = eski / k.relative_to(yeni)
            if not h.exists() or harita_satirsiz(k) != harita_satirsiz(h):
                yaz(k, h)
                degisen.append(str(k.relative_to(yeni)))
    return sorted(degisen)


def bagimliliklar(yol):
    return json.loads(Path(yol).read_text(encoding="utf-8")).get("dependencies", {})


def kurulu_paket(kok, ad):
    """apps/api'den çözülen paketin gerçek klasörü ve package.json'u; kurulu değilse None."""
    yol = kok / "apps/api/node_modules" / ad
    if not yol.exists():
        return None
    gercek = yol.resolve()
    return gercek, json.loads((gercek / "package.json").read_text(encoding="utf-8"))


def eklenecek_bagimliliklar(taban_runtime):
    """
    Belirteç değişse de kurulu sürüm aynıysa sorun yoktur (ör. ^1.61.1 → 1.61.1). Çalışan pakette
    olmayan, kendi bağımlılığı ve kurulum betiği bulunmayan yeni paket runtime'a kopyalanabilir;
    sürümü değişen ya da bağımlılık getiren paket elle kurulmalıdır.
    """
    eklenecek = []
    for ad in bagimliliklar(KOK / "apps/api/package.json"):
        yerel, calisan = kurulu_paket(KOK, ad), kurulu_paket(taban_runtime, ad)
        if yerel is None:
            dur(f"{ad} yerelde kurulu değil; önce pnpm install")
        if calisan is not None:
            if calisan[1].get("version") != yerel[1].get("version"):
                dur(f"{ad} sürümü değişti ({calisan[1].get('version')} → {yerel[1].get('version')}); runtime paketinin node_modules'u elle güncellenmeli")
            continue
        bilgi = yerel[1]
        betikler = set(bilgi.get("scripts", {})) & {"preinstall", "install", "postinstall"}
        if bilgi.get("dependencies") or bilgi.get("optionalDependencies") or bilgi.get("peerDependencies") or betikler or (yerel[0] / "binding.gyp").exists():
            dur(f"{ad} yeni ve kendi bağımlılığı/kurulum betiği var; runtime paketinin node_modules'u elle güncellenmeli")
        eklenecek.append((ad, yerel[0], bilgi["version"]))
    return eklenecek


def bagimliliklari_ekle(runtime, eklenecek):
    for ad, kaynak, surum in eklenecek:
        hedef = runtime / "node_modules/.pnpm" / f"{ad.replace('/', '+')}@{surum}" / "node_modules" / ad
        shutil.copytree(kaynak, hedef, symlinks=True)
        bag = runtime / "apps/api/node_modules" / ad
        bag.parent.mkdir(parents=True, exist_ok=True)
        bag.symlink_to(os.path.relpath(hedef, bag.parent))
    yaz(KOK / "apps/api/package.json", runtime / "apps/api/package.json")
    return [f"{ad}@{surum}" for ad, _, surum in eklenecek]


def api_hazirla(paket, taban_runtime):
    eklenecek = eklenecek_bagimliliklar(taban_runtime)
    adim("API paketi: çalışan paket sabit bağla kopyalanıyor")
    calistir(["cp", "-al", str(taban_runtime), str(paket / "runtime")])
    runtime = paket / "runtime"
    yeni_bagimliliklar = bagimliliklari_ekle(runtime, eklenecek)
    # PLT-118: hata kayıtları hangi pakette görüldüğünü buradan okur (sabit bağı bozmadan yeniden yazılır).
    surum = runtime / "SURUM"
    if surum.exists() or surum.is_symlink():
        surum.unlink()
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=KOK, capture_output=True, text=True).stdout.strip()
    surum.write_text(f"{paket.name} {sha}\n", encoding="utf-8")
    if yeni_bagimliliklar:
        adim(f"API paketi: yeni bağımlılık {', '.join(yeni_bagimliliklar)}")
    ortam = {**os.environ, "NODE_OPTIONS": "--max-old-space-size=4500"}
    with tempfile.TemporaryDirectory(prefix="pilot-yayin-") as gecici:
        adim("API derleniyor")
        calistir(["npx", "prisma", "generate"], cwd=KOK / "apps/api", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        calistir(["npx", "tsc", "-p", "tsconfig.json", "--outDir", f"{gecici}/shared", "--sourceMap", "false"], cwd=KOK / "packages/shared", env=ortam)
        calistir(["npx", "tsc", "-p", "tsconfig.json", "--outDir", f"{gecici}/baglanti", "--sourceMap", "false"], cwd=KOK / "packages/baglanti", env=ortam)
        calistir(["npx", "tsc", "-p", "tsconfig.json", "--outDir", f"{gecici}/api", "--sourceMap", "false"], cwd=KOK / "apps/api", env=ortam)
        api = js_esitle(Path(gecici) / "api", runtime / "apps/api/dist")
        shared = js_esitle(Path(gecici) / "shared", runtime / "packages/shared/dist")
        baglanti = js_esitle(Path(gecici) / "baglanti", runtime / "packages/baglanti/dist")
    yaz(KOK / "apps/api/prisma/schema.prisma", runtime / "apps/api/prisma/schema.prisma")
    gocler = []
    for g in sorted((KOK / "apps/api/prisma/migrations").iterdir()):
        hedef = runtime / "apps/api/prisma/migrations" / g.name / "migration.sql"
        if g.is_dir() and not hedef.exists():
            yaz(g / "migration.sql", hedef)
            gocler.append(g.name)
    desen = "node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client"
    kaynak, hedef = glob.glob(str(KOK / desen)), glob.glob(str(runtime / desen))
    if len(kaynak) != 1 or len(hedef) != 1:
        dur("Prisma istemcisi tek yolda bulunamadı")
    istemci = []
    for k in Path(kaynak[0]).iterdir():
        h = Path(hedef[0]) / k.name
        if k.is_file() and not k.name.endswith(".so.node") and (not h.exists() or not filecmp.cmp(k, h, False)):
            yaz(k, h)
            istemci.append(k.name)
    adim(f"API paketi: {len(api)} dosya, shared {len(shared)}, baglanti {len(baglanti)}, yeni göç {len(gocler)}, Prisma istemcisi {len(istemci)} dosya")
    return {"apiDosyalari": api, "sharedDosyalari": shared, "baglantiDosyalari": baglanti, "yeniGocler": gocler, "yeniBagimliliklar": yeni_bagimliliklar}


def web_hazirla(paket, ad):
    web, dist = KOK / "apps/web", f".next-{ad}"
    korunan = {p: (web / p).read_bytes() for p in ["tsconfig.json", "next-env.d.ts"]}
    adim("Web derleniyor (birkaç dakika)")
    try:
        with open(paket / "web-build.log", "wb") as log:
            calistir(["pnpm", "exec", "next", "build"], cwd=web, stdout=log, stderr=subprocess.STDOUT,
                     env={**os.environ, "NEXT_DIST_DIR": dist, "NODE_OPTIONS": "--max-old-space-size=4096"})
    except subprocess.CalledProcessError:
        dur(f"Web derlemesi başarısız; ayrıntı {paket / 'web-build.log'}")
    finally:
        for p, icerik in korunan.items():
            (web / p).write_bytes(icerik)
    gizli = lambda _d, adlar: [a for a in adlar if a.startswith(".env")]
    shutil.copytree(web / dist / "standalone", paket / "web", symlinks=True, ignore=gizli)
    shutil.copytree(web / dist / "static", paket / "web/apps/web" / dist / "static", symlinks=True, ignore=gizli)
    if (web / "public").exists():
        shutil.copytree(web / "public", paket / "web/apps/web/public", symlinks=True, ignore=gizli, dirs_exist_ok=True)
    hedef_kok = str((paket / "web").resolve()) + "/"
    for yol in (paket / "web").rglob("*"):
        if yol.is_symlink() and not str(yol.resolve()).startswith(hedef_kok):
            dur(f"Web paketinde paket dışına bağ var: {yol.relative_to(paket)}")
    kimlik = (web / dist / "BUILD_ID").read_text().strip()
    shutil.rmtree(web / dist)
    adim(f"Web paketi hazır (derleme {kimlik})")
    return {"webBuildId": kimlik}


def kaynak_izi():
    """Derlenen kaynakların izi: derleme sırasında dosya değişirse paket karışık kodla oluşur."""
    return subprocess.check_output(["git", "status", "--porcelain=v1", "-z", "apps", "packages"], cwd=KOK) + subprocess.check_output(["git", "diff", "--no-ext-diff", "HEAD", "--", "apps", "packages"], cwd=KOK)


def hazirla(ad, api=True, web=True):
    paket = ADAYLAR / ad
    if paket.exists():
        dur(f"{paket} zaten var; yeni bir ad kullanın")
    calisan = calisan_paketler()
    (paket / "ops").mkdir(parents=True)
    ozet = {"ad": ad, "olusturuldu": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "api": api, "web": web,
            "commit": subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=KOK, text=True).strip(),
            "kirliDosyalar": subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no", "apps", "packages"], cwd=KOK, text=True).split("\n")[:-1],
            "onceki": {k: str(v) for k, v in calisan.items()}}
    if ozet["kirliDosyalar"]:
        adim(f"UYARI: commit edilmemiş {len(ozet['kirliDosyalar'])} dosya pakete girecek")
    iz = kaynak_izi()
    if api:
        ozet.update(api_hazirla(paket, calisan["runtime"]))
    if web:
        ozet.update(web_hazirla(paket, ad))
    if kaynak_izi() != iz:
        dur(f"Derleme sırasında kaynak dosyalar değişti; paket karışık kod içerebilir. {paket} klasörünü silip yeniden deneyin")
    # Compose: çalışan dosyadan türetilir; yalnız yeniden kurulan parçanın yolu değişir.
    metin = calisan["compose"].read_text(encoding="utf-8")
    shutil.copy2(calisan["compose"], paket / "ops/geri-donus-compose.json")
    eski_ops = calisan["compose"].parent
    for dosya in eski_ops.iterdir():
        if dosya.suffix == ".sh":
            shutil.copy2(dosya, paket / "ops" / dosya.name)
    metin = metin.replace(str(eski_ops) + "/", str(paket / "ops") + "/")
    if api:
        metin = metin.replace(str(calisan["runtime"]), str(paket / "runtime"))
    if web:
        metin = metin.replace(str(calisan["web"]), str(paket / "web"))
    (paket / "ops/compose.json").write_text(metin, encoding="utf-8")
    calistir(["docker", "compose", "-f", str(paket / "ops/compose.json"), "config", "--quiet"], env=anahtarlar())
    (paket / "manifest.json").write_text(json.dumps(ozet, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    adim(f"Paket hazır: {paket}")
    return paket


def bekleyen_gocler():
    e = {**os.environ, **{k: v for k, v in env_dosyasi().items() if k.startswith("DATABASE_URL")}}
    r = subprocess.run(["npx", "prisma", "migrate", "status"], cwd=KOK / "apps/api", env=e, capture_output=True, text=True)
    cikti = r.stdout + r.stderr
    if "Database schema is up to date" in cikti:
        return [], e
    if "have not yet been applied" not in cikti:
        dur(f"Göç durumu okunamadı:\n{cikti[-600:]}")
    return re.findall(r"^(\d{14}_\S+)$", cikti, re.M), e


def goc_uygula(ad):
    bekleyen, e = bekleyen_gocler()
    if not bekleyen:
        adim("Bekleyen göç yok")
        return
    adim(f"Bekleyen göç: {', '.join(bekleyen)}; önce yedek alınıyor (10 dakikayı bulabilir)")
    klasor = KOK / "backups" / f"{ad}-oncesi"
    calistir([str(KOK / "scripts/backup-postgres.sh"), str(klasor)], cwd=KOK)
    yedek = max(klasor.glob("*.sql.gz"), key=lambda p: p.stat().st_mtime)
    calistir(["gzip", "-t", str(yedek)])
    adim(f"Yedek sağlam: {yedek.relative_to(KOK)}; göçler uygulanıyor")
    calistir(["npx", "prisma", "migrate", "deploy"], cwd=KOK / "apps/api", env=e, stdout=subprocess.DEVNULL)


def kuyruklari_bekle(ortam, sure=90):
    """Çalışan iş varken worker durdurulmaz; bekleyen iş Redis'te kalır ve yeni worker alır."""
    u = urllib.parse.urlsplit(ortam.get("_REDIS_URL", ""))
    if not u.hostname:
        return
    def say(anahtar):
        r = subprocess.run(["docker", "exec", "-e", "REDISCLI_AUTH=" + urllib.parse.unquote(u.password or ""), REDIS,
                            "redis-cli", "--no-auth-warning", "-p", "6379", "llen", anahtar], capture_output=True, text=True)
        return int(r.stdout.strip() or 0)
    bitis = time.time() + sure
    while True:
        etkin = {k: say(f"bull:{k}:active") for k in KUYRUKLAR}
        if not any(etkin.values()):
            return
        if time.time() > bitis:
            dur(f"Kuyrukta çalışan iş bitmedi: {etkin}")
        time.sleep(3)


def gecir(compose, ortam):
    calistir(["docker", "compose", "-f", str(compose), "up", "-d", "--no-deps", "--no-build", "--pull", "never",
              "--wait", "--wait-timeout", "180", *SERVISLER], env=ortam)


def saglik(paket, ozet):
    calisan = calisan_paketler()
    if ozet["api"] and calisan["runtime"] != paket / "runtime":
        raise RuntimeError("api yeni pakete bağlanmadı")
    if ozet["web"] and calisan["web"] != paket / "web":
        raise RuntimeError("web yeni pakete bağlanmadı")
    for adres in ["http://127.0.0.1:3001/health/ready", "http://127.0.0.1:3100/giris"]:
        with urllib.request.urlopen(adres, timeout=10) as y:
            if y.status != 200:
                raise RuntimeError(f"{adres} {y.status}")
    time.sleep(8)
    for servis in ["api", "worker", "soz-hatirlatma"]:
        gunluk = subprocess.run(["docker", "logs", "--since", "2m", konteyner(servis)], capture_output=True, text=True)
        kotu = [s for s in (gunluk.stdout + gunluk.stderr).splitlines() if re.search(r"Nest can't resolve|does not exist in the current database|permission denied for", s)]
        if kotu:
            raise RuntimeError(f"{servis}: {kotu[0][:200]}")


def yayin(ad, api, web):
    paket = ADAYLAR / ad
    if not paket.exists():
        hazirla(ad, api, web)
    ozet = json.loads((paket / "manifest.json").read_text(encoding="utf-8"))
    ortam = anahtarlar()
    if ozet["api"]:
        goc_uygula(ad)  # Göç koddan önce: yeni kod yeni tabloları bekler, eski kod ekleyici göçle çalışır.
        kuyruklari_bekle(ortam)
    adim("Servisler yeni pakete geçiriliyor")
    try:
        gecir(paket / "ops/compose.json", ortam)
        saglik(paket, ozet)
    except Exception as hata:  # noqa: BLE001 - her hata geri dönüş nedenidir
        adim(f"BAŞARISIZ: {hata}; önceki pakete dönülüyor")
        gecir(paket / "ops/geri-donus-compose.json", ortam)
        dur("Yayın geri alındı. Uygulanan göçler duruyor; ekleyici olmalıdır.")
    ozet["yayinlandi"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    (paket / "manifest.json").write_text(json.dumps(ozet, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    adim(f"Yayın tamam: {ad}. Geri dönüş: python3 scripts/pilot-yayin.py geri-don {ad}")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in {"hazirla", "yayin", "geri-don", "durum"}:
        print(__doc__)
        sys.exit(2)
    mod, secenek = sys.argv[1], set(a for a in sys.argv[2:] if a.startswith("--"))
    adlar = [a for a in sys.argv[2:] if not a.startswith("--")]
    if mod == "durum":
        for k, v in calisan_paketler().items():
            print(f"{k:8} {v}")
        calistir(["docker", "compose", "-p", PROJE, "ps", "--format", "table {{.Service}}\t{{.Status}}"])
        return
    if len(adlar) != 1 or not AD_KALIBI.match(adlar[0]):
        dur("Paket adı gerekli (küçük harf, rakam, tire), ör. ilt3-20261111")
    if secenek - {"--yalniz-api", "--yalniz-web"} or len(secenek) > 1:
        dur("Geçerli seçenekler: --yalniz-api ya da --yalniz-web")
    api, web = "--yalniz-web" not in secenek, "--yalniz-api" not in secenek
    if mod == "hazirla":
        hazirla(adlar[0], api, web)
    elif mod == "yayin":
        yayin(adlar[0], api, web)
    else:
        gecir(ADAYLAR / adlar[0] / "ops/geri-donus-compose.json", anahtarlar())
        adim("Önceki pakete dönüldü")


if __name__ == "__main__":
    main()
