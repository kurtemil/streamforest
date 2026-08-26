// Settings → VLC. Two ways to get from a VLC button to VLC actually playing,
// and they are listed in the order of how much they ask of the person:
//
//   1. Let the browser open the downloaded playlist by itself. One toggle in a
//      menu the browser already shows, no install, and the VLC button becomes a
//      single click that ends in VLC. This is the route for a normal computer.
//   2. Install the `vlc://` handler, which removes the download step entirely.
//      A page cannot do this for you on either OS — that is precisely the
//      privilege the scheme registry exists to withhold — so it costs one pasted
//      command. It is folded away here because it is the optional one.
//
// The original version of this section led with the command, which is how you
// end up telling someone to open a terminal to fix a two-click annoyance.
import { useState } from 'react'
import { Check, ChevronDown, Copy, Loader2, MonitorPlay } from 'lucide-react'
import { probeVlcHandler, vlcHandler, vlcPlatform } from '@/lib/vlc'
import { useT, type MessageKey } from '@/lib/i18n'

type Desktop = 'macos' | 'windows'

const INSTALLERS: Record<Desktop, {
  /** An OS name, not a word — the same in both languages, so not a key. */
  label: string
  terminal: MessageKey
  command: (origin: string) => string
  uninstall: string
}> = {
  macos: {
    label: 'macOS',
    terminal: 'vlc.terminalMac',
    command: (origin) => `curl -fsSL ${origin}/vlc-handler.sh | bash`,
    uninstall: 'rm -rf "$HOME/Applications/VLC URL Handler.app"',
  },
  windows: {
    label: 'Windows',
    terminal: 'vlc.terminalWindows',
    command: (origin) => `irm ${origin}/vlc-handler.ps1 | iex`,
    uninstall: 'reg delete "HKCU\\Software\\Classes\\vlc" /f',
  },
}

// Where each browser hides "stop asking me about this file type". They all have
// it; no two of them call it the same thing or keep it in the same place — and
// none of them call it the same thing in two languages either, so the steps are
// a key and the browser's own name is not.
function autoOpenHint(): { browser: string | null; steps: MessageKey } {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Edg\//.test(ua))     return { browser: 'Edge',    steps: 'vlc.stepsEdge' }
  if (/Firefox\//.test(ua)) return { browser: 'Firefox', steps: 'vlc.stepsFirefox' }
  if (/Chrome\//.test(ua))  return { browser: 'Chrome',  steps: 'vlc.stepsChrome' }
  if (/Safari\//.test(ua))  return { browser: 'Safari',  steps: 'vlc.stepsSafari' }
  return { browser: null, steps: 'vlc.stepsFallback' }
}

type TestState = 'idle' | 'testing' | 'ok' | 'missing'

export function VlcHandlerSection() {
  const t = useT()
  const platform = vlcPlatform()
  const [os, setOs] = useState<Desktop>(platform === 'windows' ? 'windows' : 'macos')
  const [copied, setCopied] = useState(false)
  const [test, setTest] = useState<TestState>('idle')
  const [showInstaller, setShowInstaller] = useState(false)
  // Read once per mount: a verdict only changes when the Test button changes it.
  const [known] = useState(vlcHandler)

  const isMobile = platform === 'ios' || platform === 'android'
  const installer = INSTALLERS[os]
  const command = installer.command(location.origin)
  const hint = autoOpenHint()
  const handlerWorks = test === 'ok' || (test === 'idle' && known === 'installed')

  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard refused (no permission, or an insecure origin) — the command
      // is on screen in full, so selecting it by hand still works.
    }
  }

  async function runTest() {
    setTest('testing')
    setTest((await probeVlcHandler()) ? 'ok' : 'missing')
  }

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2.5 mb-4">
        <MonitorPlay size={16} className="text-neutral-400" />
        <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">VLC</h2>
      </div>

      <div className="bg-white/[0.03] rounded-xl p-4 ring-1 ring-white/8 flex flex-col gap-4">
        <div className="text-sm text-neutral-400 leading-relaxed">
          <p>{t('vlc.intro')}</p>
          <p className="text-neutral-600 text-xs mt-0.5">
            {isMobile
              ? t('vlc.mobileHint')
              : handlerWorks
              ? t('vlc.worksHint')
              : t('vlc.downloadHint')}
          </p>
        </div>

        {!isMobile && !handlerWorks && (
          <div className="rounded-lg bg-black/25 ring-1 ring-white/8 px-4 py-3">
            <p className="text-sm text-white font-medium mb-1">
              {t('vlc.autoOpenTitle', { browser: hint.browser ?? t('vlc.browserFallback') })}
            </p>
            <p className="text-sm text-neutral-400 leading-relaxed">{t(hint.steps)}</p>
            <p className="text-xs text-neutral-600 mt-1.5">{t('vlc.autoOpenFooter')}</p>
          </div>
        )}

        {!isMobile && (
          <div className="border-t border-white/5 pt-4 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div className="text-xs text-neutral-500 leading-relaxed min-w-0">
                {test === 'ok' && <p className="text-accent-400">{t('vlc.testOk')}</p>}
                {test === 'missing' && <p className="text-warn-500">{t('vlc.testMissing')}</p>}
                {test === 'testing' && <p>{t('vlc.testWaiting')}</p>}
                {test === 'idle' && (
                  <p>
                    {known === 'installed' ? t('vlc.knownInstalled')
                      : known === 'missing' ? t('vlc.knownMissing')
                      : t('vlc.knownUnknown')}
                  </p>
                )}
                <p className="text-neutral-600 mt-0.5">{t('vlc.testNote')}</p>
              </div>
              <button
                onClick={runTest}
                disabled={test === 'testing'}
                className="flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-400 text-sm font-medium transition-colors shrink-0 disabled:opacity-40"
              >
                {test === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <MonitorPlay size={14} />}
                {t('vlc.test')}
              </button>
            </div>

            <div>
              <button
                onClick={() => setShowInstaller(!showInstaller)}
                className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                <ChevronDown size={13} className={`transition-transform ${showInstaller ? 'rotate-180' : ''}`} />
                {t('vlc.installerToggle')}
              </button>

              {showInstaller && (
                <div className="mt-3 flex flex-col gap-3">
                  <p className="text-xs text-neutral-500 leading-relaxed">
                    {t('vlc.installerBody', { scheme: 'vlc://' })}
                  </p>
                  <div className="flex gap-2">
                    {(Object.keys(INSTALLERS) as Desktop[]).map((key) => (
                      <button
                        key={key}
                        onClick={() => { setOs(key); setCopied(false) }}
                        className={`min-h-11 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          os === key
                            ? 'bg-accent-600/20 text-accent-400 ring-1 ring-accent-600/40'
                            : 'text-neutral-400 bg-white/3 hover:bg-white/6'
                        }`}
                      >
                        {INSTALLERS[key].label}
                        {platform === key && <span className="text-neutral-500 font-normal">{t('vlc.thisOne')}</span>}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-neutral-500">{t('vlc.pasteInto', { terminal: t(installer.terminal) })}</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-lg bg-black/40 ring-1 ring-white/8 px-3 py-2.5 text-xs text-neutral-300 font-mono">
                      {command}
                    </code>
                    <button
                      onClick={copy}
                      className="flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-400 text-sm font-medium transition-colors shrink-0"
                    >
                      {copied ? <Check size={14} className="text-accent-500" /> : <Copy size={14} />}
                      {copied ? t('vlc.copied') : t('vlc.copy')}
                    </button>
                  </div>
                  <p className="text-xs text-neutral-600 truncate">{t('vlc.undo', { command: installer.uninstall })}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
