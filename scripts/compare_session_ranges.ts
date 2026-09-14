import { readFileSync } from "fs";
import path from "path";

type SessionRow = {
  event: string;
  next_song_artist: string;
  next_song_title: string;
  next_song_views: string;
  next_song_selected_for_popularity: string;
  next_song_spotify_popularity?: string;
  click_to_card_ms: string;
  candidates: string;
};

type Candidate = {
  id: string;
  artist: string;
  title: string;
  views: number;
  spotify_popularity?: number | null;
};

type SessionMetrics = {
  session: number;
  draws: number;
  popularRate: number;
  averageViews: number;
  medianViews: number;
  averageSpotifyPopularity: number;
  medianSpotifyPopularity: number;
  averageLatencyMs: number;
  averageCandidateRank: number;
  averageViewRank: number;
  averageSpotifyRank: number;
  uniqueArtists: number;
};

type MetricKey = Exclude<keyof SessionMetrics, "session" | "draws">;

const metricLabels: Record<MetricKey, string> = {
  popularRate: "popular selection rate",
  averageViews: "average views",
  medianViews: "median views",
  averageSpotifyPopularity: "average spotify popularity",
  medianSpotifyPopularity: "median spotify popularity",
  averageLatencyMs: "average latency ms",
  averageCandidateRank: "average selected candidate rank",
  averageViewRank: "average selected view rank",
  averageSpotifyRank: "average selected spotify rank",
  uniqueArtists: "unique artists",
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

function getSelectedViewRank(row: SessionRow): number | null {
  try {
    const candidates = (JSON.parse(row.candidates) as Candidate[])
      .filter((candidate) => Number.isFinite(candidate.views))
      .sort((a, b) => b.views - a.views);
    const selectedIndex = candidates.findIndex(
      (candidate) =>
        candidate.artist === row.next_song_artist &&
        candidate.title === row.next_song_title
    );

    return selectedIndex === -1 ? null : selectedIndex + 1;
  } catch {
    return null;
  }
}

function getSelectedSpotifyRank(row: SessionRow): number | null {
  try {
    const candidates = (JSON.parse(row.candidates) as Candidate[])
      .filter((candidate) => Number.isFinite(candidate.spotify_popularity))
      .sort((a, b) => (b.spotify_popularity ?? 0) - (a.spotify_popularity ?? 0));
    const selectedIndex = candidates.findIndex(
      (candidate) =>
        candidate.artist === row.next_song_artist &&
        candidate.title === row.next_song_title
    );

    return selectedIndex === -1 ? null : selectedIndex + 1;
  } catch {
    return null;
  }
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined || value === "") {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseRange(range: string): number[] {
  const match = range.match(/^(\d+)-(\d+)$/);

  if (!match) {
    throw new Error(`Range must look like 27-36. Received: ${range}`);
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

function summarizeSession(session: number): SessionMetrics {
  const rows = loadSession(sessionPath(session)).filter((row) => row.event === "draw");
  const views = rows.map((row) => Number.parseInt(row.next_song_views, 10));
  const spotifyPopularities = rows
    .map((row) => parseNumber(row.next_song_spotify_popularity))
    .filter((value): value is number => value !== null);
  const latencies = rows.map((row) => Number.parseInt(row.click_to_card_ms, 10));
  const candidateRanks = rows
    .map(getSelectedCandidateRank)
    .filter((rank): rank is number => rank !== null && !Number.isNaN(rank));
  const viewRanks = rows
    .map(getSelectedViewRank)
    .filter((rank): rank is number => rank !== null && !Number.isNaN(rank));
  const spotifyRanks = rows
    .map(getSelectedSpotifyRank)
    .filter((rank): rank is number => rank !== null && !Number.isNaN(rank));
  const artists = new Set(rows.map((row) => row.next_song_artist));
  const popularSelections = rows.filter(
    (row) => row.next_song_selected_for_popularity === "1"
  ).length;

  return {
    session,
    draws: rows.length,
    popularRate: rows.length === 0 ? 0 : popularSelections / rows.length,
    averageViews: average(views),
    medianViews: median(views),
    averageSpotifyPopularity: average(spotifyPopularities),
    medianSpotifyPopularity: median(spotifyPopularities),
    averageLatencyMs: average(latencies),
    averageCandidateRank: average(candidateRanks),
    averageViewRank: average(viewRanks),
    averageSpotifyRank: average(spotifyRanks),
    uniqueArtists: artists.size,
  };
}

function exactPermutationPValue(firstValues: number[], secondValues: number[]): number {
  const firstSize = firstValues.length;
  const secondSize = secondValues.length;
  const pooled = [...firstValues, ...secondValues];
  const totalSum = pooled.reduce((sum, value) => sum + value, 0);
  const observedDiff = average(secondValues) - average(firstValues);
  let totalCombinations = 0;
  let atLeastAsExtreme = 0;

  function visit(start: number, selected: number, selectedSum: number): void {
    if (selected === firstSize) {
      const otherSum = totalSum - selectedSum;
      const diff = otherSum / secondSize - selectedSum / firstSize;

      totalCombinations += 1;
      if (Math.abs(diff) >= Math.abs(observedDiff) - 1e-12) {
        atLeastAsExtreme += 1;
      }
      return;
    }

    const remainingNeeded = firstSize - selected;
    const maxStart = pooled.length - remainingNeeded;

    for (let index = start; index <= maxStart; index += 1) {
      visit(index + 1, selected + 1, selectedSum + pooled[index]);
    }
  }

  visit(0, 0, 0);

  return atLeastAsExtreme / totalCombinations;
}

function formatValue(metric: MetricKey, value: number): string {
  if (metric === "popularRate") {
    return `${(value * 100).toFixed(1)}%`;
  }

  if (
    metric === "averageCandidateRank" ||
    metric === "averageViewRank" ||
    metric === "averageSpotifyPopularity" ||
    metric === "medianSpotifyPopularity" ||
    metric === "averageSpotifyRank"
  ) {
    return value.toFixed(2);
  }

  return Math.round(value).toString();
}

function formatPValue(value: number): string {
  return value < 0.0001 ? "<0.0001" : value.toFixed(4);
}

function printGroup(name: string, sessions: SessionMetrics[]): void {
  const totalDraws = sessions.reduce((sum, session) => sum + session.draws, 0);
  console.log(`\n${name}`);
  console.log(`sessions: ${sessions.map((session) => session.session).join(", ")}`);
  console.log(`total draws: ${totalDraws}`);
}

function main(): void {
  const [firstRangeArg, secondRangeArg] = process.argv.slice(2);

  if (!firstRangeArg || !secondRangeArg) {
    throw new Error("Usage: npm run compare:ranges -- 27-36 37-46");
  }

  const firstSessions = parseRange(firstRangeArg).map(summarizeSession);
  const secondSessions = parseRange(secondRangeArg).map(summarizeSession);
  const metrics = Object.keys(metricLabels) as MetricKey[];

  // if (firstSessions.length !== secondSessions.length) {
  //   throw new Error("Ranges must contain the same number of sessions for this test.");
  // }

  printGroup(`group A (${firstRangeArg})`, firstSessions);
  printGroup(`group B (${secondRangeArg})`, secondSessions);

  console.log("\nexact two-sided permutation tests over session-level metrics");
  console.log("metric, group_a_mean, group_b_mean, delta_b_minus_a, p_value");

  for (const metric of metrics) {
    const firstValues = firstSessions.map((session) => session[metric]);
    const secondValues = secondSessions.map((session) => session[metric]);
    const firstMean = average(firstValues);
    const secondMean = average(secondValues);
    const pValue = exactPermutationPValue(firstValues, secondValues);

    console.log(
      [
        metricLabels[metric],
        formatValue(metric, firstMean),
        formatValue(metric, secondMean),
        formatValue(metric, secondMean - firstMean),
        formatPValue(pValue),
      ].join(", ")
    );
  }
}

main();
