import "server-only";
export function getShellBase(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  return new URL(value).origin;
}
export function getShellLoginUrl(returnTo: string): URL {
  const url = new URL("/login", getShellBase());
  url.searchParams.set("next", returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\") ? returnTo : "/financeiro");
  return url;
}
