// Lean entry rows (`lean=1`) carry ids only. Names and the fallback currency come from
// the clients/projects/activities the page already holds (archived ones included, so old
// entries keep their names), which also makes renames show up everywhere immediately.
export function buildMasterLookup({ customers = [], projects = [], activities = [], archivedCustomers = [], archivedProjects = [], archivedActivities = [] }) {
  const index = (lists) => new Map(lists.flat().map((item) => [item.id, item]));
  return {
    customers: index([customers, archivedCustomers]),
    projects: index([projects, archivedProjects]),
    activities: index([activities, archivedActivities]),
  };
}

export function enrichEntries(rows, lookup) {
  return rows.map((e) => {
    const customer = lookup.customers.get(e.customer_id);
    const project = lookup.projects.get(e.project_id);
    const activity = lookup.activities.get(e.activity_id);
    return {
      ...e,
      customer_name: e.customer_name ?? customer?.name ?? null,
      project_name: e.project_name ?? project?.name ?? null,
      activity_name: e.activity_name ?? activity?.name ?? null,
      currency: e.currency || customer?.currency || null,
    };
  });
}
