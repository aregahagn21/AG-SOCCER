import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = "http://localhost:5000";

const LIVE_STATUSES = [
  "IN_PLAY",
  "PAUSED",
  "EXTRA_TIME",
  "PENALTY_SHOOTOUT",
];

const LEAGUE_PRIORITY = [
  "CL",
  "PL",
  "PD",
  "BL1",
  "SA",
  "FL1",
  "PPL",
  "DED",
  "EL",
  "EC",
  "WC",
];

const TEXT = {
  en: {
    home: "Home",
    live: "Live",
    matches: "Matches",
    leagues: "Leagues",
    search: "Search",
    loading: "Loading matches...",
    noMatches: "No matches found",
    yesterday: "Yesterday",
    today: "Today",
    tomorrow: "Tomorrow",
    liveNow: "LIVE",
    overview: "Overview",
    events: "Events",
    lineups: "Lineups",
    statistics: "Statistics",
    standings: "Standings",
    teams: "Teams",
    scorers: "Top scorers",
    back: "Back",
    goals: "Goals",
    cards: "Cards",
    matchEvents: "Match events",
    noData: "No data available",
    searchPlaceholder: "Search teams or competitions...",
    chooseDate: "Choose date",
    allMatches: "All matches",
    scheduled: "Scheduled",
    finished: "Finished",
    upcoming: "Upcoming",
    error: "Could not load data",
    retry: "Try again",
    played: "Played",
    won: "Won",
    drawn: "Drawn",
    lost: "Lost",
    points: "Points",
    goalDifference: "GD",
    position: "Pos",
    competition: "Competition",
    venue: "Venue",
    matchday: "Matchday",
    kickOff: "Kick-off",
    refresh: "Refresh",
    noLeagues: "No competitions available",
    noStandings: "Standings are not available for this competition.",
    noLineups: "Lineups are not provided by this data source for this match.",
    noStatistics: "Match statistics are not available from this data source.",
    selectLeague: "Select a competition to view its matches and standings.",
    language: "አማ",
    all: "All",
    matchDetails: "Match details",
    date: "Date",
  },
  am: {
    home: "መነሻ",
    live: "ቀጥታ",
    matches: "ጨዋታዎች",
    leagues: "ሊጎች",
    search: "ፈልግ",
    loading: "ጨዋታዎች በመጫን ላይ...",
    noMatches: "ምንም ጨዋታዎች አልተገኙም",
    yesterday: "ትናንት",
    today: "ዛሬ",
    tomorrow: "ነገ",
    liveNow: "ቀጥታ",
    overview: "አጠቃላይ",
    events: "ክስተቶች",
    lineups: "አሰላለፍ",
    statistics: "ስታቲስቲክስ",
    standings: "ደረጃዎች",
    teams: "ቡድኖች",
    scorers: "ከፍተኛ ግብ አግቢዎች",
    back: "ተመለስ",
    goals: "ጎሎች",
    cards: "ካርዶች",
    matchEvents: "የጨዋታ ክስተቶች",
    noData: "መረጃ አልተገኘም",
    searchPlaceholder: "ቡድኖችን ወይም ሊጎችን ፈልግ...",
    chooseDate: "ቀን ምረጥ",
    allMatches: "ሁሉም ጨዋታዎች",
    scheduled: "የታቀዱ",
    finished: "የተጠናቀቁ",
    upcoming: "የሚቀጥሉ",
    error: "መረጃውን መጫን አልተቻለም",
    retry: "እንደገና ሞክር",
    played: "ተጫውቷል",
    won: "አሸንፏል",
    drawn: "አቻ",
    lost: "ተሸንፏል",
    points: "ነጥብ",
    goalDifference: "የግብ ልዩነት",
    position: "ደረጃ",
    competition: "ውድድር",
    venue: "ስታዲየም",
    matchday: "የጨዋታ ቀን",
    kickOff: "የመጀመሪያ ሰዓት",
    refresh: "አድስ",
    noLeagues: "ምንም ውድድሮች አልተገኙም",
    noStandings: "የዚህ ውድድር ደረጃዎች አይገኙም።",
    noLineups: "የዚህ ጨዋታ አሰላለፍ አልቀረበም።",
    noStatistics: "የጨዋታ ስታቲስቲክስ አይገኝም።",
    selectLeague: "ጨዋታዎችንና ደረጃዎችን ለማየት ውድድር ምረጥ።",
    language: "EN",
    all: "ሁሉም",
    matchDetails: "የጨዋታ ዝርዝር",
    date: "ቀን",
  },
};

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

function formatDate(dateKey, language = "en") {
  const date = new Date(`${dateKey}T12:00:00`);
  return new Intl.DateTimeFormat(language === "am" ? "am-ET" : "en-GB", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatFullDate(value, language = "en") {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(language === "am" ? "am-ET" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatKickoff(value, language = "en") {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(language === "am" ? "am-ET" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isLive(match) {
  return LIVE_STATUSES.includes(match?.status);
}

function getLiveLabel(match, t) {
  if (match?.status === "PAUSED") return "HT";
  if (match?.status === "PENALTY_SHOOTOUT") return "PEN";
  if (match?.status === "EXTRA_TIME") {
    return match?.minute ? `${match.minute}' ET` : "ET";
  }
  if (match?.minute != null) return `${match.minute}'`;
  return t.liveNow;
}

function getScore(match) {
  const score = match?.score?.fullTime || {};
  const home = score.home;
  const away = score.away;

  if (home == null || away == null) {
    const halfTime = match?.score?.halfTime || {};
    if (halfTime.home != null && halfTime.away != null) {
      return `${halfTime.home} - ${halfTime.away}`;
    }
    return "—";
  }

  return `${home} - ${away}`;
}

function getMatchStatus(match, t) {
  if (isLive(match)) return getLiveLabel(match, t);

  switch (match?.status) {
    case "FINISHED":
      return t.finished;
    case "SCHEDULED":
    case "TIMED":
      return formatKickoff(match?.utcDate);
    case "POSTPONED":
      return "Postponed";
    case "CANCELLED":
      return "Cancelled";
    case "SUSPENDED":
      return "Suspended";
    case "AWARDED":
      return "Awarded";
    default:
      return match?.status || "—";
  }
}

function getMatchList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload?.data?.matches)) return payload.data.matches;
  return [];
}

function getCompetitionList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.competitions)) return payload.competitions;
  if (Array.isArray(payload?.data?.competitions)) return payload.data.competitions;
  return [];
}

function getStandingsTable(payload) {
  if (Array.isArray(payload?.standings)) {
    const total = payload.standings.find((item) => item.type === "TOTAL");
    return total?.table || payload.standings[0]?.table || [];
  }
  if (Array.isArray(payload?.table)) return payload.table;
  if (Array.isArray(payload?.standings?.table)) return payload.standings.table;
  return [];
}

async function apiRequest(path) {
  const response = await fetch(`${API_BASE}${path}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.success === false) {
    throw new Error(
      payload?.message ||
        payload?.error?.message ||
        `Request failed (${response.status})`
    );
  }

  return payload;
}

function Crest({ src, name, small = false }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <span className={`crest-fallback ${small ? "crest-small" : ""}`}>
        ⚽
      </span>
    );
  }

  return (
    <img
      className={`team-crest ${small ? "crest-small" : ""}`}
      src={src}
      alt={`${name || "Team"} crest`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function EmptyState({ children }) {
  return <div className="empty-state">{children}</div>;
}

function LoadingState({ children }) {
  return (
    <div className="loading-state">
      <span className="loading-spinner" />
      <span>{children}</span>
    </div>
  );
}

function MatchCard({ match, onOpen, t, language }) {
  const home = match?.homeTeam || {};
  const away = match?.awayTeam || {};
  const live = isLive(match);
  const score = getScore(match);

  return (
    <button className="match-card" onClick={() => onOpen(match)} type="button">
      <div className="match-card-top">
        <span className="match-competition">
          {match?.competition?.emblem && (
            <Crest
              src={match.competition.emblem}
              name={match.competition.name}
              small
            />
          )}
          {match?.competition?.name || "Football"}
        </span>
        <span className={`match-status ${live ? "status-live" : ""}`}>
          {live && <span className="live-dot" />}
          {getMatchStatus(match, t)}
        </span>
      </div>

      <div className="match-teams">
        <div className="match-team">
          <Crest src={home.crest} name={home.name} />
          <span className="team-name">{home.name || "Home team"}</span>
        </div>

        <div className={`match-score ${live ? "score-live" : ""}`}>
          {score}
        </div>

        <div className="match-team">
          <Crest src={away.crest} name={away.name} />
          <span className="team-name">{away.name || "Away team"}</span>
        </div>
      </div>

      <div className="match-card-bottom">
        <span>{match?.stage?.replaceAll("_", " ") || ""}</span>
        <span>{formatKickoff(match?.utcDate, language)}</span>
        <span className="match-open-arrow">›</span>
      </div>
    </button>
  );
}

function App() {
  const [language, setLanguage] = useState("en");
  const [darkMode, setDarkMode] = useState(true);
  const [view, setView] = useState("home");
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [matches, setMatches] = useState([]);
  const [liveMatches, setLiveMatches] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [leagueMatches, setLeagueMatches] = useState([]);
  const [leagueStandings, setLeagueStandings] = useState([]);
  const [leagueTeams, setLeagueTeams] = useState([]);
  const [leagueScorers, setLeagueScorers] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [matchDetails, setMatchDetails] = useState(null);
  const [detailsTab, setDetailsTab] = useState("overview");
  const [leagueTab, setLeagueTab] = useState("matches");
  const [searchText, setSearchText] = useState("");
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [loadingLive, setLoadingLive] = useState(false);
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [loadingLeagueDetails, setLoadingLeagueDetails] = useState(false);
  const [loadingMatchDetails, setLoadingMatchDetails] = useState(false);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [leaguesError, setLeaguesError] = useState("");
  const [detailError, setDetailError] = useState("");

  const t = TEXT[language];

  const today = localDateKey();
  const visibleDates = useMemo(
    () => Array.from({ length: 18 }, (_, index) => addDays(today, index - 3)),
    [today]
  );

  const sortedLeagues = useMemo(() => {
    const rank = (code) => {
      const index = LEAGUE_PRIORITY.indexOf(code);
      return index === -1 ? 999 : index;
    };

    return [...leagues].sort((a, b) => {
      const priorityDifference = rank(a.code) - rank(b.code);
      if (priorityDifference !== 0) return priorityDifference;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [leagues]);

  const loadMatches = useCallback(async () => {
    setLoadingMatches(true);
    setError("");

    try {
      const data = await apiRequest(
        `/api/matches?date=${encodeURIComponent(selectedDate)}`
      );
      setMatches(getMatchList(data));
    } catch (err) {
      setMatches([]);
      setError(err.message || t.error);
    } finally {
      setLoadingMatches(false);
    }
  }, [selectedDate, t.error]);

  const loadLiveMatches = useCallback(async () => {
    setLoadingLive(true);
    setLiveError("");

    try {
      const data = await apiRequest("/api/live");
      setLiveMatches(getMatchList(data));
    } catch (err) {
      setLiveMatches([]);
      setLiveError(err.message || t.error);
    } finally {
      setLoadingLive(false);
    }
  }, [t.error]);

  const loadLeagues = useCallback(async () => {
    setLoadingLeagues(true);
    setLeaguesError("");

    try {
      const data = await apiRequest("/api/leagues");
      setLeagues(getCompetitionList(data));
    } catch (err) {
      setLeagues([]);
      setLeaguesError(err.message || t.error);
    } finally {
      setLoadingLeagues(false);
    }
  }, [t.error]);

  const loadLeagueDetails = useCallback(
    async (league, initialTab = "matches") => {
      if (!league?.code) return;

      setSelectedLeague(league);
      setLeagueTab(initialTab);
      setView("league-detail");
      setLoadingLeagueDetails(true);
      setDetailError("");
      setLeagueMatches([]);
      setLeagueStandings([]);
      setLeagueTeams([]);
      setLeagueScorers([]);

      const results = await Promise.allSettled([
        apiRequest(`/api/leagues/${encodeURIComponent(league.code)}/matches`),
        apiRequest(`/api/leagues/${encodeURIComponent(league.code)}/standings`),
        apiRequest(`/api/leagues/${encodeURIComponent(league.code)}/teams`),
        apiRequest(`/api/leagues/${encodeURIComponent(league.code)}/scorers`),
      ]);

      const [matchesResult, standingsResult, teamsResult, scorersResult] =
        results;

      if (matchesResult.status === "fulfilled") {
        setLeagueMatches(getMatchList(matchesResult.value));
      }

      if (standingsResult.status === "fulfilled") {
        setLeagueStandings(getStandingsTable(standingsResult.value));
      }

      if (teamsResult.status === "fulfilled") {
        const payload = teamsResult.value;
        setLeagueTeams(
          Array.isArray(payload?.teams)
            ? payload.teams
            : Array.isArray(payload)
              ? payload
              : []
        );
      }

      if (scorersResult.status === "fulfilled") {
        const payload = scorersResult.value;
        setLeagueScorers(
          Array.isArray(payload?.scorers)
            ? payload.scorers
            : Array.isArray(payload)
              ? payload
              : []
        );
      }

      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length === results.length) {
        setDetailError(failures[0]?.reason?.message || t.error);
      }

      setLoadingLeagueDetails(false);
    },
    [t.error]
  );

  const openMatch = useCallback(
    async (match) => {
      if (!match?.id) return;

      setSelectedMatch(match);
      setMatchDetails(null);
      setDetailsTab("overview");
      setDetailError("");
      setLoadingMatchDetails(true);
      setView("match-detail");

      try {
        const payload = await apiRequest(`/api/matches/${match.id}`);
        const detail =
          payload?.match ||
          payload?.data?.match ||
          payload?.data ||
          payload;

        setMatchDetails(detail);
      } catch (err) {
        setMatchDetails(match);
        setDetailError(err.message || t.error);
      } finally {
        setLoadingMatchDetails(false);
      }
    },
    [t.error]
  );

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  useEffect(() => {
    loadLiveMatches();

    const timer = window.setInterval(loadLiveMatches, 30000);
    return () => window.clearInterval(timer);
  }, [loadLiveMatches]);

  useEffect(() => {
    loadLeagues();
  }, [loadLeagues]);

  const allVisibleMatches = useMemo(() => {
    if (view === "live") return liveMatches;
    if (view === "league-detail") return leagueMatches;
    return matches;
  }, [view, liveMatches, leagueMatches, matches]);

  const filteredMatches = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    return [...allVisibleMatches]
      .filter((match) => {
        if (!query) return true;

        const values = [
          match?.homeTeam?.name,
          match?.awayTeam?.name,
          match?.competition?.name,
          match?.competition?.code,
        ];

        return values.some((value) =>
          String(value || "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        const aLive = isLive(a) ? 0 : 1;
        const bLive = isLive(b) ? 0 : 1;
        if (aLive !== bLive) return aLive - bLive;

        const rank = (match) => {
          const index = LEAGUE_PRIORITY.indexOf(match?.competition?.code);
          return index === -1 ? 999 : index;
        };

        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return new Date(a?.utcDate || 0) - new Date(b?.utcDate || 0);
      });
  }, [allVisibleMatches, searchText]);

  const filteredLeagues = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return sortedLeagues;

    return sortedLeagues.filter((league) =>
      [
        league.name,
        league.code,
        league.area?.name,
        league.type,
      ].some((value) => String(value || "").toLowerCase().includes(query))
    );
  }, [sortedLeagues, searchText]);

  function goTo(nextView) {
    setSearchText("");
    setView(nextView);

    if (nextView === "live") loadLiveMatches();
    if (nextView === "leagues") loadLeagues();
    if (nextView === "matches" || nextView === "home") loadMatches();
  }

  function renderDateNavigation() {
    return (
      <div className="date-navigation">
        <div className="date-strip" aria-label="Select match date">
          {visibleDates.map((dateKey) => {
            const offset = Math.round(
              (new Date(`${dateKey}T12:00:00`) -
                new Date(`${today}T12:00:00`)) /
                86400000
            );

            let label = formatDate(dateKey, language);
            if (offset === -1) label = t.yesterday;
            if (offset === 0) label = t.today;
            if (offset === 1) label = t.tomorrow;

            return (
              <button
                type="button"
                key={dateKey}
                className={`date-chip ${
                  selectedDate === dateKey ? "date-chip-active" : ""
                }`}
                onClick={() => {
                  setSelectedDate(dateKey);
                  setView("matches");
                }}
              >
                <span>{label}</span>
                <small>{dateKey.split("-")[2]}</small>
              </button>
            );
          })}
          <label className="calendar-chip" title={t.chooseDate}>
            <span>▦</span>
            <small>{t.chooseDate}</small>
            <input
              aria-label={t.chooseDate}
              type="date"
              value={selectedDate}
              onChange={(event) => {
                if (event.target.value) {
                  setSelectedDate(event.target.value);
                  setView("matches");
                }
              }}
            />
          </label>
        </div>
      </div>
    );
  }

  function renderMatchList(items, isLoading, errorMessage) {
    if (isLoading) return <LoadingState>{t.loading}</LoadingState>;

    if (errorMessage) {
      return (
        <EmptyState>
          <p>{errorMessage}</p>
          <button className="primary-button" onClick={loadMatches}>
            {t.retry}
          </button>
        </EmptyState>
      );
    }

    if (!items.length) {
      return <EmptyState>{t.noMatches}</EmptyState>;
    }

    return (
      <div className="match-list">
        {items.map((match) => (
          <MatchCard
            key={match.id}
            match={match}
            onOpen={openMatch}
            t={t}
            language={language}
          />
        ))}
      </div>
    );
  }

  function renderLeagues() {
    if (loadingLeagues) return <LoadingState>{t.loading}</LoadingState>;

    if (leaguesError) {
      return (
        <EmptyState>
          <p>{leaguesError}</p>
          <button className="primary-button" onClick={loadLeagues}>
            {t.retry}
          </button>
        </EmptyState>
      );
    }

    if (!filteredLeagues.length) {
      return <EmptyState>{t.noLeagues}</EmptyState>;
    }

    return (
      <div className="league-grid">
        {filteredLeagues.map((league) => (
          <button
            className="league-card"
            key={league.id || league.code}
            type="button"
            onClick={() => loadLeagueDetails(league)}
          >
            <div className="league-emblem">
              <Crest
                src={league.emblem}
                name={league.name}
              />
            </div>
            <div className="league-card-text">
              <strong>{league.name}</strong>
              <span>{league.area?.name || league.code}</span>
              <small>{league.currentSeason?.currentMatchday
                ? `${t.matchday} ${league.currentSeason.currentMatchday}`
                : league.type || "Competition"}</small>
            </div>
            <span className="league-arrow">›</span>
          </button>
        ))}
      </div>
    );
  }

  function renderStandings(table) {
    if (!table?.length) {
      return <EmptyState>{t.noStandings}</EmptyState>;
    }

    return (
      <div className="table-scroll">
        <table className="standings-table">
          <thead>
            <tr>
              <th>{t.position}</th>
              <th className="team-column">Team</th>
              <th>P</th>
              <th>W</th>
              <th>D</th>
              <th>L</th>
              <th>{t.goalDifference}</th>
              <th>{t.points}</th>
            </tr>
          </thead>
          <tbody>
            {table.map((row) => (
              <tr key={row.team?.id || row.position}>
                <td>{row.position}</td>
                <td className="team-column">
                  <span className="table-team">
                    <Crest
                      src={row.team?.crest}
                      name={row.team?.name}
                      small
                    />
                    {row.team?.shortName || row.team?.name || "—"}
                  </span>
                </td>
                <td>{row.playedGames ?? "—"}</td>
                <td>{row.won ?? "—"}</td>
                <td>{row.draw ?? "—"}</td>
                <td>{row.lost ?? "—"}</td>
                <td>{row.goalDifference ?? "—"}</td>
                <td className="points-cell">{row.points ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderLeagueDetail() {
    if (!selectedLeague) return <EmptyState>{t.selectLeague}</EmptyState>;

    const tabs = [
      ["matches", t.matches],
      ["standings", t.standings],
      ["teams", t.teams],
      ["scorers", t.scorers],
    ];

    return (
      <section className="page-section">
        <button className="back-button" onClick={() => goTo("leagues")}>
          ← {t.back}
        </button>

        <div className="detail-heading">
          <Crest
            src={selectedLeague.emblem}
            name={selectedLeague.name}
          />
          <div>
            <h2>{selectedLeague.name}</h2>
            <p>
              {selectedLeague.area?.name || selectedLeague.code}
              {selectedLeague.currentSeason?.startDate
                ? ` · ${selectedLeague.currentSeason.startDate.slice(0, 4)}–${selectedLeague.currentSeason.endDate?.slice(0, 4) || ""}`
                : ""}
            </p>
          </div>
        </div>

        <div className="tab-strip">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              className={leagueTab === id ? "tab-active" : ""}
              onClick={() => setLeagueTab(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        {loadingLeagueDetails ? (
          <LoadingState>{t.loading}</LoadingState>
        ) : (
          <>
            {detailError && <p className="inline-error">{detailError}</p>}

            {leagueTab === "matches" &&
              renderMatchList(leagueMatches, false, "")}

            {leagueTab === "standings" &&
              renderStandings(leagueStandings)}

            {leagueTab === "teams" &&
              (leagueTeams.length ? (
                <div className="league-grid">
                  {leagueTeams.map((team) => (
                    <div className="league-card team-card" key={team.id}>
                      <Crest src={team.crest} name={team.name} />
                      <div className="league-card-text">
                        <strong>{team.name}</strong>
                        <span>{team.shortName || team.tla || ""}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState>{t.noData}</EmptyState>
              ))}

            {leagueTab === "scorers" &&
              (leagueScorers.length ? (
                <div className="scorer-list">
                  {leagueScorers.map((item, index) => (
                    <div className="scorer-row" key={item.player?.id || index}>
                      <span className="scorer-rank">{index + 1}</span>
                      <div className="scorer-info">
                        <strong>{item.player?.name || "Unknown player"}</strong>
                        <span>
                          {item.team?.name || ""}
                          {item.penalties ? ` · ${item.penalties} penalties` : ""}
                        </span>
                      </div>
                      <strong className="scorer-goals">{item.goals ?? 0}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState>{t.noData}</EmptyState>
              ))}
          </>
        )}
      </section>
    );
  }

  function renderEvents() {
    const goals = matchDetails?.goals || [];
    const bookings = matchDetails?.bookings || [];
    const substitutions = matchDetails?.substitutions || [];

    const events = [
      ...goals.map((event) => ({ ...event, eventType: "goal" })),
      ...bookings.map((event) => ({ ...event, eventType: "card" })),
      ...substitutions.map((event) => ({
        ...event,
        eventType: "substitution",
      })),
    ].sort((a, b) => {
      const minuteA = Number.parseInt(a.minute || a.time?.minute || 0, 10);
      const minuteB = Number.parseInt(b.minute || b.time?.minute || 0, 10);
      return minuteA - minuteB;
    });

    if (!events.length) return <EmptyState>{t.noData}</EmptyState>;

    return (
      <div className="events-list">
        {events.map((event, index) => {
          const teamId = event.team?.id;
          const homeId = matchDetails?.homeTeam?.id;
          const isHome = teamId === homeId;
          const minute = event.minute ?? event.time?.minute;
          let description = "";

          if (event.eventType === "goal") {
            description = `⚽ ${event.scorer?.name || event.player?.name || "Goal"}`;
            if (event.assist?.name) description += ` · Assist: ${event.assist.name}`;
          } else if (event.eventType === "card") {
            description = `${event.card === "YELLOW_CARD" ? "🟨" : "🟥"} ${event.player?.name || "Card"}`;
          } else {
            description = `🔄 ${event.playerOut?.name || "Player out"} → ${event.playerIn?.name || "Player in"}`;
          }

          return (
            <div
              className={`event-row ${isHome ? "event-home" : "event-away"}`}
              key={`${event.eventType}-${index}`}
            >
              <span className="event-minute">
                {minute != null ? `${minute}'` : "—"}
              </span>
              <span className="event-description">{description}</span>
              <span className="event-team">
                {event.team?.shortName || event.team?.name || ""}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  function renderMatchDetail() {
    if (!selectedMatch) return null;

    const match = matchDetails || selectedMatch;
    const home = match.homeTeam || selectedMatch.homeTeam || {};
    const away = match.awayTeam || selectedMatch.awayTeam || {};
    const score = getScore(match);

    const tabs = [
      ["overview", t.overview],
      ["events", t.events],
      ["lineups", t.lineups],
      ["statistics", t.statistics],
      ["standings", t.standings],
    ];

    return (
      <section className="page-section">
        <button className="back-button" onClick={() => goTo("matches")}>
          ← {t.back}
        </button>

        <div className="match-detail-competition">
          {match.competition?.name || selectedMatch.competition?.name || "Football"}
        </div>

        <div className="match-detail-scoreboard">
          <div className="scoreboard-team">
            <Crest src={home.crest} name={home.name} />
            <strong>{home.name || "Home"}</strong>
                  <small>{home.shortName || ""}</small>
          </div>

          <div className="scoreboard-score">
            <div className={isLive(match) ? "score-live" : ""}>{score}</div>
            <span className={`match-status ${isLive(match) ? "status-live" : ""}`}>
              {getMatchStatus(match, t)}
            </span>
          </div>

          <div className="scoreboard-team">
            <Crest src={away.crest} name={away.name} />
            <strong>{away.name || "Away"}</strong>
            <small>{away.shortName || ""}</small>
          </div>
        </div>

        <p className="match-detail-date">
          {formatFullDate(match.utcDate || selectedMatch.utcDate, language)}
        </p>

        {loadingMatchDetails && <LoadingState>{t.loading}</LoadingState>}
        {detailError && <p className="inline-error">{detailError}</p>}

        <div className="tab-strip">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={detailsTab === id ? "tab-active" : ""}
              onClick={() => setDetailsTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {!loadingMatchDetails && (
          <div className="match-detail-panel">
            {detailsTab === "overview" && (
              <div className="overview-grid">
                <div className="info-card">
                  <span>{t.competition}</span>
                  <strong>{match.competition?.name || "—"}</strong>
                </div>
                <div className="info-card">
                  <span>{t.matchday}</span>
                  <strong>{match.matchday ?? "—"}</strong>
                </div>
                <div className="info-card">
                  <span>{t.venue}</span>
                  <strong>{match.venue || "—"}</strong>
                </div>
                <div className="info-card">
                  <span>{t.kickOff}</span>
                  <strong>{formatFullDate(match.utcDate, language)}</strong>
                </div>
                <div className="info-card">
                  <span>{t.goals}</span>
                  <strong>
                    {(match.goals || []).length
                      ? (match.goals || [])
                          .map((goal) => goal.scorer?.name || goal.player?.name)
                          .filter(Boolean)
                          .join(", ")
                      : t.noData}
                  </strong>
                </div>
              </div>
            )}

            {detailsTab === "events" && renderEvents()}

            {detailsTab === "lineups" && (
              <div className="lineups-grid">
                {[home, away].map((team, index) => {
                  const lineup = index === 0
                    ? match.homeTeam?.lineup || match.lineups?.home || []
                    : match.awayTeam?.lineup || match.lineups?.away || [];

                  return (
                    <div className="lineup-card" key={team.id || index}>
                      <h3>{team.name || (index === 0 ? "Home" : "Away")}</h3>
                      {Array.isArray(lineup) && lineup.length ? (
                        lineup.map((player) => (
                          <div className="lineup-player" key={player.id || player.name}>
                            <span>{player.shirtNumber ?? "—"}</span>
                            {player.name}
                          </div>
                        ))
                      ) : (
                        <p className="muted-text">{t.noLineups}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {detailsTab === "statistics" && (
              <EmptyState>{t.noStatistics}</EmptyState>
            )}

            {detailsTab === "standings" && (
              <div>
                {match.competition?.code ? (
                  <button
                    className="primary-button standings-link"
                    onClick={() =>
                      loadLeagueDetails(
                        leagues.find((item) => item.code === match.competition.code) ||
                          match.competition,
                        "standings"
                      )
                    }
                  >
                    {t.standings} · {match.competition.name}
                  </button>
                ) : (
                  <EmptyState>{t.noStandings}</EmptyState>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  function renderMainContent() {
    if (view === "match-detail") return renderMatchDetail();
    if (view === "league-detail") return renderLeagueDetail();

    if (view === "leagues") {
      return (
        <section className="page-section">
          <div className="section-heading">
            <div>
              <h2>{t.leagues}</h2>
              <p>{filteredLeagues.length} competitions</p>
            </div>
            <button className="icon-button" onClick={loadLeagues} title={t.refresh}>
              ↻
            </button>
          </div>
          {renderLeagues()}
        </section>
      );
    }

    if (view === "search") {
      return (
        <section className="page-section">
          <div className="section-heading">
            <div>
              <h2>{t.search}</h2>
              <p>{t.searchPlaceholder}</p>
            </div>
          </div>

          <input
            className="search-input"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t.searchPlaceholder}
            autoFocus
          />

          <h3 className="subheading">{t.leagues}</h3>
          {renderLeagues()}

          <h3 className="subheading">{t.matches}</h3>
          {renderMatchList(filteredMatches, loadingMatches, error)}
        </section>
      );
    }

    if (view === "live") {
      return (
        <section className="page-section">
          <div className="section-heading">
            <div>
              <h2><span className="live-dot" /> {t.live}</h2>
              <p>{liveMatches.length} live matches</p>
            </div>
            <button className="icon-button" onClick={loadLiveMatches} title={t.refresh}>
              ↻
            </button>
          </div>
          {renderMatchList(liveMatches, loadingLive, liveError)}
        </section>
      );
    }

    return (
      <>
        {renderDateNavigation()}
        <section className="page-section">
          <div className="section-heading">
            <div>
              <h2>{view === "home" ? t.home : t.matches}</h2>
              <p>{formatDate(selectedDate, language)} · {selectedDate}</p>
            </div>
            <button className="icon-button" onClick={loadMatches} title={t.refresh}>
              ↻
            </button>
          </div>

          {renderMatchList(filteredMatches, loadingMatches, error)}
        </section>

        <section className="page-section featured-leagues">
          <div className="section-heading">
            <div>
              <h2>{t.leagues}</h2>
              <p>Browse available competitions</p>
            </div>
            <button className="text-button" onClick={() => goTo("leagues")}>
              View all →
            </button>
          </div>
          {loadingLeagues ? (
            <LoadingState>{t.loading}</LoadingState>
          ) : (
            <div className="featured-league-strip">
              {sortedLeagues.slice(0, 8).map((league) => (
                <button
                  className="featured-league"
                  key={league.id || league.code}
                  onClick={() => loadLeagueDetails(league)}
                >
                  <Crest src={league.emblem} name={league.name} />
                  <span>{league.name}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </>
    );
  }

  return (
    <div className={`app-shell ${darkMode ? "theme-dark" : "theme-light"}`}>
      <header className="app-header">
        <button className="brand" onClick={() => goTo("home")} type="button">
          <span className="brand-icon">⚽</span>
          <span>
            <strong>AG Football</strong>
            <small>Scores. Matches. More.</small>
          </span>
        </button>

        <div className="header-actions">
          <button
            className="header-button"
            onClick={() => setLanguage(language === "en" ? "am" : "en")}
            title="Change language"
          >
            {t.language}
          </button>
          <button
            className="header-button"
            onClick={() => setDarkMode((value) => !value)}
            title="Toggle theme"
          >
            {darkMode ? "☀" : "☾"}
          </button>
        </div>
      </header>

      <main className="app-main">
        <aside className="desktop-sidebar">
          <p className="sidebar-label">MENU</p>
          {[
            ["home", "⌂", t.home],
            ["live", "◉", t.live],
            ["matches", "▤", t.matches],
            ["leagues", "🏆", t.leagues],
            ["search", "⌕", t.search],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              className={`sidebar-link ${view === id ? "nav-active" : ""}`}
              onClick={() => goTo(id)}
            >
              <span>{icon}</span>{label}
            </button>
          ))}
          <div className="sidebar-note">
            <strong>AG Football</strong>
            <p>Follow the matches that matter to you.</p>
          </div>
        </aside>

        <div className="content-column">
          {renderMainContent()}
        </div>

        <aside className="right-sidebar">
          <div className="side-panel">
            <h3>{t.live}</h3>
            {loadingLive ? (
              <LoadingState>{t.loading}</LoadingState>
            ) : liveMatches.length ? (
              liveMatches.slice(0, 5).map((match) => (
                <button
                  className="mini-live-match"
                  key={match.id}
                  onClick={() => openMatch(match)}
                >
                  <span>{match.homeTeam?.shortName || match.homeTeam?.name}</span>
                  <strong>{getScore(match)}</strong>
                  <span>{match.awayTeam?.shortName || match.awayTeam?.name}</span>
                  <small>{getLiveLabel(match, t)}</small>
                </button>
              ))
            ) : (
              <p className="muted-text">No live matches right now.</p>
            )}
            <button className="text-button" onClick={() => goTo("live")}>
              {t.live} →
            </button>
          </div>

          <div className="side-panel">
            <h3>{t.leagues}</h3>
            {sortedLeagues.slice(0, 6).map((league) => (
              <button
                className="mini-league"
                key={league.id || league.code}
                onClick={() => loadLeagueDetails(league)}
              >
                <Crest src={league.emblem} name={league.name} small />
                <span>{league.name}</span>
              </button>
            ))}
            <button className="text-button" onClick={() => goTo("leagues")}>
              View all →
            </button>
          </div>
        </aside>
      </main>

      <nav className="bottom-navigation">
        {[
          ["home", "⌂", t.home],
          ["live", "◉", t.live],
          ["matches", "▤", t.matches],
          ["leagues", "🏆", t.leagues],
          ["search", "⌕", t.search],
        ].map(([id, icon, label]) => (
          <button
            key={id}
            className={view === id ? "bottom-nav-active" : ""}
            onClick={() => goTo(id)}
          >
            <span>{icon}</span>
            <small>{label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
function getMatchMinute(match) {
  const status = match.status;
  const minute = match.minute;
  const addedTime = match.injuryTime;

  if (status === "PAUSED") return "HT";
  if (status === "EXTRA_TIME") {
    return minute != null ? `${minute}′ ET` : "ET";
  }
  if (status === "PENALTY_SHOOTOUT") return "PEN";
  if (status === "IN_PLAY") {
    if (minute == null) return "LIVE";

    return addedTime != null && addedTime > 0
      ? `${minute}+${addedTime}′`
      : `${minute}′`;
  }

  return status || "";
}

function getGoalMinute(goal) {
  if (goal.minute == null) return "";

  const addedTime =
    goal.injuryTime != null && goal.injuryTime > 0
      ? `+${goal.injuryTime}`
      : "";

  return `${goal.minute}${addedTime}′`;
}

function getGoalTypeLabel(type) {
  if (type === "PENALTY") return " (P)";
  if (type === "OWN") return " (OG)";
  return "";
}
export default App;
