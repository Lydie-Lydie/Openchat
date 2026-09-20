#!/usr/bin/env python3
"""Build a deterministic lexicon (word/ending frequencies + sentence structure)
from a character corpus, using the Korean morphological analyzer Kiwi.

Run with: uv run --python 3.12 --with kiwipiepy python scripts/lexicon.py ...
"""
import argparse
import json
import sqlite3
import sys
import time
from collections import Counter

from kiwipiepy import Kiwi

STOP_NOUNS = {
    "수", "것", "건", "게", "데", "때", "등", "바", "분", "이", "그", "저",
    "중", "안", "밖", "전", "후", "위", "앞", "뒤", "옆", "간", "번", "명", "때문",
}

QUESTION_ENDINGS = {
    "까", "을까", "나", "니", "냐", "는가", "은가", "인가", "가", "나요",
    "까요", "을까요", "던가", "지", "냐고", "을래",
}
PROPOSAL_ENDINGS = {"자", "세", "시다"}
COMMAND_ENDINGS = {"어", "아", "해", "라", "거라", "너라", "어라", "아라"}


def read_db(db_path, guilds, channels):
    con = sqlite3.connect(db_path)
    query = "SELECT content FROM messages WHERE author_is_self = 1 AND deleted = 0"
    params = []
    if channels:
        query += " AND channel_id IN (%s)" % ",".join("?" * len(channels))
        params += channels
    if guilds:
        query += " AND guild_id IN (%s)" % ",".join("?" * len(guilds))
        params += guilds
    rows = con.execute(query, params).fetchall()
    con.close()
    return [row[0] for row in rows]


def read_jsonl(path):
    texts = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            text = row.get("text") or row.get("content") or ""
            if text:
                texts.append(text)
    return texts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db")
    parser.add_argument("--guilds", default="")
    parser.add_argument("--channels", default="")
    parser.add_argument("--input")
    parser.add_argument("--out", required=True)
    parser.add_argument("--top", type=int, default=40)
    args = parser.parse_args()

    if args.input:
        texts = read_jsonl(args.input)
    elif args.db:
        guilds = [g for g in args.guilds.split(",") if g]
        channels = [c for c in args.channels.split(",") if c]
        texts = read_db(args.db, guilds, channels)
    else:
        print("need --db or --input", file=sys.stderr)
        sys.exit(1)

    kiwi = Kiwi()
    subjects, objects = Counter(), Counter()
    nouns, verbs, adjectives, adverbs = Counter(), Counter(), Counter(), Counter()
    endings, interjections = Counter(), Counter()
    ending_types = {"평서": 0, "의문": 0, "청유": 0, "명령": 0}
    polite = 0
    total_words = 0
    total_chars = 0

    for text in texts:
        total_words += len(text.split())
        total_chars += len(text)
        tokens = kiwi.tokenize(text.replace("<br>", " "))
        for index, token in enumerate(tokens):
            tag, form = token.tag, token.form
            if tag in ("NNG", "NNP"):
                if len(form) >= 2 and form not in STOP_NOUNS:
                    nouns[form] += 1
                nxt = tokens[index + 1] if index + 1 < len(tokens) else None
                if nxt is not None:
                    if nxt.tag == "JKS" or (nxt.tag == "JX" and nxt.form in ("은", "는")):
                        if len(form) >= 2:
                            subjects[form] += 1
                    elif nxt.tag == "JKO":
                        if len(form) >= 2:
                            objects[form] += 1
            elif tag == "VV":
                verbs[token.lemma or form] += 1
            elif tag == "VA":
                adjectives[token.lemma or form] += 1
            elif tag == "MAG":
                adverbs[form] += 1
            elif tag == "IC":
                interjections[form] += 1

        last_ending = None
        for token in tokens:
            if token.tag == "EF" and all("\uac00" <= ch <= "\ud7a3" for ch in token.form):
                endings[token.form] += 1
                last_ending = token.form
        if last_ending:
            if last_ending.endswith("요") or last_ending in ("니다", "습니다", "ㅂ니다"):
                polite += 1
            if last_ending in QUESTION_ENDINGS or last_ending.endswith("까") or last_ending.endswith("나요"):
                ending_types["의문"] += 1
            elif last_ending in PROPOSAL_ENDINGS:
                ending_types["청유"] += 1
            elif last_ending in COMMAND_ENDINGS:
                ending_types["명령"] += 1
            else:
                ending_types["평서"] += 1

    message_count = len(texts)
    with_ending = max(1, sum(ending_types.values()))
    structure = {
        "messages": message_count,
        "avg_words": round(total_words / message_count, 1) if message_count else 0,
        "avg_chars": round(total_chars / message_count, 1) if message_count else 0,
        "polite_ratio": round(polite / with_ending, 2),
        "ending_types": {k: round(v / with_ending, 2) for k, v in ending_types.items()},
    }

    data = {
        "generated_at": int(time.time() * 1000),
        "analyzer": "kiwipiepy",
        "message_count": message_count,
        "subjects": subjects.most_common(args.top),
        "objects": objects.most_common(args.top),
        "nouns": nouns.most_common(args.top),
        "verbs": verbs.most_common(args.top),
        "adjectives": adjectives.most_common(args.top),
        "adverbs": adverbs.most_common(args.top),
        "endings": endings.most_common(args.top),
        "interjections": interjections.most_common(args.top),
        "structure": structure,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"messages={message_count} analyzer=kiwipiepy out={args.out}")


if __name__ == "__main__":
    main()
