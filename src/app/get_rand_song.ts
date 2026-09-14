import { promises as fs } from "fs";
import path from "path";

export type Song = {
  artist: string;
  title: string;
  line_1: string;
  line_2: string;
  views: number;
  selected_for_popularity: number;
  spotify_id?: string | null;
  spotify_popularity?: number | null;
  used: "yes" | "no";
};

const songsFilePath = path.join(
  process.cwd(),
  "spotify_and_genius_popularity_data.json"
);

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

async function writeSongs(songs: Song[]) {
  await fs.writeFile(songsFilePath, JSON.stringify(songs, null, 2) + "\n", "utf8");
}

export async function readSongs(): Promise<Song[]> {
  const raw = await fs.readFile(songsFilePath, "utf8");
  const parsed = JSON.parse(raw) as Array<Omit<Song, "used"> & { used?: "yes" | "no" }>;

  const normalizedSongs: Song[] = parsed.map((song) => ({
    ...song,
    used: song.used === "yes" ? "yes" : ("no" as const),
  }));

  const needsUpdate = normalizedSongs.some((song, index) => parsed[index].used !== song.used);

  if (needsUpdate) {
    await writeSongs(normalizedSongs);
  }

  return normalizedSongs;
}

export async function getRandomSongs(count: number = 10): Promise<Song[]> {
  let songs = await readSongs();
  let unusedSongs = songs.filter((song) => song.used === "no");

  if (unusedSongs.length === 0) {
    songs = songs.map((song) => ({ ...song, used: "no" as const }));
    await writeSongs(songs);
    unusedSongs = songs;
  }

  return shuffleArray(unusedSongs).slice(0, count);
}

export async function markSongAsUsed(artist: string, title: string): Promise<void> {
  const songs = await readSongs();
  const nextSongs: Song[] = songs.map((song) =>
    song.artist === artist && song.title === title
      ? { ...song, used: "yes" as const }
      : song
  );

  await writeSongs(nextSongs);
}

export async function resetUsedSongs(): Promise<void> {
  const songs = await readSongs();
  const resetSongs: Song[] = songs.map((song) => ({
    ...song,
    used: "no" as const,
  }));

  await writeSongs(resetSongs);
}
