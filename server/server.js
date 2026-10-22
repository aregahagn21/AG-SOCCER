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
const API_BASE = (process.env.HIGHLIGHTLY_BASE_URL || "https://soccer.highlightly.net").replace(/\/$/, "");
const API_KEY = process.env.HIGHLIGHTLY_API_KEY || process.env.RAPIDAPI_KEY || process.env.API_KEY || "";
const RAPIDAPI_HOST = process.env.HIGHLIGHTLY_RAPIDAPI_HOST || "soccer.highlightly.net";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const NEWS_FILE = path.join(DATA_DIR, "news.json");
const YEAR = new Date().getFullYear();

app.use(cors({ origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",").map(x => x.trim()) : true }));
app.use(express.json({ limit: "1mb" }));
const http = axios.create({ baseURL: API_BASE, timeout: 25000, headers: { Accept: "application/json", "x-rapidapi-key": API_KEY, "x-rapidapi-host": RAPIDAPI_HOST } });

const PRIORITY = [/champions league/i, /premier league/i, /la liga|primera division/i, /bundesliga/i, /serie a/i, /ligue 1/i, /europa league/i, /conference league/i, /primeira liga/i, /eredivisie/i, /major league soccer/i];
const rank = name => { const i = PRIORITY.findIndex(re => re.test(String(name || ""))); return i < 0 ? 999 : i; };
function listFrom(payload, keys = []) {
  const candidates = [payload, payload?.data, payload?.result, payload?.results, payload?.response];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") {
      for (const key of keys) if (Array.isArray(candidate[key])) return candidate[key];
      for (const key of ["data", "items", "results", "response"]) if (Array.isArray(candidate[key])) return candidate[key];
    }
  }
  return [];
}
function normalizeLeague(raw = {}) {
  const seasons = (Array.isArray(raw.seasons) ? raw.seasons : []).map(s => Number(s?.season ?? s?.year ?? s)).filter(Number.isFinite).sort((a,b)=>b-a);
  const currentSeason = seasons.find(y => y >= YEAR - 1 && y <= YEAR) ?? null;
  return { ...raw, id: raw.id ?? raw.leagueId ?? raw.league_id, name: raw.name ?? raw.leagueName ?? raw.title ?? "Unknown competition", code: raw.code ?? raw.slug ?? "", logo: raw.logo ?? raw.emblem ?? raw.image ?? "", emblem: raw.emblem ?? raw.logo ?? raw.image ?? "", country: raw.country ?? raw.area ?? null, seasons: [...new Set(seasons)].map(season => ({season})), currentSeason, currentSeasonAvailable: currentSeason !== null };
}
function pickNumber(...values) {
  for (const value of values) {
    if (value === 0) return 0;
    if (value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}
function normalizeStatus(value) {
  const text = String(typeof value === "object" ? (value?.short ?? value?.long ?? value?.description ?? "") : (value ?? "SCHEDULED")).trim();
  const upper = text.toUpperCase().replace(/[ -]+/g, "_");
  if (/FINISHED|FULL_TIME|FT|ENDED|COMPLETE/.test(upper)) return "FINISHED";
  if (/LIVE|IN_PLAY|INPROGRESS|IN_PROGRESS|FIRST_HALF|SECOND_HALF|1ST_HALF|2ND_HALF/.test(upper)) return "IN_PLAY";
  if (/HALF_TIME|HALFTIME|PAUSED|BREAK/.test(upper)) return "PAUSED";
  if (/EXTRA_TIME|AET/.test(upper)) return "EXTRA_TIME";
  if (/PENALT/.test(upper)) return "PENALTY_SHOOTOUT";
  if (/POSTPON/.test(upper)) return "POSTPONED";
  if (/CANCEL|ABANDON/.test(upper)) return "CANCELLED";
  if (/SUSPEND/.test(upper)) return "SUSPENDED";
  if (/SCHEDULE|NOT_STARTED|TIMED|UPCOMING/.test(upper)) return "SCHEDULED";
  return text || "SCHEDULED";
}
function person(value) {
  if (!value) return null;
  if (typeof value === "string") return { name: value };
  return { ...value, id: value.id ?? value.playerId ?? value.person?.id, name: value.name ?? value.fullName ?? value.player?.name ?? value.person?.name ?? "Unknown player" };
}
function normalizeEvent(raw = {}) {
  const typeRaw = raw.type ?? raw.eventType ?? raw.typeName ?? raw.kind ?? raw.detail ?? raw.name ?? "event";
  const type = String(typeof typeRaw === "object" ? (typeRaw.name ?? typeRaw.type ?? "event") : typeRaw).toLowerCase();
  const player = person(raw.player ?? raw.scorer ?? raw.playerIn ?? raw.actor ?? raw.participant);
  const assist = person(raw.assist ?? raw.assistedBy ?? raw.assistPlayer);
  const teamRaw = raw.team ?? raw.teamName ?? raw.side;
  const team = typeof teamRaw === "string" ? { name: teamRaw } : (teamRaw || null);
  const minuteRaw = raw.minute ?? raw.time?.minute ?? raw.timeElapsed ?? raw.elapsed ?? raw.clock?.minute;
  const minute = pickNumber(typeof minuteRaw === "object" ? minuteRaw?.elapsed ?? minuteRaw?.minute : minuteRaw);
  const injuryRaw = raw.injuryTime ?? raw.extraMinute ?? raw.addedTime ?? raw.time?.extra;
  const injuryTime = pickNumber(injuryRaw);
  const isGoal = /goal|penalty_scored|own_goal/.test(type);
  const isCard = /card|booking|yellow|red/.test(type);
  const isSub = /substitution|substitute|player_change/.test(type) || Boolean(raw.playerIn || raw.playerOut);
  return { ...raw, type, kind: isGoal ? "goal" : isCard ? "card" : isSub ? "substitution" : "other", minute, injuryTime, team: team ? { ...team, name: team.name ?? team.shortName ?? "" } : null, scorer: isGoal ? person(raw.scorer ?? raw.player ?? raw.playerIn ?? raw.actor) : person(raw.scorer), player, assist, playerIn: person(raw.playerIn ?? raw.inPlayer ?? raw.substituteIn), playerOut: person(raw.playerOut ?? raw.outPlayer ?? raw.substituteOut), card: raw.card ?? raw.cardType ?? (/red/.test(type) ? "RED" : /yellow/.test(type) ? "YELLOW" : undefined), goalType: raw.goalType ?? (/own_goal/.test(type) ? "OWN_GOAL" : /penalty/.test(type) ? "PENALTY" : undefined) };
}
function normalizeMatch(raw = {}) {
  const home = raw.homeTeam ?? raw.home ?? raw.teams?.home ?? raw.participants?.home ?? {};
  const away = raw.awayTeam ?? raw.away ?? raw.teams?.away ?? raw.participants?.away ?? {};
  const lg = raw.league ?? raw.competition ?? raw.tournament ?? raw.competitions?.[0] ?? {};
  const state = raw.state ?? raw.statusInfo ?? {};
  const rawScore = raw.score?.current ?? raw.score?.fullTime ?? raw.score ?? state.score?.current ?? state.score ?? {};
  const scoreSide = (value) => value && typeof value === "object" ? (value.total ?? value.current ?? value.goals ?? value.score ?? value.value ?? null) : value;
  const homeScore = pickNumber(raw.score?.fullTime?.home, raw.score?.current?.home, scoreSide(raw.score?.home), raw.score?.homeScore, scoreSide(raw.score?.homeTeam), raw.homeScore, scoreSide(raw.goals?.home), raw.goalsHome, scoreSide(state.score?.home), scoreSide(home.score), home.goals);
  const awayScore = pickNumber(raw.score?.fullTime?.away, raw.score?.current?.away, scoreSide(raw.score?.away), raw.score?.awayScore, scoreSide(raw.score?.awayTeam), raw.awayScore, scoreSide(raw.goals?.away), raw.goalsAway, scoreSide(state.score?.away), scoreSide(away.score), away.goals);
  const date = raw.date ?? raw.utcDate ?? raw.startDate ?? raw.kickoff ?? raw.kickoffTime ?? raw.startingAt ?? null;
  const status = normalizeStatus(state.description ?? state.status ?? raw.status?.description ?? raw.status?.name ?? raw.status ?? raw.state?.name ?? "SCHEDULED");
  const league = normalizeLeague(lg);
  const goals = Array.isArray(raw.goals) ? raw.goals.map(normalizeEvent) : [];
  const events = Array.isArray(raw.events) ? raw.events.map(normalizeEvent) : [];
  const minute = pickNumber(raw.minute, raw.time?.minute, raw.timeElapsed, state.minute, state.elapsed);
  const homeTeam = { ...home, id: home.id ?? home.team?.id, name: home.name ?? home.team?.name ?? home.participant?.name ?? "Home team", shortName: home.shortName ?? home.short_name, logo: home.logo ?? home.crest ?? home.image ?? home.team?.logo ?? "", crest: home.crest ?? home.logo ?? home.image ?? home.team?.logo ?? "", statistics: home.statistics ?? home.stats ?? null };
  const awayTeam = { ...away, id: away.id ?? away.team?.id, name: away.name ?? away.team?.name ?? away.participant?.name ?? "Away team", shortName: away.shortName ?? away.short_name, logo: away.logo ?? away.crest ?? away.image ?? away.team?.logo ?? "", crest: away.crest ?? away.logo ?? away.image ?? away.team?.logo ?? "", statistics: away.statistics ?? away.stats ?? null };
  const score = { ...(raw.score && typeof raw.score === "object" ? raw.score : {}), current: { ...(raw.score?.current || {}), home: homeScore, away: awayScore }, fullTime: { ...(raw.score?.fullTime || {}), home: pickNumber(raw.score?.fullTime?.home, status === "FINISHED" ? homeScore : null), away: pickNumber(raw.score?.fullTime?.away, status === "FINISHED" ? awayScore : null) }, halfTime: raw.score?.halfTime ?? { home: null, away: null } };
  return { ...raw, id: raw.id ?? raw.matchId ?? raw.fixture?.id ?? raw.eventId, date, utcDate: date, league, competition: { id: league.id, code: league.code, name: league.name, emblem: league.emblem, logo: league.logo }, homeTeam, awayTeam, status, minute, injuryTime: pickNumber(raw.injuryTime, state.injuryTime), state: { ...state, description: status, score: state.score ?? { current: { home: homeScore, away: awayScore } } }, score, goals, events, bookings: Array.isArray(raw.bookings) ? raw.bookings.map(normalizeEvent) : [], substitutions: Array.isArray(raw.substitutions) ? raw.substitutions.map(normalizeEvent) : [], lineups: raw.lineups ?? null };
}
function eventCollections(rawPayload) {
  const events = listFrom(rawPayload, ["events", "items", "incidents", "data"]);
  const normalized = events.map(normalizeEvent);
  return { events: normalized, goals: normalized.filter(e => e.kind === "goal"), bookings: normalized.filter(e => e.kind === "card"), substitutions: normalized.filter(e => e.kind === "substitution") };
}
function normalizeStatistics(payload, match) {
  const raw = payload?.statistics ?? payload?.data?.statistics ?? payload?.data ?? payload?.stats ?? payload;
  if (Array.isArray(raw)) {
    const homeId = String(match.homeTeam?.id ?? "home");
    const awayId = String(match.awayTeam?.id ?? "away");
    const byTeam = { home: {}, away: {} };
    for (const row of raw) {
      const teamId = String(row.team?.id ?? row.teamId ?? row.participant?.id ?? "");
      const side = teamId && teamId === homeId ? "home" : teamId && teamId === awayId ? "away" : String(row.side ?? "").toLowerCase();
      if (side === "home" || side === "away") byTeam[side][String(row.type ?? row.name ?? row.key ?? "stat").toLowerCase().replace(/[ -]+/g, "_")] = row.value ?? row.total ?? row.statistic ?? null;
    }
    return { home: byTeam.home, away: byTeam.away };
  }
  if (raw && typeof raw === "object") {
    const home = raw.home ?? raw.homeTeam ?? raw.localteam ?? raw["home"] ?? {};
    const away = raw.away ?? raw.awayTeam ?? raw.visitorteam ?? raw["away"] ?? {};
    if (home && away) return { home: Array.isArray(home) ? Object.fromEntries(home.map(x=>[String(x.type ?? x.name).toLowerCase().replace(/[ -]+/g,"_"),x.value ?? x.total])) : home, away: Array.isArray(away) ? Object.fromEntries(away.map(x=>[String(x.type ?? x.name).toLowerCase().replace(/[ -]+/g,"_"),x.value ?? x.total])) : away };
  }
  return null;
}
function live(match) { return ["IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT", "LIVE"].includes(match.status) || /live|in.?play|progress|1st half|2nd half|half.?time|extra time|penalt/i.test(`${match.status} ${match.state?.description ?? ""}`); }
function apiError(res, err) {
  const status = err.status || err.response?.status || 502;
  const detail = err.response?.data?.message || err.response?.data?.error || err.response?.data?.detail || err.message || "Unknown provider error";
  console.error("Highlightly request failed:", err.config?.url, status, detail);
  res.status(status >= 400 && status < 500 ? status : 502).json({ success:false, message:String(detail), providerStatus:err.response?.status ?? null });
}
async function get(endpoint, params = {}) { const response = await http.get(endpoint, { params }); return response.data; }
// Fetch subsequent pages when Highlightly exposes more results. A hard cap keeps
// a single request from generating excessive upstream traffic on free plans.
async function getAllPages(endpoint, params = {}, keys = [], maxPages = 10) {
  const limit = Number(params.limit) || 100;
  const first = await get(endpoint, { ...params, limit, offset: Number(params.offset) || 0 });
  const rows = [...listFrom(first, keys)];
  const pagination = first?.pagination ?? first?.data?.pagination ?? {};
  const total = Number(pagination.totalCount ?? pagination.total ?? pagination.count ?? first?.totalCount ?? first?.count);
  let offset = (Number(params.offset) || 0) + limit;
  let pages = 1;
  while (pages < maxPages && rows.length >= limit && (!Number.isFinite(total) || offset < total)) {
    const next = await get(endpoint, { ...params, limit, offset });
    const nextRows = listFrom(next, keys);
    if (!nextRows.length) break;
    rows.push(...nextRows);
    pages += 1;
    offset += limit;
    const nextTotal = Number(next?.pagination?.totalCount ?? next?.pagination?.total ?? next?.pagination?.count ?? next?.totalCount ?? next?.count);
    if (Number.isFinite(nextTotal) && offset >= nextTotal) break;
    if (nextRows.length < limit) break;
  }
  return { rows, pagination, pagesFetched: pages, providerTotal: Number.isFinite(total) ? total : null };
}
function requireKey(_req,res,next) { if (!API_KEY) return res.status(503).json({success:false,message:"Highlightly API key is missing. Add HIGHLIGHTLY_API_KEY to server/.env and restart the backend."}); next(); }
async function readNews(){ await fs.mkdir(DATA_DIR,{recursive:true}); try { const v=JSON.parse(await fs.readFile(NEWS_FILE,"utf8")); return Array.isArray(v)?v:[]; } catch(e) { if(e.code!=="ENOENT") throw e; await fs.writeFile(NEWS_FILE,"[]"); return []; } }
async function writeNews(items){ await fs.mkdir(DATA_DIR,{recursive:true}); await fs.writeFile(NEWS_FILE,JSON.stringify(items,null,2)); }
function admin(req,res,next){ const key=process.env.ADMIN_KEY; if(!key)return res.status(503).json({success:false,message:"Set ADMIN_KEY in server/.env to enable publishing."}); if(req.get("x-admin-key")!==key)return res.status(401).json({success:false,message:"Invalid admin key."}); next(); }

app.get("/",(_req,res)=>res.json({success:true,message:"Welcome to AG SOCCER API ⚽",provider:"Highlightly"}));
app.get("/api/health",(_req,res)=>res.json({success:true,provider:"Highlightly",apiKeyConfigured:Boolean(API_KEY),adminConfigured:Boolean(process.env.ADMIN_KEY),currentYear:YEAR}));
app.get("/api/test",requireKey,async(_req,res)=>{try{const p=await get("/leagues",{limit:5,offset:0});const leagues=listFrom(p,["leagues"]);res.json({success:true,provider:"Highlightly",count:leagues.length,leagues,rawKeys:Object.keys(p||{})});}catch(e){apiError(res,e);}});

async function sendLeagues(_req,res){ try { const result=await getAllPages("/leagues",{limit:100,offset:0},["leagues","competitions","items"],10); const unique=new Map(); for(const raw of result.rows){const league=normalizeLeague(raw); if(league.id!=null) unique.set(String(league.id),league);} const leagues=[...unique.values()].sort((a,b)=>rank(a.name)-rank(b.name)||String(a.name).localeCompare(String(b.name))); res.json({success:true,count:leagues.length,leagues,competitions:leagues,pagination:result.pagination,pagesFetched:result.pagesFetched,providerTotal:result.providerTotal}); } catch(e){apiError(res,e);} }
app.get("/api/leagues",requireKey,sendLeagues); app.get("/api/competitions",requireKey,sendLeagues);
app.get("/api/leagues/:id",requireKey,async(req,res)=>{try{const p=await get(`/leagues/${encodeURIComponent(req.params.id)}`);const raw=Array.isArray(p)?p[0]:p?.data?.league??p?.data?.[0]??p?.data??p?.league??p;res.json({success:true,league:normalizeLeague(raw)});}catch(e){apiError(res,e);}});

app.get("/api/matches",requireKey,async(req,res)=>{try{const date=/^\d{4}-\d{2}-\d{2}$/.test(req.query.date||"")?req.query.date:new Date().toISOString().slice(0,10);const params={date,limit:100,offset:0};if(req.query.leagueId)params.leagueId=Number(req.query.leagueId);if(req.query.timezone)params.timezone=req.query.timezone;const result=await getAllPages("/matches",params,["matches","fixtures","items"],10);const unique=new Map();for(const raw of result.rows){const match=normalizeMatch(raw);if(match.id!=null)unique.set(String(match.id),match);}const matches=[...unique.values()].sort((a,b)=>rank(a.competition?.name)-rank(b.competition?.name)||new Date(a.utcDate||0)-new Date(b.utcDate||0));res.json({success:true,date,count:matches.length,matches,pagination:result.pagination,pagesFetched:result.pagesFetched,providerCount:result.providerTotal});}catch(e){apiError(res,e);}});
app.get("/api/live",requireKey,async(req,res)=>{try{const date=req.query.date||new Date().toISOString().slice(0,10);const result=await getAllPages("/matches",{date,limit:100,offset:0,...(req.query.timezone?{timezone:req.query.timezone}:{})},["matches","fixtures","items"],10);const matches=result.rows.map(normalizeMatch).filter(live).sort((a,b)=>rank(a.competition?.name)-rank(b.competition?.name));res.json({success:true,date,count:matches.length,matches,pagesFetched:result.pagesFetched});}catch(e){apiError(res,e);}});
app.get("/api/matches/live",requireKey,async(req,res)=>{try{const date=req.query.date||new Date().toISOString().slice(0,10);const result=await getAllPages("/matches",{date,limit:100,offset:0},["matches","fixtures","items"],10);const matches=result.rows.map(normalizeMatch).filter(live).sort((a,b)=>rank(a.competition?.name)-rank(b.competition?.name));res.json({success:true,date,count:matches.length,matches,pagesFetched:result.pagesFetched});}catch(e){apiError(res,e);}});
app.get("/api/matches/:id/events",requireKey,async(req,res)=>{try{const p=await get(`/events/${encodeURIComponent(req.params.id)}`);res.json({success:true,...eventCollections(p)});}catch(e){apiError(res,e);}});
app.get("/api/matches/:id/lineups",requireKey,async(req,res)=>{try{const p=await get(`/lineups/${encodeURIComponent(req.params.id)}`);res.json({success:true,lineups:p?.lineups??p?.data?.lineups??p?.data??p});}catch(e){apiError(res,e);}});
app.get("/api/matches/:id/statistics",requireKey,async(req,res)=>{try{const p=await get(`/statistics/${encodeURIComponent(req.params.id)}`);res.json({success:true,statistics:p?.statistics??p?.data?.statistics??p?.data??p});}catch(e){apiError(res,e);}});
app.get("/api/matches/:id",requireKey,async(req,res)=>{
  try {
    const id = encodeURIComponent(req.params.id);
    const p = await get(`/matches/${id}`);
    const raw = Array.isArray(p) ? p[0] : p?.data?.match ?? p?.data?.[0] ?? p?.data ?? p?.match ?? p;
    let match = normalizeMatch(raw);
    // Details endpoints can be unavailable for some competitions/plans. Fetch each
    // independently so a missing statistics response never hides goals or cards.
    const [eventsResult, lineupsResult, statsResult] = await Promise.allSettled([
      get(`/events/${id}`), get(`/lineups/${id}`), get(`/statistics/${id}`)
    ]);
    if (eventsResult.status === "fulfilled") {
      const eventData = eventCollections(eventsResult.value);
      match = { ...match, events: eventData.events, goals: eventData.goals.length ? eventData.goals : match.goals, bookings: eventData.bookings.length ? eventData.bookings : match.bookings, substitutions: eventData.substitutions.length ? eventData.substitutions : match.substitutions };
    }
    if (lineupsResult.status === "fulfilled") {
      const lp = lineupsResult.value;
      match.lineups = lp?.lineups ?? lp?.data?.lineups ?? lp?.data ?? lp;
      const lineupArray = Array.isArray(match.lineups) ? match.lineups : [];
      const homeLineup = lineupArray.find(x => String(x.team?.id ?? x.teamId ?? x.side).toLowerCase() === String(match.homeTeam?.id ?? "home").toLowerCase() || String(x.side).toLowerCase() === "home");
      const awayLineup = lineupArray.find(x => String(x.team?.id ?? x.teamId ?? x.side).toLowerCase() === String(match.awayTeam?.id ?? "away").toLowerCase() || String(x.side).toLowerCase() === "away");
      const homeObject = !Array.isArray(match.lineups) ? (match.lineups?.home ?? match.lineups?.homeTeam) : null;
      const awayObject = !Array.isArray(match.lineups) ? (match.lineups?.away ?? match.lineups?.awayTeam) : null;
      const h = homeLineup ?? homeObject;
      const a = awayLineup ?? awayObject;
      if (h) match.homeTeam = { ...match.homeTeam, lineup: h.lineup ?? h.startingXI ?? h.players ?? h.starters ?? [], bench: h.bench ?? h.substitutes ?? h.subs ?? [], formation: h.formation ?? match.homeTeam.formation, coach: h.coach ?? match.homeTeam.coach };
      if (a) match.awayTeam = { ...match.awayTeam, lineup: a.lineup ?? a.startingXI ?? a.players ?? a.starters ?? [], bench: a.bench ?? a.substitutes ?? a.subs ?? [], formation: a.formation ?? match.awayTeam.formation, coach: a.coach ?? match.awayTeam.coach };
    }
    if (statsResult.status === "fulfilled") {
      const stats = normalizeStatistics(statsResult.value, match);
      if (stats) match = { ...match, homeTeam: { ...match.homeTeam, statistics: stats.home }, awayTeam: { ...match.awayTeam, statistics: stats.away } };
    }
    res.json({ success: true, match, details: { events: eventsResult.status === "fulfilled", lineups: lineupsResult.status === "fulfilled", statistics: statsResult.status === "fulfilled" } });
  } catch(e) { apiError(res,e); }
});

async function leagueSeason(id,requested){const p=await get(`/leagues/${encodeURIComponent(id)}`);const raw=Array.isArray(p)?p[0]:p?.data?.[0]??p?.data??p;const league=normalizeLeague(raw);const seasons=league.seasons.map(x=>x.season);if(requested){const y=Number(requested);if(!seasons.includes(y)){const e=new Error(`Season ${requested} is not listed for ${league.name}. Available seasons: ${seasons.join(", ")||"not supplied by provider"}.`);e.status=400;throw e;}return {league,season:y};}if(league.currentSeason!=null)return {league,season:league.currentSeason};if(seasons.length)return {league,season:seasons[0]};return {league,season:undefined};}
app.get("/api/leagues/:id/standings",requireKey,async(req,res)=>{try{const {league,season}=await leagueSeason(req.params.id,req.query.season);const params={leagueId:Number(req.params.id)};if(season)params.season=season;const p=await get("/standings",params);const standings=p?.standings??p?.data?.standings??p?.groups??p?.data?.groups??listFrom(p,["standings","groups"]);res.json({success:true,league,season,standings});}catch(e){apiError(res,e);}});
app.get("/api/standings/:id",(req,res)=>{req.url=`/api/leagues/${encodeURIComponent(req.params.id)}/standings${req.url.includes("?")?req.url.slice(req.url.indexOf("?")):""}`;app.handle(req,res);});
app.get("/api/leagues/:id/matches",requireKey,async(req,res)=>{try{const {league,season}=await leagueSeason(req.params.id,req.query.season);const params={leagueId:Number(req.params.id),limit:100,offset:0};if(season)params.season=season;const p=await get("/matches",params);const matches=listFrom(p,["matches","fixtures","items"]).map(normalizeMatch).sort((a,b)=>new Date(a.utcDate||0)-new Date(b.utcDate||0));res.json({success:true,league,season,count:matches.length,matches});}catch(e){apiError(res,e);}});
app.get("/api/teams",requireKey,async(req,res)=>{try{const params={limit:Number(req.query.limit)||100,offset:0};if(req.query.leagueId)params.leagueId=Number(req.query.leagueId);if(req.query.season)params.season=Number(req.query.season);if(req.query.search)params.name=req.query.search;const p=await get("/teams",params);const teams=listFrom(p,["teams","items"]);res.json({success:true,count:teams.length,teams});}catch(e){apiError(res,e);}});
app.get("/api/teams/:id",requireKey,async(req,res)=>{try{const p=await get(`/teams/${encodeURIComponent(req.params.id)}`);res.json({success:true,team:p?.data?.team??p?.data??p});}catch(e){apiError(res,e);}});
app.get("/api/leagues/:id/teams",requireKey,async(req,res)=>{try{const {league,season}=await leagueSeason(req.params.id,req.query.season);const params={leagueId:Number(req.params.id),limit:100,offset:0};if(season)params.season=season;const p=await get("/teams",params);const teams=listFrom(p,["teams","items"]);res.json({success:true,league,season,count:teams.length,teams});}catch(e){apiError(res,e);}});
app.get("/api/leagues/:id/scorers",requireKey,async(req,res)=>{try{const {league,season}=await leagueSeason(req.params.id,req.query.season);let scorers=[];let message="Top-scorer data is not exposed by the configured Highlightly endpoint.";try{const p=await get("/top-scorers",{leagueId:Number(req.params.id),...(season?{season}:{})});scorers=listFrom(p,["scorers","players","topScorers"]);message="";}catch{}res.json({success:true,league,season,count:scorers.length,scorers,message});}catch(e){apiError(res,e);}});

app.get("/api/news",async(_req,res)=>{try{const news=(await readNews()).sort((a,b)=>new Date(b.publishedAt||b.createdAt||0)-new Date(a.publishedAt||a.createdAt||0));res.json({success:true,count:news.length,news});}catch(e){apiError(res,e);}});
app.post("/api/news",admin,async(req,res)=>{try{const b=req.body||{};const title=String(b.title||"").trim();const excerpt=String(b.excerpt||b.summary||b.description||"").trim();const body=String(b.body||b.description||excerpt).trim();if(!title||!excerpt)return res.status(400).json({success:false,message:"A title and summary are required."});const news=await readNews();const article={id:String(Date.now()),title,excerpt,summary:excerpt,body,description:body,imageUrl:String(b.imageUrl||b.image||"").trim(),image:String(b.image||b.imageUrl||"").trim(),url:String(b.url||"").trim(),category:String(b.category||"Football"),publishedAt:new Date().toISOString()};news.unshift(article);await writeNews(news);res.status(201).json({success:true,news:article,article});}catch(e){apiError(res,e);}});
app.delete("/api/news/:id",admin,async(req,res)=>{try{const items=await readNews();const updated=items.filter(x=>String(x.id)!==req.params.id);if(updated.length===items.length)return res.status(404).json({success:false,message:"News article not found."});await writeNews(updated);res.json({success:true,message:"News article deleted."});}catch(e){apiError(res,e);}});
app.use("/api",(_req,res)=>res.status(404).json({success:false,message:"API route not found."}));
app.listen(PORT,()=>{console.log(`AG SOCCER API running at http://localhost:${PORT}`);console.log(`Highlightly key configured: ${Boolean(API_KEY)}`);console.log(`RapidAPI host: ${RAPIDAPI_HOST}`);});
