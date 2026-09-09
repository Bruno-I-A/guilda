export const MISSION_PAGE_SIZE = 100;
export const PACKAGE_PAGE_SIZE = 20;

export function missionPage(requested: string | undefined, total: number, size: number) {
  const pages = Math.max(1, Math.ceil(total / size));
  const parsed = Number(requested);
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, pages) : 1;
  return { page, pages, offset: (page - 1) * size };
}

/** Preserve explicit scope while switching view; pagination starts over. */
export function missionViewHref(filters: URLSearchParams, view: "standalone" | "informative") {
  const next = new URLSearchParams(filters);
  next.delete("page");
  next.delete("origin");
  if (view === "standalone") next.delete("view");
  else next.set("view", view);
  return next.size ? `/tasks?${next}` : "/tasks";
}
