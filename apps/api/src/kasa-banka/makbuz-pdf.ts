import { kacis, paraBicim, sayfaSablonu, tarihBicim } from "../core/pdf/pdf-sablon";

export function makbuzPdfHtml(h: any, firma: any, logoDataUri?: string): string {
  const tahsilat = h.tip === "tahsilat";
  const hesap = h.kasa?.ad ?? h.bankaHesap?.ad ?? h.posHesap?.ad ?? "—";
  const no = `MKB-${String(h.id).slice(0, 8).toUpperCase()}`;
  return sayfaSablonu({
    baslik: tahsilat ? "TAHSİLAT MAKBUZU" : "ÖDEME MAKBUZU",
    altBaslik: `${firma.unvan} · Makbuz No: ${no}`,
    logoDataUri,
    icerik: `
      <div style="display:flex;justify-content:space-between;gap:16px;margin:18px 0">
        <div class="kutu" style="flex:1"><b>İşlem tarihi</b><br>${tarihBicim(h.tarih)}</div>
        <div class="kutu" style="flex:1"><b>Makbuz no</b><br>${kacis(no)}</div>
        <div class="kutu" style="flex:1"><b>İşlem türü</b><br>${tahsilat ? "Tahsilat" : "Ödeme / Tediye"}</div>
      </div>
      <div class="kutu" style="margin-bottom:12px">
        <b>${tahsilat ? "Tahsil edilen" : "Ödeme yapılan"}</b><br>
        <span style="font-size:13pt">${kacis(h.cari?.unvan ?? "Genel işlem")}</span><br>
        ${h.cari?.kod ? `<span style="color:#6b7280">Cari kodu: ${kacis(h.cari.kod)}</span>` : ""}
      </div>
      <table class="veri"><thead><tr><th>Açıklama</th><th>Hesap</th><th>Belge / Kaynak</th><th class="sag">Tutar</th></tr></thead>
      <tbody><tr><td>${kacis(h.aciklama || (tahsilat ? "Tahsilat" : "Ödeme"))}</td><td>${kacis(hesap)}</td><td>${kacis(h.fatura?.no ?? h.kaynakTur ?? "—")}</td><td class="sag"><b>${paraBicim(h.tutar)} ${kacis(h.dovizCinsi)}</b></td></tr></tbody></table>
      ${h.dovizCinsi !== "TRY" ? `<div class="kutu" style="margin-top:12px">Kur: ${paraBicim(h.kur)} · TL karşılığı: <b>${paraBicim(h.tutarTry)} TL</b></div>` : ""}
      <div style="font-size:15pt;font-weight:bold;text-align:right;margin-top:18px">TOPLAM: ${paraBicim(h.tutar)} ${kacis(h.dovizCinsi)}</div>
      <div style="display:flex;gap:50px;margin-top:55px;text-align:center"><div style="flex:1;border-top:1px solid #9ca3af;padding-top:7px">Teslim eden<br><small>Ad, soyad ve imza</small></div><div style="flex:1;border-top:1px solid #9ca3af;padding-top:7px">Teslim alan<br><small>Ad, soyad ve imza</small></div></div>`,
  });
}
