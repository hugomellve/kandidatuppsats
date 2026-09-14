import { readFileSync } from "fs";
import path from "path";

type SessionRow = {
  event: string;
  next_song_artist: string;
  next_song_title: string;
  next_song_views: string;
  next_song_selected_for_popularity: string;
  click_to_card_ms: string;
  candidates: string;
};

type Candidate = {
  id: string;
  artist: string;
  title: string;
};

type SessionSummary = {
  filePath: string;
  draws: number;
  popularSelections: number;
  popularSelectionRate: number;
  averageViews: number;
  medianViews: number;
  maxViews: number;
  averageLatencyMs: number;
  medianLatencyMs: number;
  maxLatencyMs: number;
  averageSelectedCandidateRank: number;
  missingCandidateMatches: number;
  uniqueArtists: number;
  topArtists: Array<{ artist: string; count: number }>;
  songs: string[];
  artists: string[];
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

function loadSession(filePath: string): SessionRow[] {
  const content = readFileSync(filePath, "utf8");
  const [header, ...dataRows] = parseCsv(content);

  if (!header) {
    throw new Error(`${filePath} is empty.`);
  }

  return dataRows.map((values) =>
    Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]))
  ) as SessionRow[];
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function songKey(row: SessionRow): string {
  return `${row.next_song_artist} - ${row.next_song_title}`;
}

function getSelectedCandidateRank(row: SessionRow): number | null {
  try {
    const candidates = JSON.parse(row.candidates) as Candidate[];
    const selected = candidates.find(
      (candidate) =>
        candidate.artist === row.next_song_artist &&
        candidate.title === row.next_song_title
    );

    if (!selected) {
      return null;
    }

    return Number.parseInt(selected.id.replace("candidate_", ""), 10);
  } catch {
    return null;
  }
}

function summarize(filePath: string): SessionSummary {
  const rows = loadSession(filePath).filter((row) => row.event === "draw");
  const views = rows.map((row) => Number.parseInt(row.next_song_views, 10));
  const latencies = rows.map((row) => Number.parseInt(row.click_to_card_ms, 10));
  const candidateRanks = rows
    .map(getSelectedCandidateRank)
    .filter((rank): rank is number => rank !== null && !Number.isNaN(rank));
  const artistCounts = new Map<string, number>();

  for (const row of rows) {
    artistCounts.set(row.next_song_artist, (artistCounts.get(row.next_song_artist) ?? 0) + 1);
  }

  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([artist, count]) => ({ artist, count }));

  const popularSelections = rows.filter(
    (row) => row.next_song_selected_for_popularity === "1"
  ).length;

  return {
    filePath,
    draws: rows.length,
    popularSelections,
    popularSelectionRate: rows.length === 0 ? 0 : popularSelections / rows.length,
    averageViews: Math.round(average(views)),
    medianViews: median(views),
    maxViews: Math.max(...views),
    averageLatencyMs: Math.round(average(latencies)),
    medianLatencyMs: median(latencies),
    maxLatencyMs: Math.max(...latencies),
    averageSelectedCandidateRank: Number(average(candidateRanks).toFixed(2)),
    missingCandidateMatches: rows.length - candidateRanks.length,
    uniqueArtists: artistCounts.size,
    topArtists,
    songs: rows.map(songKey),
    artists: rows.map((row) => row.next_song_artist),
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printSummary(summary: SessionSummary): void {
  console.log(`\n${path.basename(summary.filePath)}`);
  console.log(`draws: ${summary.draws}`);
  console.log(
    `popular selections: ${summary.popularSelections} (${formatPercent(
      summary.popularSelectionRate
    )})`
  );
  console.log(
    `views avg/median/max: ${summary.averageViews} / ${summary.medianViews} / ${summary.maxViews}`
  );
  console.log(
    `latency ms avg/median/max: ${summary.averageLatencyMs} / ${summary.medianLatencyMs} / ${summary.maxLatencyMs}`
  );
  console.log(`average selected candidate rank: ${summary.averageSelectedCandidateRank}`);
  console.log(`missing candidate matches: ${summary.missingCandidateMatches}`);
  console.log(`unique artists: ${summary.uniqueArtists}`);
  console.log(
    `top artists: ${summary.topArtists
      .map((artist) => `${artist.artist}:${artist.count}`)
      .join(", ")}`
  );
}

function main(): void {
  const [firstPath, secondPath] = process.argv.slice(2);

  if (!firstPath || !secondPath) {
    throw new Error(
      "Usage: npm run compare:sessions -- sessions/testing_session_25.csv sessions/testing_session_26.csv"
    );
  }

  const first = summarize(firstPath);
  const second = summarize(secondPath);
  const firstSongs = new Set(first.songs);
  const secondSongs = new Set(second.songs);
  const firstArtists = new Set(first.artists);
  const secondArtists = new Set(second.artists);
  const overlappingSongs = [...firstSongs].filter((song) => secondSongs.has(song));
  const overlappingArtists = [...firstArtists].filter((artist) => secondArtists.has(artist));

  printSummary(first);
  printSummary(second);

  console.log("\ncomparison");
  console.log(`overlapping songs: ${overlappingSongs.length}`);
  console.log(`overlapping artists: ${overlappingArtists.length}`);
  console.log(
    `popular selection rate delta: ${formatPercent(
      second.popularSelectionRate - first.popularSelectionRate
    )}`
  );
  console.log(`average views delta: ${second.averageViews - first.averageViews}`);
  console.log(`median views delta: ${second.medianViews - first.medianViews}`);
  console.log(`average latency delta ms: ${second.averageLatencyMs - first.averageLatencyMs}`);
  console.log(
    `average selected candidate rank delta: ${Number(
      (second.averageSelectedCandidateRank - first.averageSelectedCandidateRank).toFixed(2)
    )}`
  );
}

main();
