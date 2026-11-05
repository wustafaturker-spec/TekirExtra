import { TableWrap } from "@/components/ui";
import type { PaketFiyatlandirmasi } from "@/lib/platform-paketler";

export function PlatformPaketFiyati({ fiyat }: { fiyat?: PaketFiyatlandirmasi | null }) {
  if (!fiyat) return <p>Sürüm fiyatı tanımlı değil.</p>;
  return <div className="stack">
    <p>Fiyat geçerlilik tarihi: {fiyat.gecerlilikTarihi.split("-").reverse().join(".")} (Türkiye) · Para birimi: TRY · KDV %{fiyat.kdvOrani}</p>
    <TableWrap><thead><tr><th>Dönem</th><th>Dönem toplamı (KDV hariç)</th></tr></thead>
      <tbody>{[...fiyat.donemler].sort((a, b) => a.aySayisi - b.aySayisi).map((d) => <tr key={d.aySayisi}><td>{d.aySayisi} ay</td><td>{d.matrah.replace(".", ",")} TRY</td></tr>)}</tbody>
    </TableWrap>
    <p className="subtle">Boş dönemlere fiyat türetilmez. Mevcut aboneliğin fiyatını değiştirmek ayrı önizleme ve onay gerektirir; geçerlilik tarihinde otomatik değişiklik yapılmaz.</p>
  </div>;
}
