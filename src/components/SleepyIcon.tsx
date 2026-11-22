const paths = {
  home: "M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
  log: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  settings: "M10 3h4l.6 2.5 2 .9 2.4-1 2 3.4-1.8 1.7v2.9l1.8 1.7-2 3.4-2.4-1-2 .9L14 21h-4l-.6-2.5-2-.9-2.4 1-2-3.4 1.8-1.7v-2.9L3 8.9l2-3.4 2.4 1 2-.9L10 3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  baby: "M8 6c.2-3 4-4 5-1.5.6 1.4-.8 2.6-2 2.3M4.5 11a7.5 7.5 0 1 1 15 0c2.5.2 2.5 4 0 4.2a7.8 7.8 0 0 1-15 0c-2.5-.2-2.5-4 0-4.2ZM8 12h.01M16 12h.01M10 16c1.1 1 2.9 1 4 0",
  sleep: "M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z",
  feed: "M10 7V5a2 2 0 0 1 4 0v2m-6 0h8v4H8zM9 11h6l2 3v6H7v-6zm1 4h2m-2 3h2",
  diaper: "M3 6h18v6c0 4-4 7-9 8-5-1-9-4-9-8zm0 4c4 0 7 3 7 9m11-9c-4 0-7 3-7 9M3 8h5m8 0h5",
  edit: "m4 16-1 5 5-1L20 8l-4-4L4 16Zm10-10 4 4",
  chevron: "m6 9 6 6 6-6",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
  calendar: "M4 6h16v14H4zM8 4v4m8-4v4M4 10h16",
};

export default function SleepyIcon({ name, className }: { name: keyof typeof paths; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={paths[name]} />
  </svg>;
}
