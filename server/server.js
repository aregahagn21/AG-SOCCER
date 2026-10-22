
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 5000);
const SPORTScore_BASE = "https://sportscore.com";
const YEAR = new Date().getFullYear();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const NEWS_FILE = path.join(DATA_DIR, "news.json");

app.use(cors({
  origin: process.env.CLIENT_ORIGIN
    ? process.env.CLIENT_ORIGIN.split(",").map(value => value.trim())
    : true
}));
app.use(express.json({ limit: "1mb" }));

const http = axios.create({
  baseURL: SPORTScore_BASE,
  timeout: 20000,
  headers: { Accept: "application/json" }
});

// SportScore competition slugs.
// The English Premier League slug has been tested successfully.
const COMPETITIONS = [
  { id: "uefa-champions-league", name: "UEFA Champions League", country: "Europe" },
  { id: "english-premier-league", name: "English Premier League", country: "England" },
  { id: "spanish-la-liga", name: "Spanish La Liga", country: "Spain" },
  { id: "italian-serie-a", name: "Italian Serie A", country: "Italy" },
  { id: "german-bundesliga", name: "German Bundesliga", country: "Germany" },
  { id: "french-ligue-1", name: "French Ligue 1", country: "France" },
  { id: "uefa-europa-league", name: "UEFA Europa League", country: "Europe" },
  { id: "uefa-conference-league", name: "UEFA Conference League", country: "Europe" },
  { id: "portuguese-primeira-liga", name: "Portuguese Primeira Liga", country: "Portugal" },
  { id: "dutch-eredivisie", name: "Dutch Eredivisie", country: "Netherlands" },
  { id: "major-league-soccer", name: "Major League Soccer", country: "USA" }
];

const PRIORITY = [
  /champions league/i,
  /premier league/i,
  /la liga/i,
  /bundesliga/i,
  /serie a/i,
  /ligue 1/i,
  /europa league/i,
  /conference league/i,
  /primeira liga/i,
  /eredivisie/i,
  /major league soccer/i
];

function rank(name) {
  const index = PRIORITY.findIndex(pattern =>
    pattern.test(String(name || ""))
  );
  return index < 0 ? 999 : index;
}

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.matches)) return data.matches;
  if (Array.isArray(data?.fixtures)) return data.fixtures;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.response)) return data.response;
  if (Array.isArray(data?.scorers)) return data.scorers;
  return [];
}

async function getJSON(endpoint, params = {}) {
  const response = await http.get(endpoint, { params });

  if (response.data?.error) {
    const error = response.data.error;
    throw new Error(
      typeof error === "string" ? error : JSON.stringify(error)
    );
  }

  return response.data;
}

function slugFromUrl(url = "") {
  const match = String(url).match(/\/football\/match\/([^/]+)\//i);
  return match?.[1] || "";
}

function normalizeStatus(raw = {}) {
  const value = String(
    typeof raw === "string"
      ? raw
      : raw.status_text || raw.status || raw.short || ""
  ).toLowerCase();

  if (/live|1st half|2nd half|first half|second half|extra time|in progress/.test(value)) {
    return "IN_PLAY";
  }
  if (/half time|halftime|break/.test(value)) return "PAUSED";
  if (/finished|full time|ft|after penalties|ended/.test(value)) {
    return "FINISHED";
  }
  if (/postponed/.test(value)) return "POSTPONED";
  if (/cancelled|canceled|abandoned/.test(value)) return "CANCELLED";
  if (/suspended/.test(value)) return "SUSPENDED";

  return "SCHEDULED";
}

function normalizeMatch(raw = {}) {
  const home = raw.homeTeam || raw.teams?.home || {};
  const away = raw.awayTeam || raw.teams?.away || {};

  const homeName =
    typeof raw.home === "string"
      ? raw.home
      : home.name || raw.home_name || "Home team";

  const awayName =
    typeof raw.away === "string"
      ? raw.away
      : away.name || raw.away_name || "Away team";

  const url = raw.url || "";
  const slug = raw.slug || slugFromUrl(url) || raw.id || "";

  const homeScore =
    raw.home_score ?? raw.goals?.home ?? raw.score?.home ?? null;
  const awayScore =
    raw.away_score ?? raw.goals?.away ?? raw.score?.away ?? null;

  const date = raw.time || raw.date || raw.utcDate || raw.fixture?.date || null;
  const status = normalizeStatus(raw);

  const homeTeam = {
    id: home.slug || raw.home_slug || homeName.toLowerCase().replace(/\s+/g, "-"),
    name: homeName,
    shortName: homeName,
    logo: raw.home_logo || home.logo || home.crest || "",
    crest: raw.home_logo || home.logo || home.crest || ""
  };

  const awayTeam = {
    id: away.slug || raw.away_slug || awayName.toLowerCase().replace(/\s+/g, "-"),
    name: awayName,
    shortName: awayName,
    logo: raw.away_logo || away.logo || away.crest || "",
    crest: raw.away_logo || away.crest || away.logo || ""
  };

  const competitionName =
    raw.competition || raw.league?.name || raw.competition_name || "Football";

  const incidents = Array.isArray(raw.incidents) ? raw.incidents : [];

  const events = incidents.map((event, index) => {
    const type = String(event.type || "Event").toLowerCase();
    const isGoal = /goal|penalty/.test(type);
    const isCard = /card/.test(type);
    const isSubstitution = /substitution/.test(type);

    return {
      ...event,
      id: event.id ?? index,
      type: event.type || "Event",
      kind: isGoal
        ? "goal"
        : isCard
          ? "card"
          : isSubstitution
            ? "substitution"
            : "other",
      minute: event.time ?? event.minute ?? null,
      player: event.player ? { name: event.player } : null,
      team:
        event.side === "home"
          ? homeTeam
          : event.side === "away"
            ? awayTeam
            : null,
      playerIn: event.player_in ? { name: event.player_in } : null,
      playerOut: event.player_out ? { name: event.player_out } : null
    };
  });

  return {
    ...raw,
    id: String(slug),
    slug: String(slug),
    url,
    date,
    utcDate: date,
    timestamp: date ? Math.floor(new Date(date).getTime() / 1000) : null,

    competition: {
      id: raw.competition_slug || raw.competition?.slug ||
        competitionName.toLowerCase().replace(/\s+/g, "-"),
      name: competitionName,
      logo: raw.competition_logo || raw.league?.logo || "",
      emblem: raw.competition_logo || raw.league?.logo || ""
    },

    league: {
      id: raw.competition_slug || raw.competition?.slug ||
        competitionName.toLowerCase().replace(/\s+/g, "-"),
      name: competitionName,
      logo: raw.competition_logo || "",
      emblem: raw.competition_logo || "",
      season: YEAR
    },

    homeTeam,
    awayTeam,
    status,
    minute: raw.live_minute ?? raw.minute ?? null,

    state: {
      description: status,
      short: raw.status_text || raw.status || "",
      elapsed: raw.live_minute ?? null
    },

    score: {
      current: {
        home: homeScore === null || homeScore === "" ? null : Number(homeScore),
        away: awayScore === null || awayScore === "" ? null : Number(awayScore)
      },
      fullTime: {
        home: status === "FINISHED" && homeScore !== null
          ? Number(homeScore)
          : null,
        away: status === "FINISHED" && awayScore !== null
          ? Number(awayScore)
          : null
      },
      halfTime: { home: null, away: null }
    },

    goals: events.filter(event => event.kind === "goal"),
    events,
    bookings: events.filter(event => event.kind === "card"),
    substitutions: events.filter(event => event.kind === "substitution"),
    lineups: raw.lineups || null
  };
}

function normalizeScorer(raw = {}, index = 0) {
  return {
    ...raw,
    rank: raw.rank ?? index + 1,

    player: {
      id: raw.player_slug || raw.player?.slug || "",
      name: typeof raw.player === "string"
        ? raw.player
        : raw.player?.name || "Unknown player",
      photo: raw.player_logo || raw.player?.logo || "",
      logo: raw.player_logo || raw.player?.logo || ""
    },

    team: {
      id: raw.team_slug || raw.team?.slug || "",
      name: typeof raw.team === "string"
        ? raw.team
        : raw.team?.name || "Unknown team",
      logo: raw.team_logo || raw.team?.logo || ""
    },

    goals: Number(raw.goals ?? raw.goals_count ?? 0),
    assists: Number(raw.assists ?? 0),
    appearances: Number(raw.matches ?? raw.appearances ?? 0),
    minutes: Number(raw.minutes ?? 0)
  };
}

async function getStandings(slug) {
  return getJSON("/api/widget/standings/", {
    sport: "football",
    slug
  });
}

async function getMatchDetails(slug) {
  return getJSON("/api/widget/match/", {
    sport: "football",
    slug
  });
}

// News file management
async function readNews() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const data = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;

    await fs.writeFile(NEWS_FILE, "[]");
    return [];
  }
}

async function writeNews(items) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(NEWS_FILE, JSON.stringify(items, null, 2));
}

function admin(req, res, next) {
  const key = process.env.ADMIN_KEY;

  if (!key) {
    return res.status(503).json({
      success: false,
      message: "Set ADMIN_KEY to enable publishing."
    });
  }

  if (req.get("x-admin-key") !== key) {
    return res.status(401).json({
      success: false,
      message: "Invalid admin key."
    });
  }

  next();
}

function handleError(res, error) {
  console.error(
    "SportScore request failed:",
    error.response?.status,
    error.message
  );

  res.status(error.response?.status || 502).json({
    success: false,
    message: error.message || "SportScore request failed."
  });
}

// Home and health
app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "Welcome to AG SOCCER API ⚽",
    provider: "SportScore"
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    provider: "SportScore",
    adminConfigured: Boolean(process.env.ADMIN_KEY),
    currentYear: YEAR
  });
});

// Competitions
function sendCompetitions(_req, res) {
  const leagues = [...COMPETITIONS].sort(
    (a, b) => rank(a.name) - rank(b.name)
  );

  res.json({
    success: true,
    count: leagues.length,
    leagues,
    competitions: leagues
  });
}

app.get("/api/leagues", sendCompetitions);
app.get("/api/competitions", sendCompetitions);

app.get("/api/leagues/:id", (req, res) => {
  const league = COMPETITIONS.find(item => item.id === req.params.id);

  if (!league) {
    return res.status(404).json({
      success: false,
      message: "Competition slug not found. Use /api/leagues to see supported competitions."
    });
  }

  res.json({ success: true, league });
});

// Fixtures for a date
app.get("/api/matches", async (req, res) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "")
      ? req.query.date
      : new Date().toISOString().slice(0, 10);

    const params = {
      date,
      limit: Math.min(Number(req.query.limit) || 200, 200)
    };

    if (req.query.leagueId || req.query.competition) {
      params.competition = String(req.query.leagueId || req.query.competition);
    }

    if (req.query.team) params.team = String(req.query.team);
    if (req.query.status) params.status = String(req.query.status);

    const data = await getJSON("/api/v1/fixtures/", params);

    const matches = asArray(data)
      .map(normalizeMatch)
      .sort((a, b) =>
        rank(a.competition?.name) - rank(b.competition?.name) ||
        new Date(a.date || 0) - new Date(b.date || 0)
      );

    res.json({ success: true, date, count: matches.length, matches });
  } catch (error) {
    handleError(res, error);
  }
});

// Live matches
async function sendLiveMatches(_req, res) {
  try {
    const data = await getJSON("/api/v1/fixtures/", {
      status: "live",
      limit: 200
    });

    const matches = asArray(data)
      .map(normalizeMatch)
      .filter(match =>
        match.status === "IN_PLAY" || match.status === "PAUSED"
      )
      .sort((a, b) =>
        rank(a.competition?.name) - rank(b.competition?.name)
      );

    res.json({
      success: true,
      date: new Date().toISOString().slice(0, 10),
      count: matches.length,
      matches
    });
  } catch (error) {
    handleError(res, error);
  }
}

app.get("/api/live", sendLiveMatches);
app.get("/api/matches/live", sendLiveMatches);

// Match events
app.get("/api/matches/:id/events", async (req, res) => {
  try {
    const data = await getMatchDetails(req.params.id);
    const raw = data.match || data;
    const match = normalizeMatch(raw);
    const events = match.events || [];

    res.json({
      success: true,
      events,
      goals: events.filter(event => event.kind === "goal"),
      bookings: events.filter(event => event.kind === "card"),
      substitutions: events.filter(event => event.kind === "substitution")
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Match lineups
app.get("/api/matches/:id/lineups", async (req, res) => {
  try {
    const data = await getMatchDetails(req.params.id);
    const raw = data.match || data;

    res.json({
      success: true,
      lineups: raw.lineups || null
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Match statistics
app.get("/api/matches/:id/statistics", async (req, res) => {
  try {
    const data = await getMatchDetails(req.params.id);
    const raw = data.match || data;

    res.json({
      success: true,
      statistics: raw.stats || []
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Full match details
app.get("/api/matches/:id", async (req, res) => {
  try {
    const data = await getMatchDetails(req.params.id);
    const raw = data.match || data;

    if (!raw.home || !raw.away) {
      return res.status(404).json({
        success: false,
        message: "Match details were not found."
      });
    }

    const match = normalizeMatch(raw);

    res.json({
      success: true,
      match,
      details: {
        events: Array.isArray(raw.incidents),
        lineups: Boolean(raw.lineups),
        statistics: Array.isArray(raw.stats)
      }
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Standings
app.get("/api/leagues/:id/standings", async (req, res) => {
  try {
    const data = await getStandings(req.params.id);
    const tables = data.tables || [];

    const standings = tables.map(table =>
      (table.rows || []).map(row => ({
        rank: row.pos,
        position: row.pos,
        team: {
          id: row.team_slug,
          name: row.team,
          logo: row.team_logo || ""
        },
        played: row.p,
        won: row.w,
        draw: row.d,
        lost: row.l,
        goalsFor: row.gf,
        goalsAgainst: row.ga,
        goalDifference: row.gd,
        points: row.pts,
        form: row.form || null,
        description: row.promo_name || null
      }))
    );

    res.json({
      success: true,
      league: {
        id: data.competition_slug || req.params.id,
        name: data.competition || req.params.id,
        logo: data.competition_logo || ""
      },
      season: YEAR,
      tables,
      standings
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/standings/:id", async (req, res) => {
  try {
    const data = await getStandings(req.params.id);
    const tables = data.tables || [];

    const standings = tables.map(table =>
      (table.rows || []).map(row => ({
        rank: row.pos,
        position: row.pos,
        team: {
          id: row.team_slug,
          name: row.team,
          logo: row.team_logo || ""
        },
        played: row.p,
        won: row.w,
        draw: row.d,
        lost: row.l,
        goalsFor: row.gf,
        goalsAgainst: row.ga,
        goalDifference: row.gd,
        points: row.pts,
        form: row.form || null,
        description: row.promo_name || null
      }))
    );

    res.json({
      success: true,
      league: {
        id: data.competition_slug || req.params.id,
        name: data.competition || req.params.id,
        logo: data.competition_logo || ""
      },
      season: YEAR,
      tables,
      standings
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Matches for a competition on a given date
app.get("/api/leagues/:id/matches", async (req, res) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "")
      ? req.query.date
      : new Date().toISOString().slice(0, 10);

    const data = await getJSON("/api/v1/fixtures/", {
      date,
      competition: req.params.id,
      limit: Math.min(Number(req.query.limit) || 200, 200)
    });

    const matches = asArray(data).map(normalizeMatch);

    res.json({
      success: true,
      league: COMPETITIONS.find(item => item.id === req.params.id) ||
        { id: req.params.id },
      season: YEAR,
      date,
      count: matches.length,
      matches
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Team search
app.get("/api/teams", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();

    if (!search) {
      return res.json({
        success: true,
        count: 0,
        teams: [],
        message: "Enter ?search=team-name to search for teams."
      });
    }

    const data = await getJSON("/api/v1/search/", {
      q: search,
      sport: "football",
      limit: 20
    });

    const teams = (data.teams || []).map(team => ({
      id: team.slug || team.id,
      slug: team.slug || "",
      name: team.name,
      logo: team.logo || "",
      crest: team.logo || "",
      country: team.country || ""
    }));

    res.json({ success: true, count: teams.length, teams });
  } catch (error) {
    handleError(res, error);
  }
});

// Team details and fixtures
app.get("/api/teams/:id", async (req, res) => {
  try {
    const data = await getJSON("/api/widget/team/", {
      sport: "football",
      slug: req.params.id,
      limit: 10
    });

    res.json({
      success: true,
      team: data.team || data,
      matches: data.matches || []
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Teams listed in a competition's standings
app.get("/api/leagues/:id/teams", async (req, res) => {
  try {
    const data = await getStandings(req.params.id);

    const teams = (data.tables || []).flatMap(table =>
      (table.rows || []).map(row => ({
        id: row.team_slug,
        slug: row.team_slug,
        name: row.team,
        logo: row.team_logo || "",
        crest: row.team_logo || ""
      }))
    );

    res.json({
      success: true,
      league: data.competition || req.params.id,
      count: teams.length,
      teams
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Top scorers and assists
app.get("/api/leagues/:id/scorers", async (req, res) => {
  try {
    const data = await getJSON("/api/widget/topscorers/", {
      sport: "football",
      slug: req.params.id,
      limit: Math.min(Number(req.query.limit) || 20, 50),
      stat: req.query.stat || "goals"
    });

    const scorers = (data.scorers || []).map(normalizeScorer);

    res.json({
      success: true,
      league: data.competition || req.params.id,
      season: YEAR,
      count: scorers.length,
      scorers
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/scorers/:id", async (req, res) => {
  try {
    const data = await getJSON("/api/widget/topscorers/", {
      sport: "football",
      slug: req.params.id,
      limit: Math.min(Number(req.query.limit) || 20, 50),
      stat: req.query.stat || "goals"
    });

    const scorers = (data.scorers || []).map(normalizeScorer);

    res.json({
      success: true,
      league: data.competition || req.params.id,
      count: scorers.length,
      scorers
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Search teams, competitions, and players
app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q || req.query.search || "").trim();

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Provide a search term using ?q=..."
      });
    }

    const data = await getJSON("/api/v1/search/", {
      q,
      sport: "football",
      limit: 20
    });

    res.json({ success: true, ...data });
  } catch (error) {
    handleError(res, error);
  }
});

// News — public list
app.get("/api/news", async (_req, res) => {
  try {
    const news = (await readNews()).sort(
      (a, b) =>
        new Date(b.publishedAt || b.createdAt || 0) -
        new Date(a.publishedAt || a.createdAt || 0)
    );

    res.json({ success: true, count: news.length, news });
  } catch (error) {
    handleError(res, error);
  }
});

// News — admin publishing
app.post("/api/news", admin, async (req, res) => {
  try {
    const body = req.body || {};
    const title = String(body.title || "").trim();
    const excerpt = String(
      body.excerpt || body.summary || body.description || ""
    ).trim();
    const articleBody = String(
      body.body || body.description || excerpt
    ).trim();

    if (!title || !excerpt) {
      return res.status(400).json({
        success: false,
        message: "A title and summary are required."
      });
    }

    const news = await readNews();

    const article = {
      id: String(Date.now()),
      title,
      excerpt,
      summary: excerpt,
      body: articleBody,
      description: articleBody,
      imageUrl: String(body.imageUrl || body.image || "").trim(),
      image: String(body.image || body.imageUrl || "").trim(),
      url: String(body.url || "").trim(),
      category: String(body.category || "Football"),
      publishedAt: new Date().toISOString()
    };

    news.unshift(article);
    await writeNews(news);

    res.status(201).json({
      success: true,
      news: article,
      article
    });
  } catch (error) {
    handleError(res, error);
  }
});

// News — admin deletion
app.delete("/api/news/:id", admin, async (req, res) => {
  try {
    const items = await readNews();
    const updated = items.filter(
      item => String(item.id) !== req.params.id
    );

    if (updated.length === items.length) {
      return res.status(404).json({
        success: false,
        message: "News article not found."
      });
    }

    await writeNews(updated);

    res.json({
      success: true,
      message: "News article deleted."
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Unknown API route
app.use("/api", (_req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found."
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AG SOCCER API running on port ${PORT}`);
  console.log("Football data provider: SportScore");
  console.log(`Admin key configured: ${Boolean(process.env.ADMIN_KEY)}`);
});
