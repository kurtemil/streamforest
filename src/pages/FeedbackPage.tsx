import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bug, Check, Lightbulb, RotateCcw, Trash2 } from 'lucide-react'
import type { Feedback, FeedbackKind } from '@/types'
import { getProfile, useProfileStore } from '@/stores/profileStore'
import {
  deleteFeedback,
  describeDevice,
  listFeedback,
  sendFeedback,
  setFeedbackResolved,
} from '@/services/feedback'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/ui'
import { formatDateTime, useT, type MessageKey } from '@/lib/i18n'

/**
 * The suggestion box, ported from `lagom`.
 *
 * Two boxes rather than one field with a dropdown, and that is the whole design:
 * "report a fault" and "suggest something" ask for different sentences, and a
 * person who has just hit a bug should not have to classify it before they can
 * start typing. The kind is decided by which box you write in.
 *
 * Everyone can write — the reason it is its own route and not a section of
 * Settings, which the kid profiles cannot open. The household inbox below is
 * admin-only, and is the same list folded the same way as Lagom's: what is still
 * open stays visible, what has been ticked off steps aside without disappearing.
 */

const KINDS: { kind: FeedbackKind; label: MessageKey; placeholder: MessageKey; Icon: typeof Bug }[] = [
  { kind: 'bug',  label: 'feedback.reportBug',   placeholder: 'feedback.reportBugPlaceholder',   Icon: Bug },
  { kind: 'idea', label: 'feedback.suggestIdea', placeholder: 'feedback.suggestIdeaPlaceholder', Icon: Lightbulb },
]

const MAX_BODY = 2000

const KIND_LABEL: Record<FeedbackKind, MessageKey> = {
  bug: 'feedback.kindBug',
  idea: 'feedback.kindIdea',
}

function ReportCard({
  item,
  t,
  admin,
  onToggle,
  onDelete,
}: {
  item: Feedback
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  admin: boolean
  onToggle?: () => void
  onDelete?: () => void
}) {
  const Icon = item.kind === 'bug' ? Bug : Lightbulb
  return (
    <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/8 p-4 flex gap-3">
      <Icon size={16} className={`shrink-0 mt-0.5 ${item.kind === 'bug' ? 'text-danger-500' : 'text-warn-500'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-micro uppercase tracking-wider text-neutral-500">
          <span>{t(KIND_LABEL[item.kind])}</span>
          {admin && <span className="font-semibold text-neutral-400">{item.authorName}</span>}
          <span>{formatDateTime(item.createdAt)}</span>
          {item.resolved && (
            <span className="rounded-full bg-accent-600/20 text-accent-400 px-2 py-0.5 font-semibold">
              {t('feedback.resolved')}
            </span>
          )}
        </div>
        <p className={`mt-1.5 whitespace-pre-wrap text-body ${item.resolved ? 'text-neutral-500' : 'text-neutral-200'}`}>
          {item.body}
        </p>
        {admin && item.userAgent && (
          <p className="mt-2 text-micro text-neutral-600 truncate" title={item.userAgent}>
            {deviceLine(item, t)}
          </p>
        )}
        {admin && (onToggle || onDelete) && (
          <div className="mt-3 flex gap-2">
            {onToggle && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={onToggle}
                leadingIcon={item.resolved ? <RotateCcw size={13} /> : <Check size={13} />}
              >
                {item.resolved ? t('feedback.reopen') : t('feedback.markResolved')}
              </Button>
            )}
            {onDelete && (
              <Button variant="ghost" size="sm" className="min-h-11" onClick={onDelete} leadingIcon={<Trash2 size={13} />}>
                {t('common.remove')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** The device summary as stored, so an old report still reads as what it was. */
function deviceLine(item: Feedback, t: (key: MessageKey) => string): string {
  let viewport = ''
  let standalone = false
  try {
    const c = JSON.parse(item.context ?? '{}') as {
      viewport?: string; standalone?: boolean; displayModeStandalone?: boolean
    }
    viewport = c.viewport ?? ''
    standalone = Boolean(c.standalone || c.displayModeStandalone)
  } catch {
    // A report from before the column, or a blob we cannot read. The
    // user-agent alone still says which phone, which is most of the value.
  }
  const ua = item.userAgent ?? ''
  const device = /iPad/.test(ua) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'Android'
    : /Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : ''
  return [device, t(standalone ? 'device.homeScreen' : 'device.browser'), viewport]
    .filter(Boolean)
    .join(' · ')
}

export function FeedbackPage() {
  const t = useT()
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const profile = getProfile(activeProfileId)
  const isAdmin = profile?.role === 'admin'

  const [drafts, setDrafts] = useState<Record<FeedbackKind, string>>({ bug: '', idea: '' })
  const [sending, setSending] = useState<FeedbackKind | null>(null)
  const [sent, setSent] = useState<FeedbackKind | null>(null)
  const [failed, setFailed] = useState<FeedbackKind | null>(null)

  const [items, setItems] = useState<Feedback[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [showResolved, setShowResolved] = useState(false)

  const device = useMemo(() => describeDevice(), [])

  const reload = useCallback(async () => {
    if (!activeProfileId) return
    try {
      setLoadFailed(false)
      setItems(await listFeedback(isAdmin ? { all: true } : { profileId: activeProfileId }))
    } catch {
      setLoadFailed(true)
    }
  }, [activeProfileId, isAdmin])

  useEffect(() => { void reload() }, [reload])

  const submit = async (kind: FeedbackKind) => {
    const body = drafts[kind].trim()
    if (!body || !activeProfileId || !profile) return
    setSending(kind)
    setFailed(null)
    try {
      await sendFeedback({ profileId: activeProfileId, authorName: profile.name, kind, body })
      setDrafts((d) => ({ ...d, [kind]: '' }))
      setSent(kind)
      setTimeout(() => setSent((k) => (k === kind ? null : k)), 4000)
      await reload()
    } catch {
      setFailed(kind)
    } finally {
      setSending(null)
    }
  }

  const open = (items ?? []).filter((i) => !i.resolved)
  const done = (items ?? []).filter((i) => i.resolved)

  if (!activeProfileId) {
    return (
      <div className="p-8">
        <EmptyState icon={<Lightbulb size={40} />} title={t('feedback.title')} description={t('feedback.noProfile')} />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 pb-12 max-w-2xl">
      <h1 className="text-2xl font-bold text-white">{t('feedback.title')}</h1>
      <p className="text-neutral-500 text-body mt-1">{t('feedback.hint')}</p>

      <div className="mt-6 flex flex-col gap-4">
        {KINDS.map(({ kind, label, placeholder, Icon }) => (
          <div key={kind} className="rounded-xl bg-white/[0.03] ring-1 ring-white/8 p-4 flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-white" htmlFor={`fb-${kind}`}>
              <Icon size={15} className={kind === 'bug' ? 'text-danger-500' : 'text-warn-500'} />
              {t(label)}
            </label>
            <textarea
              id={`fb-${kind}`}
              value={drafts[kind]}
              onChange={(e) => setDrafts((d) => ({ ...d, [kind]: e.target.value }))}
              placeholder={t(placeholder)}
              rows={3}
              maxLength={MAX_BODY}
              className="w-full resize-y bg-white/5 border border-white/8 rounded-lg px-3 py-2.5 text-base can-hover:text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-accent-600/60 focus:bg-white/8 transition-colors"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-caption min-w-0 truncate">
                {sent === kind ? (
                  <span className="text-accent-400">{t('feedback.sent')}</span>
                ) : failed === kind ? (
                  <span className="text-danger-500">{t('feedback.error')}</span>
                ) : null}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="min-h-11 px-5"
                onClick={() => submit(kind)}
                loading={sending === kind}
                disabled={!drafts[kind].trim() || sending !== null}
              >
                {t('feedback.send')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* What goes along with the report, said out loud. Collecting this quietly
          from your own household is not the kind of app this is. */}
      {device && (
        <p className="mt-3 text-micro text-neutral-600">
          {t('feedback.deviceAttached')} {device} · {t('feedback.deviceWhy')}
        </p>
      )}

      <h2 className="mt-10 mb-1 text-sm font-semibold text-neutral-400 uppercase tracking-wider">
        {isAdmin ? t('feedback.inbox') : t('feedback.yours')}
      </h2>
      {isAdmin && <p className="text-xs text-neutral-600 mb-4">{t('feedback.inboxHint')}</p>}

      {loadFailed ? (
        <p className="text-caption text-danger-500">{t('feedback.loadFailed')}</p>
      ) : items === null ? null : items.length === 0 ? (
        <EmptyState icon={<Lightbulb size={36} />} title={t('feedback.empty')} description={t('feedback.emptyHint')} />
      ) : (
        <div className="flex flex-col gap-2">
          {open.map((item) => (
            <ReportCard
              key={item.id}
              item={item}
              t={t}
              admin={isAdmin}
              onToggle={isAdmin ? async () => { await setFeedbackResolved(item.id, true); void reload() } : undefined}
              onDelete={isAdmin ? async () => {
                if (!confirm(t('feedback.deleteConfirm'))) return
                await deleteFeedback(item.id)
                void reload()
              } : undefined}
            />
          ))}

          {/* Ticked-off reports fold away rather than vanish: "what did we
              already fix?" is a real question, just not the one this page is
              normally open for. */}
          {done.length > 0 && (
            <>
              <button
                onClick={() => setShowResolved((v) => !v)}
                aria-expanded={showResolved}
                className="flex items-center gap-2 min-h-11 px-4 rounded-xl bg-white/5 hover:bg-white/8 text-sm text-neutral-400 hover:text-white transition-colors"
              >
                <Check size={14} className="text-accent-500 shrink-0" />
                {t('feedback.showResolved', { count: done.length })}
                <span className="ml-auto text-neutral-600" aria-hidden="true">{showResolved ? '−' : '+'}</span>
              </button>
              {showResolved && done.map((item) => (
                <ReportCard
                  key={item.id}
                  item={item}
                  t={t}
                  admin={isAdmin}
                  onToggle={isAdmin ? async () => { await setFeedbackResolved(item.id, false); void reload() } : undefined}
                  onDelete={isAdmin ? async () => {
                    if (!confirm(t('feedback.deleteConfirm'))) return
                    await deleteFeedback(item.id)
                    void reload()
                  } : undefined}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
