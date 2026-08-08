export function sayfaAdedi(adet: string | undefined, varsayilan = 50, enFazla = 200): number {
  if (adet === undefined || adet.trim() === "") return varsayilan;
  const sayi = Number(adet);
  if (!Number.isFinite(sayi)) return varsayilan;
  return Math.min(Math.max(Math.trunc(sayi), 1), enFazla);
}
