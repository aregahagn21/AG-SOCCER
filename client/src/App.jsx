import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

function getLiveMinute(match) {
  // Prefer the minute supplied by the provider.
  const officialMinute = Number(match.minute);
  if (
    match.minute !== null &&
    match.minute !== undefined &&
    match.minute !== "" &&
    Number.isFinite(officialMinute)
  ) {
    return Math.min(120, Math.max(0, officialMinute));
  }

  // Estimate only while the match is actively being played.
  // A penalty shootout has no meaningful match-minute clock.
  const status = String(match.status || "").toUpperCase();
  if (!["IN_PLAY", "EXTRA_TIME", "LIVE"].includes(status) || !match.utcDate) {
    return null;
  }

  const kickoff = new Date(match.utcDate).getTime();
  if (!Number.isFinite(kickoff) || Date.now() < kickoff) {
    return null;
  }

  // Clamp the estimate so the displayed clock never runs beyond 120 minutes.
  // This is an estimate when the provider does not supply an official minute.
  return Math.min(120, Math.floor((Date.now() - kickoff) / 60000));
}

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

const PRIORITY = [
  "uefa-champions-league", "premier-league", "la-liga", "bundesliga",
  "serie-a", "ligue-1", "europa-league", "uefa-europa-conference-league",
  "primeira-liga", "eredivisie", "english-premier-league", "spanish-la-liga",
  "german-bundesliga", "italian-serie-a", "french-ligue-1", "uefa-europa-league",
  "portuguese-primeira-liga", "dutch-eredivisie", "CL", "PL", "PD", "BL1", "SA", "FL1", "EL", "PPL", "DED", "BSA"
];
const COMPETITION_PRIORITY = [
  "UEFA Champions League", "Champions League", "England Premier League", "Premier League",
  "Spain La Liga", "La Liga", "Primera Division", "Germany Bundesliga", "Bundesliga",
  "Italy Serie A", "Serie A", "France Ligue 1", "Ligue 1", "UEFA Europa League",
  "UEFA Conference League", "Conference League", "Europa League", "Portugal Primeira Liga",
  "Primeira Liga", "Netherlands Eredivisie", "Eredivisie", "Major League Soccer"
];
function competitionRank(match) {
  const code = String(match.competition?.code || "").toLowerCase();
  const slug = String(match.competition?.slug || match.league?.slug || "").toLowerCase();
  const name = String(match.competition?.name || match.league?.name || "").toLowerCase();
  const codeIndex = PRIORITY.indexOf(slug || code);
  if (codeIndex >= 0) return codeIndex;
  const nameIndex = COMPETITION_PRIORITY.findIndex((item) => name.includes(item.toLowerCase()));
  return nameIndex >= 0 ? nameIndex : 1000;
}

const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT", "LIVE"]);

const STATUS_LABELS = {

  SCHEDULED: "Scheduled", TIMED: "Scheduled", IN_PLAY: "LIVE", PAUSED: "Half-time",

  EXTRA_TIME: "Extra time", PENALTY_SHOOTOUT: "Penalties", FINISHED: "FT",

  POSTPONED: "Postponed", SUSPENDED: "Suspended", CANCELLED: "Cancelled",

  AWARDED: "Awarded",

};

const TEXT = {

  en: {

    home: "Home", live: "Live", matches: "Matches", leagues: "Leagues", news: "News",

    search: "Search", today: "Today", yesterday: "Previous day", tomorrow: "Next day",

    noMatches: "No matches found for this date.", retry: "Try again", loading: "Loading…",

    allLeagues: "All competitions", standings: "Standings", teams: "Teams", scorers: "Top scorers",

    details: "Match details", overview: "Overview", events: "Events", lineups: "Lineups",

    stats: "Statistics", close: "Back", admin: "Admin / publish update", publish: "Publish update",

    title: "Title", excerpt: "Short summary", body: "Article text", category: "Category",

    imageUrl: "Optional image URL", adminKey: "Admin key", delete: "Delete", noNews: "No news yet.",

    noLineups: "Lineups have not been provided by the data provider for this match.",

    noEvents: "No goal, booking or substitution events are available for this match.",

    noStandings: "Standings are unavailable for this competition or plan.",

    searchPlaceholder: "Search teams, competitions or news…", refresh: "Refresh",

    publishSuccess: "Your update has been published.", published: "Published",

    noSearch: "No results found.", leagueMatches: "Competition matches", matchday: "Matchday",

    score: "Score", localTime: "Local time", appearance: "AG Football",

  },

  am: {

    home: "መነሻ", live: "ቀጥታ", matches: "ጨዋታዎች", leagues: "ሊጎች", news: "ዜና",

    search: "ፈልግ", today: "ዛሬ", yesterday: "ያለፈው ቀን", tomorrow: "ቀጣይ ቀን",

    allLeagues: "ሁሉም ውድድሮች", standings: "ደረጃ", teams: "ቡድኖች", scorers: "ግብ አስቆጣሪዎች",

    details: "የጨዋታ ዝርዝር", overview: "አጠቃላይ", events: "ክስተቶች", lineups: "ቋሚ ተሰላፊዎች",

    stats: "ስታቲስቲክስ", close: "ተመለስ", admin: "አስተዳዳሪ / ዜና አትም", publish: "ዜና አትም",

    title: "ርዕስ", excerpt: "አጭር ማጠቃለያ", body: "የዜና ጽሑፍ", category: "ምድብ",

    imageUrl: "የምስል አድራሻ (አማራጭ)", adminKey: "የአስተዳዳሪ ቁልፍ",

    delete: "ሰርዝ", noNews: "ገና ዜና የለም።", noLineups: "ለዚህ ጨዋታ ቋሚ ተሰላፊዎች አልተገኙም።",

    noEvents: "ለዚህ ጨዋታ ክስተቶች አልተገኙም።", refresh: "አድስ",

    searchPlaceholder: "ቡድን፣ ሊግ ወይም ዜና ፈልግ…", loading: "በመጫን ላይ…",

    retry: "እንደገና ሞክር", noMatches: "በዚህ ቀን ጨዋታ አልተገኘም።",

    published: "የታተመ", noStandings: "የደረጃ ሰንጠረዥ አልተገኘም።",

    search: "ፈልግ", noSearch: "ውጤት አልተገኘም።", appearance: "AG Football",

  },

};



function localDateString(date = new Date()) {

  const y = date.getFullYear();

  const m = String(date.getMonth() + 1).padStart(2, "0");

  const d = String(date.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;

}

function shiftDate(dateString, days) {

  const [y, m, d] = dateString.split("-").map(Number);

  const date = new Date(y, m - 1, d, 12, 0, 0);

  date.setDate(date.getDate() + days);

  return localDateString(date);

}

function getTimezone() {

  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }

  catch { return "UTC"; }

}

async function api(path, options = {}) {

  const response = await fetch(`${API_BASE}${path}`, {

    ...options,

    headers: { "Content-Type": "application/json", ...(options.headers || {}) },

  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) throw new Error(data.message || `Request failed (${response.status})`);

  return data;

}

function formatTime(utcDate) {

  if (!utcDate) return "—";

  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(utcDate));

}

function formatDate(dateString, locale = "en") {

  const [y, m, d] = dateString.split("-").map(Number);

  return new Intl.DateTimeFormat(locale === "am" ? "am-ET" : undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(y, m - 1, d, 12));

}

function statusText(match) {
  const status = String(match.status || "").toUpperCase();

  if (status === "IN_PLAY" || status === "LIVE") {
    const minute = getLiveMinute(match);
    if (minute === null) return "LIVE";

    const injuryTime = Number(match.injuryTime || 0);
    if (injuryTime > 0 && minute < 120) {
      return `${minute}+${injuryTime}′`;
    }

    return typeof match.minute === "number" || (match.minute != null && match.minute !== "")
      ? `${minute}′`
      : `LIVE · ~${minute}′`;
  }

  if (status === "PAUSED") return "HT";

  if (status === "EXTRA_TIME") {
    const minute = getLiveMinute(match);
    return minute === null ? "Extra time" : `${minute}′ ET`;
  }

  if (status === "PENALTY_SHOOTOUT") return "Penalties";

  return STATUS_LABELS[status] || match.status || "Scheduled";
}

function isLive(match) { return LIVE_STATUSES.has(match.status); }

function matchGoals(match) { return Array.isArray(match.goals) ? match.goals : []; }

function goalMinute(goal) {

  if (goal.minute == null) return "";

  return `${goal.minute}${goal.injuryTime ? `+${goal.injuryTime}` : ""}′`;

}

function goalType(goal) {

  const type = String(goal.type || "").toUpperCase();

  if (type.includes("PENALTY")) return " (P)";

  if (type.includes("OWN")) return " (OG)";

  return "";

}

function matchEvents(match) {
  const goals = (match.goals || []).map((event) => ({
    kind: "goal",
    minute: event.minute,
    injuryTime: event.injuryTime,
    icon: "⚽",
    label: `${event.scorer?.name || "Unknown scorer"}${goalType(event)}${event.assist?.name ? ` · Assist: ${event.assist.name}` : ""}`,
    team: event.team?.name || "",
  }));
  const bookings = (match.bookings || []).map((event) => ({
    kind: "booking",
    minute: event.minute,
    injuryTime: event.injuryTime,
    icon: String(event.card || "").toUpperCase().includes("RED") ? "🟥" : "🟨",
    label: `${event.player?.name || "Unknown player"} · ${String(event.card || "Card").replaceAll("_", " ").toLowerCase()}`,
    team: event.team?.name || "",
  }));
  const substitutions = (match.substitutions || []).map((event) => ({
    kind: "substitution",
    minute: event.minute,
    injuryTime: event.injuryTime,
    icon: "🔄",
    label: `${event.playerIn?.name || "Player on"} on · ${event.playerOut?.name || "Player off"} off`,
    team: event.team?.name || "",
  }));
  return [...goals, ...bookings, ...substitutions].sort((a, b) => {
    const minuteA = Number.isFinite(Number(a.minute)) ? Number(a.minute) : 999;
    const minuteB = Number.isFinite(Number(b.minute)) ? Number(b.minute) : 999;
    return minuteA - minuteB || Number(a.injuryTime || 0) - Number(b.injuryTime || 0);
  });
}

const STAT_LABELS = {
  ball_possession: "Possession", shots: "Total shots", shots_on_goal: "Shots on target",
  shots_off_goal: "Shots off target", corner_kicks: "Corners", offsides: "Offsides",
  fouls: "Fouls", free_kicks: "Free kicks", goal_kicks: "Goal kicks", throw_ins: "Throw-ins",
  saves: "Saves", yellow_cards: "Yellow cards", yellow_red_cards: "Second yellow / red",
  red_cards: "Red cards",
};

function statDisplay(value, key) {
  if (value == null) return "—";
  return key === "ball_possession" ? `${value}%` : value;
}

function dateOfMatch(match) {

  if (!match.utcDate) return "";

  return localDateString(new Date(match.utcDate));

}

function sortCompetitions(items) {

  return [...items].sort((a, b) => {

    const rank = (item) => {
      const code = String(item.code || "").toLowerCase();
      const slug = String(item.slug || "").toLowerCase();
      const name = String(item.name || "").toLowerCase();
      const codeRank = PRIORITY.indexOf(slug || code);
      if (codeRank >= 0) return codeRank;
      const patterns = [
        /champions league/, /premier league/, /la liga|primera division/,
        /bundesliga/, /serie a/, /ligue 1/, /europa league/,
        /conference league/, /primeira liga/, /eredivisie/, /major league soccer/
      ];
      const found = patterns.findIndex((pattern) => pattern.test(name));
      return found < 0 ? 999 : found;
    };
    return rank(a) - rank(b) || (a.name || "").localeCompare(b.name || "");

  });

}



function getCompetitionTitle(match) {
  const name = String(
    match.competition?.name || match.league?.name || match.competition_name || "Other matches"
  ).trim();

  // Use one consistent heading for the English Premier League.
  if (
    /^(english\s+)?premier league$/i.test(name) ||
    String(match.competition?.code || match.league?.code || "").toUpperCase() === "PL"
  ) {
    return "England Premier League";
  }

  return name || "Other matches";
}

function groupMatchesByCompetition(items) {
  const groups = new Map();

  for (const match of items || []) {
    const title = getCompetitionTitle(match);
    if (!groups.has(title)) {
      groups.set(title, {
        title,
        emblem: match.competition?.emblem || match.league?.emblem || "",
        representative: match,
        matches: [],
      });
    }
    groups.get(title).matches.push(match);
  }

  return [...groups.values()].sort((a, b) => {
    return competitionRank(a.representative) - competitionRank(b.representative) ||
      a.title.localeCompare(b.title);
  });
}

function CompetitionMatchGroups({ matches, onOpen }) {
  const groups = groupMatchesByCompetition(matches);

  return (
    <div className="competition-match-groups">
      {groups.map((group) => (
        <section className="competition-match-group" key={group.title}>
          <h3 className="competition-match-heading">
            {group.emblem && (
              <img
                src={group.emblem}
                alt=""
                onError={(event) => { event.currentTarget.style.display = "none"; }}
              />
            )}
            <span>{group.title}</span>
            <small>{group.matches.length} {group.matches.length === 1 ? "match" : "matches"}</small>
          </h3>
          <div className="match-grid">
            {group.matches.map((match, index) => (
              <MatchCard
                key={match.id ?? match.slug ?? `${group.title}-${index}`}
                match={match}
                onOpen={onOpen}
                showCompetition={false}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MatchCard({ match, onOpen, showCompetition = true }) {

  const goals = matchGoals(match);

  const homeScore = match.score?.fullTime?.home ?? match.score?.halfTime?.home;

  const awayScore = match.score?.fullTime?.away ?? match.score?.halfTime?.away;

  const homeName = match.homeTeam?.shortName || match.homeTeam?.name || "Home";

  const awayName = match.awayTeam?.shortName || match.awayTeam?.name || "Away";

  return (

    <button className="match-card" onClick={() => onOpen(match)} type="button">

      <div className="match-meta">

        {showCompetition && (
          <span className="competition-label">

            {match.competition?.emblem && <img src={match.competition.emblem} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />}

            {getCompetitionTitle(match)}

          </span>
        )}

        <span className={`status-pill ${isLive(match) ? "status-live" : ""}`}>

          {isLive(match) && <i className="live-dot" />} {statusText(match)}

        </span>

      </div>

      <div className="teams-score">

        <div className="team-row">

          <img className="team-crest" src={match.homeTeam?.crest || ""} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />

          <span className="team-name">{homeName}</span>

          <strong className="team-score">{homeScore ?? "–"}</strong>

        </div>

        <div className="team-row">

          <img className="team-crest" src={match.awayTeam?.crest || ""} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />

          <span className="team-name">{awayName}</span>

          <strong className="team-score">{awayScore ?? "–"}</strong>

        </div>

      </div>

      {goals.length > 0 && (

        <div className="goal-list">

          {goals.map((goal, index) => {

            const homeGoal = goal.team?.id === match.homeTeam?.id;

            return (

              <div className="goal-line" key={`${match.id}-goal-${index}`}>

                <span>⚽</span>

                <span className="goal-player">{goal.scorer?.name || "Scorer unavailable"}{goalType(goal)}</span>

                <span className="goal-minute">{goalMinute(goal)}</span>

                <span className="goal-team">{homeGoal ? homeName : awayName}</span>

              </div>

            );

          })}

        </div>

      )}

      <div className="match-footer">

        <span>{match.matchday ? `Matchday ${match.matchday}` : (match.stage || "")}</span>

        <span>{isLive(match) ? "Match centre ↗" : formatTime(match.utcDate)}</span>

      </div>

    </button>

  );

}



function NewsCard({ item, onOpen, onDelete, canAdmin }) {

  return (

    <article className="news-card">

      {item.imageUrl && <img className="news-image" src={item.imageUrl} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />}

      <div className="news-content">

        <div className="news-meta"><span className="category-tag">{item.category || "News"}</span><time>{item.publishedAt ? new Date(item.publishedAt).toLocaleDateString() : ""}</time></div>

        <h3>{item.title}</h3>

        <p>{item.excerpt}</p>

        <div className="news-actions">

          <button className="text-button" onClick={() => onOpen(item)}>Read article →</button>

          {canAdmin && <button className="text-button danger-text" onClick={() => onDelete(item.id)}>Delete</button>}

        </div>

      </div>

    </article>

  );

}



export default function App() {

  const [language, setLanguage] = useState("en");

  const [dark, setDark] = useState(true);

  const [section, setSection] = useState("home");

  const [selectedDate, setSelectedDate] = useState(() => localDateString());

  const [matches, setMatches] = useState([]);

  const [liveMatches, setLiveMatches] = useState([]);

  const [competitions, setCompetitions] = useState([]);

  const [news, setNews] = useState([]);

  const [loadingMatches, setLoadingMatches] = useState(false);

  const [loadingLive, setLoadingLive] = useState(false);

  const [loadingLeagues, setLoadingLeagues] = useState(false);

  const [loadingNews, setLoadingNews] = useState(false);

  const [error, setError] = useState("");

  const [selectedCompetition, setSelectedCompetition] = useState(null);

  const [leagueData, setLeagueData] = useState(null);

  const [selectedMatch, setSelectedMatch] = useState(null);

  const [matchDetail, setMatchDetail] = useState(null);

  const [matchDetailError, setMatchDetailError] = useState("");

  const [matchDetailLoading, setMatchDetailLoading] = useState(false);

  const [matchDetailUpdatedAt, setMatchDetailUpdatedAt] = useState(null);

  const [matchTab, setMatchTab] = useState("overview");

  const [leagueTab, setLeagueTab] = useState("matches");

  const [search, setSearch] = useState("");

  const [adminOpen, setAdminOpen] = useState(false);

  const [adminKey, setAdminKey] = useState("");

  const [adminAuthed, setAdminAuthed] = useState(false);

  const [publishing, setPublishing] = useState(false);

  const [notice, setNotice] = useState("");

  const [article, setArticle] = useState(null);

  const [newsForm, setNewsForm] = useState({ title: "", excerpt: "", body: "", category: "News", imageUrl: "" });

  const t = TEXT[language];

  // Re-render live minute labels every 30 seconds, even when the API data
  // itself has not changed. The displayed elapsed minute is only an estimate
  // when the provider does not supply an official minute.
  const [, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClockNow(Date.now()), 30000);
    return () => window.clearInterval(clockTimer);
  }, []);



  const loadMatches = useCallback(async (date = selectedDate) => {

    setLoadingMatches(true);

    setError("");

    try {

      const data = await api(`/api/matches?date=${encodeURIComponent(date)}&timezone=${encodeURIComponent(getTimezone())}`);

      const rows = Array.isArray(data.matches) ? data.matches : [];
      setMatches(rows.sort((a, b) => competitionRank(a) - competitionRank(b) || new Date(a.utcDate || a.date || 0).getTime() - new Date(b.utcDate || b.date || 0).getTime()));

    } catch (e) {

      setError(e.message);

      setMatches([]);

    } finally { setLoadingMatches(false); }

  }, [selectedDate]);



  const loadLive = useCallback(async () => {

    setLoadingLive(true);

    try {

      const data = await api(`/api/live?timezone=${encodeURIComponent(getTimezone())}`);

      setLiveMatches(data.matches || []);

    } catch (e) { setError(e.message); }

    finally { setLoadingLive(false); }

  }, []);



  const loadLeagues = useCallback(async () => {

    setLoadingLeagues(true);

    try {

      const data = await api("/api/leagues");

      const rows = data.competitions || data.leagues || data.data?.competitions || data.data?.leagues || data.data?.data?.leagues || [];
      setCompetitions(sortCompetitions(Array.isArray(rows) ? rows : []));
      if (!Array.isArray(rows) || rows.length === 0) {
        setError("SportScore returned no competitions for this request. Check the backend /api/leagues response and the SportScore search result.");
      }

    } catch (e) { setError(e.message); }

    finally { setLoadingLeagues(false); }

  }, []);



  const loadNews = useCallback(async () => {

    setLoadingNews(true);

    try {

      const data = await api("/api/news");

      setNews(data.news || []);

    } catch (e) { setError(e.message); }

    finally { setLoadingNews(false); }

  }, []);



  useEffect(() => { loadMatches(); }, [loadMatches]);

  useEffect(() => { loadLeagues(); loadNews(); loadLive(); }, [loadLeagues, loadNews, loadLive]);

  useEffect(() => {

    const timer = window.setInterval(() => { loadLive(); }, 120000);

    return () => window.clearInterval(timer);

  }, [loadLive]);



  const goDate = (days) => {

    const next = shiftDate(selectedDate, days);

    setSelectedDate(next);

    loadMatches(next);

  };



  async function openMatch(match) {
    setSelectedMatch(match);
    setMatchDetail(match);
    setMatchTab("overview");
    setMatchDetailError("");
    setMatchDetailLoading(true);
    setSection("match-detail");
    try {
      const data = await api(`/api/matches/${encodeURIComponent(match.slug || match.id)}`);
      setMatchDetail(data.match || match);
      setMatchDetailUpdatedAt(new Date());
    } catch (error) {
      setMatchDetailError(error.message || "Could not load the latest match details.");
      // Keep the fixture-card data visible if the details request fails.
    } finally {
      setMatchDetailLoading(false);
    }
  }

  async function refreshMatchDetails() {
    if (!selectedMatch?.id) return;
    setMatchDetailLoading(true);
    setMatchDetailError("");
    try {
      const data = await api(`/api/matches/${encodeURIComponent(selectedMatch.slug || selectedMatch.id)}`);
      setMatchDetail(data.match || matchDetail || selectedMatch);
      setMatchDetailUpdatedAt(new Date());
    } catch (error) {
      setMatchDetailError(error.message || "Could not refresh match details.");
    } finally {
      setMatchDetailLoading(false);
    }
  }

  // Keep the currently open live match centre up to date. Finished matches
  // are not polled, which helps avoid unnecessary API calls and rate limits.
  useEffect(() => {
    if (section !== "match-detail" || !selectedMatch?.id || !isLive(matchDetail || selectedMatch)) return;
    const timer = window.setInterval(async () => {
      try {
        const data = await api(`/api/matches/${encodeURIComponent(selectedMatch.slug || selectedMatch.id)}`);
        const updated = data.match || null;
        if (updated) {
          setMatchDetail(updated);
          setMatchDetailUpdatedAt(new Date());
          setMatchDetailError("");
        }
      } catch (error) {
        setMatchDetailError(error.message || "Live match refresh failed. You can retry manually.");
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [section, selectedMatch?.id, matchDetail?.status]);

  async function openCompetition(competition) {

    setSelectedCompetition(competition);

    setLeagueData(null);

    setLeagueTab("matches");

    setSection("league-detail");

    try {

      const [matchResponse, standingsResponse, teamsResponse, scorersResponse] = await Promise.allSettled([

        api(`/api/leagues/${encodeURIComponent(competition.slug || competition.code || competition.id)}/matches`),

        api(`/api/leagues/${encodeURIComponent(competition.slug || competition.code || competition.id)}/standings`),

        api(`/api/leagues/${encodeURIComponent(competition.slug || competition.code || competition.id)}/teams`),

        api(`/api/leagues/${encodeURIComponent(competition.slug || competition.code || competition.id)}/scorers`),

      ]);

      setLeagueData({

        matches: matchResponse.status === "fulfilled" ? matchResponse.value.matches || [] : [],

        standings: standingsResponse.status === "fulfilled" ? standingsResponse.value.standings || [] : [],

        teams: teamsResponse.status === "fulfilled" ? teamsResponse.value.teams || [] : [],

        scorers: scorersResponse.status === "fulfilled" ? scorersResponse.value.scorers || [] : [],

        errors: [matchResponse, standingsResponse, teamsResponse, scorersResponse].map((r) => r.status === "rejected" ? r.reason?.message : ""),

      });

    } catch (e) { setError(e.message); }

  }

  async function deleteNews(id) {

    if (!window.confirm("Delete this news post?")) return;

    try {

      await api(`/api/news/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-admin-key": adminKey } });

      setNews((old) => old.filter((item) => item.id !== id));

      setNotice("News post deleted.");

    } catch (e) { setNotice(e.message); }

  }

  async function publishNews(e) {

    e.preventDefault();

    setPublishing(true); setNotice("");

    try {

      const data = await api("/api/news", {

        method: "POST",

        headers: { "x-admin-key": adminKey },

        body: JSON.stringify(newsForm),

      });

      setNews((old) => [data.news || data.article, ...old].filter(Boolean));

      setNewsForm({ title: "", excerpt: "", body: "", category: "News", imageUrl: "" });

      setAdminOpen(false);

      setAdminAuthed(true);

      setNotice(t.publishSuccess);

    } catch (e2) { setNotice(e2.message); }

    finally { setPublishing(false); }

  }



  const filteredMatches = useMemo(() => {

    const q = search.trim().toLowerCase();

    return matches
      .filter((m) => !q || [m.homeTeam?.name, m.awayTeam?.name, m.competition?.name].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => competitionRank(a) - competitionRank(b) || new Date(a.utcDate || 0).getTime() - new Date(b.utcDate || 0).getTime());

  }, [matches, search]);

  const filteredCompetitions = useMemo(() => {

    const q = search.trim().toLowerCase();

    return competitions.filter((c) => !q || `${c.name} ${c.code} ${c.area?.name || c.country?.name || c.country || ""}`.toLowerCase().includes(q));

  }, [competitions, search]);

  const filteredNews = useMemo(() => {

    const q = search.trim().toLowerCase();

    return news.filter((n) => !q || `${n.title} ${n.excerpt} ${n.body} ${n.category}`.toLowerCase().includes(q));

  }, [news, search]);



  const liveView = section === "live";

  const detailView = section === "match-detail" || section === "league-detail" || section === "article";

  function navigate(next) {

    setSection(next);

    setSelectedMatch(null);

    setMatchDetail(null);

    setSelectedCompetition(null);

    setArticle(null);

    setError("");

    if (next === "live") loadLive();

    if (next === "leagues") loadLeagues();

    if (next === "news") loadNews();

    if (next === "home" || next === "matches") loadMatches(selectedDate);

  }



  return (

    <div className={`app-shell ${dark ? "theme-dark" : "theme-light"}`}>

      <header className="topbar">

        <button className="brand" onClick={() => navigate("home")} aria-label="AG Football home">

          <span className="brand-ball">⚽</span><span><strong>AG Football</strong><small>LIVE SCORES · NEWS</small></span>

        </button>

        <div className="top-actions">

          <button className="icon-button" onClick={() => setDark((v) => !v)} title="Toggle theme">{dark ? "☀️" : "🌙"}</button>

          <button className="language-button" onClick={() => setLanguage((v) => v === "en" ? "am" : "en")}>{language === "en" ? "አማ" : "EN"}</button>

        </div>

      </header>



      <main className="main-wrap">

        <div className="welcome-row">

          <div><p className="eyebrow">YOUR FOOTBALL, YOUR WAY</p><h1>{section === "live" ? "Live centre" : section === "leagues" ? "Competitions" : section === "news" ? "Club news & updates" : "Football at a glance"}</h1><p className="subheading">Scores, schedules, league tables and updates in one place.</p></div>

          <button className="refresh-button" onClick={() => { loadMatches(); loadLive(); loadLeagues(); loadNews(); }}>↻ {t.refresh}</button>

        </div>



        {notice && <div className="notice-bar" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {error && <div className="error-bar" role="alert">{error}<button onClick={() => setError("")}>×</button></div>}



        {!detailView && (

          <div className="section-nav" role="navigation" aria-label="Main sections">

            {[

              ["home", `⌂ ${t.home}`], ["live", `● ${t.live}`], ["matches", `▦ ${t.matches}`],

              ["leagues", `♜ ${t.leagues}`], ["news", `▤ ${t.news}`],

            ].map(([key, label]) => <button key={key} className={section === key ? "nav-item active" : "nav-item"} onClick={() => navigate(key)}>{label}</button>)}

          </div>

        )}



        {!detailView && (

          <div className="search-row">

            <span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.searchPlaceholder} aria-label={t.search} />

            {search && <button onClick={() => setSearch("")}>×</button>}

          </div>

        )}



        {(section === "home" || section === "matches") && (

          <section className="panel">

            <div className="section-heading"><div><p className="eyebrow">{section === "home" ? "FIXTURES & RESULTS" : "MATCH CENTRE"}</p><h2>{t.matches}</h2></div><input className="date-input" type="date" value={selectedDate} onChange={(e) => { if (e.target.value) { setSelectedDate(e.target.value); loadMatches(e.target.value); } }} /></div>

            <div
              className="date-strip"
              role="navigation"
              aria-label="Choose match date"
              style={{
                display: "flex",
                gap: "8px",
                overflowX: "auto",
                overflowY: "hidden",
                padding: "8px 2px 12px",
                margin: "8px 0 12px",
                WebkitOverflowScrolling: "touch",
                scrollbarWidth: "thin",
                scrollSnapType: "x proximity",
              }}
            >
              {Array.from({ length: 29 }, (_, index) => shiftDate(localDateString(), index - 7)).map((date) => {
                const today = localDateString();
                const isSelected = selectedDate === date;
                const isToday = date === today;
                const dateObj = new Date(`${date}T12:00:00`);
                const weekday = new Intl.DateTimeFormat(language === "am" ? "am-ET" : undefined, { weekday: "short" }).format(dateObj);
                const dayNumber = dateObj.getDate();
                const month = new Intl.DateTimeFormat(language === "am" ? "am-ET" : undefined, { month: "short" }).format(dateObj);
                return (
                  <button
                    key={date}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${isToday ? t.today : weekday} ${month} ${dayNumber}, ${date}`}
                    className={`date-chip${isSelected ? " selected" : ""}${isToday ? " today" : ""}`}
                    onClick={() => { setSelectedDate(date); loadMatches(date); }}
                    style={{
                      flex: "0 0 76px",
                      minWidth: "76px",
                      minHeight: "70px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                      padding: "8px 6px",
                      borderRadius: "12px",
                      border: isSelected ? "1px solid var(--primary, #6366f1)" : "1px solid var(--border, #334155)",
                      background: isSelected ? "var(--primary, #6366f1)" : "var(--card, #111827)",
                      color: isSelected ? "#ffffff" : "var(--text, #f8fafc)",
                      cursor: "pointer",
                      scrollSnapAlign: "center",
                    }}
                  >
                    <span style={{ fontSize: "12px", opacity: 0.85 }}>{isToday ? t.today : weekday}</span>
                    <strong style={{ fontSize: "20px", lineHeight: 1.1 }}>{dayNumber}</strong>
                    <span style={{ fontSize: "11px", opacity: 0.85 }}>{month}</span>
                  </button>
                );
              })}
            </div>

            <p className="date-caption">{formatDate(selectedDate, language)} · {selectedDate}</p>

            {loadingMatches ? <div className="loading-state">{t.loading}</div> :

              filteredMatches.length ? <CompetitionMatchGroups matches={filteredMatches} onOpen={openMatch} /> :

              <div className="empty-state"><span>⚽</span><h3>{t.noMatches}</h3><p>Try another date or open a competition to view its full schedule.</p><button className="secondary-button" onClick={() => loadMatches()}>{t.retry}</button></div>}

          </section>

        )}



        {section === "live" && (

          <section className="panel">

            <div className="section-heading"><div><p className="eyebrow">LIVE SCOREBOARD</p><h2><i className="live-dot" /> {t.live} games</h2></div><span className="muted">{loadingLive ? t.loading : `${liveMatches.length} matches`}</span></div>

            {loadingLive && !liveMatches.length ? <div className="loading-state">{t.loading}</div> :

              liveMatches.filter((m) => !search || `${m.homeTeam?.name} ${m.awayTeam?.name} ${getCompetitionTitle(m)}`.toLowerCase().includes(search.toLowerCase())).length ?

                <CompetitionMatchGroups
                  matches={liveMatches.filter((m) => !search || `${m.homeTeam?.name} ${m.awayTeam?.name} ${getCompetitionTitle(m)}`.toLowerCase().includes(search.toLowerCase()))}
                  onOpen={openMatch}
                /> :

                <div className="empty-state"><span>◷</span><h3>No live games found right now</h3><p>The scoreboard refreshes automatically every two minutes. Availability depends on your data provider plan.</p><button className="secondary-button" onClick={loadLive}>{t.refresh}</button></div>}

          </section>

        )}



        {section === "leagues" && (

          <section className="panel">

            <div className="section-heading"><div><p className="eyebrow">FOLLOW THE COMPETITIONS</p><h2>{t.leagues}</h2></div><span className="muted">{competitions.length} available</span></div>

            {loadingLeagues && !competitions.length ? <div className="loading-state">{t.loading}</div> :

              filteredCompetitions.length ? <div className="competition-grid">{filteredCompetitions.map((competition) => <button className="competition-card" key={competition.id} onClick={() => openCompetition(competition)}>

                <span className="competition-logo">{competition.emblem ? <img src={competition.emblem} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : "🏆"}</span>

                <span className="competition-info"><strong>{competition.name}</strong><small>{competition.area?.name || "International"} · {competition.code}</small></span><span className="arrow">↗</span>

              </button>)}</div> :

              <div className="empty-state"><h3>No competitions available</h3><p>Check the backend /api/leagues response and your SportScore API response.</p><button className="secondary-button" onClick={loadLeagues}>{t.retry}</button></div>}

          </section>

        )}



        {section === "news" && (

          <section className="panel">

            <div className="section-heading"><div><p className="eyebrow">FROM THE AG FOOTBALL TEAM</p><h2>News & client updates</h2><p className="subheading">Publish app announcements, release notes, football articles and service updates.</p></div><button className="primary-button" onClick={() => setAdminOpen((v) => !v)}>{adminOpen ? "Close publisher" : `＋ ${t.admin}`}</button></div>

            {adminOpen && (

              <div className="admin-panel">

                <h3>Publish a news post</h3>

                {!adminAuthed && <p className="muted">Enter your private ADMIN_KEY from server/.env. The key is sent only to your backend for publishing.</p>}

                <form className="news-form" onSubmit={publishNews}>

                  <label>{t.adminKey}<input type="password" autoComplete="current-password" value={adminKey} onChange={(e) => { setAdminKey(e.target.value); setAdminAuthed(false); }} required /></label>

                  <label>{t.title}<input maxLength={160} value={newsForm.title} onChange={(e) => setNewsForm({ ...newsForm, title: e.target.value })} required /></label>

                  <label>{t.category}<select value={newsForm.category} onChange={(e) => setNewsForm({ ...newsForm, category: e.target.value })}><option>News</option><option>App update</option><option>Announcement</option><option>Football</option><option>Maintenance</option></select></label>

                  <label>{t.excerpt}<textarea rows="2" maxLength={400} value={newsForm.excerpt} onChange={(e) => setNewsForm({ ...newsForm, excerpt: e.target.value })} required /></label>

                  <label>{t.imageUrl}<input type="url" value={newsForm.imageUrl} onChange={(e) => setNewsForm({ ...newsForm, imageUrl: e.target.value })} placeholder="https://…" /></label>

                  <label>{t.body}<textarea rows="6" value={newsForm.body} onChange={(e) => setNewsForm({ ...newsForm, body: e.target.value })} required /></label>

                  <button className="primary-button" disabled={publishing}>{publishing ? t.loading : t.publish}</button>

                </form>

              </div>

            )}

            {loadingNews && !news.length ? <div className="loading-state">{t.loading}</div> :

              filteredNews.length ? <div className="news-grid">{filteredNews.map((item) => <NewsCard key={item.id} item={item} onOpen={(post) => { setArticle(post); setSection("article"); }} canAdmin={adminAuthed} onDelete={deleteNews} />)}</div> :

              <div className="empty-state"><span>▤</span><h3>{t.noNews}</h3><p>Use the publisher to post app releases, maintenance notices or football articles for your clients.</p></div>}

          </section>

        )}

      </main>



      {section === "match-detail" && matchDetail && (

        <main className="main-wrap detail-wrap">

          <button className="back-button" onClick={() => { setSection("matches"); setSelectedMatch(null); }}>← {t.close}</button>

          <section className="panel">
            <div className="match-centre-heading">
              <p className="eyebrow">{matchDetail.competition?.name || "Match centre"}</p>
              <div className="match-centre-tools">
                <span className="muted">{matchDetailUpdatedAt ? `Updated ${matchDetailUpdatedAt.toLocaleTimeString()}` : "Match information"}</span>
                <button className="secondary-button" onClick={refreshMatchDetails} disabled={matchDetailLoading}>{matchDetailLoading ? "Refreshing…" : "↻ Refresh details"}</button>
              </div>
            </div>
            {matchDetailError && <div className="error-bar match-detail-error"><span>{matchDetailError}</span><button onClick={refreshMatchDetails} aria-label="Retry match details">Retry</button></div>}

            <div className="detail-scoreboard">

              <div className="detail-team"><img src={matchDetail.homeTeam?.crest || ""} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /><strong>{matchDetail.homeTeam?.name}</strong></div>

              <div className="detail-score"><strong>{matchDetail.score?.fullTime?.home ?? matchDetail.score?.halfTime?.home ?? "–"} : {matchDetail.score?.fullTime?.away ?? matchDetail.score?.halfTime?.away ?? "–"}</strong><span className={isLive(matchDetail) ? "live-label" : ""}>{statusText(matchDetail)}</span></div>

              <div className="detail-team"><img src={matchDetail.awayTeam?.crest || ""} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /><strong>{matchDetail.awayTeam?.name}</strong></div>

            </div>

            <div className="detail-tabs">{[["overview", t.overview], ["events", t.events], ["lineups", t.lineups], ["stats", t.stats]].map(([key, label]) => <button key={key} className={matchTab === key ? "active" : ""} onClick={() => setMatchTab(key)}>{label}</button>)}</div>

            {matchTab === "overview" && <div className="detail-content">

              <div className="info-grid"><div><small>Kick-off (your time)</small><strong>{new Date(matchDetail.utcDate).toLocaleString()}</strong></div><div><small>Venue</small><strong>{matchDetail.venue || "Not provided"}</strong></div><div><small>Referee</small><strong>{matchDetail.referees?.map((r) => r.name).join(", ") || "Not provided"}</strong></div><div><small>Matchday</small><strong>{matchDetail.matchday || matchDetail.stage || "—"}</strong></div></div>

              <h3>Goal timeline</h3>

              {matchGoals(matchDetail).length ? <div className="event-list">{matchGoals(matchDetail).map((goal, i) => <div className="event-row" key={i}><b>{goalMinute(goal)}</b><span>⚽</span><span>{goal.scorer?.name || "Unknown scorer"}{goalType(goal)}{goal.assist?.name ? ` · Assist: ${goal.assist.name}` : ""}</span><small>{goal.team?.name || ""}</small></div>)}</div> : <p className="muted">{t.noEvents}</p>}

            </div>}

            {matchTab === "events" && <div className="detail-content">

              {matchEvents(matchDetail).length ? <div className="event-list">{matchEvents(matchDetail).map((event, i) => <div className="event-row" key={`${event.kind}-${i}`}><b>{event.minute != null ? `${event.minute}${event.injuryTime ? `+${event.injuryTime}` : ""}′` : "—"}</b><span>{event.icon}</span><span>{event.label}</span><small>{event.team}</small></div>)}</div> : <p className="muted">{t.noEvents}</p>}

            </div>}

            {matchTab === "lineups" && <div className="lineup-grid">

              {[["home", matchDetail.homeTeam], ["away", matchDetail.awayTeam]].map(([side, team]) => {
                const starters = Array.isArray(team?.lineup) ? team.lineup : (Array.isArray(matchDetail.lineups?.[side]) ? matchDetail.lineups[side] : []);
                const bench = Array.isArray(team?.bench) ? team.bench : [];
                return <div className="lineup-card" key={side}>
                  <h3>{team?.name || side}</h3>
                  <p className="lineup-meta">{team?.formation ? `Formation: ${team.formation}` : "Formation not provided"}</p>
                  {team?.coach?.name && <p className="lineup-meta">Coach: {team.coach.name}</p>}
                  <h4>Starting XI {starters.length ? `(${starters.length})` : ""}</h4>
                  {starters.length ? starters.map((player, i) => <div className="player-row" key={player.id || `starter-${i}`}><span>{player.shirtNumber ?? player.number ?? "—"}</span><span>{player.name || player.player?.name || "Player"}</span><small>{player.position || ""}</small></div>) : <p className="muted">{t.noLineups}</p>}
                  {bench.length > 0 && <><h4 className="bench-heading">Substitutes</h4>{bench.map((player, i) => <div className="player-row" key={player.id || `bench-${i}`}><span>{player.shirtNumber ?? player.number ?? "—"}</span><span>{player.name || player.player?.name || "Player"}</span><small>{player.position || ""}</small></div>)}</>}
                </div>;
              })}

            </div>}

            {matchTab === "stats" && <div className="detail-content">
              {matchDetail.homeTeam?.statistics || matchDetail.awayTeam?.statistics ? <div className="stats-table">
                <div className="stats-header"><strong>{matchDetail.homeTeam?.shortName || matchDetail.homeTeam?.name || "Home"}</strong><strong>Match statistics</strong><strong>{matchDetail.awayTeam?.shortName || matchDetail.awayTeam?.name || "Away"}</strong></div>
                {Object.entries(STAT_LABELS).map(([key, label]) => {
                  const homeValue = matchDetail.homeTeam?.statistics?.[key];
                  const awayValue = matchDetail.awayTeam?.statistics?.[key];
                  if (homeValue == null && awayValue == null) return null;
                  return <div className="stats-row" key={key}><strong>{statDisplay(homeValue, key)}</strong><span>{label}</span><strong>{statDisplay(awayValue, key)}</strong></div>;
                })}
              </div> : <div className="unavailable-panel"><strong>Detailed statistics aren't included in this response.</strong><p className="muted">The current match response does not include the shots and possession fields this table needs. The app will not invent statistics; the backend must provide these fields to fill this tab.</p></div>}
            </div>}

          </section>

        </main>

      )}



      {section === "league-detail" && selectedCompetition && (

        <main className="main-wrap detail-wrap">

          <button className="back-button" onClick={() => { setSection("leagues"); setSelectedCompetition(null); }}>← {t.close} {t.leagues}</button>

          <section className="panel">

            <div className="league-title"><img src={selectedCompetition.emblem || ""} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} /><div><p className="eyebrow">{selectedCompetition.area?.name || "Competition"}</p><h2>{selectedCompetition.name}</h2></div></div>

            <div className="detail-tabs">{[["matches", t.leagueMatches], ["standings", t.standings], ["teams", t.teams], ["scorers", t.scorers]].map(([key, label]) => <button key={key} className={leagueTab === key ? "active" : ""} onClick={() => setLeagueTab(key)}>{label}</button>)}</div>
            {leagueData?.errors?.some(Boolean) && <div className="error-bar league-data-errors"><div><strong>Some competition data could not be loaded.</strong><ul>{leagueData.errors.filter(Boolean).map((message, i) => <li key={`${i}-${message}`}>{message}</li>)}</ul></div></div>}

            {!leagueData ? <div className="loading-state">{t.loading}</div> :

              leagueTab === "matches" ? leagueData.matches.length ? <div className="match-grid">{leagueData.matches.map((m, index) => <MatchCard key={m.id ?? m.slug ?? index} match={m} onOpen={openMatch} showCompetition={false} />)}</div> : <div className="empty-state"><p>No competition matches returned. This competition may not be included in your plan.</p></div> :

              leagueTab === "standings" ? leagueData.standings.length ? leagueData.standings.map((table, i) => <div className="table-scroll" key={i}><h3>{table.group || table.type || "Table"}</h3><table><thead><tr><th>#</th><th>Team</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>{(table.table || []).map((row) => <tr key={row.team.id}><td>{row.position}</td><td className="table-team">{row.team.crest && <img src={row.team.crest} alt="" />} {row.team.name}</td><td>{row.playedGames}</td><td>{row.won}</td><td>{row.draw}</td><td>{row.lost}</td><td>{row.goalDifference}</td><td><strong>{row.points}</strong></td></tr>)}</tbody></table></div>) : <p className="muted">{t.noStandings}</p> :

              leagueTab === "teams" ? <div className="team-grid">{leagueData.teams.map((team) => <div className="team-tile" key={team.id}>{team.crest && <img src={team.crest} alt="" />}<span>{team.name}</span></div>)}</div> :

              leagueData.scorers.length ? <div className="table-scroll"><table><thead><tr><th>#</th><th>Player</th><th>Team</th><th>Goals</th><th>Assists</th></tr></thead><tbody>{leagueData.scorers.map((s, i) => <tr key={s.player?.id || i}><td>{i + 1}</td><td>{s.player?.name}</td><td>{s.team?.name}</td><td>{s.goals ?? 0}</td><td>{s.assists ?? 0}</td></tr>)}</tbody></table></div> : <p className="muted">Top scorers unavailable for this competition.</p>}

          </section>

        </main>

      )}



      {section === "article" && article && (

        <main className="main-wrap detail-wrap">

          <button className="back-button" onClick={() => { setSection("news"); setArticle(null); }}>← {t.news}</button>

          <article className="panel article-page">

            {article.imageUrl && <img className="article-hero" src={article.imageUrl} alt="" />}

            <span className="category-tag">{article.category || "News"}</span>

            <h1>{article.title}</h1>

            <p className="article-excerpt">{article.excerpt}</p>

            <time className="muted">{t.published}: {new Date(article.publishedAt).toLocaleString()}</time>

            <div className="article-body">{article.body}</div>

          </article>

        </main>

      )}



      <footer className="site-footer"><span>⚽ AG Football</span><span>Scores, schedules & updates</span><a href="https://sportscore.com/" target="_blank" rel="noreferrer">Powered by SportScore</a></footer>

    </div>

  );

}