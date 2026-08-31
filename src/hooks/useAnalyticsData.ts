import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getSleepsOverlappingPeriod,
  type SleepRecord,
} from "../services/sleepService";

import {
  getFeedsFromDate,
  type FeedRecord,
} from "../services/feedService";

import {
  subscribeToSleepChanges,
} from "../services/sleepRealtime";

import {
  subscribeToFeedChanges,
} from "../services/feedRealtime";

import {
  normalizeFeedRows,
  normalizeSleepRows,
} from "../analytics";

// 30 days for the Month tab + a small buffer.
const ANALYTICS_WINDOW_DAYS = 35;
const HEARTBEAT_MS = 60000;

export function useAnalyticsData(
  babyId: string | null,
) {
  const [
    rawSleeps,
    setRawSleeps,
  ] = useState<SleepRecord[]>([]);

  const [
    rawFeeds,
    setRawFeeds,
  ] = useState<FeedRecord[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const loadSessions =
    useCallback(async () => {
      if (!babyId) {
        setRawSleeps([]);
        return;
      }

      const from = new Date(
        Date.now() -
          ANALYTICS_WINDOW_DAYS *
            24 *
            60 *
            60 *
            1000,
      );

      const data =
        await getSleepsOverlappingPeriod(
          babyId,
          from.toISOString(),
          new Date().toISOString(),
        );

      setRawSleeps(data);
    }, [babyId]);

  const loadFeeds =
    useCallback(async () => {
      if (!babyId) {
        setRawFeeds([]);
        return;
      }

      const from = new Date(
        Date.now() -
          ANALYTICS_WINDOW_DAYS *
            24 *
            60 *
            60 *
            1000,
      );

      const data =
        await getFeedsFromDate(
          babyId,
          from.toISOString(),
        );

      setRawFeeds(data);
    }, [babyId]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!babyId) {
        setRawSleeps([]);
        setRawFeeds([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        await Promise.all([
          loadSessions(),
          loadFeeds(),
        ]);
      } catch (error) {
        console.error(
          "Analytics load failed:",
          error,
        );
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void init();

    if (!babyId) {
      return () => {
        mounted = false;
      };
    }

    const heartbeat =
      window.setInterval(() => {
        void loadSessions();
        void loadFeeds();
      }, HEARTBEAT_MS);

    const offSleep =
      subscribeToSleepChanges(
        babyId,
        loadSessions,
      );

    const offFeed =
      subscribeToFeedChanges(
        babyId,
        loadFeeds,
      );

    return () => {
      mounted = false;

      window.clearInterval(
        heartbeat,
      );

      offSleep();
      offFeed();
    };
  }, [
    babyId,
    loadSessions,
    loadFeeds,
  ]);

  const normalizedSleep =
    useMemo(
      () =>
        normalizeSleepRows(
          rawSleeps,
        ),
      [rawSleeps],
    );

  const feeds =
    useMemo(
      () =>
        normalizeFeedRows(
          rawFeeds,
        ),
      [rawFeeds],
    );

  const reload =
    useCallback(async () => {
      await Promise.all([
        loadSessions(),
        loadFeeds(),
      ]);
    }, [
      loadSessions,
      loadFeeds,
    ]);

  return {
    sessions:
      normalizedSleep.sessions,

    active:
      normalizedSleep.active,

    feeds,

    loading,

    reload,
  };
}