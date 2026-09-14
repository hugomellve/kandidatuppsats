import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

type SongData = {
  artist: string;
  title: string;
  views?: number;
  spotify_popularity: number;
};

type Candidate = {
  artist: string;
  title: string;
  views?: number;
  spotify_popularity?: number | null;
  [key: string]: unknown;
};

const dataPath = "spotify_and_genius_popularity_data.json";
const backupDirPath = path.join("sessions", "spotify_popularity_backfill_backup");
const spotifyColumn = "next_song_spotify_popularity";
const insertAfterColumn = "next_song_selected_for_popularity";

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      row.push(field);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function toCsvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function buildCsv(rows: string[][]): string {
  return rows.map((row) => row.map(toCsvValue).join(",")).join("\n") + "\n";
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function repairMojibake(value: string): string {
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
}

function songKey(artist: string, title: string): string {
  return `${normalize(artist)}\u0000${normalize(title)}`;
}

function keyVariants(artist: string, title: string): string[] {
  return [
    songKey(artist, title),
    songKey(repairMojibake(artist), title),
    songKey(artist, repairMojibake(title)),
    songKey(repairMojibake(artist), repairMojibake(title)),
  ];
}

function loadSpotifyLookup(): Map<string, SongData[]> {
  const songs = JSON.parse(readFileSync(dataPath, "utf8")) as SongData[];
  const lookup = new Map<string, SongData[]>();

  for (const song of songs) {
    for (const key of keyVariants(song.artist, song.title)) {
      const current = lookup.get(key) ?? [];
      current.push(song);
      lookup.set(key, current);
    }
  }

  return lookup;
}

function findSong(
  lookup: Map<string, SongData[]>,
  artist: string,
  title: string,
  views?: number
): SongData | null {
  for (const key of keyVariants(artist, title)) {
    const matches = lookup.get(key);

    if (!matches || matches.length === 0) {
      continue;
    }

    if (views !== undefined) {
      const sameViews = matches.find((song) => song.views === views);

      if (sameViews) {
        return sameViews;
      }
    }

    return matches[0];
  }

  return null;
}

function parseRange(range: string): number[] {
  const match = range.match(/^(\d+)-(\d+)$/);

  if (!match) {
    throw new Error(`Range must look like 91-110. Received: ${range}`);
  }

  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);

  if (start > end) {
    throw new Error(`Range start must be <= end. Received: ${range}`);
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function sessionPath(session: number): string {
  return path.join("sessions", `testing_session_${session}.csv`);
}

function ensureBackup(filePath: string): void {
  mkdirSync(backupDirPath, { recursive: true });
  const backupPath = path.join(backupDirPath, path.basename(filePath));

  if (!existsSync(backupPath)) {
    copyFileSync(filePath, backupPath);
  }
}

function ensureSpotifyColumn(header: string[], rows: string[][]): string[] {
  if (header.includes(spotifyColumn)) {
    return header;
  }

  const insertAfterIndex = header.indexOf(insertAfterColumn);
  const insertIndex = insertAfterIndex === -1 ? header.length : insertAfterIndex + 1;
  const nextHeader = [...header.slice(0, insertIndex), spotifyColumn, ...header.slice(insertIndex)];

  for (const row of rows) {
    row.splice(insertIndex, 0, "");
  }

  return nextHeader;
}

function indexByHeader(header: string[]): Map<string, number> {
  return new Map(header.map((column, index) => [column, index]));
}

function backfillSession(session: number, lookup: Map<string, SongData[]>): {
  rows: number;
  selectedMatches: number;
  candidateMatches: number;
  candidateMisses: number;
} {
  const filePath = sessionPath(session);

  if (!existsSync(filePath)) {
    throw new Error(`Missing session file: ${filePath}`);
  }

  const csvRows = parseCsv(readFileSync(filePath, "utf8"));
  const [rawHeader, ...dataRows] = csvRows;

  if (!rawHeader) {
    throw new Error(`${filePath} is empty.`);
  }

  ensureBackup(filePath);

  const header = ensureSpotifyColumn(rawHeader, dataRows);
  const indexes = indexByHeader(header);
  const spotifyIndex = indexes.get(spotifyColumn);
  const eventIndex = indexes.get("event");
  const artistIndex = indexes.get("next_song_artist");
  const titleIndex = indexes.get("next_song_title");
  const viewsIndex = indexes.get("next_song_views");
  const candidatesIndex = indexes.get("candidates");

  if (
    spotifyIndex === undefined ||
    eventIndex === undefined ||
    artistIndex === undefined ||
    titleIndex === undefined
  ) {
    throw new Error(`${filePath} is missing required columns.`);
  }

  let selectedMatches = 0;
  let candidateMatches = 0;
  let candidateMisses = 0;

  for (const row of dataRows) {
    if (row[eventIndex] !== "draw") {
      continue;
    }

    const views =
      viewsIndex === undefined ? undefined : Number.parseInt(row[viewsIndex], 10);
    const selectedSong = findSong(
      lookup,
      row[artistIndex],
      row[titleIndex],
      Number.isNaN(views) ? undefined : views
    );

    if (selectedSong) {
      row[spotifyIndex] = selectedSong.spotify_popularity.toString();
      selectedMatches += 1;
    }

    if (candidatesIndex === undefined || !row[candidatesIndex]) {
      continue;
    }

    try {
      const candidates = JSON.parse(row[candidatesIndex]) as Candidate[];

      for (const candidate of candidates) {
        const candidateSong = findSong(
          lookup,
          candidate.artist,
          candidate.title,
          candidate.views
        );

        if (candidateSong) {
          candidate.spotify_popularity = candidateSong.spotify_popularity;
          candidateMatches += 1;
        } else {
          candidate.spotify_popularity = null;
          candidateMisses += 1;
        }
      }

      row[candidatesIndex] = JSON.stringify(candidates);
    } catch {
      candidateMisses += 1;
    }
  }

  writeFileSync(filePath, buildCsv([header, ...dataRows]), "utf8");

  return {
    rows: dataRows.length,
    selectedMatches,
    candidateMatches,
    candidateMisses,
  };
}

function main(): void {
  const [rangeArg = "91-110"] = process.argv.slice(2);
  const sessions = parseRange(rangeArg);
  const lookup = loadSpotifyLookup();
  let totalRows = 0;
  let totalSelectedMatches = 0;
  let totalCandidateMatches = 0;
  let totalCandidateMisses = 0;

  for (const session of sessions) {
    const result = backfillSession(session, lookup);
    totalRows += result.rows;
    totalSelectedMatches += result.selectedMatches;
    totalCandidateMatches += result.candidateMatches;
    totalCandidateMisses += result.candidateMisses;

    console.log(
      `session ${session}: selected=${result.selectedMatches}, candidates=${result.candidateMatches}, candidate_misses=${result.candidateMisses}`
    );
  }

  console.log("\nbackfill complete");
  console.log(`sessions: ${sessions.join(", ")}`);
  console.log(`rows touched: ${totalRows}`);
  console.log(`selected song matches: ${totalSelectedMatches}`);
  console.log(`candidate matches: ${totalCandidateMatches}`);
  console.log(`candidate misses: ${totalCandidateMisses}`);
  console.log(`backups: ${backupDirPath}`);
}

main();
