import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { getClientContext } from '@/lib/diagnostics'

/**
 * What the viewport actually is, on the device holding it.
 *
 * The tab bar sat far above the bottom edge on a real iPhone while measuring
 * flush in every viewport Playwright can drive — and Playwright cannot emulate
 * safe-area insets, so no amount of local testing could say which number was
 * wrong. Two fixes were guessed and neither landed.
 *
 * This is the loop that replaces guessing: the numbers come off the phone, and
 * the row that matters is `tab bar`, which reports the bar's own rectangle
 * against the viewport height. If its bottom equals the viewport height, the bar
 * is positioned correctly and the gap is the inset; if it does not, the bar is
 * being laid out short and the inset is innocent.
 */

interface Row {
  label: string
  value: string
  /** Set when the value is the answer to something, rather than context. */
  flag?: 'ok' | 'suspect'
}

function measure(): Row[] {
  const ctx = getClientContext()
  const vv = window.visualViewport
  const nav = document.querySelector('nav[aria-label="Primary"]')
  const rows: Row[] = []

  rows.push({ label: 'viewport', value: `${window.innerWidth}×${window.innerHeight}` })
  rows.push({
    label: 'visual viewport',
    value: vv ? `${Math.round(vv.width)}×${Math.round(vv.height)} @${vv.offsetTop.toFixed(0)}` : 'n/a',
  })
  rows.push({ label: 'screen', value: ctx.screen })
  rows.push({ label: 'dpr', value: String(ctx.dpr) })
  rows.push({ label: 'insets t/r/b/l', value: ctx.insets })
  rows.push({
    label: 'standalone',
    value: `${ctx.standalone ? 'legacy' : '—'} / ${ctx.displayModeStandalone ? 'display-mode' : '—'}`,
  })
  rows.push({ label: 'ios', value: ctx.iosVersion ? `${ctx.iosVersion} (${ctx.brand})` : ctx.brand })

  if (nav) {
    const r = nav.getBoundingClientRect()
    const bottomEdge = Math.round(r.bottom)
    const reaches = bottomEdge === Math.round(window.innerHeight)
    rows.push({
      label: 'tab bar',
      value: `top ${Math.round(r.top)} · h ${Math.round(r.height)} · bottom ${bottomEdge}`,
    })
    rows.push({
      label: 'bar reaches bottom',
      value: reaches ? 'yes' : `no — short by ${Math.round(window.innerHeight - r.bottom)}px`,
      flag: reaches ? 'ok' : 'suspect',
    })
    const cs = getComputedStyle(nav)
    rows.push({ label: 'bar padding-bottom', value: cs.paddingBottom })
    rows.push({ label: 'bar position', value: `${cs.position} / bottom ${cs.bottom}` })
  } else {
    rows.push({ label: 'tab bar', value: 'not rendered at this width' })
  }

  return rows
}

export function ViewportReadout() {
  const [rows, setRows] = useState<Row[]>([])
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(() => setRows(measure()), [])

  useEffect(() => {
    refresh()
    // Insets and viewport both change on rotation, and the bar's geometry is the
    // thing under investigation — so re-measure rather than showing a stale set.
    window.addEventListener('resize', refresh)
    window.addEventListener('orientationchange', refresh)
    return () => {
      window.removeEventListener('resize', refresh)
      window.removeEventListener('orientationchange', refresh)
    }
  }, [refresh])

  const copy = async () => {
    const text = rows.map((r) => `${r.label}: ${r.value}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard is permission-gated in some contexts; the values are on screen
      // either way, so this is not worth an error state.
    }
  }

  return (
    <div className="bg-[#141414] rounded-xl p-5 ring-1 ring-white/5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">Viewport</p>
          <p className="text-xs text-neutral-500 mt-0.5">
            Safe-area insets can't be emulated, so layout at the screen edges has to be
            measured here.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={refresh}
            aria-label="Re-measure"
            className="w-11 h-11 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 transition-colors"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 min-h-11 px-3 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 text-xs font-medium transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-xs">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-neutral-500 whitespace-nowrap">{r.label}</dt>
            <dd
              className={
                r.flag === 'suspect'
                  ? 'text-red-400 font-semibold tabular-nums'
                  : r.flag === 'ok'
                  ? 'text-accent-400 tabular-nums'
                  : 'text-neutral-300 tabular-nums'
              }
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
