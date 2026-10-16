
import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const API_BASE = "https://v3.football.api-sports.io";
const API_KEY = process.env.API_FOOTBALL_KEY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const NEWS_FILE = path.join(DATA_DIR, "news.json");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// --------------------------------------------------
// API-FOOTBALL CLIENT
// --------------------------------------------------

const footballAPI = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
  headers: {
    "x-apisports-key": API_KEY || "",
  },
});

async function apiGet(endpoint, params = {}) {
  if (!API_KEY) {
    const error = new Error(
      "API_FOOTBALL_KEY is missing from server/.env"
    );
    error.status = 500;
    throw error;
  }

  const response = await footballAPI.get(endpoint, { params });
  const data = response.data;

  if (data.errors && Object.keys(data.errors).length > 0) {
    const error = new Error(
      JSON.stringify(data.errors)
    );
    error.status = 502;
    error.providerErrors = data.errors;
    throw error;
  }

  return data;
}

function sendError(res, error) {
  console.error("AG SOCCER API error:", error.message);

  res.status(error.status || error.response?.status || 500).json({
    success: false,
    message: error.message || "Request failed",
    ...(error.providerErrors && {
      providerErrors: error.providerErrors,
    }),
    ...(error.response?.data?.errors && {
      providerErrors: error.response.data.errors,
    }),
  });
}

// --------------------------------------------------
// NORMALIZE FIXTURES FOR THE REACT FRONTEND
// --------------------------------------------------

function normalizeMatch(item) {
  const fixture = item.fixture || {};
  const league = item.league || {};
  const teams = item.teams || {};
  const goals = item.goals || {};
  const score = item.score || {};

  return {
    id: fixture.id,
    utcDate: fixture.date,
    date: fixture.date,
    timestamp: fixture.timestamp,

    status: fixture.status?.short || "NS",
    statusText: fixture.status?.long || "Not Started",
    elapsed: fixture.status?.elapsed ?? null,

    area: {
      name: league.country || "",
      flag: league.flag || null,
    },

    competition: {
      id: league.id,
      name: league.name,
      code: league.name,
      emblem: league.logo,
      type: league.type || "LEAGUE",
    },

    league,

    homeTeam: {
      id: teams.home?.id,
      name: teams.home?.name,
      shortName: teams.home?.name,
      crest: teams.home?.logo,
      logo: teams.home?.logo,
      winner: teams.home?.winner ?? null,
    },

    awayTeam: {
      id: teams.away?.id,
      name: teams.away?.name,
      shortName: teams.away?.name,
      crest: teams.away?.logo,
      logo: teams.away?.logo,
      winner: teams.away?.winner ?? null,
    },

    goals: {
      home: goals.home,
      away: goals.away,
    },

    score: {
      home: goals.home,
      away: goals.away,
      halftime: score.halftime || {
        home: null,
        away: null,
      },
      fulltime: score.fulltime || {
        home: goals.home,
        away: goals.away,
      },
      extratime: score.extratime || {
        home: null,
        away: null,
      },
      penalties: score.penalty || {
        home: null,
        away: null,
      },
    },

    venue: fixture.venue || null,
    referee: fixture.referee || null,
    round: league.round || null,
    season: league.season || null,
  };
}

function currentSeason() {
  return Number(process.env.FOOTBALL_SEASON || 2024);
}

function normalizeList(items = []) {
  return items.map(normalizeMatch);
}

// --------------------------------------------------
// BASIC ROUTES
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to AG SOCCER API ⚽",
    provider: "API-Football",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "running",
    provider: "API-Football",
    apiKeyConfigured: Boolean(API_KEY),
  });
});

app.get("/api/test", async (req, res) => {
  try {
    const data = await apiGet("/status");

    res.json({
      success: true,
      message: "API-Football connection successful",
      account: data.response?.[0] || data.response || null,
      requests: data,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// --------------------------------------------------
// LEAGUES AND COMPETITIONS
// GET /api/leagues?season=2026
// GET /api/leagues?country=England&season=2026
// --------------------------------------------------

app.get(
  ["/api/leagues", "/api/competitions"],
  async (req, res) => {
    try {
      const params = {
        season: Number(req.query.season) || currentSeason(),
      };

      if (req.query.country) {
        params.country = req.query.country;
      }

      if (req.query.id) {
        params.id = Number(req.query.id);
      }

      if (req.query.search) {
        params.search = req.query.search;
      }

      const data = await apiGet("/leagues", params);

      res.json({
        success: true,
        count: data.response.length,
        leagues: data.response,
        competitions: data.response,
      });
    } catch (error) {
      sendError(res, error);
    }
  }
);

// --------------------------------------------------
// ALL MATCHES
//
// GET /api/matches?date=2026-10-14
// GET /api/matches?league=39&season=2026
// GET /api/matches?from=2026-10-01&to=2026-10-14
// GET /api/matches?status=FT
// --------------------------------------------------

app.get("/api/matches", async (req, res) => {
  try {
    const params = {};

    if (req.query.date) {
      params.date = req.query.date;
    }

    if (req.query.from) {
      params.from = req.query.from;
    }

    if (req.query.to) {
      params.to = req.query.to;
    }

    if (req.query.league) {
      params.league = Number(req.query.league);
      params.season =
        Number(req.query.season) || currentSeason();
    }

    if (req.query.team) {
      params.team = Number(req.query.team);
      params.season =
        Number(req.query.season) || currentSeason();
    }

    if (req.query.season && !params.season) {
      params.season = Number(req.query.season);
    }

    if (req.query.status) {
      params.status = req.query.status;
    }

    if (req.query.country) {
      params.country = req.query.country;
    }

    const data = await apiGet("/fixtures", params);
    const matches = normalizeList(data.response);

    res.json({
      success: true,
      count: matches.length,
      matches,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// --------------------------------------------------
// LIVE MATCHES
// Keep this route before /api/matches/:id.
//
// GET /api/live
// GET /api/matches/live
// --------------------------------------------------

app.get(
  ["/api/live", "/api/matches/live"],
  async (req, res) => {
    try {
      const params = {};

      if (req.query.league) {
        params.league = Number(req.query.league);
        params.season =
          Number(req.query.season) || currentSeason();
      } else {
        params.live = "all";
      }

      const data = await apiGet("/fixtures", params);
      const matches = normalizeList(data.response);

      res.json({
        success: true,
        count: matches.length,
        matches,
      });
    } catch (error) {
      sendError(res, error);
    }
  }
);

// --------------------------------------------------
// MATCH DETAILS, EVENTS AND LINEUPS
//
// GET /api/matches/123456
// GET /api/matches/123456/details
//
// Events and lineups are requested separately.
// Availability depends on the match and subscription.
// --------------------------------------------------

app.get(
  ["/api/matches/:id", "/api/matches/:id/details"],
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          success: false,
          message: "A valid numeric fixture ID is required",
        });
      }

      const [fixtureData, eventsResult, lineupsResult] =
        await Promise.allSettled([
          apiGet("/fixtures", { id }),
          apiGet("/fixtures/events", { fixture: id }),
          apiGet("/fixtures/lineups", { fixture: id }),
        ]);

      if (fixtureData.status === "rejected") {
        throw fixtureData.reason;
      }

      const fixture = fixtureData.value.response?.[0];

      if (!fixture) {
        return res.status(404).json({
          success: false,
          message: "Match not found",
        });
      }

      const events =
        eventsResult.status === "fulfilled"
          ? eventsResult.value.response
          : [];

      const lineups =
        lineupsResult.status === "fulfilled"
          ? lineupsResult.value.response
          : [];

      const match = normalizeMatch(fixture);

      res.json({
        success: true,
        match,
        events,
        lineups,
        availableData: {
          events: eventsResult.status === "fulfilled",
          lineups: lineupsResult.status === "fulfilled",
        },
        detailsErrors: {
          events:
            eventsResult.status === "rejected"
              ? eventsResult.reason.message
              : null,
          lineups:
            lineupsResult.status === "rejected"
              ? lineupsResult.reason.message
              : null,
        },
      });
    } catch (error) {
      sendError(res, error);
    }
  }
);

// --------------------------------------------------
// LEAGUE MATCHES
// GET /api/leagues/39/matches?season=2026
// --------------------------------------------------

app.get("/api/leagues/:id/matches", async (req, res) => {
  try {
    const league = Number(req.params.id);
    const season =
      Number(req.query.season) || currentSeason();

    const params = { league, season };

    if (req.query.date) {
      params.date = req.query.date;
    }

    if (req.query.status) {
      params.status = req.query.status;
    }

    const data = await apiGet("/fixtures", params);
    const matches = normalizeList(data.response);

    res.json({
      success: true,
      count: matches.length,
      matches,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// --------------------------------------------------
// LEAGUE STANDINGS
// GET /api/leagues/39/standings?season=2026
// --------------------------------------------------

app.get("/api/leagues/:id/standings", async (req, res) => {
  try {
    const league = Number(req.params.id);
    const season =
      Number(req.query.season) || currentSeason();

    const data = await apiGet("/standings", {
      league,
      season,
    });

    res.json({
      success: true,
      standings: data.response,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// --------------------------------------------------
// LEAGUE TEAMS
// GET /api/leagues/39/teams?season=2026
// --------------------------------------------------

app.get("/api/leagues/:id/teams", async (req, res) => {
  try {
    const league = Number(req.params.id);
    const season =
      Number(req.query.season) || currentSeason();

    const data = await apiGet("/teams", {
      league,
      season,
    });

    res.json({
      success: true,
      count: data.response.length,
      teams: data.response,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// --------------------------------------------------
// TOP SCORERS
// GET /api/leagues/39/scorers?season=2026
// --------------------------------------------------

app.get("/api/leagues/:id/scorers", async (req, res) => {
  try {
    const league = Number(req.params.id);
    const season =
      Number(req.query.season) || currentSeason();

    const data = await apiGet("/players/topscorers", {
      league,
      season,
    });

    res.json({
      success: true,
      count: data.response.length,
      scorers: data.response,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// --------------------------------------------------
// TEAM DETAILS
// GET /api/teams/33
// --------------------------------------------------

app.get("/api/teams/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const data = await apiGet("/teams", { id });

    res.json({
      success: true,
      team: data.response[0] || null,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// --------------------------------------------------
// TEAM MATCHES
// GET /api/teams/33/matches?season=2026
// --------------------------------------------------

app.get("/api/teams/:id/matches", async (req, res) => {
  try {
    const team = Number(req.params.id);
    const params = {
      team,
      season: Number(req.query.season) || currentSeason(),
    };

    if (req.query.date) {
      params.date = req.query.date;
    }

    if (req.query.last) {
      params.last = Number(req.query.last);
    }

    if (req.query.next) {
      params.next = Number(req.query.next);
    }

    const data = await apiGet("/fixtures", params);
    const matches = normalizeList(data.response);

    res.json({
      success: true,
      count: matches.length,
      matches,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// --------------------------------------------------
// NEWS FILE HELPERS
// News are stored in server/data/news.json
// --------------------------------------------------

async function ensureNewsFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(NEWS_FILE);
  } catch {
    await fs.writeFile(NEWS_FILE, "[]", "utf8");
  }
}

async function readNews() {
  await ensureNewsFile();

  const content = await fs.readFile(NEWS_FILE, "utf8");
  const news = JSON.parse(content);

  return Array.isArray(news) ? news : [];
}

async function writeNews(news) {
  await ensureNewsFile();

  await fs.writeFile(
    NEWS_FILE,
    JSON.stringify(news, null, 2),
    "utf8"
  );
}

function requireAdmin(req, res, next) {
  const adminKey =
    req.get("x-admin-key") || req.body?.adminKey;

  if (!process.env.ADMIN_KEY) {
    return res.status(503).json({
      success: false,
      message: "ADMIN_KEY is not configured on the server",
    });
  }

  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({
      success: false,
      message: "Invalid admin key",
    });
  }

  next();
}

// --------------------------------------------------
// NEWS ROUTES
// GET    /api/news
// POST   /api/news
// PUT    /api/news/:id
// DELETE /api/news/:id
// --------------------------------------------------

app.get("/api/news", async (req, res) => {
  try {
    const news = await readNews();

    res.json({
      success: true,
      count: news.length,
      news,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/news", requireAdmin, async (req, res) => {
  try {
    const { title, content, image, category, author } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: "Title and content are required",
      });
    }

    const news = await readNews();

    const article = {
      id: `${Date.now()}`,
      title,
      content,
      image: image || "",
      category: category || "Football",
      author: author || "AG SOCCER",
      createdAt: new Date().toISOString(),
    };

    news.unshift(article);
    await writeNews(news);

    res.status(201).json({
      success: true,
      article,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.put("/api/news/:id", requireAdmin, async (req, res) => {
  try {
    const news = await readNews();
    const index = news.findIndex(
      (article) => String(article.id) === req.params.id
    );

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: "News article not found",
      });
    }

    const { title, content, image, category, author } = req.body;

    news[index] = {
      ...news[index],
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(image !== undefined && { image }),
      ...(category !== undefined && { category }),
      ...(author !== undefined && { author }),
      updatedAt: new Date().toISOString(),
    };

    await writeNews(news);

    res.json({
      success: true,
      article: news[index],
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete(
  "/api/news/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const news = await readNews();
      const updated = news.filter(
        (article) => String(article.id) !== req.params.id
      );

      if (updated.length === news.length) {
        return res.status(404).json({
          success: false,
          message: "News article not found",
        });
      }

      await writeNews(updated);

      res.json({
        success: true,
        message: "News article deleted",
      });
    } catch (error) {
      sendError(res, error);
    }
  }
);

// --------------------------------------------------
// 404 HANDLER
// --------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(`AG SOCCER server running at http://localhost:${PORT}`);
  console.log(`API-Football key configured: ${API_KEY ? "Yes" : "No"}`);
  console.log(`Default football season: ${currentSeason()}`);
});
