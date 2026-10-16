
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const API_BASE =
  process.env.HIGHLIGHTLY_BASE_URL || "https://soccer.highlightly.net";
const API_KEY =
  process.env.HIGHLIGHTLY_API_KEY ||
  process.env.RAPIDAPI_KEY ||
  process.env.API_KEY;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const NEWS_FILE = path.join(DATA_DIR, "news.json");
const CURRENT_YEAR = new Date().getFullYear();

app.use(cors({
  origin: process.env.CLIENT_ORIGIN
    ? process.env.CLIENT_ORIGIN.split(",").map((s) => s.trim())
    : true,
}));
app.use(express.json({ limit: "1mb" }));

const api = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
  headers: {
    "x-rapidapi-key": API_KEY || "",
    Accept: "application/json",
  },
});

const PRIORITY = [
  "premier league",
  "uefa champions league",
  "la liga",
  "serie a",
  "bundesliga",
  "ligue 1",
  "europa league",
  "conference league",
  "world cup",
  "major league soccer",
];

function unwrap(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.data && typeof payload.data === "object") return payload.data;
  return payload;
}

function getArray(payload, ...keys) {
  const value = unwrap(payload);
  if (Array.isArray(value)) return value;

  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }
  return [];
}

function sortLeagues(leagues) {
  return [...leagues].sort((a, b) => {
    const nameA = String(a.name || "").toLowerCase();
    const nameB = String(b.name || "").toLowerCase();

    const indexA = PRIORITY.findIndex((name) => nameA.includes(name));
    const indexB = PRIORITY.findIndex((name) => nameB.includes(name));

    const rankA = indexA === -1 ? 999 : indexA;
    const rankB = indexB === -1 ? 999 : indexB;

    return rankA - rankB || nameA.localeCompare(nameB);
  });
}

function normalizeLeague(league) {
  const seasons = (league?.seasons || [])
    .map((item) => Number(item?.season ?? item))
    .filter((year) => Number.isInteger(year))
    .sort((a, b) => b - a);

  // Never label an old season as current.
  const currentSeason =
    seasons.find((year) =>
      year >= CURRENT_YEAR - 1 && year <= CURRENT_YEAR
    ) ?? null;

  return {
    ...league,
    id: league?.id,
    name: league?.name || "Unknown competition",
    logo: league?.logo || "",
    country: league?.country || null,
    seasons: [...new Set(seasons)].map((season) => ({ season })),
    currentSeason,
    currentSeasonAvailable: currentSeason !== null,
  };
}

function normalizeMatch(match) {
  const home = match?.homeTeam || match?.home || {};
  const away = match?.awayTeam || match?.away || {};
  const league = match?.league || match?.competition || {};
  const state = match?.state || {};
  const score = state?.score?.current || match?.score || {};

  return {
    ...match,
    id: match?.id,
    date: match?.date || match?.utcDate || null,
    utcDate: match?.date || match?.utcDate || null,
    league: {
      id: league?.id ?? match?.leagueId,
      name: league?.name || "Unknown competition",
      logo: league?.logo || league?.emblem || "",
      season: league?.season ?? null,
      country: league?.country || match?.country || null,
    },
    competition: {
      id: league?.id ?? match?.leagueId,
      name: league?.name || "Unknown competition",
      emblem: league?.logo || league?.emblem || "",
    },
    homeTeam: {
      ...home,
      id: home?.id,
      name: home?.name || "Home team",
      logo: home?.logo || home?.crest || "",
    },
    awayTeam: {
      ...away,
      id: away?.id,
      name: away?.name || "Away team",
      logo: away?.logo || away?.crest || "",
    },
    state: {
      ...state,
      description: state?.description || state?.status || "Scheduled",
      clock: state?.clock || null,
      score: state?.score || { current: score },
    },
    status: state?.description || state?.status || match?.status || "SCHEDULED",
    score: match?.score || {
      fullTime: {
        home: score?.home ?? null,
        away: score?.away ?? null,
      },
    },
  };
}

function isLive(match) {
  const text = [
    match?.state?.description,
    match?.state?.status,
    match?.status,
  ].filter(Boolean).join(" ").toLowerCase();

  return (
    text.includes("live") ||
    text.includes("in play") ||
    text.includes("in progress") ||
    text.includes("1st half") ||
    text.includes("2nd half") ||
    text.includes("half time") ||
    text.includes("halftime") ||
    text.includes("extra time") ||
    text.includes("penalties")
  );
}

function requireApiKey(_req, res, next) {
  if (!API_KEY) {
    return res.status(500).json({
      success: false,
      message: "Highlightly API key is missing. Configure HIGHLIGHTLY_API_KEY in server/.env.",
    });
  }
  next();
}

async function providerGet(endpoint, params = {}) {
  const response = await api.get(endpoint, { params });
  return response.data;
}

async function getLeague(leagueId) {
  const payload = await providerGet(`/leagues/${encodeURIComponent(leagueId)}`);
  const league = Array.isArray(payload)
    ? payload[0]
    : payload?.data?.[0] || payload?.data || payload;

  if (!league?.id) {
    throw new Error(`Competition ${leagueId} was not found.`);
  }

  return normalizeLeague(league);
}

async function resolveSeason(leagueId, requestedSeason) {
  const league = await getLeague(leagueId);
  const available = league.seasons.map((item) => item.season);

  if (requestedSeason !== undefined && requestedSeason !== "") {
    const year = Number(requestedSeason);

    if (!Number.isInteger(year) || !available.includes(year)) {
      const error = new Error(
        `Season ${requestedSeason} is not available for ${league.name}. Available seasons: ${available.join(", ") || "none"}.`
      );
      error.status = 400;
      throw error;
    }

    if (year < CURRENT_YEAR - 1) {
      const error = new Error(
        `Season ${year} is historical. Select the current available season instead.`
      );
      error.status = 400;
      throw error;
    }

    return { league, season: year };
  }

  if (league.currentSeason === null) {
    const error = new Error(
      `No current season is listed for ${league.name}. Available seasons: ${available.join(", ") || "none"}. This endpoint will not silently use an old season.`
    );
    error.status = 409;
    throw error;
  }

  return { league, season: league.currentSeason };
}

async function readNews() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const content = await fs.readFile(NEWS_FILE, "utf8");
    const news = JSON.parse(content);
    return Array.isArray(news) ? news : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.writeFile(NEWS_FILE, "[]", "utf8");
    return [];
  }
}

async function writeNews(news) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(NEWS_FILE, JSON.stringify(news, null, 2), "utf8");
}

function requireAdmin(req, res, next) {
  const configuredKey = process.env.ADMIN_KEY;
  const suppliedKey = req.get("x-admin-key");

  if (!configuredKey) {
    return res.status(503).json({
      success: false,
      message: "Admin publishing is disabled. Set ADMIN_KEY in server/.env.",
    });
  }

  if (!suppliedKey || suppliedKey !== configuredKey) {
    return res.status(401).json({
      success: false,
      message: "Invalid admin key.",
    });
  }

  next();
}

function handleError(res, error) {
  const status = error.status || error.response?.status || 500;
  const providerMessage =
    error.response?.data?.message ||
    error.response?.data?.error ||
    error.message ||
    "Unknown error";

  console.error("AG SOCCER API error:", {
    endpoint: error.config?.url,
    status,
    message: providerMessage,
  });

  res.status(status >= 400 && status < 500 ? status : 502).json({
    success: false,
    message: providerMessage,
  });
}

// Health check
app.get("/", (_req, res) => {
  res.json({ success: true, message: "Welcome to AG SOCCER API ⚽" });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    apiKeyConfigured: Boolean(API_KEY),
    adminConfigured: Boolean(process.env.ADMIN_KEY),
    currentYear: CURRENT_YEAR,
  });
});

// Competitions, with famous leagues first and their available seasons.
app.get("/api/leagues", requireApiKey, async (_req, res) => {
  try {
    const payload = await providerGet("/leagues", {
      limit: 100,
      offset: 0,
    });

    const leagues = sortLeagues(
      getArray(payload, "leagues").map(normalizeLeague)
    );

    res.json({
      success: true,
      count: leagues.length,
      leagues,
      pagination: payload?.pagination || null,
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/competitions", requireApiKey, async (_req, res) => {
  try {
    const payload = await providerGet("/leagues", {
      limit: 100,
      offset: 0,
    });
    const leagues = sortLeagues(
      getArray(payload, "leagues").map(normalizeLeague)
    );

    res.json({ success: true, count: leagues.length, competitions: leagues });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/leagues/:id", requireApiKey, async (req, res) => {
  try {
    const league = await getLeague(req.params.id);
    res.json({ success: true, league });
  } catch (error) {
    handleError(res, error);
  }
});

// Matches for a selected date. Highlightly requires a primary filter.
app.get("/api/matches", requireApiKey, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const params = { date, limit: 100, offset: 0 };

    if (req.query.leagueId) {
      params.leagueId = Number(req.query.leagueId);
    }

    const payload = await providerGet("/matches", params);
    const matches = getArray(payload, "matches").map(normalizeMatch);

    res.json({ success: true, date, count: matches.length, matches });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/live", requireApiKey, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const payload = await providerGet("/matches", {
      date,
      limit: 100,
      offset: 0,
    });

    const matches = getArray(payload, "matches")
      .map(normalizeMatch)
      .filter(isLive);

    res.json({ success: true, date, count: matches.length, matches });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/matches/live", requireApiKey, async (req, res) => {
  req.url = `/api/live${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
  app.handle(req, res);
});

app.get("/api/matches/:id/events", requireApiKey, async (req, res) => {
  try {
    const data = await providerGet(`/events/${encodeURIComponent(req.params.id)}`);
    res.json({ success: true, events: getArray(data, "events") });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/matches/:id/lineups", requireApiKey, async (req, res) => {
  try {
    const data = await providerGet(`/lineups/${encodeURIComponent(req.params.id)}`);
    res.json({ success: true, lineups: unwrap(data) });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/matches/:id/statistics", requireApiKey, async (req, res) => {
  try {
    const data = await providerGet(`/statistics/${encodeURIComponent(req.params.id)}`);
    res.json({ success: true, statistics: unwrap(data) });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/matches/:id", requireApiKey, async (req, res) => {
  try {
    const payload = await providerGet(
      `/matches/${encodeURIComponent(req.params.id)}`
    );
    const match = unwrap(payload);
    res.json({
      success: true,
      match: normalizeMatch(Array.isArray(match) ? match[0] : match),
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Standings, fixtures and teams use the season returned for that league.
app.get("/api/leagues/:id/standings", requireApiKey, async (req, res) => {
  try {
    const { league, season } = await resolveSeason(
      req.params.id,
      req.query.season
    );

    const payload = await providerGet("/standings", {
      leagueId: Number(req.params.id),
      season,
    });

    const standings = payload?.standings || payload?.groups || payload?.data?.standings || payload?.data?.groups || [];

    res.json({ success: true, league, season, standings });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/standings/:id", requireApiKey, async (req, res) => {
  req.url = `/api/leagues/${encodeURIComponent(req.params.id)}/standings${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
  app.handle(req, res);
});

app.get("/api/leagues/:id/matches", requireApiKey, async (req, res) => {
  try {
    const { league, season } = await resolveSeason(
      req.params.id,
      req.query.season
    );

    const payload = await providerGet("/matches", {
      leagueId: Number(req.params.id),
      season,
      limit: 100,
      offset: 0,
    });

    const matches = getArray(payload, "matches").map(normalizeMatch);
    res.json({ success: true, league, season, count: matches.length, matches });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/teams", requireApiKey, async (req, res) => {
  try {
    const params = { limit: Number(req.query.limit) || 100, offset: 0 };
    if (req.query.leagueId) params.leagueId = Number(req.query.leagueId);
    if (req.query.season) params.season = Number(req.query.season);
    if (req.query.search) params.name = req.query.search;

    const payload = await providerGet("/teams", params);
    const teams = getArray(payload, "teams");

    res.json({ success: true, count: teams.length, teams });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/teams/:id", requireApiKey, async (req, res) => {
  try {
    const payload = await providerGet(
      `/teams/${encodeURIComponent(req.params.id)}`
    );
    res.json({ success: true, team: unwrap(payload) });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/leagues/:id/teams", requireApiKey, async (req, res) => {
  try {
    const { league, season } = await resolveSeason(
      req.params.id,
      req.query.season
    );

    const payload = await providerGet("/teams", {
      leagueId: Number(req.params.id),
      season,
      limit: 100,
      offset: 0,
    });

    const teams = getArray(payload, "teams");
    res.json({ success: true, league, season, count: teams.length, teams });
  } catch (error) {
    handleError(res, error);
  }
});

// Scorers are not fabricated if the provider does not supply them.
app.get("/api/leagues/:id/scorers", requireApiKey, async (req, res) => {
  try {
    const { league, season } = await resolveSeason(
      req.params.id,
      req.query.season
    );

    res.json({
      success: true,
      league,
      season,
      count: 0,
      scorers: [],
      message: "Top scorers are not yet connected to this Highlightly integration.",
    });
  } catch (error) {
    handleError(res, error);
  }
});

// News: public read, admin-only create and delete.
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

app.post("/api/news", requireAdmin, async (req, res) => {
  try {
    const { title, summary, description, image, url, category, source } =
      req.body || {};

    if (!String(title || "").trim() || !String(summary || description || "").trim()) {
      return res.status(400).json({
        success: false,
        message: "A title and summary are required.",
      });
    }

    const news = await readNews();
    const article = {
      id: `${Date.now()}`,
      title: String(title).trim(),
      summary: String(summary || description).trim(),
      description: String(description || summary).trim(),
      image: String(image || "").trim(),
      url: String(url || "").trim(),
      category: String(category || "Football").trim(),
      source: String(source || "AG SOCCER").trim(),
      publishedAt: new Date().toISOString(),
    };

    news.unshift(article);
    await writeNews(news);

    res.status(201).json({ success: true, article });
  } catch (error) {
    handleError(res, error);
  }
});

app.delete("/api/news/:id", requireAdmin, async (req, res) => {
  try {
    const news = await readNews();
    const updated = news.filter((item) => String(item.id) !== req.params.id);

    if (updated.length === news.length) {
      return res.status(404).json({
        success: false,
        message: "News article not found.",
      });
    }

    await writeNews(updated);
    res.json({ success: true, message: "News article deleted." });
  } catch (error) {
    handleError(res, error);
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ success: false, message: "API route not found." });
});

app.listen(PORT, () => {
  console.log(`AG SOCCER API running at http://localhost:${PORT}`);
  console.log(`Highlightly key configured: ${Boolean(API_KEY)}`);
  console.log(`Admin publishing configured: ${Boolean(process.env.ADMIN_KEY)}`);
  console.log(`Current year: ${CURRENT_YEAR}`);
});
