// Which subtitle a home-library film starts with, and how its streams are named.
import { canonicalLang, langMatches } from '@/lib/lang'
import type { HomeSubtitle } from '@/services/jellyfin'

/** What a profile chose for a title, as remembered: a language, or 'off'. */
export const SUBTITLES_OFF = 'off'

/**
 * The stream to start with:
 * 1. what this profile chose for this film last time (a language, or off);
 * 2. the profile's language, where a text stream beats a picture one, which has
 *    to be burnt in and cannot be switched without restarting;
 * 3. with a language set but no stream tagged with it, the file's default stream
 *    when its language is not tagged at all: the household's SweSub rips carry
 *    their Swedish track untagged, and burning in the default stream is what
 *    these films did before anyone could choose;
 * 4. a forced stream (lines meant to be shown whatever is chosen), if any.
 */
export function pickHomeSubtitle(subs: readonly HomeSubtitle[], remembered: string | undefined, preferred: string): HomeSubtitle | null {
  if (remembered === SUBTITLES_OFF) return null
  const wanted = remembered || preferred
  if (wanted) {
    const inLang = subs.filter((s) => langMatches(wanted, { lang: s.lang, name: s.title }))
    const best = inLang.find((s) => s.text && !s.forced) ?? inLang.find((s) => !s.forced) ?? inLang[0]
    if (best) return best
    const untaggedDefault = subs.find((s) => s.isDefault && !canonicalLang(s.lang))
    if (untaggedDefault) return untaggedDefault
  }
  return subs.find((s) => s.forced) ?? null
}

/** The same choice in the next part of a split film: same language, same kind of stream. */
export function samePick(subs: readonly HomeSubtitle[], chosen: HomeSubtitle | null): HomeSubtitle | null {
  if (!chosen) return null
  const want = canonicalLang(chosen.lang)
  return subs.find((s) => canonicalLang(s.lang) === want && s.text === chosen.text && s.forced === chosen.forced)
    ?? subs.find((s) => canonicalLang(s.lang) === want)
    ?? null
}

/** "Svenska", "Engelska · SDH", or the stream's own title when it has no language. */
export function subtitleLabel(sub: HomeSubtitle, locale: string, fallback: string): string {
  const code = canonicalLang(sub.lang)
  let name: string | undefined
  if (code) {
    try { name = new Intl.DisplayNames([locale], { type: 'language' }).of(code) } catch { name = code }
  }
  if (name) name = name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
  const parts = [name, sub.title && sub.title !== name ? sub.title : undefined].filter(Boolean)
  return parts.length ? parts.join(' · ') : fallback
}
