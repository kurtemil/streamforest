import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface PlaybackPrefs {
  preferredSubtitleLang: string  // '' = off
  preferredAudioLang: string     // '' = off
  autoplayNextEpisode: boolean
}

const DEFAULT: PlaybackPrefs = {
  preferredSubtitleLang: '',
  preferredAudioLang: '',
  autoplayNextEpisode: true,
}

const PREFS_API = '/api/preferences'

async function pushPrefs(profileId: string, prefs: Partial<PlaybackPrefs>) {
  const value = JSON.stringify({
    subtitle_lang: prefs.preferredSubtitleLang ?? '',
    audio_lang: prefs.preferredAudioLang ?? '',
  })
  fetch(PREFS_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, key: 'prefs', value }),
  }).catch(() => {})
}

/**
 * What was chosen last time for one specific show or film.
 *
 * The per-profile language preference above is a default, not a memory: it
 * cannot express "this show's English track, shifted 1.5 s" — and that is
 * exactly what stays true across a season and had to be re-entered every single
 * episode. The delay is the most valuable of the three, because a mis-synced
 * subtitle file is usually mis-synced by the same amount throughout.
 */
export interface TitlePrefs {
  subtitleLang?: string
  audioLang?: string
  subtitleDelay?: number
}

interface State {
  byProfile: Record<string, Partial<PlaybackPrefs>>
  /** Keyed `${profileId}:${showKey}` — a series shares one entry across episodes. */
  byTitle: Record<string, TitlePrefs>
  getPrefs: (profileId: string | null) => PlaybackPrefs
  setPrefs: (profileId: string, patch: Partial<PlaybackPrefs>) => void
  getTitlePrefs: (profileId: string | null, titleKey: string) => TitlePrefs
  setTitlePrefs: (profileId: string | null, titleKey: string, patch: TitlePrefs) => void
  syncFromRemote: (profileId: string) => Promise<void>
}

export const usePlaybackPrefsStore = create<State>()(
  persist(
    (set, get) => ({
      byProfile: {},
      byTitle: {},
      getPrefs: (id) => ({ ...DEFAULT, ...(id ? get().byProfile[id] : {}) }),
      getTitlePrefs: (id, titleKey) => (id ? get().byTitle[`${id}:${titleKey}`] ?? {} : {}),
      setTitlePrefs: (id, titleKey, patch) => {
        if (!id) return
        const key = `${id}:${titleKey}`
        set((s) => ({ byTitle: { ...s.byTitle, [key]: { ...s.byTitle[key], ...patch } } }))
      },
      setPrefs: (id, patch) => {
        const next = { ...get().byProfile[id], ...patch }
        set((s) => ({ byProfile: { ...s.byProfile, [id]: next } }))
        pushPrefs(id, next)
      },
      syncFromRemote: async (profileId: string) => {
        try {
          const res = await fetch(`${PREFS_API}?profileId=${encodeURIComponent(profileId)}`)
          if (!res.ok) return
          const data = await res.json() as Record<string, string>
          if (!data.prefs) return
          const remote = JSON.parse(data.prefs) as { subtitle_lang?: string; audio_lang?: string }
          const patch: Partial<PlaybackPrefs> = {}
          if (remote.subtitle_lang !== undefined) patch.preferredSubtitleLang = remote.subtitle_lang
          if (remote.audio_lang !== undefined) patch.preferredAudioLang = remote.audio_lang
          set((s) => ({
            byProfile: { ...s.byProfile, [profileId]: { ...s.byProfile[profileId], ...patch } },
          }))
        } catch {
          // offline or D1 not configured — silent
        }
      },
    }),
    { name: 'sf-playback-prefs' }
  )
)
