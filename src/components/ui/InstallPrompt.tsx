import { Download, X, Share } from 'lucide-react'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import { Logo } from '@/ui'
import { useT } from '@/lib/i18n'

export function InstallPrompt() {
  const t = useT()
  const { kind, install, dismiss } = useInstallPrompt()
  if (!kind) return null

  // On iOS there is no install API, so the card explains the two taps Safari and
  // Chrome both require. Saying where the button is beats a button that cannot
  // exist — and until now iPhone users saw nothing at all.
  const manual = kind === 'ios-manual'

  return (
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] md:bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50 bg-surface-300 border border-white/10 rounded-2xl shadow-cinema p-4 flex items-center gap-3 animate-slide-up">
      <Logo size={36} className="shrink-0 rounded-xl" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{t('install.title')}</p>
        {manual ? (
          <p className="text-xs text-neutral-400 mt-0.5 flex items-center gap-1 flex-wrap">
            {t('install.tap')}{' '}
            <Share size={12} className="inline text-neutral-300" aria-label={t('install.share')} />{' '}
            {t('install.then')}{' '}
            <span className="text-neutral-300">{t('install.addToHomeScreen')}</span>
          </p>
        ) : (
          <p className="text-xs text-neutral-500 mt-0.5">{t('install.addToHome')}</p>
        )}
      </div>
      {!manual && (
        <button
          onClick={install}
          className="flex items-center gap-1.5 bg-accent-600 hover:bg-accent-500 text-white text-xs font-medium px-3 py-2.5 rounded-lg transition-colors shrink-0"
        >
          <Download size={13} />
          {t('install.action')}
        </button>
      )}
      <button
        onClick={dismiss}
        className="text-neutral-500 hover:text-white w-11 h-11 -mr-2 flex items-center justify-center transition-colors shrink-0"
        aria-label={t('install.dismiss')}
      >
        <X size={15} />
      </button>
    </div>
  )
}
