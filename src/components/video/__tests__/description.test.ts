/**
 * What a description links, and what it leaves as text.
 *
 * The cases are the shapes real descriptions carry: a chapter list, a merch link, a link to another
 * video with a start time, a hashtag line — and the near-misses that must stay text.
 */

import { describe, expect, it } from 'vitest';

import { parseDescription, partsFromRuns } from '@/components/video/description';
import type { ChannelId, VideoId } from '@/types/domain';

const kinds = (text: string) => parseDescription(text).map((part) => part.kind);

describe('timestamps', () => {
  it('turns a chapter list into positions', () => {
    const parts = parseDescription('0:00 Intro\n4:27 The spark\n1:02:03 Predictions');
    expect(parts.filter((part) => part.kind === 'time')).toEqual([
      { kind: 'time', text: '0:00', positionMs: 0 },
      { kind: 'time', text: '4:27', positionMs: 267_000 },
      { kind: 'time', text: '1:02:03', positionMs: 3_723_000 },
    ]);
  });

  it('leaves a score, a ratio and a clock inside a word alone', () => {
    expect(kinds('won 3:2 tonight')).toEqual(['text']);
    expect(kinds('aspect 16:9')).toEqual(['text']);
    expect(kinds('v1:23')).toEqual(['text']);
    expect(kinds('12:345')).toEqual(['text']);
  });
});

describe('addresses', () => {
  it('links an https address and stops before trailing punctuation', () => {
    const parts = parseDescription('Merch: https://shop.example.com/drop.');
    expect(parts).toEqual([
      { kind: 'text', text: 'Merch: ' },
      { kind: 'link', text: 'https://shop.example.com/drop', url: 'https://shop.example.com/drop' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('leaves an address the shell would refuse to open as text', () => {
    expect(kinds('see http://example.com')).toEqual(['text']);
  });

  it('opens videos and channels on the site here, with the start time', () => {
    expect(parseDescription('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toEqual([
      {
        kind: 'video',
        text: 'https://youtu.be/dQw4w9WgXcQ?t=1m30s',
        videoId: 'dQw4w9WgXcQ',
        startAtMs: 90_000,
      },
    ]);
    expect(parseDescription('https://www.youtube.com/watch?v=dQw4w9WgXcQ')[0]).toMatchObject({
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
    });
    expect(
      parseDescription('https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw')[0],
    ).toMatchObject({ kind: 'channel', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw' });
  });

  it('sends the rest of the site to the browser, where it can be shown', () => {
    expect(parseDescription('https://www.youtube.com/@MrBeast')[0]?.kind).toBe('link');
  });

  it('does not find a timestamp or hashtag inside an address', () => {
    expect(kinds('https://example.com/a#b?t=1:30')).toEqual(['link']);
  });
});

describe('hashtags', () => {
  it('links a hashtag, in any script', () => {
    expect(parseDescription('#shorts #लोफ़ी')).toEqual([
      { kind: 'hashtag', text: '#shorts', tag: 'shorts' },
      { kind: 'text', text: ' ' },
      { kind: 'hashtag', text: '#लोफ़ी', tag: 'लोफ़ी' },
    ]);
  });

  it('leaves a number, an entity and a mid-word mark alone', () => {
    expect(kinds('track #1')).toEqual(['text']);
    expect(kinds('&#39;')).toEqual(['text']);
    expect(kinds('C#major')).toEqual(['text']);
  });
});

it('keeps every character, in order', () => {
  const text = 'Watch 1:30 then https://example.com/x and #tag, ok';
  expect(
    parseDescription(text)
      .map((part) => part.text)
      .join(''),
  ).toBe(text);
});

describe('runs from the provider', () => {
  const here = '2sgstdA4a50' as VideoId;

  it('shows a chapter line as its time and makes it a position in this video', () => {
    const parts = partsFromRuns(
      [
        { text: '4:27', link: { kind: 'video', video_id: here, start_ms: 267_000 } },
        { text: ' - The spark' },
      ],
      here,
    );
    expect(parts).toEqual([
      { kind: 'time', text: '4:27', positionMs: 267_000 },
      { kind: 'text', text: ' - The spark' },
    ]);
  });

  it('takes the first chapter line, which links here with no time, as the start', () => {
    expect(
      partsFromRuns([{ text: '00:00', link: { kind: 'video', video_id: here } }], here),
    ).toEqual([{ kind: 'time', text: '00:00', positionMs: 0 }]);
  });

  it('keeps a mention as the name the site shows, linked to the channel', () => {
    const channel = 'UC9ZTAQ3Fv9uZt0RGCsbdmdA' as ChannelId;
    expect(
      partsFromRuns([{ text: '@SueBird', link: { kind: 'channel', channel_id: channel } }], here),
    ).toEqual([{ kind: 'channel', text: '@SueBird', channelId: channel }]);
  });

  it('opens other videos here, and leaves an address the shell would refuse as text', () => {
    const other = 'dQw4w9WgXcQ' as VideoId;
    expect(
      partsFromRuns(
        [
          { text: 'last week', link: { kind: 'video', video_id: other } },
          { text: 'old site', link: { kind: 'web', url: 'http://example.com' } },
          { text: 'shop', link: { kind: 'web', url: 'https://shop.example.com' } },
        ],
        here,
      ).map((part) => part.kind),
    ).toEqual(['video', 'text', 'link']);
  });

  it('still reads an unlinked run for times and addresses typed into it', () => {
    expect(partsFromRuns([{ text: 'from 1:30 on' }], here).map((part) => part.kind)).toEqual([
      'text',
      'time',
      'text',
    ]);
  });
});
