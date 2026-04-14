"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";

type LyricData = {
  line_1: string;
  line_2: string;
  artist: string;
  title: string;
};

type DrawResponse = {
  song: LyricData;
  metadata: {
    reason: string;
    difficulty: "easier" | "same" | "harder";
  };
};

type Guess = {
  artist: string;
  title: string;
  result: "success" | "fail";
};

export default function SingSingMVP() {
  const [currentLyric, setCurrentLyric] = useState<LyricData | null>(null);
  const [recentGuesses, setRecentGuesses] = useState<Guess[]>([]);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);

  const waitForPaint = async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  };

  const fetchNextCard = async (lastSong: Guess | null, nextRecentGuesses: Guess[]) => {
    setLoading(true);
    const clickStartedAt = performance.now();

    const res = await fetch("/api/lyric", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recentGuesses: nextRecentGuesses,
        lastSong,
      }),
    });

    const data = (await res.json()) as DrawResponse;

    setRecentGuesses(nextRecentGuesses);
    setCurrentLyric(data.song);
    await waitForPaint();
    const clickToCardMs = Math.round(performance.now() - clickStartedAt);

    await fetch("/api/session-draw", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lastSong,
        nextSong: {
          artist: data.song.artist,
          title: data.song.title,
        },
        difficulty: data.metadata.difficulty,
        reason: data.metadata.reason,
        clickToCardMs,
        recentGuesses: nextRecentGuesses,
      }),
    });

    setLoading(false);
  };

  const drawCard = async () => {
    await fetchNextCard(null, recentGuesses);
  };

  const submitGuess = async (result: Guess["result"]) => {
    if (!currentLyric) {
      return;
    }

    const latestGuess: Guess = {
      artist: currentLyric.artist,
      title: currentLyric.title,
      result,
    };

    const nextRecentGuesses = [latestGuess, ...recentGuesses].slice(0, 5);
    await fetchNextCard(latestGuess, nextRecentGuesses);
  };

  const resetSongs = async () => {
    setResetting(true);

    const res = await fetch("/api/reset-songs", {
      method: "POST",
    });

    if (res.ok) {
      setCurrentLyric(null);
      setRecentGuesses([]);
    }

    setResetting(false);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-900 text-white space-y-4">
      <h1 className="text-2xl font-bold">Sing Sing MVP</h1>

      {loading && <p>Fetching a lyric...</p>}

      {currentLyric ? (
        <Card className="w-full max-w-md text-center bg-white text-black">
          <CardContent className="p-4 space-y-2">
            <p className="text-lg">"{currentLyric.line_1}"</p>
            <p className="text-lg text-gray-600">"{currentLyric.line_2}"</p>
            <div className="text-sm text-gray-700">
              <p>Song: {currentLyric.title}</p>
              <p>Artist: {currentLyric.artist}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <p>Press "Draw Card" to start the game!</p>
      )}

      {currentLyric ? (
        <div className="flex space-x-2">
          <Button onClick={() => submitGuess("success")} disabled={loading}>
            Success
          </Button>
          <Button onClick={() => submitGuess("fail")} disabled={loading}>
            Fail
          </Button>
        </div>
      ) : (
        <div className="flex space-x-2">
          <Button onClick={drawCard} disabled={loading}>
            {loading ? "Loading..." : "Start Game"}
          </Button>
        </div>
      )}

      <Button
        variant="destructive"
        onClick={resetSongs}
        disabled={loading || resetting}
      >
        {resetting ? "Resetting..." : "Reset Used Songs"}
      </Button>

      {recentGuesses.length > 0 && (
        <div className="w-full max-w-md">
          <h2 className="mb-2 text-lg font-semibold">Recent guesses</h2>
          <ul className="space-y-1 text-sm text-gray-300">
            {recentGuesses.map((guess, index) => (
              <li key={`${guess.artist}-${guess.title}-${index}`}>
                {guess.title} - {guess.artist} ({guess.result})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
