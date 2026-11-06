export function DuyuruYukleniyor() {
  return <div className="duyuru-yukleniyor" role="status">
    <span className="sr-only">Duyurular yükleniyor…</span>
    {[0, 1, 2].map((sira) => <div className="duyuru-iskelet" aria-hidden="true" key={sira}><span /><div><i /><i /></div></div>)}
  </div>;
}
