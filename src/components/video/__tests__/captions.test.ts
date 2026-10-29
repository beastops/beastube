/**
 * Caption geometry and selection.
 *
 * Each case is one of the ways captions were wrong on screen: sized to the window instead of the
 * picture, placed on a letterbox bar, held behind a visible control bar, or arriving seconds late
 * because only one overlapping cue was ever drawn.
 */

import { describe, expect, it } from 'vitest';

import {
  captionFontPx,
  captionPlacement,
  defaultCaptionTrack,
  pictureRect,
  sameLanguage,
  showingCues,
} from '@/components/video/captions';
import type { CaptionTrack, Cue } from '@/types/domain';

const WIDE = 16 / 9;

describe('the picture inside the player box', () => {
  it('is the whole box when the shapes agree', () => {
    expect(pictureRect(1280, 720, WIDE)).toEqual({ left: 0, top: 0, width: 1280, height: 720 });
  });

  it('is letterboxed on a 16:10 screen, which is where captions used to sit on the bar', () => {
    expect(pictureRect(1920, 1200, WIDE)).toEqual({ left: 0, top: 60, width: 1920, height: 1080 });
  });

  it('is pillarboxed on an ultrawide screen', () => {
    const rect = pictureRect(2560, 1080, WIDE);
    expect(rect.height).toBe(1080);
    expect(rect.width).toBe(1920);
    expect(rect.left).toBe(320);
  });

  it('survives a box that has not been measured yet', () => {
    expect(pictureRect(0, 0, WIDE)).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });
});

describe('caption size', () => {
  const at = (width: number, height: number) => ({ left: 0, top: 0, width, height });

  it('follows the picture, at the proportion the site uses', () => {
    expect(captionFontPx(at(640, 360), 100)).toBeCloseTo(13.3, 1);
    expect(captionFontPx(at(1280, 720), 100)).toBeCloseTo(26.7, 1);
    expect(captionFontPx(at(1920, 1080), 100)).toBeCloseTo(40, 1);
  });

  it('keeps growing with the size setting in fullscreen', () => {
    expect(captionFontPx(at(1920, 1080), 200)).toBeCloseTo(80, 1);
  });

  it('never becomes unreadably small', () => {
    expect(captionFontPx(at(320, 180), 70)).toBe(12);
  });

  it('sizes a portrait picture by its width', () => {
    expect(captionFontPx(at(420, 747), 100)).toBeCloseTo(14, 0);
  });
});

describe('caption placement', () => {
  const picture = { left: 0, top: 0, width: 1280, height: 720 };

  it('rests at the chosen height above the bottom of the picture', () => {
    expect(captionPlacement(720, picture, 10, 0)).toEqual({ restingBottom: 72, lift: 0 });
  });

  it('moves up only as far as the controls require', () => {
    expect(captionPlacement(720, picture, 4, 75)).toEqual({ restingBottom: 28.8, lift: 46.2 });
  });

  it('does not move at all when it already rests above the controls', () => {
    expect(captionPlacement(720, picture, 15, 75).lift).toBe(0);
  });

  it('measures from the picture, not from a letterbox bar under it', () => {
    const boxed = pictureRect(1920, 1200, WIDE);
    expect(captionPlacement(1200, boxed, 10, 0).restingBottom).toBe(60 + 108);
  });
});

describe('which cues are showing', () => {
  const cue = (start_ms: number, end_ms: number, text: string): Cue => ({ start_ms, end_ms, text });
  const rolling = [
    cue(18_800, 19_039, "We're"),
    cue(19_039, 25_960, "We're no strangers to"),
    cue(21_800, 22_800, 'love.'),
    cue(22_800, 29_119, 'love. You know'),
  ];

  it('stacks overlapping lines oldest first, the way a rolling track is spoken', () => {
    expect(showingCues(rolling, 22_000).map((one) => one.text)).toEqual([
      "We're no strangers to",
      'love.',
    ]);
  });

  it('shows nothing between lines', () => {
    expect(showingCues([cue(0, 1000, 'a'), cue(2000, 3000, 'b')], 1500)).toEqual([]);
  });

  it('keeps only the newest few', () => {
    const many = Array.from({ length: 6 }, (_, index) => cue(index, 10_000, String(index)));
    expect(showingCues(many, 50).map((one) => one.text)).toEqual(['3', '4', '5']);
  });
});

describe('the default track', () => {
  const track = (language_code: string, auto = false): CaptionTrack => ({
    language_code,
    language_name: language_code,
    url: `https://www.youtube.com/api/timedtext?lang=${language_code}${auto ? '&kind=asr' : ''}`,
    is_auto_generated: auto,
  });
  const tracks = [track('ja'), track('en', true), track('pt-BR'), track('en')];

  it('prefers the viewer’s language, written by a person', () => {
    expect(defaultCaptionTrack(tracks, ['en'])).toBe(tracks[3]);
  });

  it('matches a language across regions', () => {
    expect(defaultCaptionTrack(tracks, ['pt'])).toBe(tracks[2]);
    expect(sameLanguage('es-419', 'es')).toBe(true);
    expect(sameLanguage('en', 'es')).toBe(false);
  });

  it('takes a machine-written track in the viewer’s language over none', () => {
    expect(defaultCaptionTrack([track('ja'), track('en', true)], ['en'])?.language_code).toBe('en');
  });

  it('falls back to the video’s own track, skipping unset preferences', () => {
    expect(defaultCaptionTrack(tracks, [null, undefined, 'de'])).toBe(tracks[0]);
  });

  it('has nothing to offer when the video has no tracks', () => {
    expect(defaultCaptionTrack([], ['en'])).toBeUndefined();
  });
});
