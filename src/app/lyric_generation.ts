import OpenAI from "openai";
import { getRandomSongs, markSongAsUsed, type Song } from "./get_rand_song.ts";
import { buildLyricPrompt, type PromptSetName } from "./lyric_prompts.ts";

export type Guess = {
  artist: string;
  title: string;
  result?: "success" | "fail";
};

export type Candidate = {
  id: string;
  artist: string;
  title: string;
  views: number;
  selected_for_popularity: number;
  spotify_popularity?: number | null;
};

const CANDIDATE_COUNT = 20;

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing. Set it before running lyric generation.");
  }

  return new OpenAI({ apiKey });
}

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];

  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function toModelSong(song: { artist: string; title: string }) {
  return {
    artist: song.artist,
    title: song.title,
  };
}

function toModelCandidate(candidate: Candidate) {
  return {
    candidate_id: candidate.id,
    artist: candidate.artist,
    title: candidate.title,
  };
}

function isSameSong(
  song: { artist: string; title: string },
  otherSong: { artist: string; title: string }
) {
  return song.artist === otherSong.artist && song.title === otherSong.title;
}

async function getCandidatePool(): Promise<{
  allSongs: Song[];
  candidates: Candidate[];
}> {
  const allSongs = await getRandomSongs(CANDIDATE_COUNT);

  if (!Array.isArray(allSongs) || allSongs.length === 0) {
    throw new Error("Songs JSON must contain at least 1 unused song.");
  }

  const candidates = shuffleArray(allSongs)
    .slice(0, CANDIDATE_COUNT)
    .map((song, index) => ({
      id: `candidate_${index + 1}`,
      artist: song.artist,
      title: song.title,
      views: song.views,
      selected_for_popularity: song.selected_for_popularity,
      spotify_popularity: song.spotify_popularity,
    }));

  return { allSongs, candidates };
}

async function finishSelection(
  allSongs: Song[],
  candidates: Candidate[],
  selectedCandidate: Candidate
): Promise<{ selectedSong: Song; candidates: Candidate[] }> {
  const selectedSong = allSongs.find(
    (song) =>
      song.artist === selectedCandidate.artist &&
      song.title === selectedCandidate.title
  );

  if (!selectedSong) {
    throw new Error("Selected candidate was not found in songs.json.");
  }

  await markSongAsUsed(selectedSong.artist, selectedSong.title);

  return {
    selectedSong,
    candidates,
  };
}

export async function generateRandomLyricSelection(): Promise<{
  selectedSong: Song;
  candidates: Candidate[];
}> {
  const { allSongs, candidates } = await getCandidatePool();
  const selectedCandidate = candidates[Math.floor(Math.random() * candidates.length)];

  return finishSelection(allSongs, candidates, selectedCandidate);
}

export async function generateLyricSelection(params: {
  recentGuesses: Guess[];
  lastSong: Guess | null;
  promptSet?: PromptSetName;
  randomizeRecentGuesses?: boolean;
}): Promise<{ selectedSong: Song; candidates: Candidate[] }> {
  const client = getClient();
  const { allSongs, candidates } = await getCandidatePool();
  const modelLastSong = params.lastSong ? toModelSong(params.lastSong) : null;
  const orderedRecentGuesses = params.recentGuesses
    .filter((guess) => !modelLastSong || !isSameSong(guess, modelLastSong))
    .map(toModelSong);
  const modelRecentGuesses = params.randomizeRecentGuesses
    ? shuffleArray(orderedRecentGuesses)
    : orderedRecentGuesses;
  const modelCandidates = candidates.map(toModelCandidate);

  const prompt = buildLyricPrompt({
    candidateCount: CANDIDATE_COUNT,
    recentGuesses: modelRecentGuesses,
    lastSong: modelLastSong,
    candidates: modelCandidates,
    // Options: "original", "variant", "variant-first-only",
    // "variant-second-after-first", "variant-fourth".
    // promptSet: "original",
    // promptSet: "variant", // ICL
    // promptSet: "variant-first-only", // No history
    // promptSet: "variant-second-after-first", // History
    // promptSet: "variant-fourth", // recency focus
    promptSet: params.promptSet ?? "variant", // ICL
  });

  console.log("[lyric_generation] model input", {
    // recentGuesses: modelRecentGuesses,
    // lastSong: modelLastSong,
    // candidates: modelCandidates,
    prompt,
  });

  const response = await client.responses.create({
    model: "gpt-5.4-mini",
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "song_selection",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidate_id: { type: "string" },
          },
          required: ["candidate_id"],
        },
        strict: true,
      },
    },
  });

  // console.log("[lyric_generation] model raw output", response.output_text);

  const parsed = JSON.parse(response.output_text) as {
    candidate_id: string;
  };

  // console.log("[lyric_generation] model parsed output", parsed);

  const selectedCandidate = candidates.find(
    (candidate) => candidate.id === parsed.candidate_id
  );

  if (!selectedCandidate) {
    console.error("[lyric_generation] selected candidate ID was not in candidates", {
      candidateId: parsed.candidate_id,
      candidates,
    });
    throw new Error("Model selected a candidate ID that was not found in candidates.");
  }

  return finishSelection(allSongs, candidates, selectedCandidate);
}
