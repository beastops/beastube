/**
 * The feed cache across a relaunch.
 *
 * Within a session the cache was already keeping a screen populated while it refetched; these
 * cover the part that spans launches. "Relaunch" is simulated the only honest way — by resetting
 * the module registry so the in-memory map starts empty while the webview's storage does not —
 * because the behaviour under test is precisely what survives the map being gone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecommendedFeed } from '@/services/ipc';
import type { VideoId } from '@/types/domain';

const aFeed: RecommendedFeed = {
  videos: [
    {
      id: 'dQw4w9WgXcQ' as VideoId,
      title: 'A video',
      channel_name: 'A channel',
      channel_verified: false,
      duration_ms: 212_000,
      published_text: '3 days ago',
      view_count: 1,
      live_status: 'not_live',
      is_short: false,
    },
  ],
  source: 'watched',
};

/** A fresh instance of the modules, as a new launch would have, with storage left as it was. */
async function relaunch() {
  vi.resetModules();
  const ipc = await import('@/services/ipc');
  const cache = await import('@/services/feedCache');
  return { ipc, cache };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  const { ipc } = await relaunch();
  ipc.setIpcMock(null);
});

describe('the feed cache across launches', () => {
  it('shows nothing before the first feed has ever been fetched', async () => {
    const { cache } = await relaunch();
    expect(cache.lastFeed(cache.recommendedKey(12))).toBeUndefined();
  });

  it('serves the last fetched feed at once on the next launch, then fetches a new one', async () => {
    const first = await relaunch();
    first.ipc.setIpcMock(() => Promise.resolve(aFeed as never));
    await first.cache.sharedRecommended(12, 0);

    const next = await relaunch();
    let fetched = 0;
    const newer: RecommendedFeed = { ...aFeed, source: 'discover' };
    next.ipc.setIpcMock(() => {
      fetched += 1;
      return Promise.resolve(newer as never);
    });

    // Readable before anything has been asked for, which is what paints the first frame.
    expect(next.cache.lastFeed(next.cache.recommendedKey(12))).toEqual(aFeed);

    // And a stored value never satisfies a request by itself: the fetch still goes out, and its
    // answer replaces what was shown.
    await expect(next.cache.sharedRecommended(12, 0)).resolves.toEqual(newer);
    expect(fetched).toBe(1);
    expect(next.cache.lastFeed(next.cache.recommendedKey(12))).toEqual(newer);
  });

  it('forgets the stored copy when the cache is cleared', async () => {
    const first = await relaunch();
    first.ipc.setIpcMock(() => Promise.resolve(aFeed as never));
    await first.cache.sharedRecommended(12, 0);
    first.cache.clearFeedCache();

    const next = await relaunch();
    expect(next.cache.lastFeed(next.cache.recommendedKey(12))).toBeUndefined();
  });

  it('ignores a stored value it cannot read', async () => {
    localStorage.setItem('beastube.feed.recommended:12', '{not json');
    const { cache } = await relaunch();
    expect(cache.lastFeed(cache.recommendedKey(12))).toBeUndefined();
  });
});
