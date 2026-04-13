from sqlalchemy.orm import Session

from backend.domains.finance.schema import FinancialSnapshot


def build_financial_snapshot(db: Session) -> dict:
    """
    Returns the financial snapshot for the AI context snapshot.

    Phase 1: returns stub values (all None/empty).
    Phase 2: pulls real data from Manifold broker integrations
             (Coinbase, Schwab) and Plaid (banking, subscriptions).

    The AI uses this data to reason across domains — e.g. tax events
    relative to upcoming deadlines, cash runway relative to career goals.
    Raw numbers are never surfaced directly; Eden interprets them.
    """
    snapshot = FinancialSnapshot()

    return {
        "net_worth": snapshot.net_worth,
        "portfolio_value": snapshot.portfolio_value,
        "portfolio_delta_today": snapshot.portfolio_delta_today,
        "cash_balance": snapshot.cash_balance,
        "cash_runway_months": snapshot.cash_runway_months,
        "upcoming_tax_events": snapshot.upcoming_tax_events,
        "subscription_burn_monthly": snapshot.subscription_burn_monthly,
        "alerts": snapshot.alerts,
    }
