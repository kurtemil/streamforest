import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { getProviderStatus } from '@/lib/transcode'
import { formatDateTime, useT } from '@/lib/i18n'

const RECHECK_MS = 5 * 60 * 1000

/**
 * One line when the home server has seen that no provider address answers.
 *
 * The provider was gone for seventeen days in September and October 2026 before
 * anyone noticed: the app kept showing its cached catalogue, and every title looked
 * playable until it was tapped. The transcode server checks the provider every ten
 * minutes and on every failed playback (transcode-proxy/provider.mjs). If its last
 * check of the address in use failed, it has already tried the others, so none of
 * them answers.
 *
 * It says nothing unless the server reports exactly that. An unreachable home
 * server, an offline phone and a server that has not checked yet all look alike
 * from here, and a guess would be the kind of row that cries wolf.
 */
export function ProviderDownBanner() {
  const t = useT()
  const [downSince, setDownSince] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    const check = () => {
      getProviderStatus().then((s) => {
        if (!alive) return
        const last = s?.active ? s.checks[s.active] : undefined
        setDownSince(last && !last.ok ? last.at : null)
      })
    }
    check()
    const timer = window.setInterval(check, RECHECK_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (downSince === null) return null
  return (
    <div role="status" className="flex items-start gap-2 mx-4 mt-3 md:mx-8 text-sm text-amber-200 bg-amber-500/10 ring-1 ring-amber-400/20 rounded-lg px-3 py-2.5">
      <AlertCircle size={15} className="shrink-0 mt-0.5" />
      <p>{t('layout.providerDown', { time: formatDateTime(downSince) })}</p>
    </div>
  )
}
