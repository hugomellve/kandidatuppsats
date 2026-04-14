import pandas as pd


csv_path = "song_lyrics.csv"
csv_path_cleaned = "unique_en_sv_songs.csv"

# Load only the first few rows to peek at the structure
# df = pd.read_csv(csv_path_cleaned, nrows=10)

# print(df.head())



# row_count = sum(1 for _ in open(csv_path, encoding="utf-8")) - 1  # subtract header
# print(f"Total songs: {row_count}")

## lyrics = df['lyrics']

# # Load just necessary columns
# df = pd.read_csv(csv_path_cleaned, usecols=["title", "artist"])

# # Drop duplicates
# unique_songs = df.drop_duplicates(subset=["title", "artist"])

# # Count unique combinations
# print(f"Total unique songs: {len(unique_songs)}")

# # Load only the 'tag' column to save memory
# df = pd.read_csv(csv_path, usecols=["artist"])

# # Count occurrences of each tag (genre)
# genre_counts = df["tag"].value_counts()

# # Show the top 10 genres
# print(genre_counts.head(10))

# # Load your unique songs file
# df = pd.read_csv(csv_path, usecols=["language"])

# # Normalize the language codes just in case
# df["language"] = df["language"].str.strip().str.lower()

# # Count occurrences of each language
# language_counts = df["language"].value_counts()

# # Show English and Swedish specifically
# print(f"English songs: {language_counts.get('en', 0)}")
# print(f"Swedish songs: {language_counts.get('sv', 0)}")



# Load the filtered dataset from previous step
df = pd.read_csv("top_english_swedish_subset.csv", usecols=["tag"])

# Clean and normalize genre column
df["tag"] = df["tag"].astype(str).str.strip().str.lower()

# Count occurrences per genre
genre_counts = df["tag"].value_counts().reset_index()
genre_counts.columns = ["genre", "count"]

print(genre_counts)