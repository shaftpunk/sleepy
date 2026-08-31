export default function About() {
    return (
      <main className="about-page">
        <header className="page-header">
          <p className="eyebrow">Sleepy</p>
          <h1>About</h1>
          <p className="page-description">
            A quiet little control center for sleep and feeding.
          </p>
        </header>
  
        <section className="about-hero">
          <div className="about-moon">☾</div>
          <h2>Sleepy 2.0</h2>
          <h2>v.2.2.0</h2>
          <p>Sleep. Feed. Understand the rhythm.</p>
        </section>
  
        <section className="settings-card">
          <div className="setting-copy">
            <p className="setting-title">Sleep tracking</p>
            <p className="muted">
              Start and stop sleep with a live timer, realtime
              synchronization and editable history.
            </p>
          </div>
        </section>
  
        <section className="settings-card">
          <div className="setting-copy">
            <p className="setting-title">Feeding</p>
            <p className="muted">
              Register bottle, breastfeeding and food with
              history and notes.
            </p>
          </div>
        </section>
  
        <section className="settings-card">
          <div className="setting-copy">
            <p className="setting-title">Analysis</p>
            <p className="muted">
              Sleep totals, feeding totals and daily trends
              based on live data.
            </p>
          </div>
        </section>
  
        <section className="settings-card">
          <div className="setting-copy">
            <p className="setting-title">Realtime</p>
            <p className="muted">
              Changes synchronize between connected devices
              automatically.
            </p>
          </div>
        </section>
  
        <section className="settings-card">
          <div className="setting-copy">
            <p className="setting-title">Profiles</p>
            <p className="muted">
              Hamar and Drammen keep separate sleep and feeding
              data.
            </p>
          </div>
        </section>
  
        <p className="about-version">
          Sleepy 2.0 · PWA
        </p>
      </main>
    );
  }