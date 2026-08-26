import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applyDocumentLang, detectLocale, isLocale, type Locale } from '@/lib/i18n/locales'

/**
 * The chosen language, per device.
 *
 * Per device rather than per profile on purpose: the four profiles are the
 * people who watch, not the phones they watch on, and a phone belongs to one
 * person. Making this follow the profile would mean the language changing when
 * someone hands the tablet over, and it would need a round trip to D1 before
 * the first screen could be painted.
 *
 * Nothing is stored until the switch is used. Until then `locale` is whatever
 * the device asked for, so a Swedish phone opens in Swedish on first load with
 * no setup at all — and re-detects if the device language later changes.
 */
interface State {
  /** null = never chosen; follow the device. */
  chosen: Locale | null
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useLocaleStore = create<State>()(
  persist(
    (set) => ({
      chosen: null,
      locale: detectLocale(),
      setLocale: (locale) => {
        applyDocumentLang(locale)
        set({ chosen: locale, locale })
      },
    }),
    {
      name: 'sf-locale',
      // Only the choice is persisted. `locale` is derived on every load so an
      // untouched install keeps following the device rather than freezing the
      // language it happened to be detected as on the first ever visit.
      partialize: (s) => ({ chosen: s.chosen }),
      merge: (persisted, current) => {
        const chosen = (persisted as { chosen?: unknown } | undefined)?.chosen
        const locale = isLocale(chosen) ? chosen : detectLocale()
        return { ...current, chosen: isLocale(chosen) ? chosen : null, locale }
      },
      onRehydrateStorage: () => (state) => {
        if (state) applyDocumentLang(state.locale)
      },
    },
  ),
)

/** Set `<html lang>` before the first paint, rather than after rehydration. */
applyDocumentLang(useLocaleStore.getState().locale)
