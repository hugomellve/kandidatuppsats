import { existsSync, readFileSync } from "fs";
import path from "path";
import { resetUsedSongs } from "../src/app/get_rand_song.ts";
import { appendSessionDraw, closeCurrentSession } from "../src/app/session_tracker.ts";
import {
  generateLyricSelection,
  generateRandomLyricSelection,
  type Candidate,
} from "../src/app/lyric_generation.ts";
import type { PromptSetName } from "../src/app/lyric_prompts.ts";

type Guess = {
  artist: string;
  title: string;
};

type CliOptions = {
  cycles: number;
  songsPerCycle: number;
  promptSet: PromptSetName | undefined;
  randomizeRecentGuesses: boolean;
  randomCandidate: boolean;
};

const promptSetNames: PromptSetName[] = [
  "original",
  "variant",
  "variant-first-only",
  "variant-second-after-first",
  "variant-fourth",
];

function loadLocalEnvFile(): void {
  const envPath = path.join(process.cwd(), ".env.local");

  if (!existsSync(envPath)) {
    return;
  }

  const envFile = readFileSync(envPath, "utf8");

  for (const rawLine of envFile.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    cycles: 10,
    songsPerCycle: 300,
    promptSet: "variant", // ICL
    randomizeRecentGuesses: false,
    randomCandidate: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    const [flag, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? next;

    if ((flag === "--cycles" || flag === "-c") && value) {
      options.cycles = Number.parseInt(value, 10);
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    if ((flag === "--songs" || flag === "-s") && value) {
      options.songsPerCycle = Number.parseInt(value, 10);
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    if (flag === "--prompt-set" && value) {
      if (!promptSetNames.includes(value as PromptSetName)) {
        throw new Error(
          `--prompt-set must be one of: ${promptSetNames.join(", ")}`
        );
      }

      options.promptSet = value as PromptSetName;
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    if (flag === "--randomize-recent-guesses") {
      options.randomizeRecentGuesses = true;
      continue;
    }

    if (flag === "--random-candidate") {
      options.randomCandidate = true;
      continue;
    }

    if (flag === "--help" || flag === "-h") {
      console.log(
        "Usage: npm run test:soak -- --cycles 5 --songs 300"
      );
      console.log(
        "Also supported: --cycles=5 --songs=300, --prompt-set, --randomize-recent-guesses, and --random-candidate"
      );
      process.exit(0);
    }

  }

  if (!Number.isInteger(options.cycles) || options.cycles < 1) {
    throw new Error("--cycles must be a positive integer.");
  }

  if (!Number.isInteger(options.songsPerCycle) || options.songsPerCycle < 1) {
    throw new Error("--songs must be a positive integer.");
  }

  return options;
}

async function logSessionDraw(params: {
  lastSong: Guess | null;
  nextSong: {
    artist: string;
    title: string;
    views: number;
    selected_for_popularity: number;
    spotify_popularity?: number | null;
  };
  clickToCardMs: number;
  recentGuesses: Guess[];
  candidates: Candidate[];
}): Promise<void> {
  await appendSessionDraw(params);
}

async function resetCycle(): Promise<void> {
  await closeCurrentSession();
  await resetUsedSongs();
}

async function run(): Promise<void> {
  loadLocalEnvFile();
  const options = parseArgs(process.argv.slice(2));

  console.log(
    `Starting soak test: ${options.cycles} cycles x ${options.songsPerCycle} songs.`
  );
  console.log(
    `Selection: ${options.randomCandidate ? "random candidate" : `prompt set ${options.promptSet ?? "lyric_generation default"}`}; randomized recent guesses: ${options.randomizeRecentGuesses}`
  );

  await resetUsedSongs();

  for (let cycle = 1; cycle <= options.cycles; cycle += 1) {
    console.log(`Cycle ${cycle}/${options.cycles} started.`);

    let lastSong: Guess | null = null;
    let recentGuesses: Guess[] = [];

    for (let draw = 1; draw <= options.songsPerCycle; draw += 1) {
      const startedAt = Date.now();
      const { selectedSong, candidates } = options.randomCandidate
        ? await generateRandomLyricSelection()
        : await generateLyricSelection({
            lastSong,
            recentGuesses,
            promptSet: options.promptSet,
            randomizeRecentGuesses: options.randomizeRecentGuesses,
          });
      const clickToCardMs = Date.now() - startedAt;

      await logSessionDraw({
        lastSong,
        nextSong: {
          artist: selectedSong.artist,
          title: selectedSong.title,
          views: selectedSong.views,
          selected_for_popularity: selectedSong.selected_for_popularity,
          spotify_popularity: selectedSong.spotify_popularity,
        },
        clickToCardMs,
        recentGuesses,
        candidates,
      });

      const latestGuess: Guess = {
        artist: selectedSong.artist,
        title: selectedSong.title,
      };

      recentGuesses = lastSong ? [lastSong, ...recentGuesses].slice(0, 5) : recentGuesses;
      lastSong = latestGuess;

      if (draw % 25 === 0 || draw === options.songsPerCycle) {
        console.log(
          `Cycle ${cycle}/${options.cycles}: completed ${draw}/${options.songsPerCycle} draws.`
        );
      }
    }

    await resetCycle();
    console.log(`Cycle ${cycle}/${options.cycles} reset completed.`);
  }

  console.log("Soak test finished successfully.");
}

run().catch((error) => {
  console.error("Soak test failed:", error);
  process.exitCode = 1;
});
