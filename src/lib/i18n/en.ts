/**
 * The English catalog, and the shape every other catalog is checked against.
 *
 * Flat dotted keys on purpose: a nested object reads better in this file and
 * worse everywhere else, because `t('movies.emptyTitle')` is greppable and
 * `t(m => m.movies.emptyTitle)` is not. The prefix before the first dot is the
 * screen or component the string belongs to; `common` is for the strings that
 * genuinely appear on several of them.
 *
 * Counted strings come in `_one` / `_other` pairs and are called without the
 * suffix — `t('movies.count', { count })` picks the form. Both languages here
 * have exactly two, so the rule is `count === 1`; a language with more would
 * need `Intl.PluralRules` in `index.ts` rather than more keys here.
 *
 * `{name}` placeholders are filled from the second argument. `{count}` is
 * formatted for the locale on the way in, which is the whole reason a template
 * literal is not good enough for these.
 */
export const en = {
  // ── Navigation ─────────────────────────────────────────────────────────────
  'nav.home': 'Home',
  'nav.movies': 'Movies',
  'nav.tvShort': 'TV',
  'nav.tvShows': 'TV Shows',
  'nav.liveShort': 'Live',
  'nav.liveTv': 'Live TV',
  'nav.library': 'Library',
  'nav.settings': 'Settings',
  'nav.feedback': 'Feedback',
  'nav.primary': 'Primary',
  'nav.sections': 'Sections',

  // ── Sidebar / layout chrome ────────────────────────────────────────────────
  'sidebar.search': 'Search…',
  'sidebar.switchProfile': 'Switch profile',
  'sidebar.selectProfile': 'Select profile',
  'sidebar.privateUse': 'Private use only',
  'layout.profileSwitch': 'Profile: {name} — switch',
  'layout.chooseProfile': 'Choose profile',

  // ── Shared across screens ──────────────────────────────────────────────────
  'common.loading': 'Loading…',
  'common.play': 'Play',
  'common.moreInfo': 'More Info',
  'common.cancel': 'Cancel',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.dismiss': 'Dismiss',
  'common.seeAll': 'See all',
  'common.saved': 'Saved',
  'common.remove': 'Remove',
  'common.browse': 'Browse',
  'common.previous': 'Previous',
  'common.next': 'Next',
  'common.search': 'Search…',
  'common.watchLater': 'Watch Later',
  'common.addWatchLater': 'Add to Watch Later',
  'common.removeWatchLater': 'Remove from Watch Later',
  'common.favorites': 'Favorites',
  'common.movies': 'Movies',
  'common.tvShows': 'TV Shows',
  'common.liveTv': 'Live TV',
  'common.liveChannels': 'Live Channels',
  'common.recentlyAdded': 'Recently Added',
  'common.continueWatching': 'Continue Watching',
  'common.surpriseMe': 'Surprise me',
  'common.openInVlc': 'Open in VLC',
  'common.noResults': 'No results',
  'common.tryAnotherSearch': 'Try a different search term.',
  'common.resultsFor': 'Results for "{query}"',
  'common.showingOf': 'Showing {shown} of {total}',
  'common.scrollLeft': 'Scroll left',
  'common.scrollRight': 'Scroll right',

  // ── Durations ──────────────────────────────────────────────────────────────
  'time.minutes': '{count}m',
  'time.hours': '{count}h',
  'time.hoursMinutes': '{hours}h {minutes}m',

  // ── Detail modal ───────────────────────────────────────────────────────────
  'modal.director': 'Director:',
  'modal.cast': 'Cast',

  // ── Hero ───────────────────────────────────────────────────────────────────
  'hero.goToSlide': 'Go to slide {number}',

  // ── Home ───────────────────────────────────────────────────────────────────
  'home.welcomeTitle': 'Welcome to StreamForest',
  'home.welcomeBody':
    'To get started, add your M3U playlist URL in Settings and download your channels.',
  'home.openSettings': 'Open Settings',
  'home.recentMovies': 'Recently Added Movies',
  'home.recentShows': 'Recently Added TV Shows',
  'home.becauseYouWatched': 'Because you watched {title}',

  // ── Movies ─────────────────────────────────────────────────────────────────
  'movies.title': 'Movies',
  'movies.count_one': '{count} title',
  'movies.count_other': '{count} titles',
  'movies.searchPlaceholder': 'Search movies…',
  'movies.surpriseTitle': 'Surprise me — pick a random movie',
  'movies.emptyTitle': 'No movies yet',
  'movies.emptyBody': 'Download your playlist in Settings to see movies here.',
  'movies.sinceYouWatched': 'Since you watched {title}',

  // ── Series ─────────────────────────────────────────────────────────────────
  'series.title': 'TV Shows',
  'series.count_one': '{count} show',
  'series.count_other': '{count} shows',
  'series.searchPlaceholder': 'Search shows…',
  'series.surpriseTitle': 'Surprise me — pick a random show',
  'series.emptyTitle': 'No TV shows yet',
  'series.emptyBody': 'Download your playlist in Settings to see shows here.',
  'series.allShows': 'All shows',
  'series.season': 'Season {number}',
  'series.seasonShort': 'S{number}',
  'series.episodeCount_one': '{count} episode',
  'series.episodeCount_other': '{count} episodes',
  'series.seasonsAndEpisodes': '{seasons}S · {episodes} ep',
  'series.watched': 'Watched',
  'series.favorite': 'Favorite',
  'series.favorited': 'Favorited',
  'series.vlcSeason_one': 'Open season {season} in VLC ({count} episode)',
  'series.vlcSeason_other': 'Open season {season} in VLC ({count} episodes)',
  'series.noFavorites': 'No favorites yet.',

  // ── Live TV ────────────────────────────────────────────────────────────────
  'live.emptyTitle': 'No live channels yet',
  'live.emptyBody': 'Download your playlist in Settings to see live TV here.',
  'live.searchPlaceholder': 'Search channels…',
  'live.count_one': '{count} channel',
  'live.count_other': '{count} channels',
  'live.surpriseTitle': 'Surprise me — pick a random channel',
  'live.latestWatched': 'Latest watched',
  'live.noGuideData': 'No guide data',
  'live.remaining': '{duration} left',
  'live.epgError': 'EPG error: {error}',
  'live.guideAge': 'Guide data is {hours}h old',
  'live.noGuideLoaded': 'No guide data loaded yet',
  'live.loadEpg': 'Load EPG',
  'live.setEpgUrl': 'Set EPG URL in Settings',

  // ── Library ────────────────────────────────────────────────────────────────
  'library.title': 'Library',
  'library.tabContinue': 'Continue',
  'library.tabWatchLaterShort': 'Later',
  'library.tabHistory': 'History',
  'library.sortRecent': 'Recent first',
  'library.sortAz': 'A – Z',
  'library.emptyContinueTitle': 'Nothing in progress',
  'library.emptyContinueBody': 'Start watching something and it will appear here.',
  'library.emptyWatchLaterTitle': 'Nothing saved yet',
  'library.emptyWatchLaterBody': 'Bookmark movies and TV shows to find them here.',
  'library.emptyHistoryTitle': 'No history yet',
  'library.emptyHistoryBody': 'Your watched titles will show up here.',
  'library.emptyFavoritesTitle': 'No favorites yet',
  'library.emptyFavoritesBody': 'Mark titles as favorites to build your list.',

  // ── Cards ──────────────────────────────────────────────────────────────────
  'card.watched': '{time} watched',
  'card.removeContinue': 'Remove from Continue Watching',

  // ── Command palette ────────────────────────────────────────────────────────
  'search.placeholder': 'Search movies, shows, channels…',
  'search.recent': 'Recent',
  'search.acrossLibrary': 'Search across your library',
  'search.noResultsFor': 'No results for "{query}"',
  'search.navigate': 'navigate',
  'search.open': 'open',
  'search.close': 'close',
  'search.kindMovie': 'Movie',
  'search.kindShow': 'TV Show',

  // ── Profile picker ─────────────────────────────────────────────────────────
  'profile.whosWatching': "Who's watching?",

  // ── Install prompt ─────────────────────────────────────────────────────────
  'install.title': 'Install StreamForest',
  'install.addToHome': 'Add to your home screen',
  'install.tap': 'Tap',
  'install.then': 'then',
  'install.addToHomeScreen': 'Add to Home Screen',
  'install.action': 'Install',
  'install.share': 'Share',
  'install.dismiss': 'Dismiss',

  // ── Player ─────────────────────────────────────────────────────────────────
  'player.playbackError': 'Playback Error',
  'player.tapToPlay': 'Tap to play',
  'player.buffering': 'Buffering…',
  'player.nextEpisodeIn': 'Next episode in {seconds}s',
  'player.playNow': 'Play now',
  'player.minimize': 'Minimize',
  'player.seek': 'Seek',
  'player.volume': 'Volume',
  'player.audio': 'Audio',
  'player.subtitles': 'Subtitles',
  'player.subtitlesOff': 'Off',
  'player.sync': 'Sync',
  'player.track': 'Track {number}',
  'player.pip': 'Picture in Picture',
  'player.errLostConnection': 'Lost connection to the stream.',
  'player.errCannotDecode': "This title can't be decoded on this device.",
  'player.errNoPlayableStream': "The provider didn't return a playable stream.",
  'player.errUnexpected': 'Playback stopped unexpectedly.',
  'player.errLiveNeedsProxy': 'Live TV requires the transcode proxy. Set VITE_TRANSCODE_PROXY_URL.',
  'player.errSavedPosition': 'Saved position unavailable — loading from start…',
  'player.errHlsUnsupported': 'HLS not supported in this browser',
  'player.errStreamRetry': 'Stream error — retrying from start…',
  'player.errReconnecting': 'Connection lost — reconnecting ({retry})…',
  'player.errLiveReconnect': 'Live stream reconnect failed',
  'player.errHlsGeneration': 'iOS: HLS generation failed: {detail}',
  'player.errHlsStream': 'iOS: Stream failed. Try again later. ({detail})',
  'player.errAudioSwitch': 'iOS: Audio switch failed: {detail}',
  'player.errUnknown': 'unknown',
  'player.errNetwork': 'network error',
  'player.errSubtitleNoBody': 'Subtitle response had no body',
  'player.errSubtitleNoCues': 'Subtitle stream had no readable cues',
  'player.errSubtitleStalled': 'Subtitle extraction stalled — no data from proxy in 5 min',
  'player.errSubtitleFailed': 'Subtitle load failed',

  // ── Playlist / EPG stores ──────────────────────────────────────────────────
  'playlist.errNoUrl': 'No M3U URL configured. Go to Settings.',
  'epg.errNoUrl': 'No EPG URL — enter it in Settings → TV Guide.',
  'epg.connecting': 'Connecting…',
  'epg.parsed': 'Parsed {count} programs…',
  'epg.saving': 'Saving…',
  'epg.errFetch': 'EPG fetch failed',
  'epg.errStatus': 'EPG fetch failed with status {status}',
  'epg.errNoBody': 'EPG response had no body',
  'playlist.errWorker': 'Playlist worker failed to start',
  'playlist.errNetwork': 'Network error — check your connection or M3U URL',
  'playlist.errStatus': 'Server returned {status}',

  // ── Feedback ───────────────────────────────────────────────────────────────
  'feedback.title': 'Feedback',
  'feedback.hint':
    'Write it down the moment you notice it — a fault or a wish. It lands in the same inbox.',
  'feedback.reportBug': 'Report a fault',
  'feedback.reportBugPlaceholder':
    'What happened, and what were you doing just before? A film that will not start, a button that does nothing…',
  'feedback.suggestIdea': 'Suggest something',
  'feedback.suggestIdeaPlaceholder':
    'What would make this better? Anything from a small annoyance to a whole new screen.',
  'feedback.send': 'Send',
  'feedback.sent': 'Thanks — it landed.',
  'feedback.error': 'It could not be sent. Try again.',
  'feedback.deviceAttached': 'Attached:',
  'device.homeScreen': 'home screen',
  'device.browser': 'browser',
  'device.unknown': 'unknown device',
  'feedback.deviceWhy': 'so a fault does not need a follow-up question about which phone.',
  'feedback.yours': 'Your reports',
  'feedback.showResolved_one': 'Show {count} resolved',
  'feedback.showResolved_other': 'Show {count} resolved',
  'feedback.resolved': 'Resolved',
  'feedback.kindBug': 'Fault',
  'feedback.kindIdea': 'Idea',
  'feedback.inbox': 'From the household',
  'feedback.inboxHint': 'Everything everyone has sent, newest first.',
  'feedback.empty': 'Nothing here yet',
  'feedback.emptyHint': 'Reports written from the app show up here.',
  'feedback.markResolved': 'Mark resolved',
  'feedback.reopen': 'Reopen',
  'feedback.deleteConfirm': 'Delete this report for good?',
  'feedback.noProfile': 'Choose a profile before writing.',
  'feedback.loadFailed': 'The reports could not be loaded.',
  'feedback.settingsLink': 'Open the inbox',
  'feedback.settingsBody': 'Faults and ideas written from inside the app.',

  // ── Settings ───────────────────────────────────────────────────────────────
  'settings.title': 'Settings',
  'settings.restricted': 'Settings are restricted to parents and administrators.',

  'settings.language': 'Language',
  'settings.languageBody': 'The language of this app on this device.',
  'settings.languageHint':
    'Chosen per device, not per profile — and it also decides which language descriptions and genres are fetched in.',

  'settings.playlistSource': 'Playlist Source',
  'settings.m3uUrl': 'M3U URL',
  'settings.m3uPrivate': 'Keep this URL private — it contains your credentials.',
  'settings.saveUrl': 'Save URL',
  'settings.saveFailed': 'Could not save the URL',

  'settings.cachedPlaylist': 'Cached Playlist',
  'settings.statTotal': 'Total',
  'settings.statMovies': 'Movies',
  'settings.statEpisodes': 'TV Episodes',
  'settings.statLive': 'Live Channels',
  'settings.lastUpdated': 'Last updated',
  'settings.source': 'Source',
  'settings.noPlaylist': 'No playlist cached yet.',
  'settings.downloading': 'Downloading',
  'settings.savingToDevice': 'Saving to device',
  'settings.progressDone': '✓ Done',
  'settings.saving': 'Saving…',
  'settings.downloadingEllipsis': 'Downloading…',
  'settings.reDownload': 'Re-download',
  'settings.downloadNow': 'Download now',
  'settings.clearCache': 'Clear cache',
  'settings.clearConfirm': "Clear all cached playlist data? You'll need to re-download it.",

  'settings.tvGuide': 'TV Guide (EPG)',
  'settings.epgUrl': 'EPG URL (XMLTV)',
  'settings.epgHint': "Enter your provider's XMLTV URL above.",
  'settings.epgLastLoaded': 'Last loaded: {when}',
  'settings.epgNone': 'No guide data loaded yet.',
  'settings.epgRefresh': 'Refresh Guide',
  'settings.epgLoad': 'Load Guide Data',

  'settings.metadata': 'Metadata (TMDB)',
  'settings.tmdbBody': 'Posters and metadata are cached locally from TMDB.',
  'settings.tmdbHint':
    'Failed lookups are skipped for 24 hours. Use this to retry them immediately.',
  'settings.tmdbRetry': 'Retry failed',
  'settings.tmdbCleared': 'Cleared {count}',

  'settings.playback': 'Playback',
  'settings.profile': 'Profile',
  'settings.autoplayNext': 'Autoplay next episode',
  'settings.autoplayNextHint': 'Automatically plays the next episode when one ends',
  'settings.defaultAudio': 'Default audio language',
  'settings.defaultAudioHint': 'Auto-selects this audio track on playback',
  'settings.defaultSubtitle': 'Default subtitle language',
  'settings.defaultSubtitleHint': 'Auto-selects this subtitle track on playback',
  'settings.trackOff': 'Off — manual selection',

  'settings.hiddenGroups': 'Hidden Groups',
  'settings.hiddenGroupsHint':
    "Groups you hide won't appear anywhere in the app — not in lists, search, or the home screen.",
  'settings.parentalControls': 'Parental Controls',
  'settings.parentalHint':
    "Hidden groups apply on top of your global settings for each kid's profile.",
  'settings.hiddenCount': '{count} hidden',
  'settings.groupCount_one': '{count} group',
  'settings.groupCount_other': '{count} groups',
  'settings.filterGroups': 'Filter groups…',
  'settings.hideAll': 'Hide all',
  'settings.showAll': 'Show all',
  'settings.noGroups': 'No groups found',

  // ── Track languages (the audio/subtitle selects) ───────────────────────────
  'trackLang.sv': 'Swedish (sv)',
  'trackLang.en': 'English (en)',
  'trackLang.no': 'Norwegian (no)',
  'trackLang.da': 'Danish (da)',
  'trackLang.fi': 'Finnish (fi)',
  'trackLang.de': 'German (de)',
  'trackLang.fr': 'French (fr)',
  'trackLang.es': 'Spanish (es)',
  'trackLang.ar': 'Arabic (ar)',

  // ── Settings → VLC ─────────────────────────────────────────────────────────
  'vlc.intro':
    "The VLC buttons hand playback to VLC — a season from a show's header, a single episode from its row.",
  'vlc.mobileHint':
    'Nothing to set up on this device: the VLC app registers its own link scheme. Just have it installed.',
  'vlc.worksHint': 'This computer opens VLC directly — nothing to set up here.',
  'vlc.downloadHint':
    'On this computer the button downloads the playlist and VLC opens it. Two clicks, unless you make the second one automatic:',
  'vlc.autoOpenTitle': 'Let {browser} open it for you',
  'vlc.autoOpenFooter':
    'Once, and every VLC button after that goes straight into VLC. No install, no terminal.',
  'vlc.browserFallback': 'your browser',
  'vlc.stepsEdge':
    'Open the downloads flyout, hover the .m3u, then ⋯ → "Always open files of this type".',
  'vlc.stepsFirefox':
    'Settings → General → Files and Applications → find "M3U" and set it to "Use VLC".',
  'vlc.stepsChrome':
    'After the first download, click the ⌄ next to the .m3u in the downloads bubble → "Always open files of this type".',
  'vlc.stepsSafari': 'Safari → Settings → General → tick "Open “safe” files after downloading".',
  'vlc.stepsFallback': 'Look for "always open files of this type" in its downloads menu.',
  'vlc.testOk': 'VLC answered — this computer opens VLC directly.',
  'vlc.testMissing': 'VLC did not open. The downloads route above is the one to use.',
  'vlc.testWaiting': 'Waiting for VLC…',
  'vlc.knownInstalled': 'Last checked: VLC opens directly.',
  'vlc.knownMissing': 'Last checked: no handler, so buttons download the playlist.',
  'vlc.knownUnknown': 'Never checked on this computer.',
  'vlc.testNote': 'Opens VLC on an empty test playlist — it plays nothing.',
  'vlc.test': 'Test',
  'vlc.installerToggle': 'Skip the download entirely (one pasted command)',
  'vlc.installerBody':
    'Registers a {scheme} handler on this computer, so the buttons open VLC with nothing downloaded at all. A web page is not allowed to do this for you — on either OS.',
  'vlc.thisOne': ' · this one',
  'vlc.pasteInto': 'Paste into {terminal}. Once per computer.',
  'vlc.terminalMac': 'Terminal (⌘-space → "Terminal")',
  'vlc.terminalWindows': 'PowerShell (Win+X → "Terminal")',
  'vlc.copy': 'Copy',
  'vlc.copied': 'Copied',
  'vlc.undo': 'Undo: {command}',
} as const
