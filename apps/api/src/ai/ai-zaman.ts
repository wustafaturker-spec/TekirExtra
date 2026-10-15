/** Türkiye takvim ayının başlangıcı: UTC'de önceki gün 21:00. */
export function istanbulAyBaslangici(tarih = new Date()): Date {
  const gun = tarih.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
  return new Date(`${gun.slice(0, 7)}-01T00:00:00+03:00`);
}

export interface TrSimdi {
  gun: string;   // YYYY-MM-DD
  saat: string;  // HH:MM
  haftaGunu: number; // 1 = Pazartesi … 7 = Pazar
}

export function trSimdi(an = new Date()): TrSimdi {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(an).map((x) => [x.type, x.value]),
  );
  const haftaGunu = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1;
  return { gun: `${p.year}-${p.month}-${p.day}`, saat: `${p.hour}:${p.minute}`, haftaGunu };
}
