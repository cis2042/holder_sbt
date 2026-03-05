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
    """Get the latest wallet age snapshot."""
    from app.database import get_latest_wallet_age
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

    if not DUNE_API_KEY:
        raise HTTPException(status_code=500, detail="DUNE_API_KEY not configured")

    from app.data_sync import DataSyncer
    syncer = DataSyncer(DUNE_API_KEY, TOKEN_CONTRACT, MINTER_ADDRESS, TIMEZONE)
    result = syncer.daily_sync(target_date=date)
    return JSONResponse(result)


# ── Health ───────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}
