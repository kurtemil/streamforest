import { create } from 'zustand'
import { useBionStore } from '@/stores/bionStore'
import {
  forgetSession, getSession, isAuthError, isReachable, listItems, localNetworkPermission, setPlayed,
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
  /** The title whose detail sheet is open, or null. A tap on a card opens this, not the player. */
  detail: HomeItem | null
  load: (profileId: string, userName: string) => Promise<void>
  /** Reads the list again, for positions the server saved while something played. */
  reload: () => Promise<void>
  /** Starts a title where this profile left it, or from the beginning. Closes the sheet. */
  play: (item: HomeItem, opts?: { fromStart?: boolean }) => void
  close: () => void
  openDetail: (item: HomeItem) => void
  closeDetail: () => void
  /** Watched or not, on the server, shown at once and confirmed by a fresh list. */
  markPlayed: (item: HomeItem, played: boolean) => Promise<void>
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

const inFlight = new Map<string, Promise<void>>()
const again = new Set<string>()

/** One pass: may the browser ask, does the server answer, and what may this profile see. */
async function loadOnce(profileId: string, userName: string): Promise<void> {
  const { getState: get, setState: set } = useHomeLibraryStore
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
      // Keep the session object while its token is the same: things that hold it
      // should not see a change that is not one.
      const kept = get().session?.token === session.token ? get().session : session
      if (get().profileId === profileId) set({ status: 'ready', session: kept, items })
      return
    } catch (e) {
      // A token the server no longer knows: sign in again, once.
      if (isAuthError(e)) { forgetSession(profileId, session.token); continue }
      break
    }
  }
  if (get().profileId === profileId) set({ status: 'unreachable', items: [] })
}

export const useHomeLibraryStore = create<HomeLibraryState>((set, get) => ({
  status: 'unknown',
  profileId: null,
  userName: null,
  session: null,
  items: [],
  playing: null,
  detail: null,

  async load(profileId, userName) {
    // A profile switch must never show the previous profile's titles, even briefly:
    // for a kid that would be exactly the list the allowlist exists to hide.
    if (get().profileId !== profileId) {
      set({ status: 'unknown', profileId, userName, session: null, items: [], playing: null, detail: null })
    }
    // One load per profile at a time. Two at once each signed in, and Jellyfin
    // revokes a device's token when the same device signs in again: one load got
    // 401, and the store could end up holding the revoked token, so playback and
    // position reports failed until the next reload. Measured 2026-10-17 on a
    // first visit (StrictMode mounts twice in dev; in production a foreground or a
    // player closing during a load does it). A call that arrives meanwhile asks for
    // one more pass, so nothing it was meant to pick up is lost.
    const running = inFlight.get(profileId)
    if (running) { again.add(profileId); return running }
    const run = (async () => {
      do {
        again.delete(profileId)
        await loadOnce(profileId, userName)
      } while (again.has(profileId))
    })().finally(() => inFlight.delete(profileId))
    inFlight.set(profileId, run)
    return run
  },

  async reload() {
    const { profileId, userName } = get()
    if (profileId && userName) await get().load(profileId, userName)
  },

  // The player resumes from the item's position, so starting over is the same item
  // at 0. A split film starts over in every part: its watched parts are unmarked,
  // or the film would still count them as seen.
  play: (item, opts) => {
    // Bion mode sends it to the kiosk, which plays it as this same profile.
    const bion = useBionStore.getState()
    const profileId = get().profileId
    if (bion.mode && profileId) {
      set({ detail: null })
      void bion.playHome(item, profileId, opts?.fromStart)
      return
    }
    if (!opts?.fromStart) { set({ playing: item, detail: null }); return }
    const { session } = get()
    if (session && item.parts?.some((p) => p.played)) {
      void Promise.all(item.parts.map((p) => setPlayed(session, p.id, false).catch(() => {})))
    }
    const parts = item.parts?.map((p) => ({ ...p, positionSec: 0, played: false }))
    set({ playing: { ...item, positionSec: 0, played: false, ...(parts ? { parts } : {}) }, detail: null })
  },
  close: () => set({ playing: null }),
  openDetail: (item) => set({ detail: item }),
  closeDetail: () => set({ detail: null }),

  async markPlayed(item, played) {
    const { session } = get()
    if (!session) return
    // Jellyfin clears the resume point when a film is marked watched, so the sheet
    // and the card both drop the bar straight away rather than after the round trip.
    const patch = (i: HomeItem): HomeItem => (i.id === item.id ? { ...i, played, positionSec: played ? 0 : i.positionSec } : i)
    set((s) => ({ items: s.items.map(patch), detail: s.detail && patch(s.detail) }))
    // Every file of a split film: the film is watched when all of them are.
    const ids = item.parts?.map((p) => p.id) ?? [item.id]
    await Promise.all(ids.map((id) => setPlayed(session, id, played).catch(() => {
      // The list read below puts back what the server actually has.
    })))
    await get().reload()
    const fresh = get().items.find((i) => i.id === item.id)
    if (fresh && get().detail?.id === item.id) set({ detail: fresh })
  },
}))
