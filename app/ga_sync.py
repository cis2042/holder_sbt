"""
Google Analytics 4 data sync module.

Fetches GA4 metrics using the Data API and stores in Firestore.
Property ID: 481423287
"""

import json
import logging
import os
from datetime import datetime, timedelta

from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange,
    Dimension,
    Metric,
    RunReportRequest,
    OrderBy,
)
from google.oauth2 import service_account

logger = logging.getLogger(__name__)

GA_PROPERTY_ID = os.getenv("GA_PROPERTY_ID", "481423287")


def _get_ga_client() -> BetaAnalyticsDataClient:
    """Build GA4 client from service account credentials."""
    import base64

    creds_json = os.getenv("GA_CREDENTIALS_JSON", "")
    creds_b64 = os.getenv("GA_CREDENTIALS_B64", "")

    if creds_b64:
        creds_json = base64.b64decode(creds_b64).decode("utf-8")

    if not creds_json:
        # Try loading from file path
        creds_path = os.getenv("GA_CREDENTIALS_PATH", "")
        if creds_path and os.path.exists(creds_path):
            creds = service_account.Credentials.from_service_account_file(
                creds_path,
                scopes=["https://www.googleapis.com/auth/analytics.readonly"],
            )
        else:
            raise ValueError("GA_CREDENTIALS_JSON, GA_CREDENTIALS_B64, or GA_CREDENTIALS_PATH must be set")
    else:
        info = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(
            info,
            scopes=["https://www.googleapis.com/auth/analytics.readonly"],
        )
    return BetaAnalyticsDataClient(credentials=creds)


def _run_report(client, dimensions: list[str], metrics: list[str],
                start_date: str, end_date: str,
                order_by_metric: str | None = None,
                limit: int = 0) -> list[dict]:
    """Run a GA4 report and return rows as dicts."""
    request = RunReportRequest(
        property=f"properties/{GA_PROPERTY_ID}",
        dimensions=[Dimension(name=d) for d in dimensions],
        metrics=[Metric(name=m) for m in metrics],
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
    )
    if order_by_metric:
        request.order_bys = [OrderBy(
            metric=OrderBy.MetricOrderBy(metric_name=order_by_metric),
            desc=True,
        )]
    if limit > 0:
        request.limit = limit

    response = client.run_report(request)
    rows = []
    for row in response.rows:
        r = {}
        for i, dim in enumerate(dimensions):
            r[dim] = row.dimension_values[i].value
        for i, met in enumerate(metrics):
            val = row.metric_values[i].value
            # Try to parse as number
            try:
                r[met] = int(val)
            except ValueError:
                try:
                    r[met] = float(val)
                except ValueError:
                    r[met] = val
        rows.append(r)
    return rows


class GASyncer:
    """Syncs GA4 data to Firestore."""

    def __init__(self):
        self.client = _get_ga_client()

    def fetch_daily_overview(self, start_date: str, end_date: str) -> list[dict]:
        """Fetch daily overview metrics."""
        logger.info(f"Fetching GA daily overview {start_date} → {end_date}")
        return _run_report(
            self.client,
            dimensions=["date"],
            metrics=[
                "activeUsers", "newUsers", "sessions",
                "screenPageViews", "averageSessionDuration",
                "bounceRate", "engagedSessions",
                "userEngagementDuration",
            ],
            start_date=start_date,
            end_date=end_date,
        )

    def fetch_traffic_sources(self, start_date: str, end_date: str) -> list[dict]:
        """Fetch traffic source breakdown."""
        logger.info(f"Fetching GA traffic sources {start_date} → {end_date}")
        return _run_report(
            self.client,
            dimensions=["sessionDefaultChannelGroup"],
            metrics=["sessions", "activeUsers", "newUsers", "bounceRate"],
            start_date=start_date,
            end_date=end_date,
            order_by_metric="sessions",
            limit=10,
        )

    def fetch_top_pages(self, start_date: str, end_date: str) -> list[dict]:
        """Fetch top pages."""
        logger.info(f"Fetching GA top pages {start_date} → {end_date}")
        return _run_report(
            self.client,
            dimensions=["pagePath"],
            metrics=["screenPageViews", "activeUsers", "averageSessionDuration"],
            start_date=start_date,
            end_date=end_date,
            order_by_metric="screenPageViews",
            limit=10,
        )

    def fetch_devices(self, start_date: str, end_date: str) -> list[dict]:
        """Fetch device category breakdown."""
        logger.info(f"Fetching GA device breakdown {start_date} → {end_date}")
        return _run_report(
            self.client,
            dimensions=["deviceCategory"],
            metrics=["sessions", "activeUsers"],
            start_date=start_date,
            end_date=end_date,
            order_by_metric="sessions",
        )

    def fetch_countries(self, start_date: str, end_date: str, limit: int = 250) -> list[dict]:
        """Fetch country breakdown."""
        logger.info(f"Fetching GA country breakdown {start_date} → {end_date}")
        return _run_report(
            self.client,
            dimensions=["country"],
            metrics=["activeUsers", "sessions"],
            start_date=start_date,
            end_date=end_date,
            order_by_metric="activeUsers",
            limit=limit,
        )

    def fetch_hourly_pattern(self, start_date: str, end_date: str) -> list[dict]:
        """Fetch hourly engagement pattern."""
        logger.info(f"Fetching GA hourly pattern {start_date} → {end_date}")
        return _run_report(
            self.client,
            dimensions=["hour"],
            metrics=["activeUsers", "sessions"],
            start_date=start_date,
            end_date=end_date,
        )

    def sync_daily(self, target_date: str | None = None) -> dict:
        """Sync one day's GA data to Firestore."""
        from app.database import upsert_ga_daily

        if not target_date:
            target_date = datetime.utcnow().strftime("%Y-%m-%d")

        # Fetch all dimensions for this date
        overview = self.fetch_daily_overview(target_date, target_date)
        traffic = self.fetch_traffic_sources(target_date, target_date)
        pages = self.fetch_top_pages(target_date, target_date)
        devices = self.fetch_devices(target_date, target_date)
        countries = self.fetch_countries(target_date, target_date)
        hourly = self.fetch_hourly_pattern(target_date, target_date)

        # Extract overview metrics (single row for one day)
        metrics = overview[0] if overview else {}

        data = {
            "overview": metrics,
            "traffic_sources": traffic,
            "top_pages": pages,
            "devices": devices,
            "countries": countries,
            "hourly": hourly,
        }

        upsert_ga_daily(target_date, data)

        logger.info(f"GA sync complete for {target_date}: "
                     f"{metrics.get('activeUsers', 0)} active users, "
                     f"{metrics.get('sessions', 0)} sessions")
        return {
            "status": "ok",
            "date": target_date,
            "active_users": metrics.get("activeUsers", 0),
            "sessions": metrics.get("sessions", 0),
            "pageviews": metrics.get("screenPageViews", 0),
        }

    def backfill(self, days: int = 90) -> dict:
        """Backfill GA data for the last N days."""
        from app.database import upsert_ga_daily, upsert_ga_aggregated

        end = datetime.utcnow().date()
        start = end - timedelta(days=days - 1)
        start_str = start.strftime("%Y-%m-%d")
        end_str = end.strftime("%Y-%m-%d")

        # Fetch daily overview for full range
        overview_rows = self.fetch_daily_overview(start_str, end_str)

        # Index by date
        overview_by_date = {}
        for row in overview_rows:
            d = row.get("date", "")
            if len(d) == 8:
                d = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
            overview_by_date[d] = row

        # Save daily overviews (overview only, no breakdowns)
        for date_str, metrics in overview_by_date.items():
            upsert_ga_daily(date_str, {"overview": metrics})

        # Fetch full-range aggregated breakdowns
        traffic = self.fetch_traffic_sources(start_str, end_str)
        devices = self.fetch_devices(start_str, end_str)
        countries = self.fetch_countries(start_str, end_str, limit=250)
        hourly = self.fetch_hourly_pattern(start_str, end_str)
        pages = self.fetch_top_pages(start_str, end_str)

        # Compute engagement metrics from daily data
        total_users = sum(
            r.get("activeUsers", 0) for r in overview_by_date.values())
        total_sessions = sum(
            r.get("sessions", 0) for r in overview_by_date.values())
        total_pageviews = sum(
            r.get("screenPageViews", 0) for r in overview_by_date.values())
        total_new_users = sum(
            r.get("newUsers", 0) for r in overview_by_date.values())
        total_engaged_sessions = sum(
            r.get("engagedSessions", 0) for r in overview_by_date.values())
        total_engagement_secs = sum(
            r.get("userEngagementDuration", 0) for r in overview_by_date.values())

        # Weighted average session duration (seconds)
        avg_session_duration = (total_engagement_secs / total_sessions
                                if total_sessions else 0)
        # Engagement rate = engaged sessions / total sessions
        engagement_rate = (total_engaged_sessions / total_sessions * 100
                          if total_sessions else 0)
        # Pages per session
        pages_per_session = (total_pageviews / total_sessions
                             if total_sessions else 0)

        # Store aggregated data in dedicated collection
        agg_data = {
            "start_date": start_str,
            "end_date": end_str,
            "days": len(overview_by_date),
            "traffic_sources": traffic,
            "top_pages": pages,
            "devices": devices,
            "countries": countries,
            "hourly": hourly,
            "totals": {
                "active_users": total_users,
                "sessions": total_sessions,
                "pageviews": total_pageviews,
                "new_users": total_new_users,
                "engaged_sessions": total_engaged_sessions,
                "engagement_rate": round(engagement_rate, 1),
                "avg_session_duration": round(avg_session_duration, 1),
                "pages_per_session": round(pages_per_session, 2),
                "countries_count": len(countries),
                "total_engagement_hours": round(total_engagement_secs / 3600, 1),
                "days_tracked": len(overview_by_date),
            },
        }
        upsert_ga_aggregated("latest", agg_data)

        logger.info(f"GA backfill complete: {len(overview_by_date)} days, "
                     f"{len(countries)} countries")
        return {
            "status": "ok",
            "days": len(overview_by_date),
            "countries": len(countries),
            "range": f"{start} → {end}",
        }
