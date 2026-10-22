import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const app = express();

const PORT = process.env.PORT || 5000;
const API_BASE = "https://v3.football.api-sports.io";

const API_KEY =
  process.env.API_FOOTBALL_KEY ||
  process.env.API_KEY ||
  "";

const ADMIN_KEY = process.env.ADMIN_KEY || "";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const NEWS_FILE = path.join(DATA_DIR, "news.json");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ============================================
// API CLIENT
// ============================================

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
  headers: {
    "x-apisports-key": API_KEY,
  },
});

// Simple cache to reduce API requests.
const cache = new Map();
const pendingRequests = new Map();

const CACHE_TIME = {
  leagues: 24 * 60 * 60 * 1000,
  standings: 60 * 60 * 1000,
  teams: 6 * 60 * 60 * 1000,
  scorers: 60 * 60 * 1000,
  matches: 60 * 1000,
  live: 20 * 1000,
  details: 60 * 1000,
};

function getCacheKey(url, params = {}) {
  return `${url}:${JSON.stringify(params)}`;
}

async function apiGet(url, params = {}, ttl = 60000) {
  if (!API_KEY) {
    throw new Error(
      "API key is missing. Add API_FOOTBALL_KEY to your server/.env file."
    );
  }

  const key = getCacheKey(url, params);
  const cached = cache.get(key);

  if (cached && Date.now() - cached.time < ttl) {
    return cached.data;
  }

  // Avoid sending duplicate simultaneous requests.
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key);
  }

  const request = (async () => {
    try {
      const response = await apiClient.get(url, { params });

      const body = response.data;

      if (body.errors && Object.keys(body.errors).length > 0) {
        const error = new Error(
          JSON.stringify(body.errors)
        );
        error.status = 502;
        throw error;
      }

      cache.set(key, {
        time: Date.now(),
        data: body,
      });

      return body;
    } catch (error) {
      if (error.response?.status === 429) {
        const limitedError = new Error(
          "API-Sports rate limit reached. Please wait before trying again."
        );
        limitedError.status = 429;
        throw limitedError;
      }

      if (error.response?.status === 403) {
        const planError = new Error(
          "Your API-Sports plan may not support this league, season, or endpoint."
        );
        planError.status = 403;
        throw planError;
      }

      if (error.code === "ECONNABORTED") {
        const timeoutError = new Error(
          "API-Sports request timed out. Please try again."
        );
        timeoutError.status = 504;
        throw timeoutError;
      }

      if (error.status) {
        throw error;
      }

      const apiError = new Error(
        error.response?.data?.message ||
          error.message ||
          "Unable to contact API-Sports."
      );

      apiError.status = error.response?.status || 502;
      throw apiError;
    } finally {
      pendingRequests.delete(key);
    }
  })();

  pendingRequests.set(key, request);

  return request;
}

function sendError(res, error) {
  console.error("AG SOCCER API error:", error.message);

  res.status(error.status || 500).json({
    success: false,
    message: error.message || "An unexpected server error occurred.",
  });
}

// ============================================
// SEASON CONFIGURATION
// ============================================

// Defaults to the current calendar year.
// You can override this with FOOTBALL_SEASON in .env.
//
// IMPORTANT:
// Your API-Sports free plan previously reported that
// it only supported seasons 2022, 2023, and 2024.
// If that restriction still applies, requests for 2026
// will fail until your plan supports that season.

function currentSeason() {
  const configuredSeason = Number(process.env.FOOTBALL_SEASON);

  if (
    Number.isInteger(configuredSeason) &&
    configuredSeason >= 2000 &&
    configuredSeason <= 2100
  ) {
    return configuredSeason;
  }

  return new Date().getFullYear();
}

function requestedSeason(value) {
  if (value === undefined || value === "") {
    return currentSeason();
  }

  const season = Number(value);

  if (
    !Number.isInteger(season) ||
    season < 2000 ||
    season > 2100
  ) {
    throw new Error("Invalid season. Provide a valid year.");
  }

  return season;
}

// ============================================
// NORMALIZATION HELPERS
// ============================================

function normalizeLeague(item) {
  const league = item.league || {};
  const country = item.country || {};

  return {
    id: league.id,
    name: league.name || "Unknown League",
    code: String(league.id || ""),
    type: league.type || "LEAGUE",
    emblem: league.logo || null,
    logo: league.logo || null,
    area: {
      id: country.id || null,
      name: country.name || "International",
      code: country.code || null,
      flag: country.flag || null,
    },
    country: country.name || "International",
    seasons: item.seasons || [],
  };
}

function normalizeMatch(item) {
  const fixture = item.fixture || {};
  const league = item.league || {};
  const teams = item.teams || {};
  const goals = item.goals || {};
  const score = item.score || {};

  return {
    id: fixture.id,
    date: fixture.date,
    timestamp: fixture.timestamp,
    status: {
      short: fixture.status?.short || "NS",
      long: fixture.status?.long || "Not Started",
      elapsed: fixture.status?.elapsed ?? null,
    },
    utcDate: fixture.date,
    competition: {
      id: league.id,
      name: league.name || "Unknown League",
      code: String(league.id || ""),
      emblem: league.logo || null,
      type: league.type || "LEAGUE",
    },
    league: {
      id: league.id,
      name: league.name || "Unknown League",
      logo: league.logo || null,
      country: league.country || "",
      season: league.season || currentSeason(),
    },
    area: {
      name: league.country || "International",
      flag: league.flag || null,
    },
    homeTeam: {
      id: teams.home?.id,
      name: teams.home?.name || "Home",
      shortName: teams.home?.name || "Home",
      crest: teams.home?.logo || null,
      logo: teams.home?.logo || null,
    },
    awayTeam: {
      id: teams.away?.id,
      name: teams.away?.name || "Away",
      shortName: teams.away?.name || "Away",
      crest: teams.away?.logo || null,
      logo: teams.away?.logo || null,
    },
    goals: {
      home: goals.home,
      away: goals.away,
    },
    score: {
      fullTime: {
        home: score.fulltime?.home ?? goals.home,
        away: score.fulltime?.away ?? goals.away,
      },
      halftime: {
        home: score.halftime?.home ?? null,
        away: score.halftime?.away ?? null,
      },
    },
    venue: fixture.venue?.name || "",
    referee: fixture.referee || null,
  };
}

function normalizeLeagueList(items) {
  const priority = [
    "premier league",
    "champions league",
    "la liga",
    "serie a",
    "bundesliga",
    "ligue 1",
    "europa league",
    "world cup",
    "major league soccer",
    "ethiopian premier league",
  ];

  return items
    .map(normalizeLeague)
    .sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();

      function getPriority(name) {
        const index = priority.findIndex((item) =>
          name.includes(item)
        );

        return index === -1 ? 999 : index;
      }

      return getPriority(nameA) - getPriority(nameB) ||
        nameA.localeCompare(nameB);
    });
}

// ============================================
// GENERAL ROUTES
// ============================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to AG SOCCER API ⚽",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    apiKeyConfigured: Boolean(API_KEY),
    season: currentSeason(),
    message: "AG SOCCER server is running.",
  });
});

// ============================================
// LEAGUES / COMPETITIONS
// ============================================

app.get(
  ["/api/leagues", "/api/competitions"],
  async (req, res) => {
    try {
      const data = await apiGet(
        "/leagues",
        {},
        CACHE_TIME.leagues
      );

      const leagues = normalizeLeagueList(
        data.response || []
      );

      res.json({
        success: true,
        count: leagues.length,
        leagues,
        competitions: leagues,
      });
    } catch (error) {
      sendError(res, error);
    }
  }
);

// ============================================
// MATCHES
// ============================================

app.get("/api/matches", async (req, res) => {
  try {
    const season = requestedSeason(req.query.season);
    const date = req.query.date;
    const from = req.query.from;
    const to = req.query.to;
    const league = req.query.league;
    const status = req.query.status;

    const params = { season };

    if (date) {
      params.date = date;
    } else {
      if (from) params.from = from;
      if (to) params.to = to;
    }

    if (league) params.league = league;
    if (status) params.status = status;

    const data = await apiGet(
      "/fixtures",
      params,
      CACHE_TIME.matches
    );

    const matches = (data.response || []).map(normalizeMatch);

    res.json({
      success: true,
      count: matches.length,
      season,
      matches,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// ============================================
// LIVE MATCHES
// ============================================

app.get("/api/live", async (req, res) => {
  try {
    const data = await apiGet(
      "/fixtures",
      { live: "all" },
      CACHE_TIME.live
    );

    const matches = (data.response || []).map(normalizeMatch);

    res.json({
      success: true,
      count: matches.length,
      matches,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// ============================================
// MATCH DETAILS, EVENTS, LINEUPS, STATISTICS
// ============================================

app.get("/api/matches/:id", async (req, res) => {
  try {
    const fixtureId = Number(req.params.id);

    if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID.",
      });
    }

    const [fixtureData, eventsData, lineupsData, statsData] =
      await Promise.all([
        apiGet(
          "/fixtures",
          { id: fixtureId },
          CACHE_TIME.details
        ),
        apiGet(
          "/fixtures/events",
          { fixture: fixtureId },
          CACHE_TIME.details
        ),
        apiGet(
          "/fixtures/lineups",
          { fixture: fixtureId },
          CACHE_TIME.details
        ),
        apiGet(
          "/fixtures/statistics",
          { fixture: fixtureId },
          CACHE_TIME.details
        ),
      ]);

    res.json({
      success: true,
      match: normalizeMatch(
        fixtureData.response?.[0] || {}
      ),
      events: eventsData.response || [],
      lineups: lineupsData.response || [],
      statistics: statsData.response || [],
    });
  } catch (error) {
    sendError(res, error);
  }
});

// ============================================
// LEAGUE MATCHES
// ============================================

app.get("/api/leagues/:id/matches", async (req, res) => {
  try {
    const league = Number(req.params.id);
    const season = requestedSeason(req.query.season);

    const params = { league, season };

    if (req.query.date) {
      params.date = req.query.date;
    }

    if (req.query.from) {
      params.from = req.query.from;
    }

    if (req.query.to) {
      params.to = req.query.to;
    }

    const data = await apiGet(
      "/fixtures",
      params,
      CACHE_TIME.matches
    );

    const matches = (data.response || []).map(normalizeMatch);

    res.json({
      success: true,
      count: matches.length,
      matches,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// ============================================
// STANDINGS
// ============================================

app.get("/api/leagues/:id/standings", async (req, res) => {
  try {
    const league = Number(req.params.id);
    const season = requestedSeason(req.query.season);

    const data = await apiGet(
      "/standings",
      { league, season },
      CACHE_TIME.standings
    );

    const standings =
      data.response?.[0]?.league?.standings || [];

    res.json({
      success: true,
      league: data.response?.[0]?.league || null,
      standings,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// ============================================
// TEAMS
// ============================================

app.get("/api/leagues/:id/teams", async (req, res) => {
  try {
    const league = Number(req.params.id);
    const season = requestedSeason(req.query.season);

    const data = await apiGet(
      "/teams",
      { league, season },
      CACHE_TIME.teams
    );

    res.json({
      success: true,
      count: data.response?.length || 0,
      teams: (data.response || []).map((item) => ({
        id: item.team?.id,
        name: item.team?.name,
        code: item.team?.code,
        country: item.team?.country,
        founded: item.team?.founded,
        national: item.team?.national,
        logo: item.team?.logo,
        venue: item.venue || null,
      })),
    });
  } catch (error) {
    sendError(res, error);
  }
});

// ============================================
// TOP SCORERS
// ============================================

app.get("/api/leagues/:id/scorers", async (req, res) => {
  try {
    const league = Number(req.params.id);
    const season = requestedSeason(req.query.season);

    const data = await apiGet(
      "/players/topscorers",
      { league, season },
      CACHE_TIME.scorers
    );

    res.json({
      success: true,
      count: data.response?.length || 0,
      scorers: (data.response || []).map((item) => ({
        player: item.player,
        statistics: item.statistics?.[0] || {},
      })),
    });
  } catch (error) {
    sendError(res, error);
  }
});

// ============================================
// NEWS STORAGE HELPERS
// ============================================

async function ensureNewsFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(NEWS_FILE);
  } catch {
    await fs.writeFile(
      NEWS_FILE,
      JSON.stringify([], null, 2),
      "utf8"
    );
  }
}

async function readNews() {
  await ensureNewsFile();

  const content = await fs.readFile(NEWS_FILE, "utf8");

  try {
    const news = JSON.parse(content);
    return Array.isArray(news) ? news : [];
  } catch {
    return [];
  }
}

async function saveNews(news) {
  await ensureNewsFile();

  await fs.writeFile(
    NEWS_FILE,
    JSON.stringify(news, null, 2),
    "utf8"
  );
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({
      success: false,
      message: "ADMIN_KEY is not configured in server/.env.",
    });
  }

  const suppliedKey = req.get("x-admin-key");

  if (suppliedKey !== ADMIN_KEY) {
    return res.status(401).json({
      success: false,
      message: "Invalid admin key.",
    });
  }

  next();
}

// ============================================
// NEWS: PUBLIC LIST
// ============================================

app.get("/api/news", async (req, res) => {
  try {
    const news = await readNews();

    res.json({
      success: true,
      count: news.length,
      news: news.sort(
        (a, b) =>
          new Date(b.publishedAt || b.createdAt || 0) -
          new Date(a.publishedAt || a.createdAt || 0)
      ),
    });
  } catch (error) {
    sendError(res, error);
  }
});

// ============================================
// NEWS: PUBLISH ARTICLE
// ============================================

app.post("/api/news", requireAdmin, async (req, res) => {
  try {
    const {
      title,
      excerpt = "",
      body = "",
      content = "",
      category = "News",
      imageUrl = "",
      image = "",
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: "Article title is required.",
      });
    }

    if (!String(body || content).trim()) {
      return res.status(400).json({
        success: false,
        message: "Article body is required.",
      });
    }

    const news = await readNews();

    const article = {
      id: crypto.randomUUID(),
      title: String(title).trim(),
      excerpt: String(excerpt).trim(),
      body: String(body || content).trim(),
      content: String(body || content).trim(),
      category: String(category || "News").trim(),
      imageUrl: String(imageUrl || image || "").trim(),
      image: String(imageUrl || image || "").trim(),
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    news.unshift(article);
    await saveNews(news);

    res.status(201).json({
      success: true,
      message: "News article published successfully.",
      article,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// ============================================
// NEWS: DELETE ARTICLE
// ============================================

app.delete("/api/news/:id", requireAdmin, async (req, res) => {
  try {
    const news = await readNews();

    const filtered = news.filter(
      (article) => String(article.id) !== String(req.params.id)
    );

    if (filtered.length === news.length) {
      return res.status(404).json({
        success: false,
        message: "News article not found.",
      });
    }

    await saveNews(filtered);

    res.json({
      success: true,
      message: "News article deleted.",
    });
  } catch (error) {
    sendError(res, error);
  }
});

// ============================================
// ERROR HANDLER
// ============================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((error, req, res, next) => {
  console.error("Unexpected server error:", error);

  res.status(500).json({
    success: false,
    message: "Unexpected server error.",
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`AG SOCCER server running at http://localhost:${PORT}`);
  console.log(`Default football season: ${currentSeason()}`);
  console.log(`API key configured: ${Boolean(API_KEY)}`);
  console.log(`Admin key configured: ${Boolean(ADMIN_KEY)}`);
});
