import { useAppStore } from "../stores/appStore";

export default function Settings() {
  const currentBbyId = useAppStore((state) => state.currentBbyId);
  const setBbyId = useAppStore((state) => state.setBbyId);

  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);

  return (
    <main className="settings-page">
      <header className="page-header">
        <p className="eyebrow">Sleepy</p>
        <h1>Settings</h1>
        <p className="page-description">
          Choose which profile to show and how Sleepy should look on this device.
        </p>
      </header>

      <section className="settings-card">
        <div className="setting-copy">
          <p className="setting-title">Location</p>
          <p className="muted">
            Sleep and feeding data will later be filtered by this selection.
          </p>
        </div>

        <select
          className="settings-select"
          value={currentBbyId}
          onChange={(event) =>
            setBbyId(event.target.value as "Hamar" | "Drammen")
          }
        >
          <option value="Hamar">Hamar</option>
          <option value="Drammen">Drammen</option>
        </select>
      </section>

      <section className="settings-card">
        <div className="setting-copy">
          <p className="setting-title">Appearance</p>
          <p className="muted">
            Current theme: {theme === "dark" ? "Dark" : "Light"}
          </p>
        </div>

        <button className="secondary-button" onClick={toggleTheme}>
          {theme === "dark" ? "Use light mode" : "Use dark mode"}
        </button>
      </section>

      <section className="settings-card">
        <div className="setting-copy">
          <p className="setting-title">About</p>
          <p className="muted">Sleepy 2.0 · Phase 1</p>
        </div>
      </section>
    </main>
  );
}