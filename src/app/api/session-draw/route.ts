import { NextResponse } from "next/server";
import { appendSessionDraw } from "../../session_tracker";

type Guess = {
  artist: string;
  title: string;
  result?: "success" | "fail";
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      lastSong: Guess | null;
      nextSong: { artist: string; title: string };
      difficulty: "easier" | "same" | "harder";
      reason: string;
      clickToCardMs: number;
      recentGuesses: Guess[];
    };

    await appendSessionDraw({
      lastSong: body.lastSong ?? null,
      nextSong: body.nextSong,
      difficulty: body.difficulty,
      reason: body.reason,
      clickToCardMs: body.clickToCardMs,
      recentGuesses: Array.isArray(body.recentGuesses)
        ? body.recentGuesses.slice(0, 5)
        : [],
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
