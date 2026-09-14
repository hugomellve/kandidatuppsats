import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";

type SessionRow = {
  event: string;
  next_song_artist: string;
  next_song_title: string;
  next_song_views: string;
  next_song_selected_for_popularity: string;
  candidates: string;
};

type Candidate = {
  id: string;
  artist: string;
  title: string;
  views: number;
};

type SongCount = {
  song: string;
  artist: string;
  title: string;
  count: number;
  sessions: Set<number>;
};

type SelectedSong = {
  song: string;
  views: number;
  selectedForPopularity: number;
  count: number;
};

type CliOptions = {
  sessions: number[];
  top: number;
  width: number;
};

type ViewRankResult = {
  rank: number;
  candidateCount: number;
  song: string;
  views: number;
};

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

function loadSession(session: number): SessionRow[] {
  const filePath = sessionPath(session);
  const content = readFileSync(filePath, "utf8");
  const [header, ...dataRows] = parseCsv(content);

  if (!header) {
    throw new Error(`${filePath} is empty.`);
  }

  return dataRows.map((values) =>
    Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]))
  ) as SessionRow[];
}

function sessionPath(session: number): string {
  return path.join("sessions", `testing_session_${session}.csv`);
}

function parseRange(range: string): number[] {
  const match = range.match(/^(\d+)-(\d+)$/);

  if (!match) {
    throw new Error(`Range must look like 51-81. Received: ${range}`);
  }

  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);

  if (start > end) {
    throw new Error(`Range start must be <= end. Received: ${range}`);
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function listAvailableSessions(): number[] {
  return readdirSync("sessions")
    .map((fileName) => fileName.match(/^testing_session_(\d+)\.csv$/)?.[1])
    .filter((session): session is string => Boolean(session))
    .map((session) => Number.parseInt(session, 10))
    .sort((a, b) => a - b);
}

function parseSessionSelector(selector: string): number[] {
  if (/^\d+-\d+$/.test(selector)) {
    return parseRange(selector);
  }

  if (/^\d+(,\d+)*$/.test(selector)) {
    return selector.split(",").map((session) => Number.parseInt(session, 10));
  }

  throw new Error(
    `Session selector must be a range like 51-81 or a list like 51,52,53. Received: ${selector}`
  );
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    sessions: [],
    top: 20,
    width: 40,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    const [flag, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? next;

    if ((flag === "--top" || flag === "-t") && value) {
      options.top = Number.parseInt(value, 10);
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    if ((flag === "--width" || flag === "-w") && value) {
      options.width = Number.parseInt(value, 10);
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    if (flag === "--last" && value) {
      const count = Number.parseInt(value, 10);
      const availableSessions = listAvailableSessions();
      options.sessions = availableSessions.slice(-count);
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    if (flag === "--help" || flag === "-h") {
      printUsage();
      process.exit(0);
    }

    if (!arg.startsWith("-") && options.sessions.length === 0) {
      options.sessions = parseSessionSelector(arg);
      continue;
    }

    if (!arg.startsWith("-") && options.sessions.length > 0) {
      const numericValue = Number.parseInt(arg, 10);

      if (!Number.isInteger(numericValue)) {
        throw new Error(`Unknown argument: ${arg}`);
      }

      if (options.top === 20) {
        options.top = numericValue;
        continue;
      }

      if (options.width === 40) {
        options.width = numericValue;
        continue;
      }
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.sessions.length === 0) {
    throw new Error("Missing sessions. Use a range like 51-81, a list, or --last 20.");
  }

  if (!Number.isInteger(options.top) || options.top < 1) {
    throw new Error("--top must be a positive integer.");
  }

  if (!Number.isInteger(options.width) || options.width < 10) {
    throw new Error("--width must be an integer >= 10.");
  }

  const missingSessions = options.sessions.filter((session) => !existsSync(sessionPath(session)));

  if (missingSessions.length > 0) {
    throw new Error(`Missing session files: ${missingSessions.join(", ")}`);
  }

  return options;
}

function songKey(row: SessionRow): string {
  return `${row.next_song_artist} - ${row.next_song_title}`;
}

function getSelectedViewRank(row: SessionRow): ViewRankResult | null {
  try {
    const candidates = JSON.parse(row.candidates) as Candidate[];
    const rankedCandidates = [...candidates]
      .filter((candidate) => Number.isFinite(candidate.views))
      .sort((a, b) => b.views - a.views);
    const selectedIndex = rankedCandidates.findIndex(
      (candidate) =>
        candidate.artist === row.next_song_artist &&
        candidate.title === row.next_song_title
    );

    if (selectedIndex === -1) {
      return null;
    }

    return {
      rank: selectedIndex + 1,
      candidateCount: rankedCandidates.length,
      song: songKey(row),
      views: rankedCandidates[selectedIndex].views,
    };
  } catch {
    return null;
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const mean = average(values);
  return average(values.map((value) => (value - mean) ** 2));
}

function entropy(counts: number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0);

  if (total === 0) {
    return 0;
  }

  return counts.reduce((sum, count) => {
    const probability = count / total;
    return probability === 0 ? sum : sum - probability * Math.log2(probability);
  }, 0);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function bar(value: number, maxValue: number, width: number): string {
  const length = maxValue === 0 ? 0 : Math.max(1, Math.round((value / maxValue) * width));
  return "#".repeat(length);
}

function collectSongCounts(sessions: number[]): {
  counts: SongCount[];
  selectedSongs: SelectedSong[];
  totalDraws: number;
  drawsBySession: Map<number, number>;
  viewRanks: ViewRankResult[];
  missingViewRanks: number;
} {
  const songs = new Map<string, SongCount>();
  const selectedSongs = new Map<string, SelectedSong>();
  const drawsBySession = new Map<number, number>();
  const viewRanks: ViewRankResult[] = [];
  let totalDraws = 0;
  let missingViewRanks = 0;

  for (const session of sessions) {
    const rows = loadSession(session).filter((row) => row.event === "draw");
    drawsBySession.set(session, rows.length);
    totalDraws += rows.length;

    for (const row of rows) {
      const viewRank = getSelectedViewRank(row);

      if (viewRank) {
        viewRanks.push(viewRank);
      } else {
        missingViewRanks += 1;
      }

      const key = songKey(row);
      const views = Number.parseInt(row.next_song_views, 10);
      const selectedForPopularity = Number.parseInt(
        row.next_song_selected_for_popularity,
        10
      );
      const current =
        songs.get(key) ??
        {
          song: key,
          artist: row.next_song_artist,
          title: row.next_song_title,
          count: 0,
          sessions: new Set<number>(),
        };

      current.count += 1;
      current.sessions.add(session);
      songs.set(key, current);

      const currentSelectedSong =
        selectedSongs.get(key) ??
        {
          song: key,
          views: Number.isNaN(views) ? 0 : views,
          selectedForPopularity: Number.isNaN(selectedForPopularity)
            ? 0
            : selectedForPopularity,
          count: 0,
        };

      currentSelectedSong.count += 1;
      selectedSongs.set(key, currentSelectedSong);
    }
  }

  return {
    counts: [...songs.values()].sort((a, b) => b.count - a.count || a.song.localeCompare(b.song)),
    selectedSongs: [...selectedSongs.values()],
    totalDraws,
    drawsBySession,
    viewRanks,
    missingViewRanks,
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function printFrequencyGraph(counts: SongCount[], width: number): void {
  const buckets = new Map<number, number>();

  for (const song of counts) {
    buckets.set(song.count, (buckets.get(song.count) ?? 0) + 1);
  }

  const sortedBuckets = [...buckets.entries()].sort((a, b) => b[0] - a[0]);
  const maxBucketSize = Math.max(...sortedBuckets.map(([, size]) => size), 0);

  console.log("\nselection frequency graph");
  console.log("times selected -> number of songs");

  for (const [timesSelected, songCount] of sortedBuckets) {
    console.log(
      `${timesSelected.toString().padStart(4, " ")}x | ${bar(
        songCount,
        maxBucketSize,
        width
      )} ${songCount}`
    );
  }
}

function printViewRankGraph(viewRanks: ViewRankResult[], width: number): void {
  const buckets = new Map<number, number>();

  for (const result of viewRanks) {
    buckets.set(result.rank, (buckets.get(result.rank) ?? 0) + 1);
  }

  const sortedBuckets = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const maxBucketSize = Math.max(...sortedBuckets.map(([, size]) => size), 0);

  console.log("\nselected song rank by candidate views");
  console.log("rank 1 = highest-view candidate in that draw");

  for (const [rank, drawCount] of sortedBuckets) {
    console.log(
      `${rank.toString().padStart(4, " ")} | ${bar(
        drawCount,
        maxBucketSize,
        width
      )} ${drawCount}`
    );
  }
}

function printSongsByViewRank(viewRanks: ViewRankResult[], sampleSize: number): void {
  const byRank = new Map<number, ViewRankResult[]>();

  for (const result of viewRanks) {
    const current = byRank.get(result.rank) ?? [];
    current.push(result);
    byRank.set(result.rank, current);
  }

  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);

  console.log(`\nselected song examples by view rank (${sampleSize} per rank)`);

  for (const rank of sortedRanks) {
    const examples = (byRank.get(rank) ?? [])
      .slice(0, sampleSize)
      .map((result) => `${result.song} (${result.views} views)`);

    console.log(`${rank.toString().padStart(4, " ")} | ${examples.join("; ")}`);
  }
}

function printPopularityBoundarySongs(selectedSongs: SelectedSong[], top: number): void {
  const topNonPopular = selectedSongs
    .filter((song) => song.selectedForPopularity === 0)
    .sort((a, b) => b.views - a.views || a.song.localeCompare(b.song))
    .slice(0, top);
  const bottomPopular = selectedSongs
    .filter((song) => song.selectedForPopularity === 1)
    .sort((a, b) => a.views - b.views || a.song.localeCompare(b.song))
    .slice(0, top);

  console.log(`\ntop ${topNonPopular.length} selected_for_popularity=0 songs by views`);
  for (const [index, song] of topNonPopular.entries()) {
    console.log(
      `${(index + 1).toString().padStart(2, " ")}. ${song.song} | ${song.views} views (${song.count} selections)`
    );
  }

  console.log(`\nbottom ${bottomPopular.length} selected_for_popularity=1 songs by views`);
  for (const [index, song] of bottomPopular.entries()) {
    console.log(
      `${(index + 1).toString().padStart(2, " ")}. ${song.song} | ${song.views} views (${song.count} selections)`
    );
  }
}

function printTopSongs(counts: SongCount[], top: number, width: number): void {
  const maxCount = counts[0]?.count ?? 0;

  console.log(`\ntop ${Math.min(top, counts.length)} songs`);
  for (const [index, song] of counts.slice(0, top).entries()) {
    console.log(
      `${(index + 1).toString().padStart(2, " ")}. ${song.song} | ${bar(
        song.count,
        maxCount,
        width
      )} ${song.count} (${song.sessions.size} sessions)`
    );
  }
}

function printTopArtists(counts: SongCount[], top: number, width: number): void {
  const artists = new Map<string, number>();

  for (const song of counts) {
    artists.set(song.artist, (artists.get(song.artist) ?? 0) + song.count);
  }

  const topArtists = [...artists.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top);
  const maxCount = topArtists[0]?.[1] ?? 0;

  console.log(`\ntop ${Math.min(top, topArtists.length)} artists`);
  for (const [index, [artist, count]] of topArtists.entries()) {
    console.log(
      `${(index + 1).toString().padStart(2, " ")}. ${artist} | ${bar(
        count,
        maxCount,
        width
      )} ${count}`
    );
  }
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run songs:variance -- 51-81");
  console.log("  npm run songs:variance -- 51,52,53 --top 15");
  console.log("  npm run songs:variance -- 51-81 15 50");
  console.log("  npm run songs:variance -- --last 20 --width 50");
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const { counts, selectedSongs, totalDraws, drawsBySession, viewRanks, missingViewRanks } =
    collectSongCounts(options.sessions);
  const selectionCounts = counts.map((song) => song.count);
  const rankValues = viewRanks.map((result) => result.rank);
  const repeatedSongs = counts.filter((song) => song.count > 1).length;
  const maxCount = Math.max(...selectionCounts, 0);
  const mean = average(selectionCounts);
  const populationVariance = variance(selectionCounts);
  const standardDeviation = Math.sqrt(populationVariance);
  const entropyBits = entropy(selectionCounts);
  const effectiveSongCount = 2 ** entropyBits;
  const topRankSelections = viewRanks.filter((result) => result.rank === 1).length;
  const topFiveSelections = viewRanks.filter((result) => result.rank <= 5).length;

  console.log("song selection variance");
  console.log(`sessions: ${options.sessions.join(", ")}`);
  console.log(`session count: ${options.sessions.length}`);
  console.log(`total draws: ${totalDraws}`);
  console.log(`unique songs: ${counts.length}`);
  console.log(`repeated songs: ${repeatedSongs}`);
  console.log(`max selections for one song: ${maxCount}`);
  console.log(`mean selections per unique song: ${formatNumber(mean)}`);
  console.log(`selection-count variance: ${formatNumber(populationVariance)}`);
  console.log(`selection-count std dev: ${formatNumber(standardDeviation)}`);
  console.log(`effective song count by entropy: ${formatNumber(effectiveSongCount)}`);
  console.log(`view-rank matches: ${viewRanks.length}`);
  console.log(`missing view-rank matches: ${missingViewRanks}`);
  console.log(`average selected view rank: ${formatNumber(average(rankValues))}`);
  console.log(`median selected view rank: ${formatNumber(median(rankValues))}`);
  console.log(
    `selected highest-view candidate: ${topRankSelections} (${formatNumber(
      (topRankSelections / Math.max(viewRanks.length, 1)) * 100
    )}%)`
  );
  console.log(
    `selected top-5 by views: ${topFiveSelections} (${formatNumber(
      (topFiveSelections / Math.max(viewRanks.length, 1)) * 100
    )}%)`
  );
  console.log(
    `draws by session: ${[...drawsBySession.entries()]
      .map(([session, draws]) => `${session}:${draws}`)
      .join(", ")}`
  );

  printFrequencyGraph(counts, options.width);
  printViewRankGraph(viewRanks, options.width);
  printSongsByViewRank(viewRanks, 5);
  printPopularityBoundarySongs(selectedSongs, options.top);
  printTopSongs(counts, options.top, options.width);
  printTopArtists(counts, options.top, options.width);
}

main();
