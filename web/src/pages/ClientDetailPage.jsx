import { useEffect } from "react";
import CurrencySelect from "../components/CurrencySelect.jsx";
import DetailPager from "../components/DetailPager.jsx";
import IdentityMark from "../components/IdentityMark.jsx";
import Ledger from "../components/Ledger.jsx";
import { getClient } from "../lib/api.js";
import { currencyHint, currencySymbol } from "../lib/currencies.js";
import { formatDuration, formatMoney } from "../lib/format.js";
import { Link, useParams } from "../lib/router.jsx";
import { useDetailPage } from "../lib/useDetailPage.js";

const PAGE = 50;

function ClientProjects({ projects, currency }) {
  const symbol = currencySymbol(currency);
  return (
    <table className="table table-sm min-w-[34rem]">
      <thead>
        <tr className="border-b border-base-300 text-left text-sm font-medium ink-muted">
          <th className="font-medium">Project</th>
          <th className="font-medium">Budget</th>
          <th className="text-right font-medium">Rate</th>
        </tr>
      </thead>
      <tbody>
        {projects.length === 0 ? (
          <tr>
            <td colSpan={3} className="ink-muted py-6">
              No projects yet — add one in <Link className="link" to="/settings">Settings</Link>.
            </td>
          </tr>
        ) : (
          projects.map((p) => (
            <tr key={p.id} className="border-b border-base-300">
              <td><Link className="link link-hover" to={`/projects/${p.id}`}>{p.name}</Link></td>
              <td className="ink-muted text-sm capitalize">{p.budget_type || "hourly"}</td>
              <td className="figure text-right">
                {p.rate > 0 ? (
                  `${formatMoney(p.rate, currency)}/h`
                ) : (
                  <span className="ink-muted">falls back to client rate</span>
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

export default function ClientDetailPage() {
  const match = useParams("/clients/:id");
  const id = match?.params.id;
  const { data, error, loading, offset, setOffset, reload } = useDetailPage(getClient, id, { limit: PAGE });

  useEffect(() => {
    document.title = "Client · Timetracker";
    return () => {
      document.title = "Timetracker";
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getClient(id, { limit: PAGE, offset }).then((payload) => {
      if (!cancelled) {
        setData(payload);
        setLoading(false);
      }
    }).catch((err) => {
      if (!cancelled) {
        setError(err.message);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, offset]);

  if (error) {
    return (
      <section className="py-16">
        <h1 className="text-xl font-semibold">Client unavailable</h1>
        <p className="ink-muted mt-2 max-w-[55ch]">The client record could not be loaded.</p>
        <p className="figure mt-2 text-sm text-accent">{error}</p>
        <div className="mt-5 flex gap-2">
          <button className="btn btn-primary" onClick={reload}>Try again</button>
          <Link className="btn btn-ghost ring-1 ring-inset ring-base-300" to="/settings">Open settings</Link>
        </div>
      </section>
    );
  }

  const customer = data?.customer;
  const currency = customer?.currency || "USD";

  return (
    <div>
      <nav className="no-print pt-8 text-sm" aria-label="Breadcrumb">
        <Link className="ink-muted link" to="/settings">Settings</Link>
        <span className="ink-muted mx-2">/</span>
        <span>Clients</span>
      </nav>

      <header className="rule flex flex-wrap items-end justify-between gap-x-10 gap-y-4 py-6">
        <div className="flex items-center gap-3">
          <IdentityMark name={customer?.name} imageUrl={customer?.image_url} size="lg" />
          <div>
            <h1 className="text-2xl font-semibold">{customer ? customer.name : "Client"}</h1>
          <p className="ink-muted mt-1 text-sm">
            {customer ? currencyHint(customer.currency) : "Loading…"}
            {customer?.archived_at ? <span className="ml-2 badge badge-ghost badge-sm">Archived</span> : null}
          </p>
          </div>
        </div>
        <dl className="flex items-end gap-8">
          <div>
            <dt className="field-label">Closed entries</dt>
            <dd className="figure text-xl font-medium leading-none">{customer ? data.totals.entry_count : "—"}</dd>
          </div>
          <div>
            <dt className="field-label">Hours</dt>
            <dd className="figure text-xl font-medium leading-none">{customer ? formatDuration(data.totals.total_seconds) : "—"}</dd>
          </div>
          <div>
            <dt className="field-label">Billed</dt>
            <dd className="figure text-accent text-xl font-medium leading-none">
              {customer ? formatMoney(data.totals.total_cost, currency) : "—"}
            </dd>
          </div>
        </dl>
      </header>

      {!data ? (
        <p className="ink-muted py-16"><span className="loading loading-spinner loading-sm" /> Loading client…</p>
      ) : (
        <>
          <section className="rule py-7">
            <h2 className="text-lg font-semibold">Projects</h2>
            <p className="ink-muted mt-1 text-sm">A project rate overrides the client rate; the client rate is the fallback.</p>
            <div className="mt-5 overflow-x-auto">
              <ClientProjects projects={data.projects} currency={currency} />
            </div>
          </section>

          <section className="pb-10">
            <h2 className="text-lg font-semibold">Time history</h2>
            <p className="ink-muted mt-1 text-sm">
              This client's recorded entries{data.paging.returned < data.totals.entry_count ? " (newest first)" : ""}.
            </p>
            <div className="mt-4">
              <Ledger entries={data.entries} scopeLabel={`Client: ${customer?.name ?? ""}`} />
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
