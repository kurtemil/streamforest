import { Download, X } from 'lucide-react'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'

export function InstallPrompt() {
  const { visible, install, dismiss } = useInstallPrompt()
  if (!visible) return null

  return (
    <div className="fixed bottom-20 md:bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50 bg-surface-300 border border-white/10 rounded-2xl shadow-cinema p-4 flex items-center gap-3 animate-slide-up">
      <div className="w-9 h-9 rounded-xl bg-accent-600 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
          <path d="M5 3l14 9-14 9V3z" fill="white" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">Install StreamForest</p>
        <p className="text-xs text-neutral-500 mt-0.5">Add to your home screen</p>
      </div>
      <button
        onClick={install}
        className="flex items-center gap-1.5 bg-accent-600 hover:bg-accent-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0"
      >
        <Download size={13} />
        Install
      </button>
      <button
        onClick={dismiss}
        className="text-neutral-500 hover:text-white p-1 transition-colors shrink-0"
        aria-label="Dismiss"
      >
        <X size={15} />
      </button>
    </div>
  )
}
