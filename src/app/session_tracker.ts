import { promises as fs } from "fs";
import path from "path";

type Guess = {
  artist: string;
  title: string;
  result?: "success" | "fail";
};

type SessionRow = {
  timestamp: string;
  event: "draw" | "reset";
  lastSongArtist: string;
  lastSongTitle: string;
  lastSongResult: string;
  nextSongArtist: string;
  nextSongTitle: string;
  difficulty: string;
  reason: string;
  clickToCardMs: string;
  recentGuesses: string;
};

const sessionsDirPath = path.join(process.cwd(), "sessions");
const sessionPointerPath = path.join(sessionsDirPath, "current_session.txt");
const csvHeader =
  "timestamp,event,last_song_artist,last_song_title,last_song_result,next_song_artist,next_song_title,difficulty,reason,click_to_card_ms,recent_guesses\n";

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
    row.difficulty,
    row.reason,
    row.clickToCardMs,
    row.recentGuesses,
  ]
    .map((value) => toCsvValue(value))
    .join(",") + "\n";
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
  } catch {
    await fs.writeFile(filePath, csvHeader, "utf8");
  }
}

export async function appendSessionDraw(params: {
  lastSong: Guess | null;
  nextSong: { artist: string; title: string };
  difficulty: "easier" | "same" | "harder";
  reason: string;
  clickToCardMs: number;
  recentGuesses: Guess[];
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
    difficulty: params.difficulty,
    reason: params.reason,
    clickToCardMs: params.clickToCardMs.toString(),
    recentGuesses: JSON.stringify(params.recentGuesses),
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
    difficulty: "",
    reason: "Session ended by reset button.",
    clickToCardMs: "",
    recentGuesses: "",
  };

  await fs.appendFile(filePath, buildCsvRow(row), "utf8");

  const currentSessionNumber = await getCurrentSessionNumber();
  await setCurrentSessionNumber(currentSessionNumber + 1);
}
