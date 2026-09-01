import {
    deleteFeed,
    type FeedRecord,
  } from "../services/feedService";

  import { feedTypeLabel, formatClock, sideLabel } from "../lib/format";
  import { LOCALES, useTranslation } from "../i18n";

  type FeedHistoryProps = {
    feeds: FeedRecord[];
    onChanged: () => void;
  };

  export default function FeedHistory({
    feeds,
    onChanged,
  }: FeedHistoryProps) {
    const { t, lang } = useTranslation();

    function formatDate(date: string) {
      return new Intl.DateTimeFormat(
        LOCALES[lang],
        {
          day: "2-digit",
          month: "short",
        }
      ).format(new Date(date));
    }

    function feedDescription(
      feed: FeedRecord
    ) {
      if (feed.feedtype === "bottle") {
        return feed.amountml !== null
          ? `${feed.amountml} ml`
          : feedTypeLabel("bottle", lang);
      }

      if (feed.feedtype === "breast") {
        const side = sideLabel(feed.side, lang);
        const typeLabel = feedTypeLabel("breast", lang);

        return `${typeLabel}${
          side ? ` · ${side}` : ""
        }`;
      }

      return feedTypeLabel("food", lang);
    }

    function iconForFeed(
      feed: FeedRecord
    ) {
      if (feed.feedtype === "bottle") {
        return "🍼";
      }

      if (feed.feedtype === "breast") {
        return "♡";
      }

      return "🥣";
    }

    async function handleDelete(
      feed: FeedRecord
    ) {
      const confirmed =
        window.confirm(
          t("common.confirmDeleteFeed")
        );

      if (!confirmed) {
        return;
      }

      try {
        await deleteFeed(feed.id);
        onChanged();
      } catch (error) {
        console.error(
          "Failed to delete feed:",
          error
        );
      }
    }

    if (feeds.length === 0) {
      return (
        <div className="empty-card">
          <div className="feed-empty-icon">
            🍼
          </div>

          <p>
            {t("analysis.feed.noFeedingYet")}
          </p>
        </div>
      );
    }

    return (
      <div className="history-list">
        {feeds.map((feed) => (
          <div
            className="history-item"
            key={feed.id}
          >
            <div className="history-icon">
              {iconForFeed(feed)}
            </div>

            <div className="history-content">
              <strong>
                {feedDescription(feed)}
              </strong>

              <span>
                {formatDate(feed.starttime)}
                {" · "}
                {formatClock(new Date(feed.starttime).getTime(), lang)}
              </span>

              {feed.note && (
                <p>{feed.note}</p>
              )}
            </div>

            <button
              className="history-delete"
              onClick={() =>
                handleDelete(feed)
              }
              aria-label={t("common.deleteFeedingAria")}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    );
  }