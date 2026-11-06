/**
 * Sihirbazın türe özel engelleri (ihracat, kamu, iade, SGK…). `gonderilebilir`
 * yalnız bağlantı, kimlik ve tarih kontrollerini anlatır; bu liste boş değilse
 * belge kuyruğa girmez. Tek gönderim ve toplu gönderim (EBLG-152) aynı listeyi kullanır.
 */
type Engelli = { engeller?: { mesaj: string }[] } | null | undefined;

export function sihirbazEngelleri(wizard: Partial<Record<"ihracat" | "yurtDisiEarsiv" | "internetSatisi" | "iade" | "kamu" | "sgk" | "sarj" | "idis" | "yolcuBeraberi" | "ytb" | "sevkiyat", Engelli>>): { mesaj: string }[] {
  return [
    ...(wizard.ihracat?.engeller ?? []), ...(wizard.yurtDisiEarsiv?.engeller ?? []), ...(wizard.internetSatisi?.engeller ?? []),
    ...(wizard.iade?.engeller ?? []), ...(wizard.kamu?.engeller ?? []), ...(wizard.sgk?.engeller ?? []), ...(wizard.sarj?.engeller ?? []),
    ...(wizard.idis?.engeller ?? []), ...(wizard.yolcuBeraberi?.engeller ?? []), ...(wizard.ytb?.engeller ?? []), ...(wizard.sevkiyat?.engeller ?? []),
  ];
}
