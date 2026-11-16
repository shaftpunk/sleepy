import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { SLEEP_PRESENTATION_CHANGED, type SleepPresentationChange } from "../services/sleepPresentationEvents";
import { publishSleepEstimateHistory } from "../services/sleepEstimateService";
import { sessionGeneration, isSessionGenerationCurrent } from "../auth/sessionLifecycle";

// 30 days for the Month tab + a small buffer.
const ANALYTICS_WINDOW_DAYS = 35;
const HEARTBEAT_MS = 60000;

export function useAnalyticsData(
  babyId: string | null,
) {
  const [sleepData, setSleepData] = useState<{ babyId: string | null; rows: SleepRecord[] }>({ babyId: null, rows: [] });
  const requestEpoch = useRef({ value: 0 });
  const sleepRequest = useRef(0);
  const rawSleeps = useMemo(() => sleepData.babyId === babyId ? sleepData.rows : [], [sleepData, babyId]);

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
        setSleepData({ babyId, rows: [] });
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

      const epoch = requestEpoch.current.value;
      const request = ++sleepRequest.current;
      const generation = sessionGeneration();
      const to = new Date();
      let data: SleepRecord[];
      try {
        data = await getSleepsOverlappingPeriod(
          babyId,
          from.toISOString(),
          to.toISOString(),
        );
      } catch (error) {
        if (epoch === requestEpoch.current.value && request === sleepRequest.current) {
          setSleepData({ babyId, rows: [] });
        }
        console.error("Analytics sleep load failed:", error);
        return;
      }

      if (!isSessionGenerationCurrent(generation) || epoch !== requestEpoch.current.value || request !== sleepRequest.current) return;
      publishSleepEstimateHistory(babyId, data, from.getTime(), to.getTime(), generation);
      setSleepData({ babyId, rows: data.filter(row => row.baby_id === babyId) });
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
    const lifecycle = requestEpoch.current;
    lifecycle.value++;

    async function init() {
      if (!babyId) {
        setSleepData({ babyId, rows: [] });
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
        lifecycle.value++;
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
      lifecycle.value++;

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

  // The heartbeat above bounds staleness to 60s while the app stays in the
  // foreground, but backgrounding (locked screen, app-switch) can silently
  // drop the realtime connection for much longer than that, and Supabase
  // does not replay missed events on reconnect. Force a fresh fetch as soon
  // as the page is visible again instead of waiting out the heartbeat.
  useEffect(() => {
    if (!babyId) return;

    function refetchIfVisible() {
      if (document.visibilityState === "visible") {
        void loadSessions();
        void loadFeeds();
      }
    }

    document.addEventListener("visibilitychange", refetchIfVisible);
    window.addEventListener("focus", refetchIfVisible);
    document.addEventListener("resume", refetchIfVisible);
    const onSleepWrite = (event: Event) => {
      // Authoritative active-state snapshots are reads, not history mutations.
      if (!(event as Event & { sleepChange?: SleepPresentationChange }).sleepChange?.snapshot) void loadSessions();
    };
    window.addEventListener(SLEEP_PRESENTATION_CHANGED, onSleepWrite);

    return () => {
      document.removeEventListener("visibilitychange", refetchIfVisible);
      window.removeEventListener("focus", refetchIfVisible);
      document.removeEventListener("resume", refetchIfVisible);
      window.removeEventListener(SLEEP_PRESENTATION_CHANGED, onSleepWrite);
    };
  }, [babyId, loadSessions, loadFeeds]);

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
