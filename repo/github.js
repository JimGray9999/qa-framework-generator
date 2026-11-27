import { agentError } from "../agents/catalog.js";

// Fetch a PUBLIC GitHub repository as a zip, without credentials.
//
// The server only ever talks to two fixed GitHub hosts. A user-supplied URL is parsed into
// {owner, repo, ref} and the download URL is built from those validated parts, so the input
// can never steer a request to another host. Redirects are followed manually and every hop
// is checked against the allow-list (api.github.com redirects zipball requests to
// codeload.github.com). Size and time are capped.

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9._\/-]{1,200}$/;
const ALLOWED_HOSTS = new Set(["api.github.com", "codeload.github.com"]);

export function parseGitHubUrl(input) {
  let url;
  try {
    url = new URL(String(input || "").trim());
  } catch {
    throw agentError("Enter a GitHub repository URL like https://github.com/owner/repo.");
  }
  if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname) || url.username || url.password || url.port) {
    throw agentError("Only public https://github.com/owner/repo URLs are supported.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw agentError("Enter a GitHub repository URL like https://github.com/owner/repo.");
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === "." || repo === "..") {
    throw agentError("That does not look like a valid GitHub owner/repository name.");
  }
  let ref = "";
  if (parts[2] === "tree" && parts.length > 3) {
    ref = parts.slice(3).join("/");
    if (!REF_RE.test(ref) || ref.split("/").some((s) => s === ".." || s === ".")) {
      throw agentError("That branch or tag name is not supported. Use the repository root URL instead.");
    }
  }
  return { owner, repo, ref };
}

export async function downloadGitHubZip(
  { owner, repo, ref },
  { fetchFn = fetch, maxBytes = 25 * 1024 * 1024, timeoutMs = 60_000, maxRedirects = 4 } = {}
) {
  let url = `https://api.github.com/repos/${owner}/${repo}/zipball${ref ? "/" + ref.split("/").map(encodeURIComponent).join("/") : ""}`;
  const signal = AbortSignal.timeout(timeoutMs);
  let res;
  for (let hop = 0; ; hop++) {
    let u;
    try { u = new URL(url); } catch { throw agentError("GitHub returned an invalid redirect."); }
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname) || u.port) {
      throw agentError("GitHub redirected to an unexpected host; the download was blocked.");
    }
    try {
      res = await fetchFn(u.toString(), {
        redirect: "manual",
        signal,
        headers: { "User-Agent": "qa-framework-generator", Accept: "application/vnd.github+json" },
      });
    } catch (err) {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") throw agentError("Downloading the repository timed out.");
      throw agentError("Could not reach GitHub. Check your connection and try again.");
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      if (hop >= maxRedirects) throw agentError("GitHub redirected too many times.");
      const loc = res.headers.get("location");
      if (!loc) throw agentError("GitHub returned a redirect without a location.");
      url = new URL(loc, u).toString();
      continue;
    }
    break;
  }
  if (res.status === 404) throw agentError("Repository (or branch) not found, or it is not public.");
  if (res.status === 403 || res.status === 429) throw agentError("GitHub refused the request (probably its anonymous rate limit). Try again later, or upload a zip instead.");
  if (!res.ok) throw agentError(`GitHub returned an unexpected response (${res.status}).`);

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw agentError(`The repository download is too large (over ${Math.round(maxBytes / 1048576)} MB). Upload a trimmed zip instead.`);
  }
  const chunks = [];
  let total = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw agentError(`The repository download is too large (over ${Math.round(maxBytes / 1048576)} MB). Upload a trimmed zip instead.`);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    if (err?.expose) throw err;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw agentError("Downloading the repository timed out.");
    throw agentError("The repository download was interrupted.");
  }
  return Buffer.concat(chunks);
}
