import type { Messages } from './index'

/**
 * Svenska. Every key in `en.ts` has to be here — `satisfies Messages` is what
 * makes a forgotten one a build error rather than an English word appearing in
 * the middle of a Swedish screen.
 *
 * Wording follows what Swedish streaming apps actually say rather than what the
 * English reads as literally: an EPG is a *tablå*, not "guidedata"; a TV series
 * is a *serie*, so "TV Shows" is "Serier" and not "TV-program".
 */
export const sv = {
  // ── Navigation ─────────────────────────────────────────────────────────────
  'nav.home': 'Hem',
  'nav.movies': 'Filmer',
  'nav.tvShort': 'Serier',
  'nav.tvShows': 'Serier',
  'nav.liveShort': 'Live',
  'nav.liveTv': 'Live-TV',
  'nav.library': 'Bibliotek',
  'nav.settings': 'Inställningar',
  'nav.feedback': 'Feedback',
  'nav.primary': 'Huvudnavigering',
  'nav.sections': 'Avdelningar',

  // ── Sidebar / layout chrome ────────────────────────────────────────────────
  'sidebar.search': 'Sök…',
  'sidebar.switchProfile': 'Byt profil',
  'sidebar.selectProfile': 'Välj profil',
  'sidebar.privateUse': 'Endast privat bruk',
  'layout.profileSwitch': 'Profil: {name} — byt',
  'layout.chooseProfile': 'Välj profil',

  // ── Shared across screens ──────────────────────────────────────────────────
  'common.loading': 'Laddar…',
  'common.play': 'Spela',
  'common.moreInfo': 'Mer info',
  'common.cancel': 'Avbryt',
  'common.back': 'Tillbaka',
  'common.close': 'Stäng',
  'common.dismiss': 'Stäng',
  'common.seeAll': 'Visa alla',
  'common.saved': 'Sparad',
  'common.remove': 'Ta bort',
  'common.browse': 'Bläddra',
  'common.previous': 'Föregående',
  'common.next': 'Nästa',
  'common.search': 'Sök…',
  'common.watchLater': 'Titta senare',
  'common.addWatchLater': 'Lägg till i Titta senare',
  'common.removeWatchLater': 'Ta bort från Titta senare',
  'common.favorites': 'Favoriter',
  'common.movies': 'Filmer',
  'common.tvShows': 'Serier',
  'common.liveTv': 'Live-TV',
  'common.liveChannels': 'Livekanaler',
  'common.recentlyAdded': 'Nyligen tillagt',
  'common.continueWatching': 'Fortsätt titta',
  'common.surpriseMe': 'Överraska mig',
  'common.openInVlc': 'Öppna i VLC',
  'common.noResults': 'Inga träffar',
  'common.tryAnotherSearch': 'Prova ett annat sökord.',
  'common.resultsFor': 'Träffar för ”{query}”',
  'common.showingOf': 'Visar {shown} av {total}',
  'common.scrollLeft': 'Bläddra åt vänster',
  'common.scrollRight': 'Bläddra åt höger',

  // ── Durations ──────────────────────────────────────────────────────────────
  'time.minutes': '{count} min',
  'time.hours': '{count} tim',
  'time.hoursMinutes': '{hours} tim {minutes} min',

  // ── Detail modal ───────────────────────────────────────────────────────────
  'modal.director': 'Regi:',
  'modal.cast': 'Skådespelare',

  // ── Hero ───────────────────────────────────────────────────────────────────
  'hero.goToSlide': 'Gå till bild {number}',

  // ── Home ───────────────────────────────────────────────────────────────────
  'home.welcomeTitle': 'Välkommen till StreamForest',
  'home.welcomeBody':
    'Börja med att lägga till adressen till din M3U-spellista i Inställningar och hämta dina kanaler.',
  'home.openSettings': 'Öppna inställningar',
  'home.recentMovies': 'Nyligen tillagda filmer',
  'home.recentShows': 'Nyligen tillagda serier',
  'home.becauseYouWatched': 'För att du såg {title}',

  // ── Movies ─────────────────────────────────────────────────────────────────
  'movies.title': 'Filmer',
  'movies.count_one': '{count} titel',
  'movies.count_other': '{count} titlar',
  'movies.searchPlaceholder': 'Sök filmer…',
  'movies.surpriseTitle': 'Överraska mig — slumpa fram en film',
  'movies.emptyTitle': 'Inga filmer än',
  'movies.emptyBody': 'Hämta din spellista i Inställningar för att se filmer här.',
  'movies.sinceYouWatched': 'Sedan du såg {title}',

  // ── Series ─────────────────────────────────────────────────────────────────
  'series.title': 'Serier',
  'series.count_one': '{count} serie',
  'series.count_other': '{count} serier',
  'series.searchPlaceholder': 'Sök serier…',
  'series.surpriseTitle': 'Överraska mig — slumpa fram en serie',
  'series.emptyTitle': 'Inga serier än',
  'series.emptyBody': 'Hämta din spellista i Inställningar för att se serier här.',
  'series.allShows': 'Alla serier',
  'series.season': 'Säsong {number}',
  'series.seasonShort': 'S{number}',
  'series.episodeCount_one': '{count} avsnitt',
  'series.episodeCount_other': '{count} avsnitt',
  'series.seasonsAndEpisodes': '{seasons} säs · {episodes} avs',
  'series.watched': 'Sedd',
  'series.favorite': 'Favorit',
  'series.favorited': 'Favoritmarkerad',
  'series.vlcSeason_one': 'Öppna säsong {season} i VLC ({count} avsnitt)',
  'series.vlcSeason_other': 'Öppna säsong {season} i VLC ({count} avsnitt)',
  'series.noFavorites': 'Inga favoriter än.',

  // ── Live TV ────────────────────────────────────────────────────────────────
  'live.emptyTitle': 'Inga livekanaler än',
  'live.emptyBody': 'Hämta din spellista i Inställningar för att se live-TV här.',
  'live.searchPlaceholder': 'Sök kanaler…',
  'live.count_one': '{count} kanal',
  'live.count_other': '{count} kanaler',
  'live.surpriseTitle': 'Överraska mig — slumpa fram en kanal',
  'live.latestWatched': 'Senast sedda',
  'live.noGuideData': 'Ingen tablå',
  'live.remaining': '{duration} kvar',
  'live.epgError': 'Tablåfel: {error}',
  'live.guideAge': 'Tablån är {hours} tim gammal',
  'live.noGuideLoaded': 'Ingen tablå har hämtats än',
  'live.loadEpg': 'Hämta tablå',
  'live.setEpgUrl': 'Ange tablåadress i Inställningar',

  // ── Library ────────────────────────────────────────────────────────────────
  'library.title': 'Bibliotek',
  'library.tabContinue': 'Fortsätt',
  'library.tabWatchLaterShort': 'Senare',
  'library.tabHistory': 'Historik',
  'library.sortRecent': 'Senaste först',
  'library.sortAz': 'A – Ö',
  'library.emptyContinueTitle': 'Inget pågående',
  'library.emptyContinueBody': 'Börja titta på något så dyker det upp här.',
  'library.emptyWatchLaterTitle': 'Inget sparat än',
  'library.emptyWatchLaterBody': 'Spara filmer och serier så hittar du dem här.',
  'library.emptyHistoryTitle': 'Ingen historik än',
  'library.emptyHistoryBody': 'Det du har sett dyker upp här.',
  'library.emptyFavoritesTitle': 'Inga favoriter än',
  'library.emptyFavoritesBody': 'Favoritmarkera titlar för att bygga din lista.',

  // ── Cards ──────────────────────────────────────────────────────────────────
  'card.watched': 'Sett {time}',
  'card.removeContinue': 'Ta bort från Fortsätt titta',

  // ── Command palette ────────────────────────────────────────────────────────
  'search.placeholder': 'Sök filmer, serier, kanaler…',
  'search.recent': 'Senaste',
  'search.acrossLibrary': 'Sök i hela biblioteket',
  'search.noResultsFor': 'Inga träffar för ”{query}”',
  'search.navigate': 'flytta',
  'search.open': 'öppna',
  'search.close': 'stäng',
  'search.kindMovie': 'Film',
  'search.kindShow': 'Serie',

  // ── Profile picker ─────────────────────────────────────────────────────────
  'profile.whosWatching': 'Vem tittar?',

  // ── Install prompt ─────────────────────────────────────────────────────────
  'install.title': 'Installera StreamForest',
  'install.addToHome': 'Lägg till på hemskärmen',
  'install.tap': 'Tryck på',
  'install.then': 'och sedan',
  'install.addToHomeScreen': 'Lägg till på hemskärmen',
  'install.action': 'Installera',
  'install.share': 'Dela',
  'install.dismiss': 'Stäng',

  // ── Player ─────────────────────────────────────────────────────────────────
  'player.playbackError': 'Uppspelningsfel',
  'player.tapToPlay': 'Tryck för att spela',
  'player.buffering': 'Buffrar…',
  'player.nextEpisodeIn': 'Nästa avsnitt om {seconds} s',
  'player.playNow': 'Spela nu',
  'player.minimize': 'Minimera',
  'player.seek': 'Spola',
  'player.volume': 'Volym',
  'player.audio': 'Ljud',
  'player.subtitles': 'Undertexter',
  'player.subtitlesOff': 'Av',
  'player.sync': 'Synk',
  'player.track': 'Spår {number}',
  'player.pip': 'Bild i bild',
  'player.errLostConnection': 'Tappade anslutningen till strömmen.',
  'player.errCannotDecode': 'Den här titeln kan inte avkodas på den här enheten.',
  'player.errNoPlayableStream': 'Leverantören gav ingen spelbar ström.',
  'player.errUnexpected': 'Uppspelningen avbröts oväntat.',
  'player.errLiveNeedsProxy':
    'Live-TV kräver transkodningsservern. Ange VITE_TRANSCODE_PROXY_URL.',
  'player.errSavedPosition': 'Sparad position är otillgänglig — startar om från början…',
  'player.errHlsUnsupported': 'HLS stöds inte i den här webbläsaren',
  'player.errStreamRetry': 'Strömfel — försöker igen från början…',
  'player.errReconnecting': 'Anslutningen bröts — återansluter ({retry})…',
  'player.errLiveReconnect': 'Kunde inte återansluta till livekanalen',
  'player.errHlsGeneration': 'iOS: HLS kunde inte genereras: {detail}',
  'player.errHlsStream': 'iOS: Strömmen misslyckades. Försök igen senare. ({detail})',
  'player.errAudioSwitch': 'iOS: Byte av ljudspår misslyckades: {detail}',
  'player.errUnknown': 'okänt',
  'player.errNetwork': 'nätverksfel',
  'player.errSubtitleNoBody': 'Undertextsvaret saknade innehåll',
  'player.errSubtitleNoCues': 'Undertextströmmen innehöll inga läsbara rader',
  'player.errSubtitleStalled':
    'Undertextutvinningen har stannat — ingen data från servern på 5 minuter',
  'player.errSubtitleFailed': 'Undertexten kunde inte laddas',

  // ── Playlist / EPG stores ──────────────────────────────────────────────────
  'playlist.errNoUrl': 'Ingen M3U-adress är angiven. Gå till Inställningar.',
  'epg.errNoUrl': 'Ingen tablåadress — ange den i Inställningar → TV-tablå.',
  'epg.connecting': 'Ansluter…',
  'epg.parsed': 'Tolkade {count} program…',
  'epg.saving': 'Sparar…',
  'epg.errFetch': 'Tablån kunde inte hämtas',
  'epg.errStatus': 'Tablån kunde inte hämtas, status {status}',
  'epg.errNoBody': 'Tablåsvaret saknade innehåll',
  'playlist.errWorker': 'Spellisteläsaren kunde inte startas',
  'playlist.errNetwork': 'Nätverksfel — kontrollera anslutningen eller M3U-adressen',
  'playlist.errStatus': 'Servern svarade {status}',

  // ── Feedback ───────────────────────────────────────────────────────────────
  'feedback.title': 'Feedback',
  'feedback.hint':
    'Skriv ner det i samma stund du märker det — ett fel eller en önskan. Det hamnar i samma inkorg.',
  'feedback.reportBug': 'Rapportera ett fel',
  'feedback.reportBugPlaceholder':
    'Vad hände, och vad gjorde du precis innan? En film som inte startar, en knapp som inte gör något…',
  'feedback.suggestIdea': 'Föreslå något',
  'feedback.suggestIdeaPlaceholder':
    'Vad skulle göra appen bättre? Allt från en liten irritation till en helt ny vy.',
  'feedback.send': 'Skicka',
  'feedback.sent': 'Tack — det kom fram.',
  'feedback.error': 'Det gick inte att skicka. Försök igen.',
  'feedback.deviceAttached': 'Bifogas:',
  'device.homeScreen': 'hemskärm',
  'device.browser': 'webbläsare',
  'device.unknown': 'okänd enhet',
  'feedback.deviceWhy': 'så att ett fel inte kräver en följdfråga om vilken telefon det gällde.',
  'feedback.yours': 'Dina rapporter',
  'feedback.showResolved_one': 'Visa {count} klarmarkerad',
  'feedback.showResolved_other': 'Visa {count} klarmarkerade',
  'feedback.resolved': 'Klar',
  'feedback.kindBug': 'Fel',
  'feedback.kindIdea': 'Idé',
  'feedback.inbox': 'Från hushållet',
  'feedback.inboxHint': 'Allt som alla har skickat, senaste först.',
  'feedback.empty': 'Inget här än',
  'feedback.emptyHint': 'Rapporter som skrivs i appen dyker upp här.',
  'feedback.markResolved': 'Klarmarkera',
  'feedback.reopen': 'Öppna igen',
  'feedback.deleteConfirm': 'Ta bort rapporten helt?',
  'feedback.noProfile': 'Välj en profil innan du skriver.',
  'feedback.loadFailed': 'Rapporterna kunde inte hämtas.',
  'feedback.settingsLink': 'Öppna inkorgen',
  'feedback.settingsBody': 'Fel och idéer som skrivits inifrån appen.',

  // ── Settings ───────────────────────────────────────────────────────────────
  'settings.title': 'Inställningar',
  'settings.restricted': 'Inställningar är bara till för föräldrar och administratörer.',

  'settings.language': 'Språk',
  'settings.languageBody': 'Språket i appen på den här enheten.',
  'settings.languageHint':
    'Väljs per enhet, inte per profil — och styr även vilket språk beskrivningar och genrer hämtas på.',

  'settings.playlistSource': 'Spellistkälla',
  'settings.m3uUrl': 'M3U-adress',
  'settings.m3uPrivate': 'Håll adressen privat — den innehåller dina inloggningsuppgifter.',
  'settings.saveUrl': 'Spara adress',
  'settings.saveFailed': 'Adressen kunde inte sparas',

  'settings.cachedPlaylist': 'Sparad spellista',
  'settings.statTotal': 'Totalt',
  'settings.statMovies': 'Filmer',
  'settings.statEpisodes': 'Serieavsnitt',
  'settings.statLive': 'Livekanaler',
  'settings.lastUpdated': 'Senast uppdaterad',
  'settings.source': 'Källa',
  'settings.noPlaylist': 'Ingen spellista är sparad än.',
  'settings.downloading': 'Hämtar',
  'settings.savingToDevice': 'Sparar på enheten',
  'settings.progressDone': '✓ Klar',
  'settings.saving': 'Sparar…',
  'settings.downloadingEllipsis': 'Hämtar…',
  'settings.reDownload': 'Hämta igen',
  'settings.downloadNow': 'Hämta nu',
  'settings.clearCache': 'Rensa cache',
  'settings.clearConfirm': 'Rensa all sparad spellistdata? Du måste hämta den igen.',

  'settings.tvGuide': 'TV-tablå (EPG)',
  'settings.epgUrl': 'Tablåadress (XMLTV)',
  'settings.epgHint': 'Ange din leverantörs XMLTV-adress ovan.',
  'settings.epgLastLoaded': 'Senast hämtad: {when}',
  'settings.epgNone': 'Ingen tablå har hämtats än.',
  'settings.epgRefresh': 'Uppdatera tablån',
  'settings.epgLoad': 'Hämta tablån',

  'settings.metadata': 'Metadata (TMDB)',
  'settings.tmdbBody': 'Omslag och metadata sparas lokalt från TMDB.',
  'settings.tmdbHint':
    'Misslyckade sökningar hoppas över i 24 timmar. Använd knappen för att försöka igen direkt.',
  'settings.tmdbRetry': 'Försök igen',
  'settings.tmdbCleared': 'Rensade {count}',

  'settings.playback': 'Uppspelning',
  'settings.profile': 'Profil',
  'settings.autoplayNext': 'Spela nästa avsnitt automatiskt',
  'settings.autoplayNextHint': 'Startar nästa avsnitt automatiskt när ett tar slut',
  'settings.defaultAudio': 'Standardspråk för ljud',
  'settings.defaultAudioHint': 'Väljer det här ljudspåret automatiskt vid uppspelning',
  'settings.defaultSubtitle': 'Standardspråk för undertext',
  'settings.defaultSubtitleHint': 'Väljer den här undertexten automatiskt vid uppspelning',
  'settings.trackOff': 'Av — välj manuellt',

  'settings.hiddenGroups': 'Dolda grupper',
  'settings.hiddenGroupsHint':
    'Grupper du döljer syns ingenstans i appen — varken i listor, i sökningen eller på startsidan.',
  'settings.parentalControls': 'Föräldrakontroll',
  'settings.parentalHint':
    'Dolda grupper läggs ovanpå dina globala inställningar för varje barnprofil.',
  'settings.hiddenCount': '{count} dolda',
  'settings.groupCount_one': '{count} grupp',
  'settings.groupCount_other': '{count} grupper',
  'settings.filterGroups': 'Filtrera grupper…',
  'settings.hideAll': 'Dölj alla',
  'settings.showAll': 'Visa alla',
  'settings.noGroups': 'Inga grupper hittades',

  // ── Track languages (the audio/subtitle selects) ───────────────────────────
  'trackLang.sv': 'Svenska (sv)',
  'trackLang.en': 'Engelska (en)',
  'trackLang.no': 'Norska (no)',
  'trackLang.da': 'Danska (da)',
  'trackLang.fi': 'Finska (fi)',
  'trackLang.de': 'Tyska (de)',
  'trackLang.fr': 'Franska (fr)',
  'trackLang.es': 'Spanska (es)',
  'trackLang.ar': 'Arabiska (ar)',

  // ── Settings → VLC ─────────────────────────────────────────────────────────
  'vlc.intro':
    'VLC-knapparna lämnar över uppspelningen till VLC — en hel säsong från seriens rubrik, ett enskilt avsnitt från dess rad.',
  'vlc.mobileHint':
    'Inget att ställa in på den här enheten: VLC-appen registrerar sitt eget länkschema. Den behöver bara vara installerad.',
  'vlc.worksHint': 'Den här datorn öppnar VLC direkt — inget att ställa in här.',
  'vlc.downloadHint':
    'På den här datorn laddar knappen ner spellistan och VLC öppnar den. Två klick, om du inte gör det andra automatiskt:',
  'vlc.autoOpenTitle': 'Låt {browser} öppna den åt dig',
  'vlc.autoOpenFooter':
    'En gång, sedan går varje VLC-knapp rakt in i VLC. Ingen installation, ingen terminal.',
  'vlc.browserFallback': 'webbläsaren',
  'vlc.stepsEdge':
    'Öppna nedladdningsfliken, håll muspekaren över .m3u-filen och välj ⋯ → ”Öppna alltid filer av den här typen”.',
  'vlc.stepsFirefox':
    'Inställningar → Allmänt → Filer och program → leta upp ”M3U” och ställ in den på ”Använd VLC”.',
  'vlc.stepsChrome':
    'Efter första nedladdningen: klicka på ⌄ bredvid .m3u-filen i nedladdningsbubblan → ”Öppna alltid filer av den här typen”.',
  'vlc.stepsSafari':
    'Safari → Inställningar → Allmänt → kryssa i ”Öppna ”säkra” filer efter hämtning”.',
  'vlc.stepsFallback': 'Leta efter ”öppna alltid filer av den här typen” i nedladdningsmenyn.',
  'vlc.testOk': 'VLC svarade — den här datorn öppnar VLC direkt.',
  'vlc.testMissing': 'VLC öppnades inte. Nedladdningsvägen ovan är den som gäller.',
  'vlc.testWaiting': 'Väntar på VLC…',
  'vlc.knownInstalled': 'Senast kontrollerat: VLC öppnas direkt.',
  'vlc.knownMissing': 'Senast kontrollerat: ingen hanterare, så knapparna laddar ner spellistan.',
  'vlc.knownUnknown': 'Aldrig kontrollerat på den här datorn.',
  'vlc.testNote': 'Öppnar VLC med en tom testspellista — den spelar ingenting.',
  'vlc.test': 'Testa',
  'vlc.installerToggle': 'Hoppa över nedladdningen helt (ett inklistrat kommando)',
  'vlc.installerBody':
    'Registrerar en {scheme}-hanterare på den här datorn, så att knapparna öppnar VLC utan att något laddas ner alls. En webbsida får inte göra det åt dig — på något av operativsystemen.',
  'vlc.thisOne': ' · den här',
  'vlc.pasteInto': 'Klistra in i {terminal}. En gång per dator.',
  'vlc.terminalMac': 'Terminal (⌘-mellanslag → ”Terminal”)',
  'vlc.terminalWindows': 'PowerShell (Win+X → ”Terminal”)',
  'vlc.copy': 'Kopiera',
  'vlc.copied': 'Kopierat',
  'vlc.undo': 'Ångra: {command}',
} satisfies Messages
