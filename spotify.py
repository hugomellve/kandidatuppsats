import argparse
import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from difflib import SequenceMatcher
from typing import Any


DEFAULT_INPUT_PATH = "first_set_enriched.json"
DEFAULT_OUTPUT_PATH = "first_set_enriched_spotify.json"
REQUESTS_PER_SECOND = 1

last_request_at = 0.0


class SpotifyRateLimitError(RuntimeError):
    def __init__(self, retry_after: int) -> None:
        super().__init__(
            f"Rate limited by Spotify. Retry after {retry_after}s. "
            "Progress has been saved; rerun this script later to resume."
        )
        self.retry_after = retry_after


def load_env_file(path: str = ".env.local") -> None:
    if not os.path.exists(path):
        return

    with open(path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()

            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def request_json(request: urllib.request.Request) -> dict[str, Any]:
    global last_request_at

    min_interval = 1 / REQUESTS_PER_SECOND
    elapsed = time.monotonic() - last_request_at

    if elapsed < min_interval:
        time.sleep(min_interval - elapsed)

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            last_request_at = time.monotonic()
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        last_request_at = time.monotonic()

        if error.code == 429:
            retry_after = int(error.headers.get("Retry-After", "60"))
            raise SpotifyRateLimitError(retry_after) from error

        raise


def request_access_token(client_id: str, client_secret: str) -> str:
    credentials = f"{client_id}:{client_secret}".encode("utf-8")
    encoded_credentials = base64.b64encode(credentials).decode("utf-8")
    body = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode("utf-8")
    request = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=body,
        headers={
            "Authorization": f"Basic {encoded_credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )

    payload = request_json(request)
    return payload["access_token"]


def normalize(value: str) -> str:
    return " ".join(
        "".join(char.lower() if char.isalnum() else " " for char in value).split()
    )


def similarity(first: str, second: str) -> float:
    return SequenceMatcher(None, normalize(first), normalize(second)).ratio()


def score_track(song: dict[str, Any], track: dict[str, Any]) -> float:
    track_name = track.get("name", "")
    artist_names = " ".join(artist.get("name", "") for artist in track.get("artists", []))
    title_score = similarity(str(song.get("title", "")), track_name)
    artist_score = similarity(str(song.get("artist", "")), artist_names)

    return title_score * 0.7 + artist_score * 0.3


def search_track(access_token: str, song: dict[str, Any]) -> dict[str, Any] | None:
    title = str(song.get("title", ""))
    artist = str(song.get("artist", ""))
    query = urllib.parse.urlencode(
        {
            "q": f'track:"{title}" artist:"{artist}"',
            "type": "track",
            "limit": "10",
        }
    )
    request = urllib.request.Request(
        f"https://api.spotify.com/v1/search?{query}",
        headers={"Authorization": f"Bearer {access_token}"},
        method="GET",
    )
    payload = request_json(request)
    tracks = payload.get("tracks", {}).get("items", [])

    if not tracks:
        return None

    return max(tracks, key=lambda track: score_track(song, track))


def get_track_details(access_token: str, track_id: str) -> dict[str, Any]:
    request = urllib.request.Request(
        f"https://api.spotify.com/v1/tracks/{urllib.parse.quote(track_id)}",
        headers={"Authorization": f"Bearer {access_token}"},
        method="GET",
    )

    return request_json(request)


def find_track_with_details(access_token: str, song: dict[str, Any]) -> dict[str, Any] | None:
    track = search_track(access_token, song)

    if not track:
        return None

    track_id = track.get("id")

    if not track_id:
        return track

    detailed_track = get_track_details(access_token, track_id)
    detailed_track["_match_score"] = score_track(song, track)
    return detailed_track


def apply_spotify_match(song: dict[str, Any], track: dict[str, Any] | None) -> None:
    if not track:
        song["spotify_popularity"] = None
        song["spotify_track_id"] = None
        song["spotify_track_name"] = None
        song["spotify_artist_name"] = None
        song["spotify_match_score"] = None
        return

    artists = track.get("artists", [])
    artist_name = artists[0].get("name") if artists else None

    song["spotify_popularity"] = track.get("popularity")
    song["spotify_popularity_available"] = "popularity" in track
    song["spotify_track_id"] = track.get("id")
    song["spotify_track_name"] = track.get("name")
    song["spotify_artist_name"] = artist_name
    song["spotify_match_score"] = round(track.get("_match_score", score_track(song, track)), 3)


def load_songs(input_path: str, output_path: str) -> list[dict[str, Any]]:
    source_path = output_path if os.path.exists(output_path) else input_path

    with open(source_path, "r", encoding="utf-8") as file:
        return json.load(file)


def write_songs(output_path: str, songs: list[dict[str, Any]]) -> None:
    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(songs, file, indent=2, ensure_ascii=False)
        file.write("\n")


def smoke_test(access_token: str) -> None:
    track = find_track_with_details(access_token, {"artist": "ABBA", "title": "Dancing Queen"})

    if not track:
        raise RuntimeError("Spotify credentials worked, but the test search returned no track.")

    print("Spotify API credentials work.")
    print(
        f"Test search returned: {track['name']} by {track['artists'][0]['name']} "
        f"(popularity {track.get('popularity', 'not returned by this API key')})"
    )


def assert_popularity_available(access_token: str) -> None:
    track = find_track_with_details(access_token, {"artist": "ABBA", "title": "Dancing Queen"})

    if track and "popularity" in track:
        return

    raise RuntimeError(
        "Spotify matched tracks successfully, but this API key does not receive the "
        "'popularity' field from Spotify. Spotify marks track popularity as deprecated "
        "and may restrict it for newer/development apps. The script was stopped so it "
        "does not create a full copy with null popularity values."
    )


def enrich_songs(
    access_token: str,
    input_path: str,
    output_path: str,
    limit: int | None,
    save_every: int,
) -> None:
    songs = load_songs(input_path, output_path)
    enriched_count = 0
    missing_count = 0

    for index, song in enumerate(songs):
        if song.get("spotify_track_id") is not None:
            continue

        if limit is not None and enriched_count >= limit:
            break

        try:
            track = search_track(access_token, song)
            apply_spotify_match(song, track)
        except SpotifyRateLimitError:
            write_songs(output_path, songs)
            raise

        enriched_count += 1
        if not track:
            missing_count += 1

        print(
            f"{index + 1}/{len(songs)} {song.get('artist')} - {song.get('title')} "
            f"-> {song.get('spotify_track_id') or 'no match'} "
            f"({song.get('spotify_track_name') or 'no match'})"
        )

        if enriched_count % save_every == 0:
            write_songs(output_path, songs)

    write_songs(output_path, songs)
    print(f"\nWrote copied/enriched data to {output_path}")
    print(f"Newly processed songs: {enriched_count}")
    print(f"No-match songs in this run: {missing_count}")


def print_status(input_path: str, output_path: str) -> None:
    songs = load_songs(input_path, output_path)
    matched = sum(1 for song in songs if song.get("spotify_track_id"))
    no_match = sum(
        1
        for song in songs
        if "spotify_track_id" in song and song.get("spotify_track_id") is None
    )
    remaining = len(songs) - matched - no_match

    print(f"total songs: {len(songs)}")
    print(f"matched track IDs: {matched}")
    print(f"marked no match: {no_match}")
    print(f"remaining unprocessed: {remaining}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copy first_set_enriched.json and add Spotify track popularity."
    )
    parser.add_argument("--input", default=DEFAULT_INPUT_PATH)
    parser.add_argument("--output", default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--save-every", type=int, default=25)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--status", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    load_env_file()

    if args.status:
        print_status(args.input, args.output)
        return

    client_id = os.environ.get("SPOTIFY_CLIENT_ID")
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET")

    if not client_id or not client_secret:
        raise RuntimeError(
            "Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env.local."
        )

    access_token = request_access_token(client_id, client_secret)

    if args.smoke:
        smoke_test(access_token)
        return

    enrich_songs(
        access_token=access_token,
        input_path=args.input,
        output_path=args.output,
        limit=args.limit,
        save_every=args.save_every,
    )


if __name__ == "__main__":
    main()
