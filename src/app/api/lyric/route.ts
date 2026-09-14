import { NextResponse } from "next/server";
import { generateLyricSelection, type Guess } from "../../lyric_generation.ts";

export async function POST(req: Request) {
  try {
    let body: any = {};

    try {
  const rawBody = await req.text();
  body = rawBody ? JSON.parse(rawBody) : {};
    } 
    catch {
      return NextResponse.json(
    { error: "Request body must be valid JSON." },
    { status: 400 });
    }

    const recentGuesses: Guess[] = Array.isArray(body.recentGuesses)
      ? body.recentGuesses.slice(0, 5)
      : [];

    const lastSong: Guess | null = body.lastSong ?? null;

    const { selectedSong, candidates } = await generateLyricSelection({
      recentGuesses,
      lastSong,
    });

    return NextResponse.json({
      song: {
        artist: selectedSong.artist,
        title: selectedSong.title,
        line_1: selectedSong.line_1,
        line_2: selectedSong.line_2,
        views: selectedSong.views,
        selected_for_popularity: selectedSong.selected_for_popularity,
        spotify_popularity: selectedSong.spotify_popularity,
      },
      metadata: {
        candidates,
      },
    });
  } catch (error) {
    console.error("POST /api/openai error:", error);

    return NextResponse.json(
      { error: "Something went wrong in the POST function." },
      { status: 500 }
    );
  }
}
