// Every path under public/data, in one place. Nothing else in the codebase
// concatenates a data path — change the layout here and the pipeline follows.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA = join(ROOT, "public", "data");

export const configPath = (file) => join(ROOT, "config", file);
export const leagueConfigPath = (id) => configPath(join("leagues", `${id}.json`));

const leagueDir = (id) => join(DATA, "leagues", id);
export const leagueFile = (id, name) => join(leagueDir(id), `${name}.json`);
export const leagueWeekFile = (id, week) => join(leagueDir(id), "weeks", `w${week}.json`);

const projDir = (season) => join(DATA, "projections", String(season));
export const projFile = (season, week) => join(projDir(season), `w${week}.json`);
export const projOverridesFile = (season, week) => join(projDir(season), `w${week}.overrides.json`);
export const seasonProjFile = (season) => join(projDir(season), "season.json");
export const playersFile = (date) => join(DATA, "players", `${date}.json`);
export const playersDir = join(DATA, "players");
export const statePath = join(DATA, "state.json");

export const booksRoot = join(DATA, "books");
export const bookDir = (id) => join(booksRoot, id);
export const bookFile = (id, week) => join(bookDir(id), `w${week}.json`);
export const bookIndexFile = (id) => join(bookDir(id), "index.json");
export const booksIndexFile = join(booksRoot, "index.json");
