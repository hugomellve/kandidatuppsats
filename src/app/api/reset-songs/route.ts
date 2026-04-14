import { NextResponse } from "next/server";
import { resetUsedSongs } from "../../get_rand_song";
import { closeCurrentSession } from "../../session_tracker";

export async function POST() {
  try {
    await closeCurrentSession();
    await resetUsedSongs();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/reset-songs error:", error);

    return NextResponse.json(
      { error: "Something went wrong while resetting songs." },
      { status: 500 }
    );
  }
}
