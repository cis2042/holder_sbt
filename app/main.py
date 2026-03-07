"""
FastAPI application for BSC Token Growth Dashboard.

Serves:
- REST API for chart data (from Firestore)
- Static dashboard SPA
- Sync endpoints (for Cloud Scheduler)
"""

import logging
import os
from datetime import datetime

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

app = FastAPI(title="BSC Token Growth Dashboard", version="1.0.0")

# ── CORS (allow widget embedding from any origin) ────────────
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ── Config ───────────────────────────────────────────────────
DUNE_API_KEY = os.getenv("DUNE_API_KEY", "")
TOKEN_CONTRACT = os.getenv("TOKEN_CONTRACT_ADDRESS", "0xe3ec133e29addfbba26a412c38ed5de37195156f")
MINTER_ADDRESS = os.getenv("MINTER_ADDRESS", "0x344659F3Ef3c2D2A0cdF071ea13Fa87867777777")
TIMEZONE = os.getenv("TIMEZONE", "UTC")
SYNC_SECRET = os.getenv("SYNC_SECRET", "")  # Protect sync endpoints

# ── Static files ─────────────────────────────────────────────
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")


@app.get("/")
async def index():
    """Serve the dashboard."""
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# Mount static files after the root route
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ── API: Daily Stats ─────────────────────────────────────────

@app.get("/api/stats/daily")
async def api_daily_stats(
    from_date: str | None = None,
    to_date: str | None = None,
):
    """Get daily stats, optionally filtered by date range."""
    from app.database import get_daily_stats
    data = get_daily_stats(from_date, to_date)
    return {"status": "ok", "count": len(data), "data": data}


@app.get("/api/stats/summary")
async def api_summary():
    """Get latest summary stats."""
    from app.database import get_latest_daily_stat, get_daily_stats, get_sync_meta

    latest = get_latest_daily_stat()
    meta = get_sync_meta()

    # Calculate 7-day stats
    all_stats = get_daily_stats()
    stats_7d = all_stats[-7:] if len(all_stats) >= 7 else all_stats
    stats_14d = all_stats[-14:] if len(all_stats) >= 14 else all_stats
    avg_7d = sum(s["new_users"] for s in stats_7d) / max(len(stats_7d), 1)
    avg_prev_7d = (
        sum(s["new_users"] for s in stats_14d[:7]) / 7
        if len(stats_14d) >= 14 else None
    )
    change_7d = (
        ((avg_7d - avg_prev_7d) / max(avg_prev_7d, 1) * 100)
        if avg_prev_7d and avg_prev_7d > 0 else None
    )

    # All-time stats
    total_days = len(all_stats)
    avg_daily = sum(s["new_users"] for s in all_stats) / max(total_days, 1)

    return {
        "status": "ok",
        "latest": latest,
        "sync_meta": meta,
        "metrics": {
            "total_days": total_days,
            "avg_daily_all_time": round(avg_daily, 1),
            "avg_7d": round(avg_7d, 1),
            "change_7d_pct": round(change_7d, 1) if change_7d is not None else None,
        },
    }


# ── API: Wallet Age ──────────────────────────────────────────

@app.get("/api/wallet-age/latest")
async def api_wallet_age_latest():
    """Get the latest wallet age snapshot — prefer all-holders analysis."""
    from app.database import get_ga_aggregated, get_latest_wallet_age

    # Try all-holders analysis first
    agg = get_ga_aggregated("wallet_all_holders")
    if agg:
        return {"status": "ok", "data": agg}

    # Fallback to per-day snapshot
    data = get_latest_wallet_age()
    if not data:
        raise HTTPException(status_code=404, detail="No wallet age data available")
    return {"status": "ok", "data": data}


@app.get("/api/wallet-age/{date}")
async def api_wallet_age(date: str):
    """Get wallet age snapshot for a specific date."""
    from app.database import get_wallet_age
    data = get_wallet_age(date)
    if not data:
        raise HTTPException(status_code=404, detail=f"No wallet age data for {date}")
    return {"status": "ok", "data": data}


# ── API: Formulas ────────────────────────────────────────────

@app.get("/api/formulas")
async def api_formulas():
    """Return SQL queries and formula descriptions used for data generation."""
    from app.data_sync import ALL_DAILY_MINTS_SQL, TODAY_WALLET_AGE_SQL, TOTAL_HOLDERS_SQL

    return {
        "status": "ok",
        "formulas": {
            "daily_mints": {
                "description": (
                    "Count distinct wallets receiving a mint (NFT transfer from 0x0 via minter) "
                    "for each day, from contract inception to present."
                ),
                "sql": ALL_DAILY_MINTS_SQL.format(
                    token_hex="e3ec...5156f", minter_hex="344659...7777"
                ),
            },
            "wallet_age_analysis": {
                "description": (
                    "For each day's new users, look back 1 year for prior transactions. "
                    "Classify by wallet age (6 buckets) × prior tx count (6 buckets). "
                    "Produces a cross-tabulation matrix."
                ),
                "sql": TODAY_WALLET_AGE_SQL.format(
                    token_hex="e3ec...5156f", minter_hex="344659...7777",
                    target_date="YYYY-MM-DD", timezone="Asia/Taipei"
                ),
            },
            "total_holders": {
                "description": "All-time distinct wallets that received a mint from the minter.",
                "sql": TOTAL_HOLDERS_SQL.format(
                    token_hex="e3ec...5156f", minter_hex="344659...7777"
                ),
            },
        },
    }


# ── Sync Endpoints ───────────────────────────────────────────

def _verify_sync_auth(request: Request):
    """Verify sync request is authorized."""
    # Accept Cloud Scheduler OIDC tokens or secret header
    if SYNC_SECRET:
        auth = request.headers.get("X-Sync-Secret", "")
        if auth != SYNC_SECRET:
            raise HTTPException(status_code=403, detail="Unauthorized")


@app.post("/api/sync/backfill")
async def api_backfill(request: Request):
    """Trigger full historical backfill from Dune → Firestore."""
    _verify_sync_auth(request)

    if not DUNE_API_KEY:
        raise HTTPException(status_code=500, detail="DUNE_API_KEY not configured")

    from app.data_sync import DataSyncer
    syncer = DataSyncer(DUNE_API_KEY, TOKEN_CONTRACT, MINTER_ADDRESS, TIMEZONE)
    result = syncer.backfill()
    return JSONResponse(result)


@app.post("/api/sync/daily")
async def api_daily_sync(request: Request, date: str | None = None):
    """Trigger daily sync. Called by Cloud Scheduler."""
    _verify_sync_auth(request)

    results = {}

    # Dune sync
    if DUNE_API_KEY:
        from app.data_sync import DataSyncer
        syncer = DataSyncer(DUNE_API_KEY, TOKEN_CONTRACT, MINTER_ADDRESS, TIMEZONE)
        results["dune"] = syncer.daily_sync(target_date=date)
    else:
        results["dune"] = {"status": "skipped", "reason": "DUNE_API_KEY not set"}

    # GA sync
    try:
        from app.ga_sync import GASyncer
        ga = GASyncer()
        results["ga"] = ga.sync_daily(target_date=date)
    except Exception as e:
        logger.warning(f"GA sync failed: {e}")
        results["ga"] = {"status": "error", "message": str(e)}

    return JSONResponse(results)


@app.post("/api/sync/wallet-all")
async def api_wallet_all_sync(request: Request):
    """Run ALL-holders wallet analysis and store result."""
    _verify_sync_auth(request)

    if not DUNE_API_KEY:
        raise HTTPException(status_code=500, detail="DUNE_API_KEY not set")

    from app.data_sync import DataSyncer
    from app.database import upsert_ga_aggregated

    syncer = DataSyncer(DUNE_API_KEY, TOKEN_CONTRACT, MINTER_ADDRESS, TIMEZONE)
    df = syncer.fetch_all_holders_wallet()
    if df.empty:
        raise HTTPException(status_code=500, detail="No data from Dune")

    # Process cross-tab
    cross_tab = df.to_dict("records")
    total = int(df["users"].sum())

    # Build age distribution
    age_agg = df.groupby("age_bucket")["users"].sum().reset_index()
    age_dist = [
        {"age_bucket": row["age_bucket"], "users": int(row["users"]),
         "pct": round(int(row["users"]) / total * 100, 2) if total else 0}
        for _, row in age_agg.iterrows()
    ]

    # Build tx distribution
    tx_agg = df.groupby("tx_count_bucket")["users"].sum().reset_index()
    tx_dist = [
        {"tx_count_bucket": row["tx_count_bucket"], "users": int(row["users"]),
         "pct": round(int(row["users"]) / total * 100, 2) if total else 0}
        for _, row in tx_agg.iterrows()
    ]

    data = {
        "date": datetime.utcnow().strftime("%Y-%m-%d"),
        "total_analyzed": total,
        "cross_tab": cross_tab,
        "age_distribution": age_dist,
        "tx_distribution": tx_dist,
    }
    upsert_ga_aggregated("wallet_all_holders", data)

    return {
        "status": "ok",
        "total_analyzed": total,
        "cross_tab_cells": len(cross_tab),
    }


# ── API: GA Analytics ────────────────────────────────────────

@app.get("/api/ga/daily")
async def api_ga_daily(from_date: str | None = None, to_date: str | None = None):
    """Get GA daily overview metrics with optional date range."""
    from app.database import get_ga_daily
    data = get_ga_daily(from_date, to_date)
    # Extract just the overview metrics for the timeline
    timeline = []
    for d in data:
        ov = d.get("overview", {})
        if ov:
            date_val = ov.get("date", d.get("date", ""))
            # Normalize YYYYMMDD → YYYY-MM-DD
            if len(date_val) == 8 and "-" not in date_val:
                date_val = f"{date_val[:4]}-{date_val[4:6]}-{date_val[6:8]}"
            timeline.append({
                "date": date_val,
                "activeUsers": ov.get("activeUsers", 0),
                "newUsers": ov.get("newUsers", 0),
                "sessions": ov.get("sessions", 0),
                "pageviews": ov.get("screenPageViews", 0),
                "avgDuration": round(ov.get("averageSessionDuration", 0), 1),
                "bounceRate": round(ov.get("bounceRate", 0) * 100, 1) if isinstance(ov.get("bounceRate", 0), float) and ov.get("bounceRate", 0) < 1 else round(ov.get("bounceRate", 0), 1),
                "engagedSessions": ov.get("engagedSessions", 0),
            })
    return {"status": "ok", "count": len(timeline), "data": timeline}


@app.get("/api/ga/summary")
async def api_ga_summary():
    """Get latest GA summary with traffic, devices, countries."""
    from app.database import get_ga_aggregated, get_ga_daily

    agg = get_ga_aggregated("latest")
    if not agg:
        # Fallback: compute from daily docs
        from app.database import get_ga_latest
        latest = get_ga_latest()
        if not latest:
            return {"status": "ok", "data": None}
        all_ga = get_ga_daily()
        total_users = sum(d.get("overview", {}).get("activeUsers", 0) for d in all_ga)
        total_sessions = sum(d.get("overview", {}).get("sessions", 0) for d in all_ga)
        total_pageviews = sum(d.get("overview", {}).get("screenPageViews", 0) for d in all_ga)
        return {
            "status": "ok",
            "data": {
                "latest_date": latest.get("date"),
                "traffic_sources": latest.get("traffic_sources", []),
                "top_pages": latest.get("top_pages", []),
                "devices": latest.get("devices", []),
                "countries": latest.get("countries", []),
                "hourly": latest.get("hourly", []),
                "totals": {
                    "active_users": total_users,
                    "sessions": total_sessions,
                    "pageviews": total_pageviews,
                    "days_tracked": len(all_ga),
                },
            },
        }

    return {
        "status": "ok",
        "data": {
            "latest_date": agg.get("end_date"),
            "traffic_sources": agg.get("traffic_sources", []),
            "top_pages": agg.get("top_pages", []),
            "devices": agg.get("devices", []),
            "countries": agg.get("countries", []),
            "hourly": agg.get("hourly", []),
            "totals": agg.get("totals", {}),
        },
    }


@app.post("/api/sync/ga")
async def api_ga_sync(request: Request, date: str | None = None):
    """Trigger GA data sync."""
    _verify_sync_auth(request)
    try:
        from app.ga_sync import GASyncer
        ga = GASyncer()
        result = ga.sync_daily(target_date=date)
        return JSONResponse(result)
    except Exception as e:
        logger.error(f"GA sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync/ga-backfill")
async def api_ga_backfill(request: Request, days: int = 90):
    """Trigger GA historical backfill."""
    _verify_sync_auth(request)
    try:
        from app.ga_sync import GASyncer
        ga = GASyncer()
        result = ga.backfill(days=days)
        return JSONResponse(result)
    except Exception as e:
        logger.error(f"GA backfill failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Health ───────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

