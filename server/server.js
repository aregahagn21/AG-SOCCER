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

const SPORT_SCORE_BASE = "https://sportscore.com";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, "data");

const NEWS_FILE = path.join(DATA_DIR, "news.json");

const YEAR = new Date().getFullYear();

const TZ = "UTC";



const configuredOrigins = (process.env.CLIENT_ORIGIN || "https://ag-soccer.vercel.app,http://localhost:5173,http://127.0.0.1:5173")

  .split(",").map((v) => v.trim()).filter(Boolean);

app.use(cors({

  origin(origin, callback) {

    if (!origin) return callback(null, true);

    let hostname = "";

    try { hostname = new URL(origin).hostname; } catch { /* invalid origin */ }

    const allowed = configuredOrigins.includes(origin) || hostname === "ag-soccer.vercel.app" || hostname.endsWith(".vercel.app") || hostname === "localhost" || hostname === "127.0.0.1";

    callback(allowed ? null : new Error(`CORS blocked origin: ${origin}`), allowed);

  },

  methods: ["GET", "HEAD", "POST", "DELETE", "OPTIONS"],

  allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],

  optionsSuccessStatus: 204,

  maxAge: 86400,

}));

app.use(express.json({ limit: "1mb" }));



const http = axios.create({ baseURL: SPORT_SCORE_BASE, timeout: 20000, headers: { Accept: "application/json" } });

const responseCache = new Map();

const CACHE_MS = 60_000;

const resolvedCompetitions = new Map();

// Keep user-facing competition names stable, but resolve the actual SportScore slugs
// through /api/v1/search/ at runtime. This avoids assuming that our UI slug is the
// provider's slug (for example, men's La Liga is "spanish-la-liga", not "la-liga").
const COMPETITIONS = [
  { name: "UEFA Champions League", slug: "uefa-champions-league", aliases: ["champions-league", "ucl"], searchQuery: "UEFA Champions League", matchNames: ["UEFA Champions League", "Champions League"], country: "Europe", rank: 0 },
  { name: "England Premier League", slug: "english-premier-league", aliases: ["premier-league", "england-premier-league", "pl"], searchQuery: "English Premier League", matchNames: ["English Premier League", "Premier League"], country: "England", rank: 1 },
  { name: "Spain La Liga", slug: "spanish-la-liga", aliases: ["la-liga", "primera-division", "pd"], searchQuery: "Spanish La Liga", matchNames: ["Spanish La Liga", "La Liga"], country: "Spain", rank: 2 },
  { name: "Germany Bundesliga", slug: "german-bundesliga", aliases: ["bundesliga", "bl1"], searchQuery: "German Bundesliga", matchNames: ["German Bundesliga", "Bundesliga"], country: "Germany", rank: 3 },
  { name: "Italy Serie A", slug: "italian-serie-a", aliases: ["serie-a", "sa"], searchQuery: "Italian Serie A", matchNames: ["Italian Serie A", "Serie A"], country: "Italy", rank: 4 },
  { name: "France Ligue 1", slug: "french-ligue-1", aliases: ["ligue-1", "fl1"], searchQuery: "French Ligue 1", matchNames: ["French Ligue 1", "Ligue 1"], country: "France", rank: 5 },
  { name: "UEFA Europa League", slug: "uefa-europa-league", aliases: ["europa-league", "el"], searchQuery: "UEFA Europa League", matchNames: ["UEFA Europa League", "Europa League"], country: "Europe", rank: 6 },
  { name: "UEFA Conference League", slug: "uefa-conference-league", aliases: ["conference-league", "uefa-europa-conference-league"], searchQuery: "UEFA Conference League", matchNames: ["UEFA Conference League", "UEFA Europa Conference League", "Conference League"], country: "Europe", rank: 7 },
  { name: "Portugal Primeira Liga", slug: "portuguese-primeira-liga", aliases: ["primeira-liga", "ppl"], searchQuery: "Portuguese Primeira Liga", matchNames: ["Portuguese Primeira Liga", "Primeira Liga", "Liga Portugal"], country: "Portugal", rank: 8 },
  { name: "Netherlands Eredivisie", slug: "dutch-eredivisie", aliases: ["eredivisie", "ded"], searchQuery: "Dutch Eredivisie", matchNames: ["Dutch Eredivisie", "Eredivisie"], country: "Netherlands", rank: 9 },
];



function cacheGet(key) {

  const entry = responseCache.get(key);

  if (entry && Date.now() - entry.at < CACHE_MS) return entry.value;

  if (entry) responseCache.delete(key);

  return null;

}

function cacheSet(key, value) { responseCache.set(key, { at: Date.now(), value }); return value; }

async function getJson(url, params = {}) {

  const key = `${url}?${new URLSearchParams(Object.entries(params).filter(([,v]) => v != null).map(([k,v]) => [k, String(v)])).toString()}`;

  const cached = cacheGet(key);

  if (cached) return cached;

  try {

    const { data } = await http.get(url, { params });

    if (data?.success === false || data?.error) throw new Error(data.message || data.error || "SportScore request failed");

    return cacheSet(key, data);

  } catch (err) {

    const status = err.response?.status;

    const detail = err.response?.data?.message || err.response?.data?.error || err.message || "Unknown error";

    const e = new Error(`SportScore request failed (${status || "network"}): ${detail}`);

    e.status = status && status >= 400 && status < 500 ? status : 502;

    throw e;

  }

}

function listFrom(payload, names = []) {

  if (Array.isArray(payload)) return payload;

  for (const key of [...names, "matches", "fixtures", "results", "data", "items", "events", "standings", "players", "topscorers", "lineups", "timeline"]) {

    if (Array.isArray(payload?.[key])) return payload[key];

    if (Array.isArray(payload?.data?.[key])) return payload.data[key];

  }

  return [];

}

function first(...values) { return values.find(v => v !== undefined && v !== null && v !== ""); }

function asNum(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

function entityName(v) { if (typeof v === "string") return v; return first(v?.name, v?.title, v?.short_name, v?.display_name, ""); }

function entitySlug(v) {

  if (typeof v === "string" || !v) return "";

  const direct = first(v.slug, v.url_slug, v.code, v.competition_slug, v.league_slug, "");

  if (direct) return String(direct).replace(/^\/+|\/+$/g, "");

  const url = first(v.url, v.href, v.path, "");

  if (url) {

    const parts = String(url).split(/[/?#]/).filter(Boolean);

    const last = parts[parts.length - 1] || "";

    if (last && !/^https?:$/i.test(last)) return last;

  }

  return "";

}

function normalizeCompetitionToken(value) {
  return String(value || "").toLowerCase().trim().replace(/\s+/g, "-").replace(/_/g, "-");
}

function competitionFromIdentifier(identifier) {
  const token = normalizeCompetitionToken(identifier);
  if (!token) return null;
  // Exact provider slugs take precedence over UI aliases.
  const resolvedExact = resolvedCompetitions.get(token);
  if (resolvedExact) return resolvedExact;
  for (const resolved of resolvedCompetitions.values()) {
    if (normalizeCompetitionToken(resolved.slug) === token || normalizeCompetitionToken(resolved.providerSlug) === token) return resolved;
  }
  return COMPETITIONS.find(c => normalizeCompetitionToken(c.slug) === token || (c.aliases || []).some(a => normalizeCompetitionToken(a) === token)) || null;
}

function competitionFor(raw = {}, expectedCompetition = null) {
  const c = raw.competition || raw.league || raw.tournament || raw.competition_info || {};
  const rawName = first(entityName(c), raw.competition_name, raw.league_name, raw.tournament_name, "");
  const rawSlug = first(entitySlug(c), raw.competition_slug, raw.league_slug, raw.tournament_slug, "");
  const bySlug = competitionFromIdentifier(rawSlug);
  const nameToken = normalizeCompetitionToken(rawName).replace(/^(england|spain|germany|italy|france|portugal|netherlands)-/, "");
  const rawCountry = normalizeCompetitionToken(first(c.country, c.area?.name, c.region, ""));
  const byExactName = COMPETITIONS.find(item => {
    const tokens = [item.name, item.slug, item.name.replace(/^(England|Spain|Germany|Italy|France|Portugal|Netherlands) /, ""), ...(item.aliases || [])]
      .map(normalizeCompetitionToken);
    const exactName = tokens.includes(normalizeCompetitionToken(rawName)) || tokens.includes(nameToken);
    if (!exactName || !rawCountry || item.country === "Europe") return exactName;
    const expectedCountry = normalizeCompetitionToken(item.country);
    return rawCountry === expectedCountry || rawCountry.includes(expectedCountry) || expectedCountry.includes(rawCountry);
  });
  const seed = bySlug || byExactName || expectedCompetition || null;
  const name = seed?.name || rawName || "Other competitions";
  const actualSlug = seed?.slug || rawSlug || slugify(name);
  const country = first(c.country, c.area?.name, c.region, seed?.country, "Europe");
  return {
    id: first(c.id, actualSlug), slug: actualSlug, code: actualSlug, name,
    emblem: first(c.logo, c.emblem, c.image, c.icon, raw.competition_logo, ""),
    logo: first(c.logo, c.emblem, c.image, c.icon, raw.competition_logo, ""),
    area: { name: country }, country,
  };
}

function rawCompetitionIdentifier(raw = {}) {
  const c = raw.competition || raw.league || raw.tournament || raw.competition_info || {};
  return first(entitySlug(c), raw.competition_slug, raw.league_slug, raw.tournament_slug, "");
}

function providerPayloadMatchesCompetition(payload = {}, competition) {
  const containers = [
    payload?.competition, payload?.league, payload?.tournament,
    payload?.data?.competition, payload?.data?.league, payload?.data?.tournament,
    payload?.result?.competition, payload?.result?.league,
  ].filter(Boolean);
  for (const metadata of containers) {
    const identifier = entitySlug(metadata) || metadata?.competition_slug || metadata?.league_slug || "";
    if (identifier) {
      const resolved = competitionFromIdentifier(identifier);
      if (resolved && resolved.rank !== undefined && competition.rank !== undefined && resolved.rank !== competition.rank) return false;
      // If a provider supplies an unfamiliar identifier, use the explicit name check below.
    }
    const name = entityName(metadata) || metadata?.competition_name || metadata?.league_name || "";
    if (name) {
      const token = normalizeCompetitionToken(name);
      const accepted = [
        competition.name,
        competition.name.replace(/^(England|Spain|Germany|Italy|France|Portugal|Netherlands) /, ""),
        competition.slug,
        ...(competition.aliases || []),
      ].map(normalizeCompetitionToken);
      if (!accepted.includes(token)) return false;
      const country = normalizeCompetitionToken(first(metadata.country, metadata.area?.name, metadata.region, ""));
      const expectedCountry = normalizeCompetitionToken(competition.country);
      if (country && competition.country !== "Europe" && country !== expectedCountry && !country.includes(expectedCountry) && !expectedCountry.includes(country)) return false;
    }
  }
  return true;
}

function fixtureBelongsToCompetition(raw = {}, competition) {
  const identifier = rawCompetitionIdentifier(raw);
  if (identifier) {
    const resolved = competitionFromIdentifier(identifier);
    if (resolved) return resolved.rank !== undefined && competition.rank !== undefined ? resolved.rank === competition.rank : resolved.slug === competition.slug;
  }
  const c = raw.competition || raw.league || raw.tournament || raw.competition_info || {};
  const rawName = first(entityName(c), raw.competition_name, raw.league_name, raw.tournament_name, "");
  if (!rawName) return true; // The fixtures endpoint itself was queried with competition=<exact slug>.
  const rawToken = normalizeCompetitionToken(rawName);
  const allowedNames = [competition.name, competition.name.replace(/^(England|Spain|Germany|Italy|France|Portugal|Netherlands) /, ""), ...(competition.aliases || [])].map(normalizeCompetitionToken);
  if (!allowedNames.includes(rawToken)) return false;
  const rawCountry = normalizeCompetitionToken(first(c.country, c.area?.name, c.region, ""));
  const expectedCountry = normalizeCompetitionToken(competition.country);
  return !rawCountry || competition.country === "Europe" || rawCountry === expectedCountry || rawCountry.includes(expectedCountry) || expectedCountry.includes(rawCountry);
}

function slugify(value) { return String(value || "competition").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

function normalizeStatus(rawStatus, statusText = "") {

  const value = `${rawStatus || ""} ${statusText || ""}`.trim().toLowerCase();

  if (/penalt|shoot.?out/.test(value)) return "PENALTY_SHOOTOUT";

  if (/extra.?time|\bet\b/.test(value)) return "EXTRA_TIME";

  if (/half.?time|\bht\b|break/.test(value)) return "PAUSED";

  if (/live|in.?play|\b[1-9][0-9]?\s*['′]/.test(value)) return "IN_PLAY";

  if (/finished|full.?time|\bft\b|ended|after full time/.test(value)) return "FINISHED";

  if (/postpon/.test(value)) return "POSTPONED";

  if (/cancel|abandon/.test(value)) return "CANCELLED";

  if (/suspend/.test(value)) return "SUSPENDED";

  if (/upcoming|scheduled|not started|\bns\b/.test(value)) return "SCHEDULED";

  return rawStatus ? String(rawStatus).toUpperCase().replaceAll(" ", "_") : "SCHEDULED";

}

function normalizePerson(raw) {

  if (!raw) return null;

  if (typeof raw === "string") return { name: raw };

  return { ...raw, id: first(raw.id, raw.player_id), name: first(raw.name, raw.player_name, raw.full_name, raw.player?.name, "Unknown player") };

}

function normalizeEvent(raw = {}) {

  const kindText = String(first(raw.kind, raw.type, raw.event, raw.description, raw.label, "event")).toLowerCase();

  const minuteRaw = first(raw.minute, raw.time?.minute, raw.elapsed, raw.time, raw.elapsed_time);

  const minuteMatch = typeof minuteRaw === "string" ? minuteRaw.match(/\d+/) : null;

  const minute = asNum(minuteRaw) ?? (minuteMatch ? Number(minuteMatch[0]) : null);

  const player = normalizePerson(first(raw.player, raw.scorer, raw.player_name));

  const assist = normalizePerson(first(raw.assist, raw.assist_player));

  const kind = /goal|score|penalty/.test(kindText) ? "goal" : /yellow|red|card|booking/.test(kindText) ? "card" : /substitut/.test(kindText) ? "substitution" : "other";

  return { ...raw, kind, type: kindText, minute, injuryTime: asNum(first(raw.injury_time, raw.added_time, raw.extra_time)), team: typeof raw.team === "string" ? { name: raw.team } : (raw.team || null), player, scorer: kind === "goal" ? player : normalizePerson(raw.scorer), assist, playerIn: normalizePerson(first(raw.player_in, raw.in_player, kind === "substitution" ? raw.player : null)), playerOut: normalizePerson(first(raw.player_out, raw.out_player, raw.assist)), card: first(raw.card, raw.card_type, raw.detail, "") };

}

function normalizeStats(statsRaw, side) {

  if (!statsRaw) return null;

  if (Array.isArray(statsRaw)) {

    const out = {};

    for (const item of statsRaw) {

      const keyText = String(first(item.type, item.name, item.label, item.stat, "")).toLowerCase();

      const value = first(item.value, item.total, item.value_home, item.amount);

      const map = [

        [/possession/, "ball_possession"], [/shots on target|shots on goal/, "shots_on_goal"], [/shots off target|shots off goal/, "shots_off_goal"], [/total shots|shots total|^shots$/, "shots"], [/corner/, "corner_kicks"], [/offside/, "offsides"], [/foul/, "fouls"], [/save/, "saves"], [/yellow card/, "yellow_cards"], [/red card/, "red_cards"], [/free kick/, "free_kicks"], [/goal kick/, "goal_kicks"], [/throw.?in/, "throw_ins"]

      ].find(([re]) => re.test(keyText));

      if (map) out[map[1]] = value;

    }

    return Object.keys(out).length ? out : null;

  }

  if (typeof statsRaw === "object") {

    const out = {};

    for (const [key, value] of Object.entries(statsRaw)) {

      const k = key.toLowerCase().replace(/[ -]/g, "_");

      const mapped = ({ possession: "ball_possession", ball_possession: "ball_possession", shots_on_target: "shots_on_goal", shots_on_goal: "shots_on_goal", shots_off_target: "shots_off_goal", corners: "corner_kicks", corner_kicks: "corner_kicks", total_shots: "shots", shots: "shots", fouls: "fouls", saves: "saves", offsides: "offsides", yellow_cards: "yellow_cards", red_cards: "red_cards" })[k] || k;

      if (["ball_possession","shots_on_goal","shots_off_goal","corner_kicks","shots","fouls","saves","offsides","yellow_cards","red_cards","free_kicks","goal_kicks","throw_ins"].includes(mapped)) out[mapped] = value;

    }

    return Object.keys(out).length ? out : null;

  }

  return null;

}

function normalizeFixture(raw = {}, expectedCompetition = null) {

  const homeRaw = first(raw.homeTeam, raw.home_team, raw.home, raw.teams?.home, {});

  const awayRaw = first(raw.awayTeam, raw.away_team, raw.away, raw.teams?.away, {});

  const homeName = entityName(homeRaw) || first(raw.home_name, raw.home_team_name, "Home team");

  const awayName = entityName(awayRaw) || first(raw.away_name, raw.away_team_name, "Away team");

  const time = first(raw.utcDate, raw.utc_date, raw.kickoff, raw.start_time, raw.datetime, raw.time, raw.date, null);

  const scoreRaw = raw.score || raw.scores || {};

  const homeScore = asNum(first(raw.home_score, raw.homeScore, scoreRaw.home, scoreRaw.home_score, scoreRaw.current?.home, scoreRaw.full_time?.home));

  const awayScore = asNum(first(raw.away_score, raw.awayScore, scoreRaw.away, scoreRaw.away_score, scoreRaw.current?.away, scoreRaw.full_time?.away));

  const statusText = first(raw.status_text, raw.statusText, raw.status?.text, raw.status?.description, "");

  const statusRaw = typeof raw.status === "object" ? first(raw.status.code, raw.status.name, raw.status.type) : raw.status;

  const status = normalizeStatus(statusRaw, statusText);

  const slug = first(raw.slug, raw.match_slug, raw.url_slug, "");

  const id = first(raw.id, raw.match_id, raw.fixture_id, slug);

  const competition = competitionFor(raw, expectedCompetition);

  const minuteMatch = String(first(raw.minute, raw.elapsed, statusText, "")).match(/\b(\d{1,3})(?:\s*\+\s*(\d+))?\s*['′]/);

  const homeLogo = first(homeRaw.logo, homeRaw.crest, homeRaw.image, homeRaw.icon, raw.home_logo, raw.homeTeamLogo, "");

  const awayLogo = first(awayRaw.logo, awayRaw.crest, awayRaw.image, awayRaw.icon, raw.away_logo, raw.awayTeamLogo, "");

  return {

    ...raw, id, slug: slug || (typeof id === "string" ? id : undefined), date: time, utcDate: time,

    competition, league: { ...competition, currentSeason: YEAR },

    homeTeam: { ...(typeof homeRaw === "object" ? homeRaw : {}), id: first(homeRaw.id, raw.home_team_id), name: homeName, shortName: first(homeRaw.short_name, homeRaw.shortName, homeName), crest: homeLogo, logo: homeLogo },

    awayTeam: { ...(typeof awayRaw === "object" ? awayRaw : {}), id: first(awayRaw.id, raw.away_team_id), name: awayName, shortName: first(awayRaw.short_name, awayRaw.shortName, awayName), crest: awayLogo, logo: awayLogo },

    status, statusText, minute: asNum(first(raw.minute, raw.elapsed, minuteMatch?.[1])), injuryTime: asNum(first(raw.injury_time, minuteMatch?.[2])),

    state: { description: statusText || status, short: status, elapsed: asNum(first(raw.minute, raw.elapsed, minuteMatch?.[1])) },

    score: { current: { home: homeScore, away: awayScore }, fullTime: { home: asNum(first(scoreRaw.fullTime?.home, scoreRaw.full_time?.home, raw.home_score)), away: asNum(first(scoreRaw.fullTime?.away, scoreRaw.full_time?.away, raw.away_score)) } },

    events: listFrom(raw, ["events", "timeline", "incidents"]).map(normalizeEvent),

    goals: listFrom(raw, ["goals"]).map(normalizeEvent), bookings: listFrom(raw, ["bookings", "cards"]).map(normalizeEvent), substitutions: listFrom(raw, ["substitutions"]).map(normalizeEvent),

    lineups: raw.lineups || null,

    ...(normalizeStats(first(raw.home_statistics, raw.home_stats, raw.statistics?.home, raw.stats?.home), "home") ? { homeTeam: { ...(typeof homeRaw === "object" ? homeRaw : {}), id: first(homeRaw.id, raw.home_team_id), name: homeName, shortName: first(homeRaw.short_name, homeRaw.shortName, homeName), crest: homeLogo, logo: homeLogo, statistics: normalizeStats(first(raw.home_statistics, raw.home_stats, raw.statistics?.home, raw.stats?.home), "home") } } : {}),

    ...(normalizeStats(first(raw.away_statistics, raw.away_stats, raw.statistics?.away, raw.stats?.away), "away") ? { awayTeam: { ...(typeof awayRaw === "object" ? awayRaw : {}), id: first(awayRaw.id, raw.away_team_id), name: awayName, shortName: first(awayRaw.short_name, awayRaw.shortName, awayName), crest: awayLogo, logo: awayLogo, statistics: normalizeStats(first(raw.away_statistics, raw.away_stats, raw.statistics?.away, raw.stats?.away), "away") } } : {}),

  };

}

function findArray(payload, keys, depth = 0) {

  if (!payload || depth > 6) return [];

  if (Array.isArray(payload)) return payload;

  if (typeof payload !== "object") return [];

  for (const key of keys) if (Array.isArray(payload[key])) return payload[key];

  // SportScore and other score providers may wrap the table several levels deep.

  for (const key of ["data", "result", "results", "response", "standings", "league", "competition", "table_data"]) {

    if (payload[key] && typeof payload[key] === "object") {

      const found = findArray(payload[key], keys, depth + 1);

      if (found.length) return found;

    }

  }

  return [];

}

function normalizeTable(payload) {

  const rowKeys = ["table", "rows", "standings", "entries", "ranking", "teams", "participants", "items"];

  // Many football APIs return one object per group/table, each with its own `table` array.

  const groupCandidates = Array.isArray(payload) ? payload : findArray(payload, ["tables", "groups", "standings"]);

  const groups = groupCandidates.filter(g => g && typeof g === "object" && !Array.isArray(g) && findArray(g, ["table", "rows", "entries", "ranking", "teams"]).length);

  const tables = groups.length ? groups.map((group, groupIndex) => ({

    group: first(group.group, group.name, group.stage, group.round, group.title, `Table ${groupIndex + 1}`),

    type: first(group.type, group.stage_type, "TOTAL"),

    table: findArray(group, ["table", "rows", "entries", "ranking", "teams"]).map((r, i) => normalizeStandingRow(r, i))

  })).filter(g => g.table.length) : [];

  if (tables.length) return tables;



  const rawRows = findArray(payload, rowKeys);

  if (!rawRows.length) return [];

  const rows = rawRows.map((r, i) => normalizeStandingRow(r, i));

  return rows.length ? [{ group: first(payload?.group, payload?.name, payload?.stage, payload?.competition?.name, "League table"), type: "TOTAL", table: rows }] : [];

}

function normalizeStandingRow(r = {}, i = 0) {

  const teamRaw = first(r.team, r.club, r.participant, r.squad, r, {});

  const played = asNum(first(r.playedGames, r.played, r.matches_played, r.played_matches, r.matches, r.mp, r.games_played, r.appearances));

  const won = asNum(first(r.won, r.wins, r.win, r.w));

  const draw = asNum(first(r.draw, r.draws, r.drawn, r.d));

  const lost = asNum(first(r.lost, r.losses, r.loss, r.l));

  const goalsFor = asNum(first(r.goalsFor, r.goals_for, r.goals_scored, r.gf, r.for));

  const goalsAgainst = asNum(first(r.goalsAgainst, r.goals_against, r.goals_conceded, r.ga, r.against));

  const teamName = first(entityName(teamRaw), r.team_name, r.club_name, r.participant_name, r.name, r.title, "Team");

  return {

    position: asNum(first(r.position, r.rank, r.place, r.order, i + 1)) ?? i + 1,

    team: { id: first(teamRaw?.id, teamRaw?.slug, r.team_id, r.club_id, teamName, i), name: teamName, crest: first(teamRaw?.crest, teamRaw?.logo, teamRaw?.image, teamRaw?.icon, r.team_logo, r.logo, r.image, "") },

    playedGames: played, won, draw, lost,

    goalDifference: asNum(first(r.goalDifference, r.goal_difference, r.gd, goalsFor != null && goalsAgainst != null ? goalsFor - goalsAgainst : null)),

    points: asNum(first(r.points, r.pts, r.point, r.score, r.total_points)) ?? 0,

    goalsFor, goalsAgainst, form: first(r.form, r.recent_form, "")

  };

}



function normalizeScorers(payload) {

  const rows = listFrom(payload, ["scorers", "topscorers", "top_scorers", "topScorers", "players", "ranking", "leaders", "items"]);

  return rows.map((r) => {

    const player = first(r.player, r.person, r, {});

    const team = first(r.team, r.club, r.squad, {});

    const goals = asNum(first(r.goals, r.goal_count, r.total_goals, r.value, r.statistics?.goals, r.stats?.goals));

    const assists = asNum(first(r.assists, r.assist_count, r.total_assists, r.statistics?.assists, r.stats?.assists));

    return { ...r, player: { id: first(player.id, player.slug, entityName(player)), name: entityName(player) || "Unknown player" }, team: { id: first(team.id, team.slug), name: entityName(team) || "—" }, goals: goals ?? 0, assists: assists ?? 0 };

  });

}

function normalizeTeams(payload) {

  const rows = listFrom(payload, ["teams", "clubs", "participants", "items"]);

  return rows.map((r, i) => { const t = r.team || r.club || r; return { id: first(t.id, t.slug, i), slug: entitySlug(t), name: entityName(t) || "Team", crest: first(t.crest, t.logo, t.image, t.icon, ""), logo: first(t.logo, t.crest, t.image, "") }; });

}

async function fetchFixtures(date, competition = null) {
  const params = { sport: "football", date, limit: 200, src: "ag-soccer" };
  if (competition?.slug) params.competition = competition.slug;
  return getJson("/api/v1/fixtures/", params);
}

function utcDatePlus(days) { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

function rankCompetition(match) {

  const name = String(match.competition?.name || match.league?.name || "").toLowerCase();

  const slug = String(match.competition?.slug || match.competition?.code || "").toLowerCase();

  const exact = COMPETITIONS.find(c => c.slug === slug || c.name.toLowerCase() === name);

  if (exact) return exact.rank;

  const patterns = [/champions league/, /premier league/, /la liga|primera division/, /bundesliga/, /serie a/, /ligue 1/, /europa league/, /conference league/, /primeira liga/, /eredivisie/];

  const idx = patterns.findIndex(re => re.test(name));

  return idx < 0 ? 999 : idx;

}

function sortMatches(matches) { return [...matches].sort((a,b) => rankCompetition(a) - rankCompetition(b) || new Date(a.utcDate || 0) - new Date(b.utcDate || 0)); }

function routeError(res, err) { const status = err.status || 502; console.error("AG SOCCER / SportScore error:", err.message); res.status(status).json({ success: false, message: err.message || "SportScore request failed" }); }

async function readNews() { await fs.mkdir(DATA_DIR, { recursive: true }); try { const value = JSON.parse(await fs.readFile(NEWS_FILE, "utf8")); return Array.isArray(value) ? value : []; } catch (e) { if (e.code !== "ENOENT") throw e; await fs.writeFile(NEWS_FILE, "[]"); return []; } }

async function writeNews(items) { await fs.mkdir(DATA_DIR, { recursive: true }); await fs.writeFile(NEWS_FILE, JSON.stringify(items, null, 2)); }

function admin(req, res, next) { const key = process.env.ADMIN_KEY; if (!key) return res.status(503).json({ success: false, message: "Set ADMIN_KEY to enable publishing." }); if (req.get("x-admin-key") !== key) return res.status(401).json({ success: false, message: "Invalid admin key." }); next(); }

function getCompetition(slugOrCode) {
  const val = decodeURIComponent(String(slugOrCode || "")).toLowerCase();
  return resolvedCompetitions.get(val) || competitionFromIdentifier(val) || COMPETITIONS.find(c => slugify(c.name) === val || c.name.toLowerCase() === val) || { name: val.replaceAll("-", " ").replace(/\b\w/g, c => c.toUpperCase()), slug: val, aliases: [], country: "Europe", rank: 999 };
}



app.get("/", (_req, res) => res.json({ success: true, message: "Welcome to AG SOCCER API ⚽", provider: "SportScore", docs: "https://sportscore.com/developers/api/" }));

app.get("/api/health", (_req, res) => res.json({ success: true, provider: "SportScore", apiKeyConfigured: false, apiKeyRequired: false, adminConfigured: Boolean(process.env.ADMIN_KEY), currentYear: YEAR, competitionDiscovery: "dynamic via SportScore search", attributionRequired: true }));

app.get("/api/test", async (_req, res) => { try { const p = await getJson("/api/v1/search/", { q: "Premier League", sport: "football", limit: 5 }); res.json({ success: true, provider: "SportScore", result: p }); } catch (e) { routeError(res, e); } });



function collectSearchEntities(payload, out = [], seen = new Set(), depth = 0) {

  if (!payload || depth > 5) return out;

  if (Array.isArray(payload)) { for (const item of payload) collectSearchEntities(item, out, seen, depth + 1); return out; }

  if (typeof payload !== "object") return out;

  const slug = entitySlug(payload);

  const name = entityName(payload);

  if (slug && name && !seen.has(slug)) { seen.add(slug); out.push(payload); }

  for (const [key, value] of Object.entries(payload)) {

    if (["competition", "competitions", "league", "leagues", "results", "data", "items", "groups", "tournaments"].includes(key.toLowerCase())) collectSearchEntities(value, out, seen, depth + 1);

  }

  return out;

}

function competitionNameToken(value) {
  return normalizeCompetitionToken(value).replace(/^(england|english|spain|spanish|germany|german|italy|italian|france|french|portugal|portuguese|netherlands|dutch)-/, "");
}

function competitionCandidateScore(candidate, seed) {
  const name = entityName(candidate);
  const candidateToken = normalizeCompetitionToken(name);
  const allowed = [seed.name, ...(seed.matchNames || []), ...(seed.aliases || [])]
    .map(competitionNameToken);
  const normalizedCandidate = competitionNameToken(name);
  let score = allowed.includes(normalizedCandidate) ? 100 : 0;
  const url = String(candidate.url || candidate.href || "").toLowerCase();
  const expectedCountry = normalizeCompetitionToken(seed.country);
  if (seed.country !== "Europe" && url.includes(`/${expectedCountry}/`)) score += 25;
  if (seed.country === "Europe" && /uefa|europe|international/.test(url)) score += 15;
  if (/women|femenino|femenina|femenin|womens|ladies/.test(`${candidateToken} ${url}`)) score -= 100;
  if (score < 100) return -1;
  return score;
}

async function resolveCompetitionSeed(seed) {
  const fallback = {
    id: seed.slug, slug: seed.slug, code: seed.slug, name: seed.name,
    emblem: "", logo: "", area: { name: seed.country }, country: seed.country,
    aliases: seed.aliases || [], currentSeason: YEAR, rank: seed.rank,
  };

  try {
    const payload = await getJson("/api/v1/search/", {
      q: seed.searchQuery || seed.name,
      sport: "football",
      limit: 20,
      src: "ag-soccer",
    });
    const candidates = Array.isArray(payload?.competitions) ? payload.competitions : [];
    const best = candidates
      .map(candidate => ({ candidate, score: competitionCandidateScore(candidate, seed) }))
      .filter(item => item.score >= 100)
      .sort((a, b) => b.score - a.score)[0]?.candidate;

    if (!best?.slug) {
      console.warn(`SportScore search did not find an exact competition for ${seed.name}; using configured fallback slug ${seed.slug}.`);
      return fallback;
    }

    const resolved = {
      ...fallback,
      id: best.slug,
      slug: best.slug,
      code: best.slug,
      providerSlug: best.slug,
      emblem: best.logo || fallback.emblem,
      logo: best.logo || fallback.logo,
      providerUrl: best.url || "",
      providerName: best.name || seed.name,
    };
    resolvedCompetitions.set(String(seed.slug).toLowerCase(), resolved);
    resolvedCompetitions.set(String(best.slug).toLowerCase(), resolved);
    for (const alias of seed.aliases || []) resolvedCompetitions.set(String(alias).toLowerCase(), resolved);
    return resolved;
  } catch (error) {
    console.warn(`SportScore competition search failed for ${seed.name}: ${error.message}`);
    return fallback;
  }
}

async function resolveRequestedCompetition(identifier) {
  const configured = getCompetition(identifier);
  // If /api/leagues already resolved this entry, use the provider's exact slug.
  const cached = resolvedCompetitions.get(String(identifier || "").toLowerCase());
  if (cached?.providerSlug) return cached;
  const known = resolvedCompetitions.get(String(configured.slug || "").toLowerCase());
  if (known?.providerSlug) return known;
  return resolveCompetitionSeed(configured);
}

app.get("/api/leagues", async (_req, res) => {

  // SportScore exposes competition discovery through search. Resolve each canonical league name to its real provider slug.

  const competitions = await Promise.all(COMPETITIONS.map(resolveCompetitionSeed));

  for (const c of competitions) {
    resolvedCompetitions.set(String(c.slug).toLowerCase(), c);
    if (c.providerSlug) resolvedCompetitions.set(String(c.providerSlug).toLowerCase(), c);
    for (const alias of c.aliases || []) resolvedCompetitions.set(String(alias).toLowerCase(), c);
  }

  res.json({ success: true, count: competitions.length, provider: "SportScore", competitions, leagues: competitions });

});

app.get("/api/matches", async (req, res) => {

  try {

    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : utcDatePlus(0);

    const p = await fetchFixtures(date);

    let matches = listFrom(p).map(normalizeFixture);

    if (req.query.leagueId) { const c = await resolveRequestedCompetition(req.query.leagueId); matches = matches.filter(m => m.competition.slug === c.slug || m.competition.code === c.slug); }

    res.json({ success: true, provider: "SportScore", date, count: matches.length, matches: sortMatches(matches), updated: p.updated || null });

  } catch (e) { routeError(res, e); }

});

app.get("/api/live", async (_req, res) => {

  try {

    const p = await getJson("/api/v1/fixtures/", { sport: "football", date: utcDatePlus(0), status: "live", limit: 200, src: "ag-soccer" });

    const matches = listFrom(p).map(normalizeFixture).filter(m => ["IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT"].includes(m.status));

    res.json({ success: true, provider: "SportScore", count: matches.length, matches: sortMatches(matches), updated: p.updated || null });

  } catch (e) { routeError(res, e); }

});

app.get("/api/matches/live", async (_req, res) => {

  try { const p = await getJson("/api/v1/fixtures/", { sport: "football", date: utcDatePlus(0), status: "live", limit: 200, src: "ag-soccer" }); const matches = listFrom(p).map(normalizeFixture); res.json({ success: true, count: matches.length, matches: sortMatches(matches) }); }

  catch (e) { routeError(res, e); }

});

app.get("/api/matches/:id/events", async (req, res) => { try { const p = await getJson("/api/widget/match/", { sport: "football", slug: req.params.id, src: "ag-soccer" }); const events = listFrom(p, ["events", "timeline", "incidents"]).map(normalizeEvent); res.json({ success: true, events, goals: events.filter(e => e.kind === "goal"), bookings: events.filter(e => e.kind === "card"), substitutions: events.filter(e => e.kind === "substitution") }); } catch (e) { routeError(res,e); } });

app.get("/api/matches/:id/lineups", async (req, res) => { try { const p = await getJson("/api/widget/match/", { sport: "football", slug: req.params.id, src: "ag-soccer" }); res.json({ success: true, lineups: p.lineups || p.data?.lineups || null, match: p }); } catch (e) { routeError(res,e); } });

app.get("/api/matches/:id/statistics", async (req, res) => { try { const p = await getJson("/api/widget/match/", { sport: "football", slug: req.params.id, src: "ag-soccer" }); const statistics = p.statistics || p.stats || p.data?.statistics || p.data?.stats || null; res.json({ success: true, statistics, message: statistics ? undefined : "SportScore did not provide detailed match statistics for this fixture." }); } catch (e) { routeError(res,e); } });

function statsForSide(raw, side, teamName) {

  const direct = first(raw[`${side}_statistics`], raw[`${side}_stats`], raw.statistics?.[side], raw.stats?.[side], null);

  if (direct) return normalizeStats(direct, side);

  const blocks = first(raw.statistics, raw.stats, raw.match_statistics, raw.team_statistics, null);

  if (Array.isArray(blocks)) {

    const found = blocks.find(item => {

      const label = String(first(item.side, item.home_away, item.team?.side, item.team?.name, item.name, "")).toLowerCase();

      return label === side || label.includes(side) || (teamName && label.includes(String(teamName).toLowerCase()));

    });

    if (found) return normalizeStats(first(found.statistics, found.stats, found.values, found), side);

    // Some providers return one row per statistic with separate home/away values.

    const split = blocks.filter(item => item && (item.home !== undefined || item.away !== undefined || item.home_value !== undefined || item.away_value !== undefined))

      .map(item => ({ type: first(item.type, item.name, item.label), value: side === "home" ? first(item.home, item.home_value) : first(item.away, item.away_value) }));

    if (split.length) return normalizeStats(split, side);

  }

  return normalizeStats(blocks, side);

}



app.get("/api/matches/:id", async (req, res) => {

  try {

    const slug = String(req.params.id);

    const p = await getJson("/api/widget/match/", { sport: "football", slug, src: "ag-soccer" });

    const raw = p.match || p.data?.match || p.data || p;

    const match = normalizeFixture({ ...raw, slug: first(raw.slug, slug) });

    const events = listFrom(raw, ["events", "timeline", "incidents"]).map(normalizeEvent);

    const goals = listFrom(raw, ["goals"]).map(normalizeEvent);

    const bookings = listFrom(raw, ["bookings", "cards"]).map(normalizeEvent);

    const substitutions = listFrom(raw, ["substitutions"]).map(normalizeEvent);

    const lineupsRaw = first(raw.lineups, raw.lineup, p.lineups, p.data?.lineups, null);

    const lineupSide = (side) => {

      if (Array.isArray(lineupsRaw)) {

        const team = lineupsRaw.find(x => String(x.side || x.team_side || x.team?.name || "").toLowerCase().includes(side)) || lineupsRaw[side === "home" ? 0 : 1];

        return team ? listFrom(team, ["players", "starting_xi", "startingXI", "starting_lineup", "start_xi", "starters", "lineup", "startXI"]).map(normalizePerson) : [];

      }

      return listFrom(lineupsRaw?.[side], ["players", "starting_xi", "startingXI", "starting_lineup", "start_xi", "starters", "lineup", "startXI"]).map(normalizePerson);

    };

    const homeStatistics = statsForSide(raw, "home", match.homeTeam?.name);

    const awayStatistics = statsForSide(raw, "away", match.awayTeam?.name);

    match.events = events.length ? events : [...goals, ...bookings, ...substitutions];

    match.goals = goals.length ? goals : events.filter(e => e.kind === "goal");

    match.bookings = bookings.length ? bookings : events.filter(e => e.kind === "card");

    match.substitutions = substitutions.length ? substitutions : events.filter(e => e.kind === "substitution");

    match.lineups = { home: lineupSide("home"), away: lineupSide("away") };

    match.homeTeam = { ...match.homeTeam, lineup: lineupSide("home"), bench: listFrom(lineupsRaw?.home, ["substitutes", "bench"]).map(normalizePerson), ...(homeStatistics ? { statistics: homeStatistics } : {}) };

    match.awayTeam = { ...match.awayTeam, lineup: lineupSide("away"), bench: listFrom(lineupsRaw?.away, ["substitutes", "bench"]).map(normalizePerson), ...(awayStatistics ? { statistics: awayStatistics } : {}) };

    res.json({ success: true, provider: "SportScore", match, details: { events: match.events.length > 0, lineups: match.homeTeam.lineup.length > 0 || match.awayTeam.lineup.length > 0, statistics: Boolean(homeStatistics || awayStatistics), rawFields: Object.keys(raw || {}) } });

  } catch (e) { routeError(res,e); }

});



async function competitionFixtures(competition) {
  const dates = Array.from({ length: 15 }, (_, i) => utcDatePlus(i - 3));
  const results = await Promise.allSettled(dates.map(date => fetchFixtures(date, competition)));
  const matches = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const raw of listFrom(result.value)) {
      // Never show a match under a competition when the provider identifies another league.
      if (!fixtureBelongsToCompetition(raw, competition)) continue;
      matches.push(normalizeFixture(raw, competition));
    }
  }
  const unique = new Map();
  for (const match of matches) unique.set(String(match.id || match.slug || `${match.utcDate}-${match.homeTeam?.name}-${match.awayTeam?.name}`), match);
  return sortMatches([...unique.values()]);
}

app.get("/api/leagues/:id/matches", async (req, res) => { try { const competition = await resolveRequestedCompetition(req.params.id); const matches = await competitionFixtures(competition); res.json({ success: true, provider: "SportScore", league: competition, season: YEAR, count: matches.length, matches }); } catch (e) { routeError(res,e); } });

async function fetchStandingsForCompetition(competition) {
  // One exact slug only. Falling back to generic slugs can silently return another league's table.
  let lastPayload = null;
  for (const endpoint of ["/api/widget/standings/", "/api/v1/standings/"]) {
    try {
      const payload = await getJson(endpoint, { sport: "football", slug: competition.slug, src: "ag-soccer" });
      lastPayload = payload;
      if (!providerPayloadMatchesCompetition(payload, competition)) {
        console.warn(`SportScore returned mismatched standings metadata for ${competition.slug}; ignoring it.`);
        continue;
      }
      const rows = normalizeTable(payload);
      if (rows.length && rows.some(group => Array.isArray(group.table) && group.table.length)) {
        return { standings: rows, slug: competition.slug, payload };
      }
    } catch (error) {
      if (error.status !== 404) console.warn(`Standings lookup failed for ${competition.slug} (${endpoint}): ${error.message}`);
    }
  }
  return { standings: [], slug: competition.slug, payload: lastPayload };
}

app.get("/api/leagues/:id/standings", async (req, res) => {

  try {

    const competition = await resolveRequestedCompetition(req.params.id);

    const result = await fetchStandingsForCompetition(competition);

    res.json({ success: true, provider: "SportScore", league: { ...competition, slug: result.slug }, season: YEAR, standings: result.standings, count: result.standings.reduce((n, g) => n + (g.table?.length || 0), 0), message: result.standings.length ? undefined : "No standings were returned for this competition. Check the competition slug or SportScore availability." });

  } catch (e) { routeError(res, e); }

});

app.get("/api/standings/:id", async (req, res) => {

  try {

    const competition = await resolveRequestedCompetition(req.params.id);

    const result = await fetchStandingsForCompetition(competition);

    res.json({ success: true, provider: "SportScore", league: { ...competition, slug: result.slug }, season: YEAR, standings: result.standings, count: result.standings.reduce((n, g) => n + (g.table?.length || 0), 0), message: result.standings.length ? undefined : "No standings were returned for this competition. Check the competition slug or SportScore availability." });

  } catch (e) { routeError(res, e); }

});

function competitionSlugCandidates(competition) {
  // Try the documented canonical slug first, then aliases for older links/provider variants.
  return [...new Set([competition.slug, ...(competition.aliases || [])].filter(Boolean))];
}

async function fetchCompetitionWidget(endpoint, competition, extraParams = {}) {
  let lastError = null;
  for (const slug of competitionSlugCandidates(competition)) {
    try {
      const payload = await getJson(endpoint, {
        sport: "football",
        slug,
        src: "ag-soccer",
        ...extraParams,
      });
      if (!providerPayloadMatchesCompetition(payload, competition)) {
        console.warn(`Ignoring mismatched ${endpoint} payload for ${competition.name} (requested slug: ${slug}).`);
        continue;
      }
      return { payload, slug };
    } catch (error) {
      lastError = error;
      if (error.status !== 404) {
        console.warn(`${endpoint} lookup failed for ${competition.name} (${slug}): ${error.message}`);
      }
    }
  }
  if (lastError) throw lastError;
  return { payload: null, slug: competition.slug };
}

app.get("/api/leagues/:id/scorers", async (req, res) => {
  try {
    const competition = await resolveRequestedCompetition(req.params.id);
    const result = await fetchCompetitionWidget("/api/widget/topscorers/", competition, {
      limit: 20,
      stat: "goals",
    });
    const scorers = result.payload ? normalizeScorers(result.payload) : [];
    res.json({
      success: true,
      provider: "SportScore",
      league: { ...competition, slug: result.slug },
      season: YEAR,
      count: scorers.length,
      scorers,
      message: scorers.length ? undefined : "SportScore did not return top scorers for this competition. Check the network connection and competition slug.",
    });
  } catch (error) {
    routeError(res, error);
  }
});

app.get("/api/leagues/:id/teams", async (req, res) => {
  try {
    const competition = await resolveRequestedCompetition(req.params.id);
    let teams = [];

    try {
      const result = await fetchCompetitionWidget("/api/widget/standings/", competition);
      if (result.payload) {
        teams = normalizeTeams(result.payload);
        if (!teams.length) {
          const tables = normalizeTable(result.payload);
          teams = tables.flatMap(group => group.table || []).map(row => ({
            id: row.team.id,
            name: row.team.name,
            crest: row.team.crest || "",
            logo: row.team.crest || "",
            slug: slugify(row.team.name),
          }));
        }
      }
    } catch (error) {
      console.warn(`Could not load teams from ${competition.slug} standings: ${error.message}`);
    }

    // If standings do not contain team rows, derive teams only from fixtures verified for this competition.
    if (!teams.length) {
      const matches = await competitionFixtures(competition);
      const map = new Map();
      for (const match of matches) {
        for (const team of [match.homeTeam, match.awayTeam]) {
          if (team?.name) {
            map.set(String(team.id || team.name), {
              id: team.id || team.name,
              name: team.name,
              crest: team.crest || "",
              logo: team.logo || team.crest || "",
              slug: team.slug || slugify(team.name),
            });
          }
        }
      }
      teams = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    res.json({
      success: true,
      provider: "SportScore",
      league: competition,
      season: YEAR,
      count: teams.length,
      teams,
      message: teams.length ? undefined : "No teams were returned. Check the SportScore connection and competition slug.",
    });
  } catch (error) {
    routeError(res, error);
  }
});

app.get("/api/teams", async (req, res) => { try { const q = String(req.query.search || "football").trim(); const p = await getJson("/api/v1/search/", { q: q.length >= 2 ? q : "football", sport: "football", limit: 20, src: "ag-soccer" }); const teams = normalizeTeams(p.teams || p.results?.teams || p.data?.teams || p); res.json({ success: true, count: teams.length, teams }); } catch (e) { routeError(res,e); } });

app.get("/api/teams/:id", async (req, res) => { try { const p = await getJson("/api/v1/search/", { q: req.params.id, sport: "football", limit: 10, src: "ag-soccer" }); const teams = normalizeTeams(p.teams || p.results?.teams || p.data?.teams || p); const team = teams[0]; if (!team) return res.status(404).json({ success: false, message: "Team not found." }); res.json({ success: true, team }); } catch (e) { routeError(res,e); } });

app.get("/api/countries", (_req, res) => res.json({ success: true, count: 0, countries: [], provider: "SportScore" }));



app.get("/api/news", async (_req, res) => { try { const news = (await readNews()).sort((a,b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0)); res.json({ success: true, count: news.length, news }); } catch (e) { routeError(res,e); } });

app.post("/api/news", admin, async (req, res) => { try { const b = req.body || {}; const title = String(b.title || "").trim(); const excerpt = String(b.excerpt || b.summary || b.description || "").trim(); const body = String(b.body || b.description || excerpt).trim(); if (!title || !excerpt) return res.status(400).json({ success: false, message: "A title and summary are required." }); const news = await readNews(); const article = { id: String(Date.now()), title, excerpt, summary: excerpt, body, description: body, imageUrl: String(b.imageUrl || b.image || "").trim(), image: String(b.image || b.imageUrl || "").trim(), url: String(b.url || "").trim(), category: String(b.category || "Football"), publishedAt: new Date().toISOString() }; news.unshift(article); await writeNews(news); res.status(201).json({ success: true, news: article, article }); } catch (e) { routeError(res,e); } });

app.delete("/api/news/:id", admin, async (req, res) => { try { const items = await readNews(); const updated = items.filter(x => String(x.id) !== req.params.id); if (updated.length === items.length) return res.status(404).json({ success: false, message: "News article not found." }); await writeNews(updated); res.json({ success: true, message: "News article deleted." }); } catch (e) { routeError(res,e); } });

app.use("/api", (_req, res) => res.status(404).json({ success: false, message: "API route not found." }));

app.listen(PORT, () => { console.log(`AG SOCCER API running at http://localhost:${PORT}`); console.log("Football data provider: SportScore (no API key required)"); console.log(`Admin publishing configured: ${Boolean(process.env.ADMIN_KEY)}`); });