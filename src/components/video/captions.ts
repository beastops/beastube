/**
 * Where captions go, how big they are, and which ones are showing.
 *
 * Pure functions, kept apart from the overlay that draws them so the geometry can be tested
 * without a player. Every measurement is taken against the *picture*, not the player box: in
 * fullscreen on a screen that is not 16:9 the box is the whole screen and the picture is
 * letterboxed inside it, and a caption placed against the box sat on the black bar.
 */

import type { CaptionTrack, Cue } from '@/types/domain';

/** A rectangle inside the player box, in CSS pixels. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The picture's rectangle inside a box, for a picture of `aspect` (width ÷ height) fitted within it.
 *
 * The embed letterboxes rather than crops, so the picture is the largest rectangle of its own shape
 * that fits, centred.
 */
export function pictureRect(boxWidth: number, boxHeight: number, aspect: number): Rect {
  if (boxWidth <= 0 || boxHeight <= 0 || !(aspect > 0)) {
    return { left: 0, top: 0, width: Math.max(0, boxWidth), height: Math.max(0, boxHeight) };
  }
  let width = boxWidth;
  let height = boxWidth / aspect;
  if (height > boxHeight) {
    height = boxHeight;
    width = boxHeight * aspect;
  }
  return { left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height };
}

/**
 * Caption text size in CSS pixels.
 *
 * A twenty-seventh of the picture's height at 100%, which is the proportion the site uses: 13px on
 * a 360-tall player, 27px at 720, 40px filling a 1080p screen. It was a fixed share of the
 * *window's* width before, so the same caption was half again as large beside the related list as
 * it is on the site, and stopped growing past 135% in fullscreen because of a hard cap.
 *
 * A portrait picture is sized by its width instead, or a Short would carry captions as wide as its
 * height allows and wrap a word per line.
 */
export function captionFontPx(picture: Rect, scalePercent: number): number {
  const basis = Math.min(picture.height, picture.width * 0.9);
  const scale = Math.max(0.5, scalePercent / 100);
  return Math.max(12, Math.min((basis / 27) * scale, basis / 8));
}

/** How far below its resting place a caption may be pushed by the control bar, and back. */
export interface CaptionPlacement {
  /** From the box's bottom edge to the bottom of the caption block, while nothing is in the way. */
  restingBottom: number;
  /** How much further up it has to sit right now to clear the controls. */
  lift: number;
}

/**
 * Where the caption block sits.
 *
 * `offsetPercent` is the viewer's setting: how far above the bottom of the picture captions rest.
 * `clearance` is how much of the box's bottom edge the controls are covering at this moment —
 * zero while they are hidden. A caption moves up only as far as it has to, which is what the site
 * does: one resting high enough already does not move at all.
 */
export function captionPlacement(
  boxHeight: number,
  picture: Rect,
  offsetPercent: number,
  clearance: number,
): CaptionPlacement {
  const belowPicture = Math.max(0, boxHeight - (picture.top + picture.height));
  const restingBottom = belowPicture + (picture.height * Math.max(0, offsetPercent)) / 100;
  return { restingBottom, lift: Math.max(0, clearance - restingBottom) };
}

/** At most this many cues on screen at once. */
const MAX_SHOWING = 3;

/**
 * The cues on screen at `ms`, oldest first.
 *
 * All of them, not the first: an auto-generated track keeps the previous line up while the next is
 * spoken beneath it, and showing one at a time held every new line back until the old one ended.
 * Capped at the newest few so a malformed track cannot fill the picture.
 */
export function showingCues(cues: readonly Cue[], ms: number): Cue[] {
  const showing: Cue[] = [];
  for (const cue of cues) {
    // Sorted by start, so nothing past this point can be showing yet.
    if (cue.start_ms > ms) break;
    if (ms < cue.end_ms) showing.push(cue);
  }
  return showing.length > MAX_SHOWING ? showing.slice(-MAX_SHOWING) : showing;
}

/** Whether two cue lists are the same cues, so a redraw can be skipped. */
export function sameCues(a: readonly Cue[], b: readonly Cue[]): boolean {
  return a.length === b.length && a.every((cue, index) => cue === b[index]);
}

/** The primary subtag of a language tag: `pt` for `pt-BR`, `es` for `es-419`. */
function primaryLanguage(tag: string): string {
  return tag.split(/[-_]/)[0]?.toLowerCase() ?? '';
}

/** Whether two language tags name the same language, ignoring region and script. */
export function sameLanguage(a: string, b: string): boolean {
  return primaryLanguage(a) !== '' && primaryLanguage(a) === primaryLanguage(b);
}

/**
 * The track to show when the viewer has not picked one for this video.
 *
 * The first preferred language the video has wins, a person-written track ahead of a
 * machine-written one in the same language. With none of them on offer, the video's own track:
 * the provider lists that first, again person-written ahead of machine-written.
 *
 * Matched on the language rather than the whole tag, so a preference for `pt` finds `pt-BR` — an
 * exact match missed every regional track, which is most of them.
 */
export function defaultCaptionTrack(
  tracks: readonly CaptionTrack[],
  preferred: readonly (string | null | undefined)[],
): CaptionTrack | undefined {
  for (const language of preferred) {
    if (!language) continue;
    const matching = tracks.filter((track) => sameLanguage(track.language_code, language));
    const chosen = matching.find((track) => track.is_auto_generated !== true) ?? matching[0];
    if (chosen) return chosen;
  }
  return tracks.find((track) => track.is_auto_generated !== true) ?? tracks[0];
}
