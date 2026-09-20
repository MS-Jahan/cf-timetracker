import { useEffect } from "react";
import DetailPager from "../components/DetailPager.jsx";
import IdentityMark from "../components/IdentityMark.jsx";
import Ledger from "../components/Ledger.jsx";
import RankedBars from "../components/RankedBars.jsx";
import { getActivity } from "../lib/api.js";
import { formatDuration, formatMoney } from "../lib/format.js";
import { Link, navigate, useParams } from "../lib/router.jsx";
import { useDetailPage } from "../lib/useDetailPage.js";

const PAGE = 50;

/**
 * An activity spans clients with different currencies, so the headline total uses the
 * same dominant-currency rule as the ledger: the currency carrying the most billed
 * value in this activity's history.
 */
function dominantCurrency(rows) {
  const totals = {};
  for (const row of rows) totals[row.currency || "?"] = (totals[row.currency || "?"] || 0) + Number(row.total_cost || 0);
  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const best = ranked[0]?.[0];
  return best && best !== "?" ? best : rows[0]?.currency || null;
}

export default function ActivityDetailPage() {
  const match = useParams("/activities/:id");
  const id = match?.params.id;
  const { data, error, loading, offset, setOffset, reload } = useDetailPage(getActivity, id, { limit: PAGE });

  useEffect(() => {
    document.title = "Activity · Timetracker";
    return () => {
      document.title = "Timetracker";
    };
  }, []);

  if (error) {
    return (
      <section className="py-16">
        <h1 className="text-xl font-semibold">Activity unavailable</h1>
        <p className="ink-muted mt-2 max-w-[55ch]">The activity record could not be loaded.</p>
        <p className="figure mt-2 text-sm text-accent">{error}</p>
        <div className="mt-5 flex gap-2">
          <button className="btn btn-primary" onClick={reload}>Try again</button>
          <Link className="btn btn-ghost ring-1 ring-inset ring-base-300" to="/settings">Open settings</Link>
        </div>
      </section>
    );
  }

  const activity = data?.activity;
  const currency = data ? dominantCurrency(data.by_client) : null;
  const mixedCurrency = data ? new Set(data.by_client.map((row) => row.currency).filter(Boolean)).size > 1 : false;

  return (
    <div>
      <nav className="no-print pt-8 text-sm" aria-label="Breadcrumb">
        <Link className="ink-muted link" to="/settings">Settings</Link>
        <span className="ink-muted mx-2">/</span>
        <span>Activities</span>
      </nav>

      <header className="rule flex flex-wrap items-end justify-between gap-x-10 gap-y-4 py-6">
        <div className="flex items-center gap-3">
          <IdentityMark name={activity?.name} imageUrl={activity?.image_url} emoji={activity?.emoji} size="lg" />
          <div>
            <h1 className="text-2xl font-semibold">{activity ? activity.name : "Activity"}</h1>
          <p className="ink-muted mt-1 text-sm">
            {activity ? (mixedCurrency ? "Shared across clients; each client shows their own currency below." : "Shared across clients; amounts in the billing currency.") : "Loading…"}
            {activity?.archived_at ? <span className="ml-2 badge badge-ghost badge-sm">Archived</span> : null}
          </p>
          </div>
        </div>
        <dl className="flex items-end gap-8">
          <div>
            <dt className="field-label">Closed entries</dt>
            <dd className="figure text-xl font-medium leading-none">{activity ? data.totals.entry_count : "-"}</dd>
          </div>
          <div>
            <dt className="field-label">Hours</dt>
            <dd className="figure text-xl font-medium leading-none">{activity ? formatDuration(data.totals.total_seconds) : "-"}</dd>
          </div>
          <div>
            <dt className="field-label">Billed{mixedCurrency ? <span className="ml-1 text-xs ink-muted font-normal">mixed currencies</span> : null}</dt>
            <dd className="figure text-accent text-xl font-medium leading-none">
              {activity && currency ? formatMoney(data.totals.total_cost, currency) : activity ? "-" : "-"}
            </dd>
          </div>
        </dl>
      </header>

      {!data ? (
        <p className="ink-muted py-16"><span className="loading loading-spinner loading-sm" /> Loading activity…</p>
      ) : (
        <>
          <section className="rule py-7">
            <h2 className="text-lg font-semibold">Where the time went</h2>
            <p className="ink-muted mt-1 text-sm">By client, in each client's own currency.</p>
            <div className="mt-5 max-w-2xl">
              <RankedBars
                rows={data.by_client}
                valueKey="total_cost"
                money
                linkRows={(row) => row.customer_id && navigate(`/clients/${row.customer_id}`)}
              />
            </div>
          </section>

          <section className="pb-10">
            <h2 className="text-lg font-semibold">Time history</h2>
            <p className="ink-muted mt-1 text-sm">
              Recorded entries for this activity{data.paging.returned < data.totals.entry_count ? " (newest first)" : ""}.
            </p>
            <div className="mt-4">
              <Ledger entries={data.entries} scopeLabel={`Activity: ${activity?.name ?? ""}`} />
            </div>
            <DetailPager
              shown={data.entries.length}
              total={data.totals.entry_count}
              offset={offset}
              limit={PAGE}
              loading={loading}
              onNewer={() => setOffset(Math.max(0, offset - PAGE))}
              onOlder={() => setOffset(offset + PAGE)}
            />
          </section>
        </>
      )}
    </div>
  );
}
