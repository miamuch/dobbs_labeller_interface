import json
from collections import defaultdict, deque
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ITEMS_PATH = ROOT / "data" / "items.json"

PRIOR_ORDER = ["pro_choice", "pro_life", "neutral", "none"]


def week_number(week):
    try:
        return int(str(week).split("_")[-1])
    except ValueError:
        return 999


def priority_rank(row):
    return 0 if row.get("priority_for_labeling") == "core_topic_coverage" else 1


def probability(row):
    try:
        return -float(row.get("topic_probability") or 0)
    except ValueError:
        return 0


def build_topic_round_robin(rows):
    by_topic = defaultdict(list)
    for row in rows:
        by_topic[str(row.get("tjst_topic", ""))].append(row)

    topic_queues = []
    for topic in sorted(by_topic, key=lambda value: int(value) if value.isdigit() else 999):
        ordered = sorted(
            by_topic[topic],
            key=lambda row: (priority_rank(row), probability(row), row["annotation_row_id"]),
        )
        topic_queues.append(deque(ordered))

    out = []
    while any(topic_queues):
        for queue in topic_queues:
            if queue:
                out.append(queue.popleft())
    return deque(out)


def build_week_queue(rows):
    by_prior = defaultdict(list)
    for row in rows:
        by_prior[str(row.get("tjst_stance_prior", ""))].append(row)

    prior_queues = []
    for prior in PRIOR_ORDER:
        if prior in by_prior:
            prior_queues.append(build_topic_round_robin(by_prior[prior]))

    out = []
    while any(prior_queues):
        for queue in prior_queues:
            if queue:
                out.append(queue.popleft())
    return deque(out)


def main():
    rows = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    by_week = defaultdict(list)
    for row in rows:
        by_week[row.get("week")].append(row)

    week_queues = {
        week: build_week_queue(week_rows)
        for week, week_rows in by_week.items()
    }

    weeks = sorted(week_queues, key=week_number)

    ordered = []
    round_index = 0
    while any(week_queues.values()):
        offset = round_index % len(weeks)
        week_order = weeks[offset:] + weeks[:offset]
        for week in week_order:
            queue = week_queues.get(week)
            if queue:
                ordered.append(queue.popleft())
        round_index += 1

    if len(ordered) != len(rows):
        raise RuntimeError(f"Expected {len(rows)} rows but produced {len(ordered)}")

    ITEMS_PATH.write_text(json.dumps(ordered, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"Wrote {len(ordered)} stratified rows to {ITEMS_PATH}")


if __name__ == "__main__":
    main()
