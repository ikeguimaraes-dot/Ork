import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("logout is POST-only and is never prefetched", () => {
 const source = readFileSync("lib/ork/ui/Sidebar.tsx", "utf8");
 assert.match(source, /<form action="\/auth\/sign-out" method="post">/);
 const route = readFileSync("src/app/auth/sign-out/route.ts", "utf8");
 assert.doesNotMatch(route.split("export function GET")[1], /auth\.signOut/);
});
