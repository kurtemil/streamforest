import { create } from 'zustand'
import {
  forgetSession, getSession, isAuthError, isReachable, listItems, localNetworkPermission,
  type HomeItem, type JellyfinSession,
} from '@/services/jellyfin'

/**
 * - `unknown`: not asked yet, or asking. Nothing is shown.
 * - `blocked`: this browser was told no when it asked about the home network.
 *   Saying "unreachable" then would be wrong at home, so it says what to change.
 * - `unreachable`: the server did not answer from here (away without Tailscale).
 *   One quiet line says so; no cards that look playable and then fail.
 * - `ready`: `items` is what this profile may see. It can be empty.
 */
export type HomeStatus = 'unknown' | 'blocked' | 'unreachable' | 'ready'

interface HomeLibraryState {
  status: HomeStatus
  profileId: string | null
  userName: string | null
  session: JellyfinSession | null
  items: HomeItem[]
  /** The title in the home player, or null. */
  playing: HomeItem | null
  load: (profileId: string, userName: string) => Promise<void>
  /** Reads the list again, for positions the server saved while something played. */
  reload: () => Promise<void>
  play: (item: HomeItem) => void
  close: () => void
}

/** What to watch next first: started and unfinished, most recent on top; then newest. */
export function orderForHome(items: HomeItem[]): HomeItem[] {
  const started = (i: HomeItem) => !i.played && i.positionSec > 10
  return [...items].sort((a, b) =>
    Number(started(b)) - Number(started(a)) ||
    (started(a) ? b.lastPlayedAt - a.lastPlayedAt : 0) ||
    b.addedAt - a.addedAt ||
    a.name.localeCompare(b.name, 'sv'),
  )
}

export const useHomeLibraryStore = create<HomeLibraryState>((set, get) => ({
  status: 'unknown',
  profileId: null,
  userName: null,
  session: null,
  items: [],
  playing: null,

  async load(profileId, userName) {
    // A profile switch must never show the previous profile's titles, even briefly:
    // for a kid that would be exactly the list the allowlist exists to hide.
    if (get().profileId !== profileId) {
      set({ status: 'unknown', profileId, userName, session: null, items: [], playing: null })
    }
    const permission = await localNetworkPermission()
    if (permission === 'denied') {
      if (get().profileId === profileId) set({ status: 'blocked', items: [] })
      return
    }
    if (!(await isReachable(permission === 'prompt'))) {
      if (get().profileId === profileId) set({ status: 'unreachable', items: [] })
      return
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await getSession(profileId, userName)
      if (!session) break
      try {
        const items = orderForHome(await listItems(session))
        if (get().profileId === profileId) set({ status: 'ready', session, items })
        return
      } catch (e) {
        // A token the server no longer knows: sign in again, once.
        if (isAuthError(e)) { forgetSession(profileId); continue }
        break
      }
    }
    if (get().profileId === profileId) set({ status: 'unreachable', items: [] })
  },

  async reload() {
    const { profileId, userName } = get()
    if (profileId && userName) await get().load(profileId, userName)
  },

  play: (item) => set({ playing: item }),
  close: () => set({ playing: null }),
}))
