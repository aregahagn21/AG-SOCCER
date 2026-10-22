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

const API_BASE =
  process.env.API_FOOTBALL_BASE_URL ||
  "https://v3.football.api-sports.io";

const API_KEY = process.env.API_FOOTBALL_KEY || "";

// Set this to a season your subscription supports.
// Your previously reported free plan supported seasons 2022–2024.
const DEFAULT_SEASON = Number(
  process.env.API_FOOTBALL_SEASON || 2026
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const NEWS_FILE = path.join(DATA_DIR, "news.json");

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN
      ? process.env.CLIENT_ORIGIN.split(",").map((x) => x.trim())
      : true,
  })
);

app.use(express.json({ limit: "1mb" }));

// API-Football authentication
const footballAPI = axios.create({
  baseURL: API_BASE.replace(/\/$/, ""),
  timeout: 25000,
  headers: {
    "x-apisports-key": API_KEY,
    Accept: "application/json",
  },
});

// Major competitions appear first.
const PRIORITY = [
  /champions league/i,
  /premier league/i,
  /la liga|primera division/i,
  /bundesliga/i,
  /serie a/i,
  /ligue 1/i,
  /europa league/i,
  /conference league/i,
  /primeira liga/i,
  /eredivisie/i,
  /major league soccer/i,
];

function leagueRank(name) {
  const index = PRIORITY.findIndex((pattern) =>
    pattern.test(String(name || ""))
  );

  return index === -1 ? 999 : index;
}

function numberOrNull(value) {
  if (value === 0) return 0;

  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(Number(value))
  ) {
    return null;
  }

  return Number(value);
}

function getSeason(req) {
  const season = Number(req.query.season || DEFAULT_SEASON);

  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    const error = new Error("Invalid season.");
    error.status = 400;
    throw error;
  }

  return season;
}

function normalizeStatus(status = {}) {
  const short = String(
    typeof status === "object" ? status.short || "" : status
  ).toUpperCase();

  const long = String(
    typeof status === "object" ? status.long || "" : ""
  ).toLowerCase();

  if (["FT", "AET", "PEN"].includes(short)) return "FINISHED";

  if (
    ["1H", "2H", "ET", "BT", "P", "LIVE"].includes(short)
  ) {
    return "IN_PLAY";
  }

  if (short === "HT") return "PAUSED";
  if (short === "PST") return "POSTPONED";
  if (short === "CANC") return "CANCELLED";
  if (short === "SUSP") return "SUSPENDED";
  if (short === "ABD") return "ABANDONED";

  if (short === "NS") return "SCHEDULED";

  if (long.includes("finished")) return "FINISHED";
  if (long.includes("live")) return "IN_PLAY";

  return short || "SCHEDULED";
}

function normalizeLeague(raw = {}) {
  const seasons = (raw.seasons || [])
    .map((item) => Number(item.year))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);

  const currentSeason =
    seasons.find((year) => year >= new Date().getFullYear() - 1) ??
    null;

  return {
    id: raw.league?.id ?? raw.id ?? null,
    name: raw.league?.name ?? raw.name ?? "Unknown competition",
    type: raw.league?.type ?? raw.type ?? "",
    code: raw.league?.code ?? raw.code ?? "",
    logo: raw.league?.logo ?? raw.logo ?? "",
    emblem: raw.league?.logo ?? raw.logo ?? "",
    country: raw.country?.name ?? raw.country ?? "",
    countryCode: raw.country?.code ?? "",
    seasons: seasons.map((season) => ({ season })),
    currentSeason,
    currentSeasonAvailable: currentSeason !== null,
  };
}

function normalizeTeam(team = {}) {
  return {
    ...team,
    id: team.id ?? null,
    name: team.name ?? "Unknown team",
    shortName: team.code ?? team.name ?? "",
    logo: team.logo ?? "",
    crest: team.logo ?? "",
  };
}

function normalizeEvent(event = {}) {
  const time = event.time || {};
  const type = String(event.type || "").toLowerCase();
  const detail = String(event.detail || "").toLowerCase();

  let kind = "other";

  if (type === "goal") {
    kind = "goal";
  } else if (type === "card") {
    kind = "card";
  } else if (type === "subst") {
    kind = "substitution";
  }

  return {
    ...event,
    kind,
    type,
    detail: event.detail ?? "",
    minute: numberOrNull(time.elapsed),
    injuryTime: numberOrNull(time.extra),
    team: event.team
      ? {
          id: event.team.id,
          name: event.team.name,
          logo: event.team.logo,
        }
      : null,
    player: event.player
      ? {
          id: event.player.id,
          name: event.player.name,
        }
      : null,
    assist: event.assist
      ? {
          id: event.assist.id,
          name: event.assist.name,
        }
      : null,
    scorer:
      kind === "goal"
        ? {
            id: event.player?.id ?? null,
            name: event.player?.name ?? "Unknown player",
          }
        : null,
    playerIn:
      kind === "substitution"
        ? {
            id: event.assist?.id ?? null,
            name: event.assist?.name ?? "Unknown player",
          }
        : null,
    playerOut:
      kind === "substitution"
        ? {
            id: event.player?.id ?? null,
            name: event.player?.name ?? "Unknown player",
          }
        : null,
    card:
      kind === "card"
        ? detail
        : null,
    goalType:
      kind === "goal"
        ? detail
        : null,
  };
}

function normalizeMatch(raw = {}) {
  const fixture = raw.fixture || {};
  const teams = raw.teams || {};
  const goals = raw.goals || {};
  const score = raw.score || {};
  const league = normalizeLeague(raw.league || {});

  const homeScore = numberOrNull(goals.home);
  const awayScore = numberOrNull(goals.away);

  const status = normalizeStatus(fixture.status || raw.status);

  const homeTeam = normalizeTeam(teams.home || {});
  const awayTeam = normalizeTeam(teams.away || {});

  return {
    ...raw,

    id: fixture.id ?? raw.id ?? null,

    date: fixture.date ?? raw.date ?? null,
    utcDate: fixture.date ?? raw.date ?? null,

    timestamp: fixture.timestamp ?? null,
    venue: fixture.venue ?? null,
    referee: fixture.referee ?? null,

    league,

    competition: {
      id: league.id,
      name: league.name,
      code: league.code,
      logo: league.logo,
      emblem: league.emblem,
    },

    homeTeam,
    awayTeam,

    status,

    minute: numberOrNull(fixture.status?.elapsed),
    injuryTime: null,

    score: {
      current: {
        home: homeScore,
        away: awayScore,
      },
      fullTime: {
        home: numberOrNull(score.fulltime?.home),
        away: numberOrNull(score.fulltime?.away),
      },
      halfTime: {
        home: numberOrNull(score.halftime?.home),
        away: numberOrNull(score.halftime?.away),
      },
      extraTime: {
        home: numberOrNull(score.extratime?.home),
        away: numberOrNull(score.extratime?.away),
      },
      penalties: {
        home: numberOrNull(score.penalty?.home),
        away: numberOrNull(score.penalty?.away),
      },
    },

    goals: [],
    events: [],
    bookings: [],
    substitutions: [],
    lineups: null,
  };
}

function isLive(match) {
  return [
    "IN_PLAY",
    "PAUSED",
    "EXTRA_TIME",
    "PENALTY_SHOOTOUT",
  ].includes(match.status);
}

async function get(endpoint, params = {}) {
  if (!API_KEY) {
    const error = new Error(
      "API_FOOTBALL_KEY is missing. Add it to your server .env file or Render environment variables."
    );

    error.status = 503;
    throw error;
  }

  const response = await footballAPI.get(endpoint, { params });

  if (response.data?.errors) {
    const details = response.data.errors;
    const message =
      typeof details === "object"
        ? JSON.stringify(details)
        : String(details);

    const error = new Error(message);
    error.status = 502;
    throw error;
  }

  return response.data;
}

function apiError(res, error) {
  const status =
    error.status ||
    error.response?.status ||
    502;

  const providerMessage =
    error.response?.data?.errors ||
    error.response?.data?.message ||
    error.message ||
    "Unknown API error";

  console.error("API-Football request failed:", providerMessage);

  res.status(status >= 400 && status < 500 ? status : 502).json({
    success: false,
    message:
      typeof providerMessage === "object"
        ? JSON.stringify(providerMessage)
        : String(providerMessage),
    providerStatus: error.response?.status ?? null,
  });
}

function admin(req, res, next) {
  const key = process.env.ADMIN_KEY;

  if (!key) {
    return res.status(503).json({
      success: false,
      message: "Set ADMIN_KEY in your environment to enable publishing.",
    });
  }

  if (req.get("x-admin-key") !== key) {
    return res.status(401).json({
      success: false,
      message: "Invalid admin key.",
    });
  }

  next();
}

async function readNews() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const data = await fs.readFile(NEWS_FILE, "utf8");
    const news = JSON.parse(data);

    return Array.isArray(news) ? news : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;

    await fs.writeFile(NEWS_FILE, "[]");
    return [];
  }
}

async function writeNews(news) {
  await fs.mkdir(DATA_DIR, { recursive: true });

  await fs.writeFile(
    NEWS_FILE,
    JSON.stringify(news, null, 2)
  );
}

// -----------------------------------------------------
// HEALTH AND TEST
// -----------------------------------------------------

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "Welcome to AG SOCCER API ⚽",
    provider: "API-Football",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    provider: "API-Football",
    apiKeyConfigured: Boolean(API_KEY),
    adminConfigured: Boolean(process.env.ADMIN_KEY),
    defaultSeason: DEFAULT_SEASON,
  });
});

app.get("/api/test", async (_req, res) => {
  try {
    const data = await get("/status");

    res.json({
      success: true,
      provider: "API-Football",
      response: data.response,
      results: data.results,
      errors: data.errors,
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// LEAGUES AND COMPETITIONS
// -----------------------------------------------------

async function sendLeagues(req, res) {
  try {
    const params = {};

    if (req.query.country) params.country = req.query.country;
    if (req.query.season) params.season = getSeason(req);
    if (req.query.search) params.search = req.query.search;
    if (req.query.id) params.id = Number(req.query.id);

    const data = await get("/leagues", params);

    const leagues = (data.response || [])
      .map((item) => normalizeLeague(item))
      .sort(
        (a, b) =>
          leagueRank(a.name) - leagueRank(b.name) ||
          a.name.localeCompare(b.name)
      );

    res.json({
      success: true,
      count: leagues.length,
      leagues,
      competitions: leagues,
    });
  } catch (error) {
    apiError(res, error);
  }
}

app.get("/api/leagues", sendLeagues);
app.get("/api/competitions", sendLeagues);

app.get("/api/leagues/:id", async (req, res) => {
  try {
    const data = await get("/leagues", {
      id: Number(req.params.id),
      season: getSeason(req),
    });

    const item = data.response?.[0];

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Competition not found.",
      });
    }

    res.json({
      success: true,
      league: normalizeLeague(item),
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// MATCHES FOR A DATE
// -----------------------------------------------------

app.get("/api/matches", async (req, res) => {
  try {
    const date =
      /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "")
        ? req.query.date
        : new Date().toISOString().slice(0, 10);

    const params = {
      date,
      timezone: req.query.timezone || "Africa/Addis_Ababa",
    };

    if (req.query.leagueId) {
      params.league = Number(req.query.leagueId);
      params.season = getSeason(req);
    }

    const data = await get("/fixtures", params);

    const matches = (data.response || [])
      .map(normalizeMatch)
      .sort(
        (a, b) =>
          leagueRank(a.competition.name) -
            leagueRank(b.competition.name) ||
          new Date(a.utcDate) - new Date(b.utcDate)
      );

    res.json({
      success: true,
      date,
      count: matches.length,
      matches,
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// LIVE MATCHES
// -----------------------------------------------------

app.get("/api/live", async (_req, res) => {
  try {
    const data = await get("/fixtures", {
      live: "all",
      timezone: "Africa/Addis_Ababa",
    });

    const matches = (data.response || [])
      .map(normalizeMatch)
      .filter(isLive)
      .sort(
        (a, b) =>
          leagueRank(a.competition.name) -
          leagueRank(b.competition.name)
      );

    res.json({
      success: true,
      count: matches.length,
      matches,
    });
  } catch (error) {
    apiError(res, error);
  }
});

app.get("/api/matches/live", async (_req, res) => {
  try {
    const data = await get("/fixtures", {
      live: "all",
      timezone: "Africa/Addis_Ababa",
    });

    const matches = (data.response || [])
      .map(normalizeMatch)
      .filter(isLive);

    res.json({
      success: true,
      count: matches.length,
      matches,
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// MATCH EVENTS
// -----------------------------------------------------

app.get("/api/matches/:id/events", async (req, res) => {
  try {
    const data = await get("/fixtures/events", {
      fixture: Number(req.params.id),
    });

    const events = (data.response || []).map(normalizeEvent);

    res.json({
      success: true,
      count: events.length,
      events,
      goals: events.filter((event) => event.kind === "goal"),
      bookings: events.filter((event) => event.kind === "card"),
      substitutions: events.filter(
        (event) => event.kind === "substitution"
      ),
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// LINEUPS
// -----------------------------------------------------

app.get("/api/matches/:id/lineups", async (req, res) => {
  try {
    const data = await get("/fixtures/lineups", {
      fixture: Number(req.params.id),
    });

    res.json({
      success: true,
      lineups: data.response || [],
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// MATCH STATISTICS
// -----------------------------------------------------

app.get("/api/matches/:id/statistics", async (req, res) => {
  try {
    const data = await get("/fixtures/statistics", {
      fixture: Number(req.params.id),
    });

    res.json({
      success: true,
      statistics: data.response || [],
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// COMPLETE MATCH DETAILS
// -----------------------------------------------------

app.get("/api/matches/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [fixtureData, eventResult, lineupResult, statsResult] =
      await Promise.allSettled([
        get("/fixtures", { id }),
        get("/fixtures/events", { fixture: id }),
        get("/fixtures/lineups", { fixture: id }),
        get("/fixtures/statistics", { fixture: id }),
      ]);

    if (fixtureData.status !== "fulfilled") {
      throw fixtureData.reason;
    }

    const raw = fixtureData.value.response?.[0];

    if (!raw) {
      return res.status(404).json({
        success: false,
        message: "Match not found.",
      });
    }

    const match = normalizeMatch(raw);

    const events =
      eventResult.status === "fulfilled"
        ? (eventResult.value.response || []).map(normalizeEvent)
        : [];

    const lineups =
      lineupResult.status === "fulfilled"
        ? lineupResult.value.response || []
        : [];

    const statistics =
      statsResult.status === "fulfilled"
        ? statsResult.value.response || []
        : [];

    match.events = events;
    match.goals = events.filter((event) => event.kind === "goal");
    match.bookings = events.filter((event) => event.kind === "card");
    match.substitutions = events.filter(
      (event) => event.kind === "substitution"
    );
    match.lineups = lineups;
    match.statistics = statistics;

    res.json({
      success: true,
      match,
      details: {
        events: eventResult.status === "fulfilled",
        lineups: lineupResult.status === "fulfilled",
        statistics: statsResult.status === "fulfilled",
      },
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// LEAGUE STANDINGS
// -----------------------------------------------------

app.get("/api/leagues/:id/standings", async (req, res) => {
  try {
    const season = getSeason(req);

    const data = await get("/standings", {
      league: Number(req.params.id),
      season,
    });

    const leagueData = data.response?.[0];

    res.json({
      success: true,
      league: leagueData?.league
        ? normalizeLeague(leagueData)
        : { id: Number(req.params.id) },
      season,
      standings: leagueData?.league?.standings || [],
    });
  } catch (error) {
    apiError(res, error);
  }
});

app.get("/api/standings/:id", async (req, res) => {
  try {
    const season = getSeason(req);

    const data = await get("/standings", {
      league: Number(req.params.id),
      season,
    });

    res.json({
      success: true,
      season,
      standings: data.response?.[0]?.league?.standings || [],
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// LEAGUE MATCHES
// -----------------------------------------------------

app.get("/api/leagues/:id/matches", async (req, res) => {
  try {
    const season = getSeason(req);

    const data = await get("/fixtures", {
      league: Number(req.params.id),
      season,
      timezone: "Africa/Addis_Ababa",
    });

    const matches = (data.response || [])
      .map(normalizeMatch)
      .sort(
        (a, b) =>
          new Date(a.utcDate) - new Date(b.utcDate)
      );

    res.json({
      success: true,
      season,
      count: matches.length,
      matches,
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// TEAMS
// -----------------------------------------------------

app.get("/api/teams", async (req, res) => {
  try {
    const params = {};

    if (req.query.leagueId) {
      params.league = Number(req.query.leagueId);
      params.season = getSeason(req);
    }

    if (req.query.season && !params.season) {
      params.season = getSeason(req);
    }

    if (req.query.search) {
      params.search = req.query.search;
    }

    if (req.query.country) {
      params.country = req.query.country;
    }

    const data = await get("/teams", params);

    const teams = (data.response || []).map((item) =>
      normalizeTeam(item.team || item)
    );

    res.json({
      success: true,
      count: teams.length,
      teams,
    });
  } catch (error) {
    apiError(res, error);
  }
});

app.get("/api/teams/:id", async (req, res) => {
  try {
    const data = await get("/teams", {
      id: Number(req.params.id),
    });

    const item = data.response?.[0];

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Team not found.",
      });
    }

    res.json({
      success: true,
      team: normalizeTeam(item.team || item),
    });
  } catch (error) {
    apiError(res, error);
  }
});

app.get("/api/leagues/:id/teams", async (req, res) => {
  try {
    const season = getSeason(req);

    const data = await get("/teams", {
      league: Number(req.params.id),
      season,
    });

    const teams = (data.response || []).map((item) =>
      normalizeTeam(item.team || item)
    );

    res.json({
      success: true,
      season,
      count: teams.length,
      teams,
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// TOP SCORERS
// -----------------------------------------------------

app.get("/api/leagues/:id/scorers", async (req, res) => {
  try {
    const season = getSeason(req);

    const data = await get("/players/topscorers", {
      league: Number(req.params.id),
      season,
    });

    const scorers = data.response || [];

    res.json({
      success: true,
      season,
      count: scorers.length,
      scorers,
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// NEWS
// -----------------------------------------------------

app.get("/api/news", async (_req, res) => {
  try {
    const news = (await readNews()).sort(
      (a, b) =>
        new Date(b.publishedAt || b.createdAt || 0) -
        new Date(a.publishedAt || a.createdAt || 0)
    );

    res.json({
      success: true,
      count: news.length,
      news,
    });
  } catch (error) {
    apiError(res, error);
  }
});

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
        message: "A title and summary are required.",
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
      publishedAt: new Date().toISOString(),
    };

    news.unshift(article);
    await writeNews(news);

    res.status(201).json({
      success: true,
      news: article,
      article,
    });
  } catch (error) {
    apiError(res, error);
  }
});

app.delete("/api/news/:id", admin, async (req, res) => {
  try {
    const news = await readNews();

    const updated = news.filter(
      (item) => String(item.id) !== req.params.id
    );

    if (updated.length === news.length) {
      return res.status(404).json({
        success: false,
        message: "News article not found.",
      });
    }

    await writeNews(updated);

    res.json({
      success: true,
      message: "News article deleted.",
    });
  } catch (error) {
    apiError(res, error);
  }
});

// -----------------------------------------------------
// UNKNOWN API ROUTES
// -----------------------------------------------------

app.use("/api", (_req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found.",
  });
});

// -----------------------------------------------------
// START SERVER
// -----------------------------------------------------

app.listen(PORT, () => {
  console.log(`AG SOCCER API running on port ${PORT}`);
  console.log(`Provider: API-Football`);
  console.log(`API key configured: ${Boolean(API_KEY)}`);
  console.log(`Default season: ${DEFAULT_SEASON}`);
});
