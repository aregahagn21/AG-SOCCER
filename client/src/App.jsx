
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = (
  import.meta.env.VITE_API_BASE || "https://ag-soccer1-3.onrender.com"
).replace(/\/$/, "");

const NAV_ITEMS = [
  { id: "home", label: "Matches", icon: "⚽" },
  { id: "live", label: "Live", icon: "🔴" },
  { id: "leagues", label: "Leagues", icon: "🏆" },
  { id: "news", label: "News", icon: "📰" },
];

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }

  return data;
}

function todayString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatDate(date, options = {}) {
  if (!date) return "Date unavailable";

  return new Date(date).toLocaleString("en-GB", {
    timeZone: "Africa/Addis_Ababa",
    ...options,
  });
}

function getStatus(match) {
  return (
    match?.state?.description ||
    match?.state?.status ||
    match?.status ||
    "Scheduled"
  );
}

function isLiveMatch(match) {
  const status = getStatus(match).toLowerCase();
  return (
    status.includes("live") ||
    status.includes("in play") ||
    status.includes("in progress") ||
    status.includes("1st half") ||
    status.includes("2nd half") ||
    status.includes("half time") ||
    status.includes("halftime") ||
    status.includes("extra time") ||
    status.includes("penalties")
  );
}

function matchScore(match) {
  const score = match?.state?.score?.current;
  const fullTime = match?.score?.fullTime;

  const home = score?.home ?? fullTime?.home;
  const away = score?.away ?? fullTime?.away;

  if (home == null && away == null) return "vs";
  return `${home ?? 0} - ${away ?? 0}`;
}

function normalizeStandings(payload) {
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => {
      if (Array.isArray(item?.standings)) {
        return item.standings.map((row) => ({
          ...row,
          groupName: item.name || item.groupName || "",
        }));
      }
      return [item];
    });
  }

  if (Array.isArray(payload?.standings)) {
    return normalizeStandings(payload.standings);
  }

  if (Array.isArray(payload?.groups)) {
    return normalizeStandings(payload.groups);
  }

  return [];
}

function App() {
  const [view, setView] = useState("home");
  const [date, setDate] = useState(todayString());
  const [matches, setMatches] = useState([]);
  const [liveMatches, setLiveMatches] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [news, setNews] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [detailData, setDetailData] = useState({});
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [leagueTab, setLeagueTab] = useState("matches");
  const [leagueData, setLeagueData] = useState([]);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [newsForm, setNewsForm] = useState({
    title: "",
    summary: "",
    image: "",
    url: "",
    category: "Football",
  });
  const [publishing, setPublishing] = useState(false);
  const [newsMessage, setNewsMessage] = useState("");

  const loadMatches = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const result = await apiRequest(
        `/api/matches?date=${encodeURIComponent(date)}`
      );
      setMatches(result.matches || []);
    } catch (err) {
      setMatches([]);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [date]);

  const loadLive = useCallback(async () => {
    try {
      const result = await apiRequest("/api/live");
      setLiveMatches(result.matches || []);
    } catch (err) {
      setLiveMatches([]);
      setError((old) => old || err.message);
    }
  }, []);

  const loadLeagues = useCallback(async () => {
    try {
      const result = await apiRequest("/api/leagues");
      setLeagues(result.leagues || []);
    } catch (err) {
      setLeagues([]);
      setError((old) => old || err.message);
    }
  }, []);

  const loadNews = useCallback(async () => {
    try {
      const result = await apiRequest("/api/news");
      setNews(result.news || []);
    } catch (err) {
      setNews([]);
      setError((old) => old || err.message);
    }
  }, []);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  useEffect(() => {
    loadLive();
    loadLeagues();
    loadNews();
  }, [loadLive, loadLeagues, loadNews]);

  const groupedMatches = useMemo(() => {
    const groups = new Map();

    for (const match of matches) {
      const name = match?.league?.name || match?.competition?.name || "Other matches";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(match);
    }

    return [...groups.entries()];
  }, [matches]);

  async function openMatch(match) {
    setSelectedMatch(match);
    setDetailTab("overview");
    setDetailData({});
    setView("match");
    setError("");

    try {
      const result = await apiRequest(`/api/matches/${match.id}`);
      setSelectedMatch(result.match || match);
    } catch {
      // Keep the match card's existing details if the provider has no full record.
    }
  }

  useEffect(() => {
    if (!selectedMatch || view !== "match" || detailTab === "overview") return;

    let cancelled = false;

    async function loadDetail() {
      setLoading(true);
      setError("");

      try {
        const result = await apiRequest(
          `/api/matches/${selectedMatch.id}/${detailTab}`
        );

        if (!cancelled) setDetailData((old) => ({ ...old, [detailTab]: result }));
      } catch (err) {
        if (!cancelled) {
          setDetailData((old) => ({ ...old, [detailTab]: null }));
          setError(err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedMatch, view, detailTab]);

  async function openLeague(league) {
    setSelectedLeague(league);
    setLeagueTab("matches");
    setLeagueData([]);
    setView("league");
    setError("");

    if (!league.currentSeasonAvailable || league.currentSeason == null) {
      setError(
        `No current season is listed for ${league.name}. Old seasons will not be shown as current.`
      );
      return;
    }

    await loadLeagueSection(league, "matches");
  }

  async function loadLeagueSection(league, tab) {
    if (!league?.id) return;

    if (!league.currentSeasonAvailable || league.currentSeason == null) {
      setLeagueData([]);
      setError(`Current season data is unavailable for ${league.name}.`);
      return;
    }

    setLeagueLoading(true);
    setError("");

    try {
      const result = await apiRequest(
        `/api/leagues/${league.id}/${tab}?season=${league.currentSeason}`
      );

      if (tab === "standings") {
        setLeagueData(normalizeStandings(result.standings));
      } else {
        setLeagueData(
          result.matches || result.teams || result.scorers || []
        );
      }
    } catch (err) {
      setLeagueData([]);
      setError(err.message);
    } finally {
      setLeagueLoading(false);
    }
  }

  async function chooseLeagueTab(tab) {
    setLeagueTab(tab);
    if (selectedLeague) await loadLeagueSection(selectedLeague, tab);
  }

  async function publishNews(event) {
    event.preventDefault();
    setPublishing(true);
    setNewsMessage("");

    try {
      const result = await apiRequest("/api/news", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({
          ...newsForm,
          description: newsForm.summary,
          source: "AG SOCCER",
          publishedAt: new Date().toISOString(),
        }),
      });

      if (result.article) {
        setNews((old) => [result.article, ...old]);
      } else {
        await loadNews();
      }

      setNewsForm({
        title: "",
        summary: "",
        image: "",
        url: "",
        category: "Football",
      });
      setNewsMessage("Article published successfully.");
    } catch (err) {
      setNewsMessage(err.message);
    } finally {
      setPublishing(false);
    }
  }

  function goBack() {
    if (view === "match") {
      setView("home");
    } else if (view === "league") {
      setView("leagues");
    } else {
      setView("home");
    }
    setError("");
  }

  function renderMatchCard(match) {
    const live = isLiveMatch(match);
    const home = match.homeTeam || {};
    const away = match.awayTeam || {};
    const leagueName = match.league?.name || match.competition?.name;

    return (
      <button
        type="button"
        className="match-card"
        key={match.id}
        onClick={() => openMatch(match)}
      >
        <div className="match-card-top">
          <span>{formatDate(match.date, { hour: "2-digit", minute: "2-digit" })}</span>
          <span className={live ? "status live-status" : "status"}>
            {getStatus(match)}
          </span>
        </div>

        <div className="match-teams">
          <div className="team-side">
            <img src={home.logo || "/club-placeholder.svg"} alt="" />
            <span>{home.name || "Home team"}</span>
          </div>

          <strong className="match-score">{matchScore(match)}</strong>

          <div className="team-side away-side">
            <img src={away.logo || "/club-placeholder.svg"} alt="" />
            <span>{away.name || "Away team"}</span>
          </div>
        </div>

        <div className="match-card-bottom">
          <span>{leagueName || "Football"}</span>
          <span>Details ↗</span>
        </div>
      </button>
    );
  }

  function renderHome() {
    return (
      <>
        <section className="hero">
          <div>
            <p className="eyebrow">YOUR FOOTBALL HUB</p>
            <h1>Every match.<br /><span>Every moment.</span></h1>
            <p className="hero-copy">
              Fixtures, scores, standings, and football news in one place.
            </p>
          </div>
          <div className="hero-ball" aria-hidden="true">⚽</div>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="eyebrow">FIXTURES</p>
              <h2>Match schedule</h2>
            </div>
            <button className="text-button" onClick={() => setView("live")}>
              Live matches →
            </button>
          </div>

          <div className="date-navigation">
            <button aria-label="Previous day" onClick={() => setDate(shiftDate(date, -1))}>
              ‹
            </button>
            <div>
              <strong>
                {date === todayString()
                  ? "Today"
                  : formatDate(`${date}T12:00:00`, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
              </strong>
              <span>{date}</span>
            </div>
            <button aria-label="Next day" onClick={() => setDate(shiftDate(date, 1))}>
              ›
            </button>
            <button className="today-button" onClick={() => setDate(todayString())}>
              Today
            </button>
          </div>

          {loading && <p className="info-message">Loading matches…</p>}

          {!loading && matches.length === 0 && (
            <div className="empty-state">
              <span>⚽</span>
              <h3>No matches found</h3>
              <p>There may be no scheduled matches on this date, or the provider may not include them in your plan.</p>
            </div>
          )}

          <div className="match-groups">
            {groupedMatches.map(([leagueName, leagueMatches]) => (
              <section className="match-group" key={leagueName}>
                <h3>{leagueName}</h3>
                {leagueMatches.map(renderMatchCard)}
              </section>
            ))}
          </div>
        </section>
      </>
    );
  }

  function renderLive() {
    return (
      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LIVE CENTER</p>
            <h2><span className="live-dot" /> Live matches</h2>
          </div>
          <button className="text-button" onClick={loadLive}>Refresh ↻</button>
        </div>

        {liveMatches.length === 0 ? (
          <div className="empty-state">
            <span>🔴</span>
            <h3>No live matches right now</h3>
            <p>Live matches appear here when the provider reports an in-progress status.</p>
          </div>
        ) : (
          <div className="match-groups">
            {liveMatches.map(renderMatchCard)}
          </div>
        )}
      </section>
    );
  }

  function renderLeagues() {
    return (
      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">COMPETITIONS</p>
            <h2>Explore leagues</h2>
          </div>
          <button className="text-button" onClick={loadLeagues}>Refresh ↻</button>
        </div>

        <div className="league-grid">
          {leagues.map((league) => (
            <button
              type="button"
              className="league-card"
              key={league.id}
              onClick={() => openLeague(league)}
            >
              <img src={league.logo || "/club-placeholder.svg"} alt="" />
              <span className="league-card-name">{league.name}</span>
              <span className="league-country">{league.country?.name || "International"}</span>
              <span className="season-chip">
                {league.currentSeasonAvailable
                  ? `Season ${league.currentSeason}`
                  : "Current season unavailable"}
              </span>
            </button>
          ))}
        </div>

        {leagues.length === 0 && (
          <div className="empty-state">
            <h3>No competitions loaded</h3>
            <p>Check the backend and Highlightly API configuration.</p>
          </div>
        )}
      </section>
    );
  }

  function renderNews() {
    return (
      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LATEST UPDATES</p>
            <h2>Football news</h2>
          </div>
          <button
            className="admin-toggle"
            onClick={() => {
              setAdminOpen((old) => !old);
              setNewsMessage("");
            }}
          >
            {adminOpen ? "Close admin" : "＋ Admin News"}
          </button>
        </div>

        {adminOpen && (
          <form className="admin-form" onSubmit={publishNews}>
            <div>
              <p className="eyebrow">ADMIN AREA</p>
              <h3>Publish an article</h3>
              <p className="muted">
                Only users with your server's ADMIN_KEY can publish news.
              </p>
            </div>

            <label>
              Admin secret
              <input
                type="password"
                autoComplete="current-password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                required
                placeholder="Enter your private admin key"
              />
            </label>

            <label>
              Headline
              <input
                value={newsForm.title}
                onChange={(e) => setNewsForm({ ...newsForm, title: e.target.value })}
                required
                maxLength={180}
                placeholder="Enter a news headline"
              />
            </label>

            <label>
              Summary
              <textarea
                value={newsForm.summary}
                onChange={(e) => setNewsForm({ ...newsForm, summary: e.target.value })}
                required
                maxLength={3000}
                placeholder="Write your article summary"
              />
            </label>

            <label>
              Image URL (optional)
              <input
                type="url"
                value={newsForm.image}
                onChange={(e) => setNewsForm({ ...newsForm, image: e.target.value })}
                placeholder="https://example.com/image.jpg"
              />
            </label>

            <label>
              Article URL (optional)
              <input
                type="url"
                value={newsForm.url}
                onChange={(e) => setNewsForm({ ...newsForm, url: e.target.value })}
                placeholder="https://example.com/article"
              />
            </label>

            <label>
              Category
              <select
                value={newsForm.category}
                onChange={(e) => setNewsForm({ ...newsForm, category: e.target.value })}
              >
                <option>Football</option>
                <option>Premier League</option>
                <option>Champions League</option>
                <option>La Liga</option>
                <option>Transfers</option>
                <option>International</option>
              </select>
            </label>

            <button className="primary-button" type="submit" disabled={publishing}>
              {publishing ? "Publishing…" : "Publish News"}
            </button>
            {newsMessage && <p className="form-message" role="status">{newsMessage}</p>}
          </form>
        )}

        <div className="news-grid">
          {news.map((article) => (
            <article className="news-card" key={article.id}>
              {article.image && (
                <img className="news-image" src={article.image} alt="" />
              )}
              <div className="news-content">
                <span className="news-category">{article.category || "Football"}</span>
                <h3>{article.title}</h3>
                <p>{article.summary || article.description}</p>
                <div className="news-footer">
                  <span>{article.source || "AG SOCCER"}</span>
                  <span>{formatDate(article.publishedAt, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}</span>
                </div>
                {article.url && (
                  <a href={article.url} target="_blank" rel="noreferrer">
                    Read article ↗
                  </a>
                )}
                {adminOpen && (
                  <button
                    type="button"
                    className="delete-news"
                    onClick={async () => {
                      if (!window.confirm("Delete this article?")) return;
                      try {
                        await apiRequest(`/api/news/${article.id}`, {
                          method: "DELETE",
                          headers: { "x-admin-key": adminKey },
                        });
                        setNews((old) => old.filter((item) => item.id !== article.id));
                        setNewsMessage("Article deleted.");
                      } catch (err) {
                        setNewsMessage(err.message);
                      }
                    }}
                  >
                    Delete article
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>

        {news.length === 0 && (
          <div className="empty-state">
            <span>📰</span>
            <h3>No articles published yet</h3>
            <p>Use Admin News to add your first article.</p>
          </div>
        )}
      </section>
    );
  }

  function renderMatchDetails() {
    const match = selectedMatch;
    if (!match) return null;

    const home = match.homeTeam || {};
    const away = match.awayTeam || {};
    const data = detailData[detailTab];

    return (
      <section className="section-block">
        <button className="back-button" onClick={goBack}>← Back</button>

        <div className="match-hero">
          <p className="eyebrow">{match.league?.name || match.competition?.name}</p>
          <p className="muted">{formatDate(match.date, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}</p>

          <div className="match-hero-teams">
            <div>
              <img src={home.logo || "/club-placeholder.svg"} alt="" />
              <h3>{home.name}</h3>
            </div>
            <strong>{matchScore(match)}</strong>
            <div>
              <img src={away.logo || "/club-placeholder.svg"} alt="" />
              <h3>{away.name}</h3>
            </div>
          </div>
          <span className={isLiveMatch(match) ? "status live-status" : "status"}>
            {getStatus(match)}
          </span>
        </div>

        <div className="detail-tabs">
          {["overview", "events", "lineups", "statistics"].map((tab) => (
            <button
              key={tab}
              className={detailTab === tab ? "active" : ""}
              onClick={() => setDetailTab(tab)}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {detailTab === "overview" ? (
          <div className="detail-panel">
            <h3>Match information</h3>
            <p><strong>Competition:</strong> {match.league?.name || match.competition?.name || "Unknown"}</p>
            <p><strong>Kickoff:</strong> {formatDate(match.date, {
              hour: "2-digit",
              minute: "2-digit",
              timeZoneName: "short",
            })}</p>
            <p><strong>Status:</strong> {getStatus(match)}</p>
            <p><strong>Score:</strong> {matchScore(match)}</p>
          </div>
        ) : loading ? (
          <p className="info-message">Loading {detailTab}…</p>
        ) : data == null ? (
          <div className="empty-state">
            <h3>{detailTab[0].toUpperCase() + detailTab.slice(1)} unavailable</h3>
            <p>The provider may not supply this information for this match or your plan.</p>
          </div>
        ) : (
          <pre className="data-panel">{JSON.stringify(
            data[detailTab] ?? data.events ?? data.lineups ?? data.statistics ?? data,
            null,
            2
          )}</pre>
        )}
      </section>
    );
  }

  function renderLeagueDetails() {
    if (!selectedLeague) return null;

    return (
      <section className="section-block">
        <button className="back-button" onClick={goBack}>← All leagues</button>

        <div className="league-detail-heading">
          <img src={selectedLeague.logo || "/club-placeholder.svg"} alt="" />
          <div>
            <p className="eyebrow">{selectedLeague.country?.name || "Competition"}</p>
            <h2>{selectedLeague.name}</h2>
            <p className="muted">
              {selectedLeague.currentSeasonAvailable
                ? `Season ${selectedLeague.currentSeason}`
                : "Current season unavailable"}
            </p>
          </div>
        </div>

        <div className="detail-tabs">
          {["matches", "standings", "teams", "scorers"].map((tab) => (
            <button
              key={tab}
              className={leagueTab === tab ? "active" : ""}
              onClick={() => chooseLeagueTab(tab)}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {leagueLoading && <p className="info-message">Loading {leagueTab}…</p>}

        {!leagueLoading && leagueTab === "matches" && (
          leagueData.length
            ? leagueData.map(renderMatchCard)
            : <p className="empty-inline">No fixtures available for this season.</p>
        )}

        {!leagueLoading && leagueTab === "standings" && (
          leagueData.length ? (
            <div className="table-scroll">
              <table className="standings-table">
                <thead>
                  <tr>
                    <th>#</th><th>Team</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {leagueData.map((row, index) => {
                    const stats = row.total || row;
                    return (
                      <tr key={row.team?.id || index}>
                        <td>{row.position || index + 1}</td>
                        <td className="standing-team">
                          {row.team?.logo && <img src={row.team.logo} alt="" />}
                          {row.team?.name || row.name || "Team"}
                        </td>
                        <td>{stats.games ?? stats.played ?? 0}</td>
                        <td>{stats.wins ?? 0}</td>
                        <td>{stats.draws ?? 0}</td>
                        <td>{stats.loses ?? stats.losses ?? 0}</td>
                        <td>{stats.scoredGoals ?? stats.goalsFor ?? 0}</td>
                        <td>{stats.receivedGoals ?? stats.goalsAgainst ?? 0}</td>
                        <td><strong>{row.points ?? stats.points ?? 0}</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="empty-inline">No standings available for this season.</p>
        )}

        {!leagueLoading && leagueTab === "teams" && (
          <div className="team-grid">
            {leagueData.map((team) => {
              const item = team.team || team;
              return (
                <div className="team-card" key={item.id || item.name}>
                  <img src={item.logo || "/club-placeholder.svg"} alt="" />
                  <span>{item.name}</span>
                </div>
              );
            })}
            {!leagueData.length && <p className="empty-inline">No teams available.</p>}
          </div>
        )}

        {!leagueLoading && leagueTab === "scorers" && (
          leagueData.length ? (
            <div className="scorer-list">
              {leagueData.map((player, index) => (
                <div className="scorer-row" key={player.id || index}>
                  <strong>{index + 1}</strong>
                  <span>{player.name || player.player?.name || "Player"}</span>
                  <strong>{player.goals ?? player.statistics?.goals ?? "—"}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-inline">
              Top scorers are not connected yet for this API integration.
            </p>
          )
        )}
      </section>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setView("home")} aria-label="AG SOCCER home">
          <span className="brand-icon">AG</span>
          <span>AG <strong>SOCCER</strong></span>
        </button>
        <span className="header-tag">FOOTBALL CENTRAL</span>
      </header>

      <main className="main-content">
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Dismiss error">×</button>
          </div>
        )}

        {view === "home" && renderHome()}
        {view === "live" && renderLive()}
        {view === "leagues" && renderLeagues()}
        {view === "news" && renderNews()}
        {view === "match" && renderMatchDetails()}
        {view === "league" && renderLeagueDetails()}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => {
              setView(item.id);
              setError("");
              if (item.id === "news") loadNews();
              if (item.id === "leagues") loadLeagues();
              if (item.id === "live") loadLive();
            }}
          >
            <span>{item.icon}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;
