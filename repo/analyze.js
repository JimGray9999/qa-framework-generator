import { buildDigest, digestToPrompt } from "./digest.js";
import { runRepoAnalyst } from "../agents/repoAnalyst.js";
import { agentError } from "../agents/catalog.js";

// Archive bytes in, validated repository analysis out. Everything is in memory.
export async function analyzeRepoBuffer({ buffer, name, generate, provider, apiKey, onEvent }) {
  const digest = buildDigest(buffer, { name });
  if (!digest.sample.length) {
    throw agentError("No readable source files were found in that archive (it may be empty, or contain only binaries and ignored folders).");
  }
  const repoContext = await runRepoAnalyst({
    digestText: digestToPrompt(digest),
    allowedSelectors: digest.selectors.map((s) => s.selector),
    name,
    generate,
    provider,
    apiKey,
    onEvent,
  });
  const s = digest.stats;
  return {
    repoContext,
    info: {
      name,
      stack: digest.stack,
      filesTotal: s.totalFiles,
      filesAnalysed: s.totalFiles - s.ignored - s.secretFilesSkipped - s.notText - s.tooLarge,
      routes: digest.routes.length,
      selectors: digest.selectors.length,
      secretFilesSkipped: s.secretFilesSkipped,
      redactions: s.redactions,
    },
  };
}
