import { useT } from '@/lib/i18n'

export interface Genre { id: number; name: string }

/**
 * A row of genres to filter by. Choosing the selected one again clears it. The
 * list comes from TMDB in the app's language; it is empty (and the row hidden)
 * when TMDB cannot be reached. 44 px tall like every other control a thumb uses;
 * the first version was 36 and failed the touch audit on phone and iPad.
 */
export function GenreChips({ genres, selected, onSelect }: {
  genres: Genre[]
  selected: Genre | null
  onSelect: (genre: Genre | null) => void
}) {
  const t = useT()
  if (genres.length === 0) return null
  return (
    <div role="group" aria-label={t('genre.label')} className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
      {genres.map((g) => {
        const on = selected?.id === g.id
        return (
          <button
            key={g.id}
            onClick={() => onSelect(on ? null : g)}
            aria-pressed={on}
            className={`shrink-0 min-h-11 px-3.5 py-2 rounded-full text-caption font-medium ring-1 transition-colors ${
              on
                ? 'bg-accent-600/25 ring-accent-500/50 text-accent-300'
                : 'bg-white/5 ring-white/10 text-neutral-400 hover:text-white hover:bg-white/10'
            }`}
          >
            {g.name}
          </button>
        )
      })}
    </div>
  )
}
