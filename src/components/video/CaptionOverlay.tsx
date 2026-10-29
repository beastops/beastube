/**
 * Captions, drawn by the application rather than by the embed.
 *
 * The embed renders its captions inside a cross-origin iframe. Nothing outside that frame can move
 * them, resize them or restyle them — the player API exposes a font size and nothing else. Drawing
 * them here is what makes a position setting possible at all.
 *
 * The cue file is fetched through the native side: it is provider data at a provider address, and
 * the check that it *is* one lives with the provider rather than here.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  captionFontPx,
  captionPlacement,
  pictureRect,
  sameCues,
  showingCues,
} from '@/components/video/captions';
import { useAsyncResource } from '@/hooks/useAsyncResource';
import { invoke } from '@/services/ipc';
import type { CaptionTrack, Cue } from '@/types/domain';

/**
 * How far ahead of the last reported position the clock may run on its own.
 *
 * The player reports its position four times a second. Between reports the clock advances by
 * elapsed time — that is what makes a line appear on the frame it is spoken rather than up to a
 * quarter of a second late — but never further than this, so a player that has stalled without
 * saying so does not leave captions running ahead of a frozen picture.
 */
const MAX_EXTRAPOLATION_MS = 1000;

/** The settings menu's width, which a caption yields to rather than running underneath it. */
const MENU_WIDTH_PX = 288;

export function CaptionOverlay({
  track,
  positionMs,
  playing,
  rate,
  pictureAspect,
  offsetPercent,
  scalePercent,
  backgroundPercent,
  clearance,
  menuOpen,
}: {
  track: CaptionTrack | undefined;
  positionMs: number;
  playing: boolean;
  rate: number;
  /** The picture's width over its height, which is the shape of the page's player slot. */
  pictureAspect: number;
  offsetPercent: number;
  scalePercent: number;
  backgroundPercent: number;
  /** How much of the bottom edge the controls cover right now; zero while they are hidden. */
  clearance: number;
  /** Whether the settings menu is open over the right of the frame. */
  menuOpen: boolean;
}): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [showing, setShowing] = useState<Cue[]>([]);

  const cues = useAsyncResource(track === undefined ? null : `cues:${track.url}`, (signal) =>
    invoke('get_caption_cues', { url: track?.url ?? '' }, { signal }),
  );
  // Only this track's cues: the resource keeps the previous value while a new track loads, and
  // drawing the old language over the new choice for a second reads as the choice not working.
  const list = cues.loading ? undefined : cues.data;

  // The box changes size with the window and with fullscreen, which is exactly when placement has
  // to follow. Measured here rather than passed in: in fullscreen the box is the screen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, []);

  // The clock. Restarted on every reported position, so drift never outlives a report, and run per
  // frame only while playing. State changes only when the set of cues on screen does.
  useEffect(() => {
    if (!list) return undefined;
    const reportedAt = performance.now();
    let frame = 0;
    const tick = () => {
      const elapsed = Math.min(MAX_EXTRAPOLATION_MS, performance.now() - reportedAt);
      const now = playing ? positionMs + elapsed * rate : positionMs;
      const next = showingCues(list, now);
      setShowing((was) => (sameCues(was, next) ? was : next));
      if (playing) frame = requestAnimationFrame(tick);
    };
    // The first tick on a timer rather than a frame: a window the compositor is not drawing gets no
    // frames at all, and its captions should still follow the reports rather than freeze.
    const first = setTimeout(tick, 0);
    return () => {
      clearTimeout(first);
      cancelAnimationFrame(frame);
    };
  }, [list, positionMs, playing, rate]);

  const picture = pictureRect(size.width, size.height, pictureAspect);
  const { restingBottom, lift } = captionPlacement(size.height, picture, offsetPercent, clearance);
  const fontSize = captionFontPx(picture, scalePercent);

  // A little in from the picture's sides, as broadcast captions are, so a long line never touches
  // the edge of the frame.
  const left = picture.left + picture.width * 0.05;
  let width = picture.width * 0.9;
  if (menuOpen) {
    // The menu is opaque and sits above the captions, so a line running under it was simply cut
    // off at its edge. Yielding that width makes the line wrap into what is left instead — unless
    // so little would be left that wrapping is worse than being partly covered.
    const yielded = size.width - MENU_WIDTH_PX - left;
    if (yielded >= picture.width * 0.4) width = Math.min(width, yielded);
  }

  // At low opacity the band no longer holds the text against a bright frame, so the letters are
  // outlined instead — the site's "outline" edge, scaled with the text.
  const outline =
    backgroundPercent < 35
      ? '0 0 0.08em rgb(0 0 0), 0 0 0.16em rgb(0 0 0 / 90%), 0.04em 0.04em 0.12em rgb(0 0 0 / 80%)'
      : undefined;

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-20">
      {list !== undefined && showing.length > 0 && size.width > 0 && (
        <div
          aria-live="off"
          className="absolute flex flex-col items-center text-center font-medium text-white"
          style={{
            left,
            width,
            bottom: restingBottom,
            fontSize,
            lineHeight: 1.32,
            gap: '0.12em',
            // Up and out of the controls' way while they are showing, and back down as they fade —
            // glided rather than jumped, so the eye can follow the line it was reading.
            transform: `translateY(${String(-lift)}px)`,
            transition: 'transform var(--duration-chrome) var(--ease-player-out)',
          }}
        >
          {showing.map((cue) => (
            <div key={`${String(cue.start_ms)}:${cue.text}`} className="max-w-full">
              <span
                style={{
                  // The text's own line breaks are the caption author's; collapsing them made every
                  // two-line caption one long line.
                  whiteSpace: 'pre-line',
                  // A band per line rather than one block behind all of them, as on the site.
                  WebkitBoxDecorationBreak: 'clone',
                  boxDecorationBreak: 'clone',
                  padding: '0.06em 0.28em',
                  borderRadius: '0.12em',
                  backgroundColor: `rgb(8 8 8 / ${String(backgroundPercent)}%)`,
                  textShadow: outline,
                }}
              >
                {cue.text.trim()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
