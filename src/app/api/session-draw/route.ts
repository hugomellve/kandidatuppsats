import { NextResponse } from "next/server";
import { appendSessionDraw } from "../../session_tracker";

type Guess = {
  artist: string;
  title: string;
  result?: "success" | "fail";
};

type SessionSong = {
  artist: string;
  title: string;
  views?: number;
  selected_for_popularity?: number;
  spotify_popularity?: number | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      lastSong: Guess | null;
      nextSong: SessionSong;
      clickToCardMs: number;
      recentGuesses: Guess[];
      candidates: SessionSong[];
    };

    await appendSessionDraw({
      lastSong: body.lastSong ?? null,
      nextSong: body.nextSong,
      clickToCardMs: body.clickToCardMs,
      recentGuesses: Array.isArray(body.recentGuesses)
        ? body.recentGuesses.slice(0, 5)
        : [],
      candidates: Array.isArray(body.candidates) ? body.candidates : [],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/session-draw error:", error);

    return NextResponse.json(
      { error: "Something went wrong while logging the session draw." },
      { status: 500 }
    );
  }
}
