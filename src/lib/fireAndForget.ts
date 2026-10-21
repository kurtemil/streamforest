/**
 * A request whose answer nobody reads: a PUT of progress, a status, a preference.
 *
 * The body is cancelled as soon as the headers are in. In Chromium an unread body keeps
 * its data pipe, and with it a shared-memory file, open until the garbage collector
 * happens to run, and the collector does not know what a file costs. The kiosk wrote
 * its status every five seconds through a fetch like this, and after 80 minutes of film
 * its renderer had 1 024 `memfd:shared-memory-region` files open, could not get more,
 * and died (2026-10-20 and -21, hemma/hemmabio.md). Never fails: offline is fine.
 */
export function fireAndForget(input: string, init?: RequestInit): Promise<void> {
  return fetch(input, init)
    .then((res) => { res.body?.cancel().catch(() => {}) })
    .catch(() => {})
}
