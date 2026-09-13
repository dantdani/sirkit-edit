/**
 * Normalized component-value key for `parts_atomic_links.value_key`.
 *
 * Value-specific exact parts (a 47k and a 1k resistor share one KiCad symbol
 * but are different MPNs) are linked per normalized value; parts whose exact
 * identity does not depend on the schematic value use the '' default link.
 * Normalization is deliberately conservative: unicode micro → u, strip unit
 * suffixes (Ω/ohm/F) and whitespace, lowercase. Unmatched values simply find
 * no link, so an instance without authority fails closed at publication.
 *
 * [B19-D I5d row 06] Case is folded only AFTER the SI prefix is read: `M` (mega) and `m` (milli) are a million-fold apart and
 * used to become the same key. Mega is keyed `meg` (the SPICE spelling), so every existing key — `10k`, `330`, `10u`,
 * `100n`, `ne555`, `5v` — is unchanged and no stored link needs re-keying (no M/m key was ever seeded). The legacy `MF`/`MFD`
 * spellings (microfarad on old drawings, millifarad in SI) get no key rather than a guess.
 */
const PREFIX_KEY: Readonly<Record<string, string>> = Object.freeze({ p: "p", n: "n", u: "u", m: "m", k: "k", K: "k", M: "meg", meg: "meg", MEG: "meg", Meg: "meg", G: "g" });
const OHM_SIGNS = /[ωΩ\u2126]/g;

export function normalizeValueKey(value: string | undefined | null): string {
  if (!value) return "";
  const compact = value.trim().replace(/[µμ]/g, "u").replace(/\s+/g, "");
  if (/^\d+(?:\.\d+)?(?:M[Ff]|[Mm][Ff][Dd])$/.test(compact)) return "";
  const unitless = compact.replace(OHM_SIGNS, "").replace(/ohms?$/i, "").replace(/[Ff]$/, "");
  const decimal = /^(\d+(?:\.\d+)?)(meg|MEG|Meg|[pnumkKMG])?([A-Za-z]*)$/.exec(unitless);
  if (decimal) {
    const mantissa = decimal[1]!.replace(/(\d)\.0$/, "$1");
    const prefix = decimal[2] ? PREFIX_KEY[decimal[2]] : "";
    return `${mantissa}${prefix}${decimal[3]!.toLowerCase()}`;
  }
  const rkm = /^(\d+)([pnumkKMGRr])(\d+)([A-Za-z]*)$/.exec(unitless);
  if (rkm) {
    const marker = rkm[2] === "R" || rkm[2] === "r" ? "r" : PREFIX_KEY[rkm[2]!];
    return `${rkm[1]}${marker}${rkm[3]}${rkm[4]!.toLowerCase()}`;
  }
  return unitless.toLowerCase().replace(/(\d)\.0(?=[a-z]|$)/, "$1");
}

/**
 * [B19-D I5d row 06] The link for a schematic value: its own value key, else the value-agnostic '' default. Own properties
 * only — a value such as `constructor` must not read the object's prototype as an assignment.
 */
export function valueKeyLink<T>(links: Readonly<Record<string, T>> | null | undefined, value: string | undefined | null): T | undefined {
  if (!links) return undefined;
  const key = normalizeValueKey(value);
  if (Object.hasOwn(links, key)) return links[key];
  return Object.hasOwn(links, "") ? links[""] : undefined;
}
