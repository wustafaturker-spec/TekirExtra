import sanitizeHtml from "sanitize-html";

/**
 * SEC-01: dışarıdan gelen e-posta HTML'i panelde uygulamanın kökeninde
 * gösterilir; gönderen herkes olabileceği için içerik güvenilmezdir. Betik,
 * olay öznitelikleri, `javascript:` bağlantıları, form/iframe/object ve
 * sayfanın tamamını etkileyecek `<style>`/`<link>` atılır. Satır içi stil
 * yalnız görünümü bozmayan özelliklerle sınırlıdır (konumlandırma yok: e-posta
 * panelin üstüne sahte ekran çizemesin). İstemci DOMPurify ile ikinci kez temizler.
 */
const IZINLI_ETIKETLER = [
  "a", "abbr", "address", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup",
  "dd", "del", "div", "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd",
  "li", "mark", "ol", "p", "pre", "q", "s", "small", "span", "strike", "strong", "sub", "sup", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "tt", "u", "ul",
];

const RENK = [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i];
const OLCU = [/^-?[\d.]+(px|em|rem|%|pt)?$/i, /^auto$/i];
const OLCU_LISTESI = [/^(-?[\d.]+(px|em|rem|%|pt)?|auto)(\s+(-?[\d.]+(px|em|rem|%|pt)?|auto)){0,3}$/i];
const KENAR = [/^[\w\s#().,%-]{1,80}$/];

const IZINLI_STILLER: sanitizeHtml.IOptions["allowedStyles"] = {
  "*": {
    color: RENK,
    "background-color": RENK,
    "text-align": [/^(left|right|center|justify|start|end)$/i],
    "vertical-align": [/^(top|middle|bottom|baseline)$/i],
    "font-weight": [/^(normal|bold|bolder|lighter|\d{3})$/i],
    "font-style": [/^(normal|italic|oblique)$/i],
    "font-size": OLCU,
    "font-family": [/^[\w\s,'"-]{1,120}$/],
    "line-height": OLCU,
    "text-decoration": [/^(none|underline|line-through|overline)$/i],
    "white-space": [/^(normal|nowrap|pre|pre-wrap|pre-line)$/i],
    width: OLCU,
    height: OLCU,
    "max-width": OLCU,
    "min-width": OLCU,
    margin: OLCU_LISTESI,
    "margin-top": OLCU, "margin-bottom": OLCU, "margin-left": OLCU, "margin-right": OLCU,
    padding: OLCU_LISTESI,
    "padding-top": OLCU, "padding-bottom": OLCU, "padding-left": OLCU, "padding-right": OLCU,
    border: KENAR, "border-top": KENAR, "border-bottom": KENAR, "border-left": KENAR, "border-right": KENAR,
    "border-collapse": [/^(collapse|separate)$/i],
    "border-radius": OLCU_LISTESI,
  },
};

const SECENEKLER: sanitizeHtml.IOptions = {
  allowedTags: IZINLI_ETIKETLER,
  // Atılan etiketin içeriği de atılır (betik metni ekrana düşmesin).
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "head", "template", "svg", "math", "iframe", "object", "embed", "form"],
  disallowedTagsMode: "discard",
  allowedAttributes: {
    "*": ["style", "align", "valign", "width", "height", "bgcolor", "color", "dir", "title", "lang"],
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height", "border"],
    td: ["colspan", "rowspan", "nowrap"],
    th: ["colspan", "rowspan", "nowrap", "scope"],
    table: ["border", "cellpadding", "cellspacing"],
    font: ["face", "size", "color"],
    col: ["span"],
    colgroup: ["span"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
  allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
  allowProtocolRelative: false,
  allowedStyles: IZINLI_STILLER,
  parseStyleAttributes: true,
  transformTags: {
    a: (etiket, oz) => ({ tagName: etiket, attribs: { ...oz, target: "_blank", rel: "noopener noreferrer nofollow" } }),
  },
};

/** E-posta HTML'ini panelde gösterilebilir hâle getirir; boş/yalnız boşluk sonuç `null` döner. */
export function epostaHtmliniTemizle(html: string | null | undefined): string | null {
  if (!html) return null;
  const temiz = sanitizeHtml(html, SECENEKLER).trim();
  return temiz ? temiz : null;
}
