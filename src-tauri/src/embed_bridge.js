// Lets the application switch a video's audio track, which the embed does not allow from outside.
//
// The embedded player registers `getAvailableAudioTracks`, `getAudioTrack` and `setAudioTrack` as
// internal methods only. Calls arriving through the IFrame API are checked against its public list
// and these are not on it, so from the page every switch was silently refused. The internal
// methods are, however, attached to the player element inside the embed's own document — which is
// where this runs.
//
// It is injected into every frame (WebView2 adds initialization scripts to child frames as well as
// the page) and does nothing anywhere except YouTube's embed, and there only when that embed's
// parent is this application. It answers two messages from that parent and no one else: `list`,
// which reports the tracks and the one playing, and `set`, which switches.

(() => {
  'use strict';

  const EMBED_HOSTS = ['www.youtube-nocookie.com', 'www.youtube.com'];
  if (!EMBED_HOSTS.includes(location.hostname) || !location.pathname.startsWith('/embed/')) return;

  // The shell's own origins: the installed application, and the development server.
  const APP_ORIGINS = [
    'http://tauri.localhost',
    'https://tauri.localhost',
    'http://localhost:1420',
  ];
  const parentOrigin = location.ancestorOrigins && location.ancestorOrigins[0];
  if (window.parent === window || !APP_ORIGINS.includes(parentOrigin)) return;

  /** How long a requested track waits for the list to load before the request lapses. */
  const PATIENCE_MS = 10_000;
  const RETRY_MS = 250;

  const player = () => document.getElementById('movie_player');
  const base = (value) =>
    String(value)
      .toLowerCase()
      .split(/[.\-_]/)[0];

  /** `{ id, name, isDefault }` for one of the player's tracks, or `null` for the placeholder. */
  const describe = (track) => {
    try {
      const info = track.getLanguageInfo();
      const id = String(typeof info.getId === 'function' ? info.getId() : info.id);
      // Before the media loads the player reports a single placeholder, `und`, named "Default".
      if (!id || id === 'und') return null;
      return { id, name: String(info.name || ''), isDefault: Boolean(info.isDefault) };
    } catch {
      return null;
    }
  };

  const available = () => {
    try {
      const element = player();
      return (
        (element && element.getAvailableAudioTracks && element.getAvailableAudioTracks()) || []
      );
    } catch {
      return [];
    }
  };

  const report = () => {
    let current = null;
    try {
      const element = player();
      current = element && element.getAudioTrack ? describe(element.getAudioTrack()) : null;
    } catch {
      current = null;
    }
    window.parent.postMessage(
      {
        beastube: 'audio',
        tracks: available().map(describe).filter(Boolean),
        current: current ? current.id : null,
      },
      parentOrigin,
    );
  };

  /** The track asked for most recently, until it has been applied or has waited too long. */
  let wanted = null;
  let timer = 0;

  const applyWhenListed = () => {
    clearTimeout(timer);
    if (wanted === null) return;
    const tracks = available();
    if (tracks.length === 0) {
      // The list only exists once the media has loaded; a choice made before that waits for it.
      if (Date.now() - wanted.at < PATIENCE_MS) timer = setTimeout(applyWhenListed, RETRY_MS);
      else wanted = null;
      return;
    }
    const { id, language } = wanted;
    wanted = null;
    // The id first: it is the same `audioTrack.id` the application read from the provider. Then
    // the language alone, for a track the two sides happen to number differently.
    const match =
      tracks.find((track) => describe(track)?.id === id) ||
      (language
        ? tracks.find((track) => base(describe(track)?.id ?? '') === base(language))
        : null);
    if (match) {
      try {
        player().setAudioTrack(match, true);
      } catch {
        // Torn down mid-switch; the next video starts on its own default.
      }
    }
    report();
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.beastube !== 'audio') return;
    if (data.action === 'set' && typeof data.id === 'string') {
      wanted = {
        id: data.id,
        language: typeof data.language === 'string' ? data.language : null,
        at: Date.now(),
      };
      applyWhenListed();
    } else if (data.action === 'list') {
      report();
    }
  });
})();
