import { useCallback, useEffect, useMemo, useState } from "react";

import { getSleepsOverlappingPeriod, type SleepRecord } from "../services/sleepService";
import { getFeedsFromDate, type FeedRecord } from "../services/feedService";
import { subscribeToSleepChanges } from "../services/sleepRealtime";
import { subscribeToFeedChanges } from "../services/feedRealtime";
import { normalizeFeedRows, normalizeSleepRows } from "../analytics";
import type { BabyId } from "../stores/appStore";

// 30 days for the Month tab + a small buffer.
const ANALYTICS_WINDOW_DAYS = 35;
const HEARTBEAT_MS = 60000;

// Single entry point for all analytics-derived state (mirrors the spec's
// loadSessions()/loadFeeds() refresh model). Normalization is memoized on the
// raw array reference, so downstream stats (wake windows, etc.) are only
// recomputed when a load actually changes the data, not on every render/tick.
export function useAnalyticsData(bbyid: BabyId) {
  const [rawSleeps, setRawSleeps] = useState<SleepRecord[]>([]);
  const [rawFeeds, setRawFeeds] = useState<FeedRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    const from = new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const data = await getSleepsOverlappingPeriod(
      bbyid,
      from.toISOString(),
      new Date().toISOString()
    );
    setRawSleeps(data);
  }, [bbyid]);

  const loadFeeds = useCallback(async () => {
    const from = new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const data = await getFeedsFromDate(bbyid, from.toISOString());
    setRawFeeds(data);
  }, [bbyid]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      setLoading(true);
      try {
        await Promise.all([loadSessions(), loadFeeds()]);
      } catch (error) {
        console.error("Analytics load failed:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    init();

    const heartbeat = window.setInterval(() => {
      loadSessions();
      loadFeeds();
    }, HEARTBEAT_MS);

    const offSleep = subscribeToSleepChanges(bbyid, loadSessions);
    const offFeed = subscribeToFeedChanges(bbyid, loadFeeds);

    return () => {
      mounted = false;
      window.clearInterval(heartbeat);
      offSleep();
      offFeed();
    };
  }, [bbyid, loadSessions, loadFeeds]);

  const normalizedSleep = useMemo(() => normalizeSleepRows(rawSleeps), [rawSleeps]);
  const feeds = useMemo(() => normalizeFeedRows(rawFeeds), [rawFeeds]);

  return {
    sessions: normalizedSleep.sessions,
    active: normalizedSleep.active,
    feeds,
    loading,
    reload: useCallback(async () => {
      await Promise.all([loadSessions(), loadFeeds()]);
    }, [loadSessions, loadFeeds]),
  };
}
