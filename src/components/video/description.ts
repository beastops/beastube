/**
 * A video description, split into the parts the watch page makes clickable.
 *
 * The site turns three things in a description into links: addresses, timestamps and hashtags. A
 * description shown as plain text left the chapter list at the top of a long video unclickable and
 * every link in it to be copied by hand.
 */

import {
  toChannelId,
  toVideoId,
  type ChannelId,
  type DescriptionRun,
  type VideoId,
} from '@/types/domain';

/** One run of a description. */
export type DescriptionPart =
  | { kind: 'text'; text: string }
  /** An address to open in the viewer's browser. */
  | { kind: 'link'; text: string; url: string }
  /** A video on the site, opened here rather than in a browser. */
  | { kind: 'video'; text: string; videoId: VideoId; startAtMs?: number }
  /** A channel on the site, opened here. */
  | { kind: 'channel'; text: string; channelId: ChannelId }
  /** A position in this video. */
  | { kind: 'time'; text: string; positionMs: number }
  | { kind: 'hashtag'; text: string; tag: string };

/**
 * Addresses, timestamps and hashtags, in one pass so none is found inside another.
 *
 * Only `https` addresses: the shell opens nothing else, and a link that is refused when clicked is
 * worse than text. A timestamp is `M:SS` or `H:MM:SS` standing on its own, so a score or a ratio
 * inside a word is left alone. A hashtag takes combining marks as well as letters, or a tag in
 * Hindi stops at its first vowel sign.
 */
const PATTERN =
  /(https:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?])|(?<![\w:.])((?:\d{1,2}:)?\d{1,2}:[0-5]\d)(?![\w:])|(?<![\w&#])#([\p{L}\p{M}\p{N}_]*\p{L}[\p{L}\p{M}\p{N}_]*)/gu;

/** `text` as a URL, or `null`. Not `URL.canParse`, which is newer than the engines the build targets. */
function toUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** Milliseconds for `M:SS` or `H:MM:SS`. */
function parseTimestamp(text: string): number {
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0) * 1000;
}

/** The `t` parameter of a video link — `90`, `90s`, `1m30s` — in milliseconds. */
function parseStart(value: string | null): number | undefined {
  if (value === null) return undefined;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value);
  if (!match) return undefined;
  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  const total = (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000;
  return total > 0 ? total : undefined;
}

/** What an `https` address on the site points at, when it is something this application shows. */
function onSite(url: URL, text: string): DescriptionPart | null {
  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  const startAtMs = parseStart(url.searchParams.get('t'));
  const video = (raw: string | null | undefined): DescriptionPart | null => {
    const videoId = toVideoId(raw ?? '');
    if (!videoId) return null;
    return startAtMs === undefined
      ? { kind: 'video', text, videoId }
      : { kind: 'video', text, videoId, startAtMs };
  };

  if (host === 'youtu.be') return video(url.pathname.slice(1).split('/')[0]);
  if (host !== 'youtube.com') return null;
  const [first, second] = url.pathname.split('/').filter(Boolean);
  if (first === 'watch') return video(url.searchParams.get('v'));
  if (first === 'shorts' || first === 'live') return video(second);
  if (first === 'channel') {
    const channelId = toChannelId(second ?? '');
    return channelId ? { kind: 'channel', text, channelId } : null;
  }
  return null;
}

/** Splits `text` into plain runs and the parts that link somewhere. */
export function parseDescription(text: string): DescriptionPart[] {
  const parts: DescriptionPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(PATTERN)) {
    const [whole, address, timestamp, hashtag] = match;
    const at = match.index;
    if (at > cursor) parts.push({ kind: 'text', text: text.slice(cursor, at) });
    cursor = at + whole.length;

    if (address !== undefined) {
      const url = toUrl(address);
      if (url === null) parts.push({ kind: 'text', text: whole });
      else parts.push(onSite(url, whole) ?? { kind: 'link', text: whole, url: url.href });
    } else if (timestamp !== undefined) {
      parts.push({ kind: 'time', text: whole, positionMs: parseTimestamp(timestamp) });
    } else if (hashtag !== undefined) {
      parts.push({ kind: 'hashtag', text: whole, tag: hashtag });
    }
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts;
}

/**
 * The parts of a description the provider delivered as runs.
 *
 * A linked run keeps the text the site shows — `4:27`, `@name`, a shortened address — and goes
 * where its link goes. A link into `videoId` itself is a position in it, which is what a chapter
 * line is. Unlinked runs are read as text, so an address or a time typed without a link still
 * works.
 */
export function partsFromRuns(
  runs: readonly DescriptionRun[],
  videoId: VideoId,
): DescriptionPart[] {
  const parts: DescriptionPart[] = [];
  for (const run of runs) {
    const link = run.link;
    if (link === undefined) {
      parts.push(...parseDescription(run.text));
    } else if (link.kind === 'video') {
      if (link.video_id === videoId) {
        // The first chapter line links here with no time at all: it is the start.
        parts.push({ kind: 'time', text: run.text, positionMs: link.start_ms ?? 0 });
      } else {
        parts.push(
          link.start_ms === undefined
            ? { kind: 'video', text: run.text, videoId: link.video_id }
            : { kind: 'video', text: run.text, videoId: link.video_id, startAtMs: link.start_ms },
        );
      }
    } else if (link.kind === 'channel') {
      parts.push({ kind: 'channel', text: run.text, channelId: link.channel_id });
    } else {
      // Only `https` is opened, so anything else stays text rather than becoming a dead link.
      const url = toUrl(link.url);
      if (url?.protocol === 'https:') {
        parts.push(onSite(url, run.text) ?? { kind: 'link', text: run.text, url: url.href });
      } else {
        parts.push({ kind: 'text', text: run.text });
      }
    }
  }
  return parts;
}
