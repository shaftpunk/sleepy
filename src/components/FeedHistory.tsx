import {
    deleteFeed,
    type FeedRecord,
  } from "../services/feedService";
  
  type FeedHistoryProps = {
    feeds: FeedRecord[];
    onChanged: () => void;
  };
  
  function formatTime(date: string) {
    return new Intl.DateTimeFormat(
      "nb-NO",
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    ).format(new Date(date));
  }
  
  function formatDate(date: string) {
    return new Intl.DateTimeFormat(
      "nb-NO",
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
        : "Bottle";
    }
  
    if (feed.feedtype === "breast") {
      const side =
        feed.side === "left"
          ? "Left"
          : feed.side === "right"
            ? "Right"
            : feed.side === "both"
              ? "Both"
              : "";
  
      return `Breast${
        side ? ` · ${side}` : ""
      }`;
    }
  
    return "Food";
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
  
  export default function FeedHistory({
    feeds,
    onChanged,
  }: FeedHistoryProps) {
    async function handleDelete(
      feed: FeedRecord
    ) {
      const confirmed =
        window.confirm(
          "Delete this feeding?"
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
            No feeding registrations yet.
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
                {formatTime(feed.starttime)}
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
              aria-label="Delete feeding"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    );
  }