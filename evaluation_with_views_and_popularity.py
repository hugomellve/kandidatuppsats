import os
import glob
import pandas as pd
import numpy as np
import json
import matplotlib.pyplot as plt
from itertools import combinations
from collections import Counter

DATA_DIR = "data/analysis_results"
STRATEGY_ORDER = [
    "Helt slumpmässig",
    "Ingen historik",
    "Slumpad historik",
    "Sequential",
    "Recency-focused",
    "In-context learning",
]
STRATEGY_LABELS = {
    "Sequential": "Sequential",
    "Recency-focused": "Recency-focused",
    "In-context learning": "In-context learning",
}
UNTRANSLATED_STRATEGIES = {"Sequential", "Recency-focused", "In-context learning"}

def order_strategies(results):
    """Return strategies in the desired chart order, preserving any extras at the end."""
    ordered = [strategy for strategy in STRATEGY_ORDER if strategy in results]
    extras = [strategy for strategy in results.keys() if strategy not in STRATEGY_ORDER]
    return ordered + extras

def display_strategy(strategy):
    return STRATEGY_LABELS.get(strategy, strategy)

def style_strategy_ticklabels(ax, strategies):
    for tick_label, strategy in zip(ax.get_xticklabels(), strategies):
        if strategy in UNTRANSLATED_STRATEGIES:
            tick_label.set_fontstyle('italic')

def format_thousands(value):
    return f"{value / 1000:.0f}k"

def add_readable_bar_labels(ax, bars, *, labels=None, fmt=None, fontsize=9):
    annotations = ax.bar_label(
        bars,
        labels=labels,
        fmt=fmt,
        padding=5,
        fontsize=fontsize,
        fontweight='bold',
    )
    for annotation in annotations:
        annotation.set_bbox({
            'facecolor': 'white',
            'edgecolor': 'none',
            'alpha': 0.85,
            'pad': 1.5,
        })
    ax.margins(y=0.12)

def get_rank(value, candidates, key, reverse=True):
    """Return the 1-based rank of value among candidates for key."""
    sorted_candidates = sorted(candidates, key=lambda x: x[key], reverse=reverse)
    for idx, cand in enumerate(sorted_candidates):
        if cand[key] == value:
            return idx + 1
    return None  # Should not happen

def process_file(filepath):
    df = pd.read_csv(filepath)
    view_ranks = []
    pop_ranks = []
    next_song_views = []
    next_song_selected_for_pop = []
    next_song_spotify_popularity = []

    for _, row in df.iterrows():
        try:
            candidates = json.loads(row['candidates'].replace('""', '"'))
        except Exception:
            continue
        selected = None
        for cand in candidates:
            if (cand['artist'] == row['next_song_artist'] and
                cand['title'] == row['next_song_title']):
                selected = cand
                break
        if not selected:
            continue
        view_rank = get_rank(selected['views'], candidates, 'views', reverse=True)
        pop_rank = get_rank(selected['spotify_popularity'], candidates, 'spotify_popularity', reverse=True)
        view_ranks.append(view_rank)
        pop_ranks.append(pop_rank)
        # Only collect these if the row was successfully processed
        next_song_views.append(float(row['next_song_views']))
        next_song_selected_for_pop.append(float(row['next_song_selected_for_popularity']))
        next_song_spotify_popularity.append(float(row['next_song_spotify_popularity']))

    return {
        'next_song_views': next_song_views,
        'next_song_selected_for_popularity': next_song_selected_for_pop,
        'next_song_spotify_popularity': next_song_spotify_popularity,
        'view_ranks': view_ranks,
        'pop_ranks': pop_ranks
    }

def plot_results(results):
    strategies = order_strategies(results)

    x = np.arange(len(strategies))
    width = 0.5

    metrics = [
        ('views_avg', 'views_std', 'Genomsnittliga visningar för vald låt', 'Visningar'),
        ('selected_for_pop_avg', 'selected_for_pop_std', 'Genomsnittligt urval efter popularitetsklass (0-1)', 'Andel'),
        ('popularity_avg', 'popularity_std', 'Genomsnittlig Spotify-popularitet (0-100)', 'Spotify-popularitet'),
        ('view_rank_avg', 'view_rank_std', 'Genomsnittlig visningsrankning (1 = flest visningar)', 'Rankning'),
        ('pop_rank_avg', 'pop_rank_std', 'Genomsnittlig popularitetsrankning (1-20)\n(1 = populärast)', 'Rankning'),
    ]

    fig, axes = plt.subplots(1, len(metrics), figsize=(22, 6))

    for ax, (avg_key, std_key, title, ylabel) in zip(axes, metrics):
        avgs = [results[s][avg_key] for s in strategies]
        colors = ['coral' if s == "Helt slumpmässig" else 'seagreen' for s in strategies]
        bars = ax.bar(x, avgs, width, color=colors, alpha=0.8)
        ax.set_title(title, fontsize=11)
        ax.set_ylabel(ylabel)
        ax.set_xticks(x)
        ax.set_xticklabels([display_strategy(s) for s in strategies], rotation=20, ha='right', fontsize=9)
        style_strategy_ticklabels(ax, strategies)
        if avg_key == 'views_avg':
            ax.set_ylim(bottom=0)
            add_readable_bar_labels(
                ax,
                bars,
                labels=[format_thousands(value) for value in avgs],
                fontsize=10,
            )
        else:
            label_fmt = '%.2f' if avg_key == 'selected_for_pop_avg' else '%.1f'
            add_readable_bar_labels(ax, bars, fmt=label_fmt)


    plt.suptitle('Jämförelse av rekommendationsstrategier', fontsize=14, fontweight='bold')
    plt.tight_layout()
    plt.savefig('strategy_comparison.png', dpi=150, bbox_inches='tight')
    plt.show()

def gini(counts):
    """Compute Gini coefficient for a list of counts."""
    arr = np.array(sorted(counts), dtype=float)
    n = len(arr)
    if n == 0 or arr.sum() == 0:
        return 0
    cumulative = np.cumsum(arr)
    return (n + 1 - 2 * np.sum(cumulative) / cumulative[-1]) / n

def jaccard(set_a, set_b):
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0

def process_diversity(filepath):
    """Return list of songs drawn (selected) per session (file = one session)."""
    df = pd.read_csv(filepath)
    songs_drawn = []
    for _, row in df.iterrows():
        artist = row.get('next_song_artist')
        title = row.get('next_song_title')
        if pd.notna(artist) and pd.notna(title):
            songs_drawn.append(f"{artist} - {title}")
    return songs_drawn

def analyze_diversity(all_sessions):
    """
    all_sessions: list of lists, each inner list is songs shown in one session
    """
    all_songs_flat = [s for session in all_sessions for s in session]
    total_draws = len(all_songs_flat)
    unique_songs = len(set(all_songs_flat))

    # Unique song ratio
    unique_ratio = unique_songs / total_draws if total_draws > 0 else 0

    # Top-10 concentration
    counter = Counter(all_songs_flat)
    top10_count = sum(count for _, count in counter.most_common(10))
    top10_concentration = top10_count / total_draws if total_draws > 0 else 0

    # Gini coefficient
    gini_coef = gini(list(counter.values()))

    # Inter-session Jaccard (average pairwise)
    session_sets = [set(s) for s in all_sessions]
    if len(session_sets) >= 2:
        jaccard_scores = [
            jaccard(a, b)
            for a, b in combinations(session_sets, 2)
        ]
        avg_jaccard = np.mean(jaccard_scores)
    else:
        avg_jaccard = np.nan

    return {
        'unique_songs': unique_songs,
        'unique_ratio': unique_ratio,
        'top10_concentration': top10_concentration,
        'gini': gini_coef,
        'avg_jaccard': avg_jaccard,
    }

def plot_diversity(diversity_results):
    strategies = order_strategies(diversity_results)

    x = np.arange(len(strategies))
    width = 0.5

    metrics = [
        ('unique_songs', 'Unika låtar visade', 'Antal', '%.0f'),
        ('unique_ratio', 'Andel unika låtar', 'Andel', '%.3f'),
        ('top10_concentration', 'Koncentration bland topp 10-låtar\n(lägre = bättre)', 'Andel', '%.3f'),
        ('gini', 'Gini-koefficient\n(lägre = bättre, 0 = jämnt)', 'Gini', '%.3f'),
        ('avg_jaccard', 'Jaccard-index (0-1)\n(lägre = mer variation)', 'Jaccard', '%.3f'),
    ]

    fig, axes = plt.subplots(1, len(metrics), figsize=(22, 6))

    for ax, (key, title, ylabel, label_fmt) in zip(axes, metrics):
        vals = [diversity_results[s][key] for s in strategies]
        colors = ['coral' if s == "Helt slumpmässig" else 'seagreen' for s in strategies]
        bars = ax.bar(x, vals, width, color=colors, alpha=0.8)
        ax.set_title(title, fontsize=10)
        ax.set_ylabel(ylabel)
        ax.set_xticks(x)
        ax.set_xticklabels([display_strategy(s) for s in strategies], rotation=20, ha='right', fontsize=9)
        style_strategy_ticklabels(ax, strategies)
        add_readable_bar_labels(ax, bars, fmt=label_fmt)
    
    plt.suptitle('Jämförelse av variation mellan rekommendationsstrategier', fontsize=14, fontweight='bold')
    plt.tight_layout()
    plt.savefig('strategy_diversity.png', dpi=150, bbox_inches='tight')
    plt.show()

def main():
    strategies = [d for d in os.listdir(DATA_DIR) if os.path.isdir(os.path.join(DATA_DIR, d))]
    results = {}
    diversity_results = {}

    for strategy in strategies:
        all_views = []
        all_selected_for_pop = []
        all_popularity = []
        all_view_ranks = []
        all_pop_ranks = []
        all_sessions = []
        files = glob.glob(os.path.join(DATA_DIR, strategy, "*.csv"))
        for f in files:
            out = process_file(f)
            all_views.extend(out['next_song_views'])
            all_selected_for_pop.extend(out['next_song_selected_for_popularity'])
            all_popularity.extend(out['next_song_spotify_popularity'])
            all_view_ranks.extend(out['view_ranks'])
            all_pop_ranks.extend(out['pop_ranks'])
            songs = process_diversity(f)
            all_sessions.append(songs)
        
        diversity_results[strategy] = analyze_diversity(all_sessions)
        results[strategy] = {
            'views_avg': np.mean(all_views),
            'views_std': np.std(all_views),
            'selected_for_pop_avg': np.mean(all_selected_for_pop),
            'selected_for_pop_std': np.std(all_selected_for_pop),
            'popularity_avg': np.mean(all_popularity),
            'popularity_std': np.std(all_popularity),
            'view_rank_avg': np.mean(all_view_ranks),
            'view_rank_std': np.std(all_view_ranks),
            'pop_rank_avg': np.mean(all_pop_ranks),
            'pop_rank_std': np.std(all_pop_ranks),
        }
    # Print results
    for strategy, stats in results.items():
        print(f"Strategy: {strategy}")
        for k, v in stats.items():
            print(f"  {k}: {v:.2f}")
        print()

    plot_results(results)

    print("\n--- Diversity Stats ---")
    for strategy, stats in diversity_results.items():
        print(f"Strategy: {strategy}")
        for k, v in stats.items():
            print(f"  {k}: {v:.4f}" if isinstance(v, float) else f"  {k}: {v}")
        print()

    plot_diversity(diversity_results)

    

if __name__ == "__main__":
    main()
