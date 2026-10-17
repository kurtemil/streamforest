// Language codes as tracks carry them, against the codes the settings store.
//
// The settings store two-letter codes ("sv"), and a profile's preferred subtitle
// language was compared with `track.lang.startsWith(pref)`. Tracks are usually
// tagged with three-letter ISO 639-2 codes, and "swe".startsWith("sv") is false:
// Swedish, the one language this household actually picks, never matched. Nor
// did Spanish ("spa") or German tagged "ger". Found 2026-10-17.

const ALIASES: Record<string, readonly string[]> = {
  sv: ['sv', 'swe', 'sve', 'swedish', 'svenska', 'svensk'],
  en: ['en', 'eng', 'english', 'engelska'],
  no: ['no', 'nb', 'nn', 'nor', 'nob', 'nno', 'norwegian', 'norsk', 'norska'],
  da: ['da', 'dan', 'danish', 'dansk', 'danska'],
  fi: ['fi', 'fin', 'finnish', 'suomi', 'finska'],
  de: ['de', 'deu', 'ger', 'german', 'deutsch', 'tyska'],
  fr: ['fr', 'fra', 'fre', 'french', 'francais', 'français', 'franska'],
  es: ['es', 'spa', 'spanish', 'espanol', 'español', 'spanska'],
  ar: ['ar', 'ara', 'arabic', 'arabiska'],
}

const CANONICAL = new Map<string, string>()
for (const [code, names] of Object.entries(ALIASES)) for (const n of names) CANONICAL.set(n, code)

/** "swe", "sv-SE", "Swedish" → "sv". An unknown code comes back lowercased, so it still equals itself. */
export function canonicalLang(code: string | null | undefined): string | null {
  if (!code) return null
  const c = code.trim().toLowerCase()
  if (!c || c === 'und' || c === '?') return null
  return CANONICAL.get(c) ?? CANONICAL.get(c.split(/[-_]/)[0]) ?? c
}

/**
 * Whether a track is in the wanted language: by its language tag, or failing
 * that by a language name in its title ("Svenska", "English SDH"), which is all
 * some files carry.
 */
export function langMatches(wanted: string | null | undefined, track: { lang?: string | null; name?: string | null }): boolean {
  const want = canonicalLang(wanted)
  if (!want) return false
  if (canonicalLang(track.lang) === want) return true
  const words = (track.name ?? '').toLowerCase().split(/[^\p{L}]+/u)
  return words.some((w) => w && CANONICAL.get(w) === want)
}
