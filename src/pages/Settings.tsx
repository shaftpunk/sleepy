import { useAppStore } from "../stores/appStore";
import NotificationSettings from "../components/NotificationSettings";

export default function Settings() {
  const currentBbyId = useAppStore(
    (state) => state.currentBbyId,
  );

  const setBbyId = useAppStore(
    (state) => state.setBbyId,
  );

  const theme = useAppStore(
    (state) => state.theme,
  );

  const toggleTheme = useAppStore(
    (state) => state.toggleTheme,
  );

  const babies = useAppStore(
    (state) => state.babies,
  );

  const currentBabyId = useAppStore(
    (state) => state.currentBabyId,
  );

  const setCurrentBabyId = useAppStore(
    (state) => state.setCurrentBabyId,
  );

  const selectedBaby =
    babies.find(
      (baby) => baby.id === currentBabyId,
    ) ?? null;

  return (
    <main className="settings-page">
      <header className="page-header">
        <p className="eyebrow">Sleepy</p>

        <h1>Settings</h1>

        <p className="page-description">
          Choose your baby, legacy data profile
          and how Sleepy should look on this
          device.
        </p>
      </header>

      <section className="settings-card">
        <div className="setting-copy">
          <p className="setting-title">
            Baby
          </p>

          <p className="muted">
            Sleepy 3.0 baby profile
          </p>

          {selectedBaby?.birth_date && (
            <p className="muted">
              Date of birth:{" "}
              {selectedBaby.birth_date}
            </p>
          )}
        </div>

        {babies.length > 0 ? (
          <select
            className="settings-select"
            value={currentBabyId ?? ""}
            onChange={(event) =>
              setCurrentBabyId(
                event.target.value,
              )
            }
          >
            {babies.map((baby) => (
              <option
                key={baby.id}
                value={baby.id}
              >
                {baby.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="muted">
            No babies found.
          </p>
        )}
      </section>

      <section className="settings-card">
        <div className="setting-copy">
          <p className="setting-title">
            Location
          </p>

          <p className="muted">
            Legacy Sleepy data profile.
            Sleep and feeding data still use
            this selection during migration.
          </p>
        </div>

        <select
          className="settings-select"
          value={currentBbyId}
          onChange={(event) =>
            setBbyId(
              event.target.value as
                | "Hamar"
                | "Drammen",
            )
          }
        >
          <option value="Hamar">
            Hamar
          </option>

          <option value="Drammen">
            Drammen
          </option>
        </select>
      </section>

      <section className="settings-card">
        <div className="setting-copy">
          <p className="setting-title">
            Appearance
          </p>

          <p className="muted">
            Current theme:{" "}
            {theme === "dark"
              ? "Dark"
              : "Light"}
          </p>
        </div>

        <button
          className="secondary-button"
          onClick={toggleTheme}
        >
          {theme === "dark"
            ? "Use light mode"
            : "Use dark mode"}
        </button>
      </section>

      <NotificationSettings
        bbyid={currentBbyId}
      />

      <section className="settings-card">
        <div className="setting-copy">
          <p className="setting-title">
            About
          </p>

          <p className="muted">
            Sleepy 2.2.0 - Multi-user migration
          </p>
        </div>
      </section>
    </main>
  );
}