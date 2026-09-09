import { describe, expect, it } from "vitest";
import { missionPage, missionViewHref } from "./mission-pagination";

describe("mission pagination", () => {
  it("keeps an accessible last page at the former 300-task cutoff", () => {
    expect(missionPage("4", 301, 100)).toEqual({ page: 4, pages: 4, offset: 300 });
  });
  it("clamps stale pages after the filter or data changes", () => {
    expect(missionPage("99", 1, 20)).toEqual({ page: 1, pages: 1, offset: 0 });
    expect(missionPage("2", 0, 20)).toEqual({ page: 1, pages: 1, offset: 0 });
    for (const invalid of ["-1", "1.5", "Infinity", "9007199254740993", "abc"]) {
      expect(missionPage(invalid, 400, 100).page).toBe(1);
    }
  });
  it("preserves explicit person/clan scopes but resets the page when switching views", () => {
    expect(missionViewHref(new URLSearchParams("scope=person&person=helena&page=3"), "informative"))
      .toBe("/tasks?scope=person&person=helena&view=informative");
    expect(missionViewHref(new URLSearchParams("view=informative&scope=clan&clan=fiscal&page=2"), "standalone"))
      .toBe("/tasks?scope=clan&clan=fiscal");
    expect(missionViewHref(new URLSearchParams(), "standalone")).toBe("/tasks");
  });
});
