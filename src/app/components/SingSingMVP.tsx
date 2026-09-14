"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";

type LyricData = {
  line_1: string;
  line_2: string;
  artist: string;
  title: string;
  views: number;
  selected_for_popularity: number;
  spotify_popularity?: number | null;
};

type DrawResponse = {
  song: LyricData;
  metadata: {
    candidates: Array<{
      id: string;
      artist: string;
      title: string;
      views: number;
      selected_for_popularity: number;
      spotify_popularity?: number | null;
    }>;
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
  const [blurSecondLine, setBlurSecondLine] = useState(true);
  const [isSecondLineRevealed, setIsSecondLineRevealed] = useState(false);

  const waitForPaint = async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  };

  const fetchNextCard = async (
    lastSong: Guess | null,
    recentGuessesForModel: Guess[],
    nextRecentGuesses: Guess[]
  ) => {
    setLoading(true);
    const clickStartedAt = performance.now();

    const res = await fetch("/api/lyric", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recentGuesses: recentGuessesForModel,
        lastSong,
      }),
    });

    const data = (await res.json()) as DrawResponse;

    setRecentGuesses(nextRecentGuesses);
    setCurrentLyric(data.song);
    setIsSecondLineRevealed(false);
    await waitForPaint();
    const clickToCardMs = Math.round(performance.now() - clickStartedAt);

    await fetch("/api/session-draw", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lastSong,
        nextSong: data.song,
        clickToCardMs,
        recentGuesses: recentGuessesForModel,
        candidates: data.metadata.candidates,
      }),
    });

    setLoading(false);
  };

  const drawCard = async () => {
    await fetchNextCard(null, recentGuesses, recentGuesses);
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
    await fetchNextCard(latestGuess, recentGuesses, nextRecentGuesses);
  };

  const resetSongs = async () => {
    setResetting(true);

    const res = await fetch("/api/reset-songs", {
      method: "POST",
    });

    if (res.ok) {
      setCurrentLyric(null);
      setRecentGuesses([]);
      setIsSecondLineRevealed(false);
    }

    setResetting(false);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-900 text-white space-y-4">
      <h1 className="text-2xl font-bold">Sing Sing MVP</h1>

      <label className="flex items-center gap-3 text-sm text-gray-200 cursor-pointer select-none">
        <span>Blur second line</span>
        <button
          type="button"
          role="switch"
          aria-checked={blurSecondLine}
          aria-label="Toggle blur for second lyric line"
          onClick={() => {
            setBlurSecondLine((current) => !current);
            setIsSecondLineRevealed(false);
          }}
          className={`relative h-7 w-12 rounded-full transition-colors ${
            blurSecondLine ? "bg-blue-500" : "bg-gray-600"
          }`}
        >
          <span
            className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white transition-transform ${
              blurSecondLine ? "translate-x-6" : "translate-x-0"
            }`}
          />
        </button>
      </label>

      {loading && <p>Fetching a lyric...</p>}

      {currentLyric ? (
        <Card className="w-full max-w-md text-center bg-white text-black">
          <CardContent className="p-4 space-y-2">
            <p className="text-lg">"{currentLyric.line_1}"</p>
            <button
              type="button"
              onClick={() => {
                if (blurSecondLine) {
                  setIsSecondLineRevealed(true);
                }
              }}
              className={`w-full text-lg text-gray-600 transition ${
                blurSecondLine && !isSecondLineRevealed ? "blur-sm" : ""
              }`}
              aria-label={
                blurSecondLine && !isSecondLineRevealed
                  ? "Reveal second lyric line"
                  : "Second lyric line visible"
              }
            >
              "{currentLyric.line_2}"
            </button>
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
