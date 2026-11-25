import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

const ACTIONS = readFileSync(
  path.resolve(
    process.cwd(),
    "src/app/(app)/clans/[id]/company-flow-actions.ts",
  ),
  "utf8",
);

test("Fluxo avisa uma vez pela missão, sem broadcast paralelo de novo cliente", () => {
  expect(ACTIONS).toContain("const missao = await createTaskRecord");
  expect(ACTIONS).toContain("const missaoInformativo = await createTaskRecord");
  expect(ACTIONS).not.toContain("enqueueMemberNewClientNotifications");
});
