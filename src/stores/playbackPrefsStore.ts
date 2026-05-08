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

interface State {
  byProfile: Record<string, Partial<PlaybackPrefs>>
  getPrefs: (profileId: string | null) => PlaybackPrefs
  setPrefs: (profileId: string, patch: Partial<PlaybackPrefs>) => void
}

export const usePlaybackPrefsStore = create<State>()(
  persist(
    (set, get) => ({
      byProfile: {},
      getPrefs: (id) => ({ ...DEFAULT, ...(id ? get().byProfile[id] : {}) }),
      setPrefs: (id, patch) =>
        set((s) => ({
          byProfile: { ...s.byProfile, [id]: { ...s.byProfile[id], ...patch } },
        })),
    }),
    { name: 'sf-playback-prefs' }
  )
)
