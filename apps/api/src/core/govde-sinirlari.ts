/**
 * EBLG-158: elle XML yükleme uçları genel 2 MB gövde sınırından muaftır; ekli (gömülü PDF'li)
 * e-Fatura XML'leri 2 MB'ı aşabiliyor. Sınır aşılırsa kullanıcı açık bir ileti görür.
 */
export const XML_YUKLEME_SINIRI_MB = 10;
export const XML_YUKLEME_YOLLARI = ["/api/v1/ebelge/xml-yukle", "/api/v1/ebelge/gelen/xml-yukle"];
export const xmlYuklemeYoluMu = (yol: string | undefined) => !!yol && XML_YUKLEME_YOLLARI.includes(yol.replace(/\/+$/, ""));
