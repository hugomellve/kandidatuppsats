import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getRandomSongs, markSongAsUsed, type Song } from "../../get_rand_song";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type Guess = {
  artist: string;
  title: string;
  result?: "success" | "fail";
};

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

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

    const allSongs = await getRandomSongs(10);
    console.log("allSongs:", allSongs);
    if (!Array.isArray(allSongs) || allSongs.length === 0) {
      return NextResponse.json(
        { error: "Songs JSON must contain at least 1 unused song." },
        { status: 500 }
      );
    }

    const candidates = shuffleArray(allSongs)
      .slice(0, 10)
      .map((song) => ({
        artist: song.artist,
        title: song.title,
      }));

    const prompt = `
You are an intelligent recommendation system for a social music game called "Sing Sing".

Your task is to select the BEST next song from a given candidate list.

---

🎯 GOAL:
Select EXACTLY ONE song from the candidate list that best fits the current game context.

---

⚠️ HARD RULES:
- You MUST select ONE song from the candidate list
- DO NOT invent songs
- DO NOT modify artist or title
- Output ONLY valid JSON
- Your selection MUST exist in the candidate list

---

🧠 GAME CONTEXT:

The following guesses are ordered from oldest to most recent:
${JSON.stringify(recentGuesses, null, 2)}

The most recent guess (latest interaction) is:
${JSON.stringify(lastSong, null, 2)}

---

🧠 DECISION STRATEGY (ICL-style reasoning):

Consider the following pattern:

If a player has previously guessed songs in a certain pattern, and the most recent guess resulted in success or failure, then the next recommended song should adapt accordingly.

- If the most recent guess was SUCCESSFUL:
  → recommend a slightly more challenging song
  → preferably similar in style, genre, language, or era

- If the most recent guess was UNSUCCESSFUL:
  → recommend a more recognizable or easier song
  → avoid songs similar to those that were guessed incorrectly

Additionally:

- Identify patterns in what the player knows (from successful guesses)
- Avoid repeating artists or very similar songs
- Prefer variety across rounds
- Prioritize songs that are fun and suitable for a social game

---

🎵 CANDIDATE SONGS:
${JSON.stringify(candidates, null, 2)}

---

📦 OUTPUT FORMAT (STRICT JSON):

{
  "selected_song": {
    "artist": "...",
    "title": "..."
  },
  "reason": "Short explanation of why this song fits the situation",
  "difficulty": "easier | same | harder"
}

---

Think step-by-step internally, but output ONLY the JSON.
`;

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "song_selection",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              selected_song: {
                type: "object",
                additionalProperties: false,
                properties: {
                  artist: { type: "string" },
                  title: { type: "string" },
                },
                required: ["artist", "title"],
              },
              reason: { type: "string" },
              difficulty: {
                type: "string",
                enum: ["easier", "same", "harder"],
              },
            },
            required: ["selected_song", "reason", "difficulty"],
          },
          strict: true,
        },
      },
    });
    console.log("raw input:", prompt);
    console.log("OpenAI response:", response);
    const parsed = JSON.parse(response.output_text) as {
      selected_song: {
        artist: string;
        title: string;
      };
      reason: string;
      difficulty: "easier" | "same" | "harder";
    };

    const selected = allSongs.find(
      (song) =>
        song.artist === parsed.selected_song.artist &&
        song.title === parsed.selected_song.title
    );

    if (!selected) {
      return NextResponse.json(
        { error: "Model selected a song that was not found in songs.json." },
        { status: 500 }
      );
    }
    console.log("selected:", selected);
    await markSongAsUsed(selected.artist, selected.title);

    return NextResponse.json({
      song: {
        artist: selected.artist,
        title: selected.title,
        line_1: selected.line_1,
        line_2: selected.line_2,
      },
      metadata: {
        reason: parsed.reason,
        difficulty: parsed.difficulty,
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
