// Settings → VLC. The "Open in VLC" buttons can only reach VLC through a URL
// scheme, and desktop VLC registers none — so every computer needs the handler
// from public/vlc-handler.{sh,ps1} installed once. This section is where that
// happens, because the alternative is finding the command in a repo.
//
// A page cannot install a URL-scheme handler itself, on either OS: that is
// exactly the privilege the scheme registry exists to withhold. One command is
// the floor. What this section can do is hand over the right one for the OS
// you are on, and answer whether it took.
import { useState } from 'react'
import { Check, Copy, Loader2, MonitorPlay } from 'lucide-react'
import { probeVlcHandler, vlcPlatform } from '@/lib/vlc'

type Desktop = 'macos' | 'windows'

const INSTALLERS: Record<Desktop, {
  label: string
  terminal: string
  command: (origin: string) => string
  uninstall: string
}> = {
  macos: {
    label: 'macOS',
    terminal: 'Terminal (⌘-space → "Terminal")',
    command: (origin) => `curl -fsSL ${origin}/vlc-handler.sh | bash`,
    uninstall: 'rm -rf "$HOME/Applications/VLC URL Handler.app"',
  },
  windows: {
    label: 'Windows',
    terminal: 'PowerShell (Win+X → "Terminal")',
    command: (origin) => `irm ${origin}/vlc-handler.ps1 | iex`,
    uninstall: 'reg delete "HKCU\\Software\\Classes\\vlc" /f',
  },
}

type TestState = 'idle' | 'testing' | 'ok' | 'missing'

export function VlcHandlerSection() {
  const platform = vlcPlatform()
  const [os, setOs] = useState<Desktop>(platform === 'windows' ? 'windows' : 'macos')
  const [copied, setCopied] = useState(false)
  const [test, setTest] = useState<TestState>('idle')

  const isMobile = platform === 'ios' || platform === 'android'
  const installer = INSTALLERS[os]
  const command = installer.command(location.origin)

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
          <p>The VLC buttons hand playback to VLC — a season from a show's header, a single episode from its row.</p>
          {isMobile ? (
            <p className="text-neutral-600 text-xs mt-0.5">
              Nothing to set up on this device: the VLC app registers its own link scheme. Just have it installed.
            </p>
          ) : (
            <p className="text-neutral-600 text-xs mt-0.5">
              Desktop VLC registers no link scheme, so each computer needs this one-time command. Without it the
              buttons still work — they download a playlist file for you to open instead.
            </p>
          )}
        </div>

        {!isMobile && (
          <>
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
                  {platform === key && <span className="text-neutral-500 font-normal"> · this one</span>}
                </button>
              ))}
            </div>

            <div>
              <p className="text-xs text-neutral-500 mb-2">
                Paste this into {installer.terminal} and press enter. Once per computer.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-lg bg-black/40 ring-1 ring-white/8 px-3 py-2.5 text-xs text-neutral-300 font-mono">
                  {command}
                </code>
                <button
                  onClick={copy}
                  className="flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-400 text-sm font-medium transition-colors shrink-0"
                >
                  {copied ? <Check size={14} className="text-accent-500" /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-4">
              <div className="text-xs text-neutral-500 leading-relaxed min-w-0">
                {test === 'ok' && <p className="text-accent-400">VLC answered — this computer is set up.</p>}
                {test === 'missing' && <p className="text-warn-500">VLC did not open. Run the command above, then test again.</p>}
                {test !== 'ok' && test !== 'missing' && <p>Opens VLC on an empty test playlist — it plays nothing.</p>}
                <p className="text-neutral-600 mt-0.5 truncate">Undo: <code className="font-mono">{installer.uninstall}</code></p>
              </div>
              <button
                onClick={runTest}
                disabled={test === 'testing'}
                className="flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-400 text-sm font-medium transition-colors shrink-0 disabled:opacity-40"
              >
                {test === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <MonitorPlay size={14} />}
                Test
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
