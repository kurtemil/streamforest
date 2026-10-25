// The version check at launch, which keeps the app from starting twice.
//
// A home-screen app starts from the copy its service worker keeps. When a build has
// been deployed since, the worker fetches it in the background and `autoUpdate`
// reloads the page once the new worker takes over — a few seconds in, after the old
// build had already read the catalogue (205 803 rows) and drawn the home screen. So
// the first launch after every deploy loaded, showed the app, and loaded again. The
// client log had it on 2026-10-25: two session-starts from the iPhone, nine seconds
// apart, with nothing in between.
//
// Now the catalogue waits for the answer. A launch from the copy asks the worker for
// a new version first, which is one fetch of sw.js. If one is on its way, the loading
// screen stays up until it takes over and the page reloads into it. Offline, or on a
// network too slow to answer in time, the app starts from the copy as before, and
// `autoUpdate` still reloads when the new worker arrives.

const CHECK_MS = 3000
const INSTALL_MS = 20_000

let reloading = false

/** Both this check and `autoUpdate` reload when the new worker takes over; one reload is enough. */
export function reloadOnce(): void {
  if (reloading) return
  reloading = true
  window.location.reload()
}

/**
 * Resolves when the page is the newest build there is to have, as far as can be told
 * in time. While a newer one installs it stays pending, and the page reloads into it
 * when it takes control; if the install fails or takes too long, it resolves anyway.
 */
export async function untilCurrent(
  registration: Promise<ServiceWorkerRegistration | undefined>,
  reload: () => void,
  ms = { check: CHECK_MS, install: INSTALL_MS },
): Promise<void> {
  const incoming = await Promise.race([
    registration
      .then(async (r) => {
        if (!r) return null
        // Resolves once the new script is fetched and its install has begun, so
        // `installing` is set if there is a new version.
        await r.update()
        return r.installing ?? r.waiting
      })
      .catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms.check)),
  ])
  if (!incoming) return
  await new Promise<void>((resolve) => {
    // Listened for here rather than left to `autoUpdate`: the update the navigation
    // itself triggers can be found before the plugin listens, and then it never reloads.
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
    incoming.addEventListener('statechange', () => { if (incoming.state === 'redundant') resolve() })
    setTimeout(resolve, ms.install)
  })
}

let resolveRegistration!: (r?: ServiceWorkerRegistration) => void
const registration = new Promise<ServiceWorkerRegistration | undefined>((resolve) => { resolveRegistration = resolve })

/** From registerSW's onRegisteredSW, or with nothing from onRegisterError. */
export function registered(r?: ServiceWorkerRegistration): void {
  resolveRegistration(r)
}

// A page with no controller came from the network, so it is the deployed build. The
// kiosks have no worker at all (main.tsx).
const fromCopy = typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller)

/** What App waits for before it reads the catalogue. */
export const launchChecked: Promise<void> = fromCopy ? untilCurrent(registration, reloadOnce) : Promise.resolve()
