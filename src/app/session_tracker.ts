import { promises as fs } from "fs";
import path from "path";

type Guess = {
  artist: string;
  title: string;
  result?: "success" | "fail";
};

type SongMetadata = {
  views: number;
  selected_for_popularity: number;
  spotify_popularity: number | null;
};

type SessionSong = {
  artist: string;
  title: string;
} & Partial<SongMetadata>;

type SessionRow = {
  timestamp: string;
  event: "draw" | "reset";
  lastSongArtist: string;
  lastSongTitle: string;
  lastSongResult: string;
  nextSongArtist: string;
  nextSongTitle: string;
  nextSongViews: string;
  nextSongSelectedForPopularity: string;
  nextSongSpotifyPopularity: string;
  clickToCardMs: string;
  recentGuesses: string;
  candidates: string;
};

const sessionsDirPath = path.join(process.cwd(), "sessions");
const sessionPointerPath = path.join(sessionsDirPath, "current_session.txt");
const legacyCsvHeader =
  "timestamp,event,last_song_artist,last_song_title,last_song_result,next_song_artist,next_song_title,next_song_views,next_song_selected_for_popularity,click_to_card_ms,recent_guesses,candidates\n";
const csvHeader =
  "timestamp,event,last_song_artist,last_song_title,last_song_result,next_song_artist,next_song_title,next_song_views,next_song_selected_for_popularity,next_song_spotify_popularity,click_to_card_ms,recent_guesses,candidates\n";

function toCsvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function buildCsvRow(row: SessionRow): string {
  return [
    row.timestamp,
    row.event,
    row.lastSongArtist,
    row.lastSongTitle,
    row.lastSongResult,
    row.nextSongArtist,
    row.nextSongTitle,
    row.nextSongViews,
    row.nextSongSelectedForPopularity,
    row.nextSongSpotifyPopularity,
    row.clickToCardMs,
    row.recentGuesses,
    row.candidates,
  ]
    .map((value) => toCsvValue(value))
    .join(",") + "\n";
}

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

function buildCsvLine(values: string[]): string {
  return values.map((value) => toCsvValue(value)).join(",") + "\n";
}

async function ensureSessionsDir(): Promise<void> {
  await fs.mkdir(sessionsDirPath, { recursive: true });
}

async function getCurrentSessionNumber(): Promise<number> {
  await ensureSessionsDir();

  try {
    const raw = await fs.readFile(sessionPointerPath, "utf8");
    const sessionNumber = Number.parseInt(raw.trim(), 10);

    return Number.isNaN(sessionNumber) || sessionNumber < 1 ? 1 : sessionNumber;
  } catch {
    await fs.writeFile(sessionPointerPath, "1\n", "utf8");
    return 1;
  }
}

async function setCurrentSessionNumber(sessionNumber: number): Promise<void> {
  await ensureSessionsDir();
  await fs.writeFile(sessionPointerPath, `${sessionNumber}\n`, "utf8");
}

async function getSessionFilePath(): Promise<string> {
  const sessionNumber = await getCurrentSessionNumber();
  return path.join(sessionsDirPath, `testing_session_${sessionNumber}.csv`);
}

async function ensureSessionFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
    const currentContent = await fs.readFile(filePath, "utf8");
    const firstLineEnd = currentContent.indexOf("\n");
    const currentHeader =
      firstLineEnd === -1 ? currentContent : currentContent.slice(0, firstLineEnd + 1);

    if (currentHeader !== csvHeader) {
      if (currentHeader === legacyCsvHeader) {
        const [, ...dataRows] = parseCsv(currentContent);
        const migratedRows = dataRows
          .map((row) => buildCsvLine([...row.slice(0, 9), "", ...row.slice(9)]))
          .join("");

        await fs.writeFile(filePath, csvHeader + migratedRows, "utf8");
        return;
      }

      const rest = firstLineEnd === -1 ? "" : currentContent.slice(firstLineEnd + 1);
      await fs.writeFile(filePath, csvHeader + rest, "utf8");
    }
  } catch {
    await fs.writeFile(filePath, csvHeader, "utf8");
  }
}

export async function appendSessionDraw(params: {
  lastSong: Guess | null;
  nextSong: SessionSong;
  clickToCardMs: number;
  recentGuesses: Guess[];
  candidates: SessionSong[];
}): Promise<void> {
  const filePath = await getSessionFilePath();
  await ensureSessionFile(filePath);

  const row: SessionRow = {
    timestamp: new Date().toISOString(),
    event: "draw",
    lastSongArtist: params.lastSong?.artist ?? "",
    lastSongTitle: params.lastSong?.title ?? "",
    lastSongResult: params.lastSong?.result ?? "",
    nextSongArtist: params.nextSong.artist,
    nextSongTitle: params.nextSong.title,
    nextSongViews: params.nextSong.views?.toString() ?? "",
    nextSongSelectedForPopularity:
      params.nextSong.selected_for_popularity?.toString() ?? "",
    nextSongSpotifyPopularity:
      params.nextSong.spotify_popularity?.toString() ?? "",
    clickToCardMs: params.clickToCardMs.toString(),
    recentGuesses: JSON.stringify(params.recentGuesses),
    candidates: JSON.stringify(params.candidates),
  };

  await fs.appendFile(filePath, buildCsvRow(row), "utf8");
}

export async function closeCurrentSession(): Promise<void> {
  const filePath = await getSessionFilePath();
  await ensureSessionFile(filePath);

  const row: SessionRow = {
    timestamp: new Date().toISOString(),
    event: "reset",
    lastSongArtist: "",
    lastSongTitle: "",
    lastSongResult: "",
    nextSongArtist: "",
    nextSongTitle: "",
    nextSongViews: "",
    nextSongSelectedForPopularity: "",
    nextSongSpotifyPopularity: "",
    clickToCardMs: "",
    recentGuesses: "",
    candidates: "",
  };

  await fs.appendFile(filePath, buildCsvRow(row), "utf8");

  const currentSessionNumber = await getCurrentSessionNumber();
  await setCurrentSessionNumber(currentSessionNumber + 1);
}
