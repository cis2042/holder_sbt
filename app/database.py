"""
Firestore database layer for BSC Token Tracker.
Collections: daily_stats, wallet_age_snapshots, sync_metadata
"""

import logging
import os
from datetime import datetime
from typing import Any

from google.cloud import firestore

logger = logging.getLogger(__name__)

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "gen-lang-client-0185671751")


def _get_client():
    """Get Firestore client, trying ADC first, then user credentials."""
    try:
        return firestore.Client(project=PROJECT_ID)
    except Exception:
        # On Cloud Run this should never fail since SA creds are automatic.
        # Locally, use Application Default Credentials (run: gcloud auth application-default login)
        import google.auth
        creds, _ = google.auth.default()
        return firestore.Client(project=PROJECT_ID, credentials=creds)


db = _get_client()

# ── Collection refs ──────────────────────────────────────────
DAILY_STATS = "daily_stats"
WALLET_AGE = "wallet_age_snapshots"
SYNC_META = "sync_metadata"


# ── Daily Stats ──────────────────────────────────────────────

def upsert_daily_stats(date_str: str, new_users: int, cumulative_holders: int):
    """Upsert a day's stats."""
    doc_ref = db.collection(DAILY_STATS).document(date_str)
    doc_ref.set({
        "date": date_str,
        "new_users": new_users,
        "cumulative_holders": cumulative_holders,
        "synced_at": datetime.utcnow().isoformat() + "Z",
    }, merge=True)


def upsert_daily_stats_batch(records: list[dict]):
    """Batch upsert daily stats. Each record: {date, new_users, cumulative_holders}."""
    batch = db.batch()
    count = 0
    for rec in records:
        doc_ref = db.collection(DAILY_STATS).document(rec["date"])
        batch.set(doc_ref, {
            "date": rec["date"],
            "new_users": rec["new_users"],
            "cumulative_holders": rec["cumulative_holders"],
            "synced_at": datetime.utcnow().isoformat() + "Z",
        }, merge=True)
        count += 1
        # Firestore batch limit is 500
        if count >= 490:
            batch.commit()
            batch = db.batch()
            count = 0
    if count > 0:
        batch.commit()


def get_daily_stats(from_date: str | None = None, to_date: str | None = None) -> list[dict]:
    """Get daily stats, optionally filtering by date range."""
    query = db.collection(DAILY_STATS).order_by("date")
    if from_date:
        query = query.where(filter=firestore.FieldFilter("date", ">=", from_date))
    if to_date:
        query = query.where(filter=firestore.FieldFilter("date", "<=", to_date))
    return [doc.to_dict() for doc in query.stream()]


def get_latest_daily_stat() -> dict | None:
    """Get the most recent daily stat."""
    docs = (
        db.collection(DAILY_STATS)
        .order_by("date", direction=firestore.Query.DESCENDING)
        .limit(1)
        .stream()
    )
    for doc in docs:
        return doc.to_dict()
    return None


# ── Wallet Age Snapshots ─────────────────────────────────────

def upsert_wallet_age(date_str: str, cross_tab: list[dict],
                       age_distribution: list[dict],
                       tx_distribution: list[dict],
                       total_analyzed: int):
    """Upsert a day's wallet age snapshot."""
    doc_ref = db.collection(WALLET_AGE).document(date_str)
    doc_ref.set({
        "date": date_str,
        "cross_tab": cross_tab,
        "age_distribution": age_distribution,
        "tx_distribution": tx_distribution,
        "total_analyzed": total_analyzed,
        "synced_at": datetime.utcnow().isoformat() + "Z",
    }, merge=True)


def get_wallet_age(date_str: str) -> dict | None:
    """Get wallet age snapshot for a specific date."""
    doc = db.collection(WALLET_AGE).document(date_str).get()
    return doc.to_dict() if doc.exists else None


def get_latest_wallet_age() -> dict | None:
    """Get the most recent wallet age snapshot."""
    docs = (
        db.collection(WALLET_AGE)
        .order_by("date", direction=firestore.Query.DESCENDING)
        .limit(1)
        .stream()
    )
    for doc in docs:
        return doc.to_dict()
    return None


# ── Sync Metadata ────────────────────────────────────────────

def get_sync_meta() -> dict:
    """Get sync metadata."""
    doc = db.collection(SYNC_META).document("state").get()
    if doc.exists:
        return doc.to_dict()
    return {"last_synced_date": None, "total_records": 0, "backfill_complete": False}


def update_sync_meta(last_synced_date: str, total_records: int, backfill_complete: bool = False):
    """Update sync metadata."""
    db.collection(SYNC_META).document("state").set({
        "last_synced_date": last_synced_date,
        "total_records": total_records,
        "backfill_complete": backfill_complete,
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }, merge=True)


# ── GA Daily Stats ───────────────────────────────────────────

GA_DAILY = "ga_daily_stats"


def upsert_ga_daily(date_str: str, data: dict):
    """Upsert a day's GA analytics data."""
    doc_ref = db.collection(GA_DAILY).document(date_str)
    doc_ref.set({
        "date": date_str,
        **data,
        "synced_at": datetime.utcnow().isoformat() + "Z",
    }, merge=True)


def get_ga_daily(from_date: str | None = None, to_date: str | None = None) -> list[dict]:
    """Get GA daily stats, optionally filtering by date range."""
    query = db.collection(GA_DAILY).order_by("date")
    if from_date:
        query = query.where(filter=firestore.FieldFilter("date", ">=", from_date))
    if to_date:
        query = query.where(filter=firestore.FieldFilter("date", "<=", to_date))
    return [doc.to_dict() for doc in query.stream()]


def get_ga_latest() -> dict | None:
    """Get the most recent GA daily stat with full breakdown."""
    docs = (
        db.collection(GA_DAILY)
        .order_by("date", direction=firestore.Query.DESCENDING)
        .limit(1)
        .stream()
    )
    for doc in docs:
        return doc.to_dict()
    return None


# ── GA Aggregated Stats ──────────────────────────────────────

GA_AGGREGATED = "ga_aggregated"


def upsert_ga_aggregated(range_key: str, data: dict):
    """Upsert aggregated GA analytics data for a date range."""
    doc_ref = db.collection(GA_AGGREGATED).document(range_key)
    doc_ref.set({
        "range_key": range_key,
        **data,
        "synced_at": datetime.utcnow().isoformat() + "Z",
    }, merge=True)


def get_ga_aggregated(range_key: str = "latest") -> dict | None:
    """Get aggregated GA data by range key."""
    doc = db.collection(GA_AGGREGATED).document(range_key).get()
    return doc.to_dict() if doc.exists else None

