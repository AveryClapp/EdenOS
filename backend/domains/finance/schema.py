from dataclasses import dataclass, field


@dataclass
class FinancialSnapshot:
    """
    Eden's view of the user's financial state.

    Phase 1: all fields are None/empty — stubs only.
    Phase 2: populated from Manifold broker integrations (Coinbase, Schwab)
             and Plaid (banking, subscriptions, net worth).

    Eden never displays these numbers raw. It interprets them in context:
    - net_worth relative to goals and timeline
    - portfolio_delta_today relative to financial goals
    - upcoming_tax_events as actionable flags
    - subscription_burn_monthly surfaced only when excessive or surprising
    """
    net_worth: float | None = None
    portfolio_value: float | None = None
    portfolio_delta_today: float | None = None
    cash_balance: float | None = None
    cash_runway_months: float | None = None
    upcoming_tax_events: list[dict] = field(default_factory=list)
    subscription_burn_monthly: float | None = None
    alerts: list[dict] = field(default_factory=list)
