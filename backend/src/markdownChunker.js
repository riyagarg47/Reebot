// Markdown produced by PyMuPDF4LLM is already structured. This chunker keeps
// that structure intact instead of flattening the document into plain text.

// Matches Markdown headings containing one to six `#` characters.
// Matches: "# Introduction", "### Installation", "###### Notes"
// Does not match: "Introduction", "#Missing space", "####### Too deep"
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/u;

// Matches the beginning of unordered and numbered Markdown list items.
// Matches: "- First item", "  * Nested item", "+ Item", "12. Item"
// Does not match: "12.Item" or an ordinary paragraph.
const LIST_RE = /^\s*(?:[-*+] |\d+\. )/u;

// Finds complete sentences globally and keeps any final unpunctuated fragment.
// Input: "First sentence. Is this second? Final fragment"
// Matches: ["First sentence.", "Is this second?", "Final fragment"]
// It also recognizes Unicode endings such as "完成。" and "真的嗎？".
const SENTENCE_RE = /.*?[.!?。！？](?:["'”’)}\]]+)?(?=\s|$)|.+$/gsu;

// Checks whether text ends in sentence punctuation, optionally followed by a quote/bracket.
// Matches endings: "Done.", "Ready?\"", "完成。"
// Does not match: "This is unfinished"
const SENTENCE_END_RE = /[.!?。！？](?:["'”’)}\]]+)?$/u;

/**
 * Group Markdown under its complete heading hierarchy.
 *
 * Input:
 *   "# Guide\nIntro.\n## Setup\nInstall it."
 * Output:
 *   [
 *     { headingPath: ["# Guide"], body: "Intro." },
 *     { headingPath: ["# Guide", "## Setup"], body: "Install it." }
 *   ]
 */
function splitSections(markdown) {
  const sections = [];
  let headingPath = [];
  let currentPath = [];
  let content = [];

  // Input: the currentPath and content held by splitSections.
  // Output: appends a completed section to `sections`; returns nothing.
  function flush() {
    const body = content.join("\n").trim();
    if (body) sections.push({ headingPath: [...currentPath], body });
  }

  for (const line of markdown.split(/\r?\n/u)) {
    const match = line.match(HEADING_RE);
    if (!match) {
      content.push(line);
      continue;
    }

    flush();
    content = [];
    const level = match[1].length;

    // Keep the complete heading path, such as H1 > H2 > H3. The path is
    // repeated in every chunk so retrieval always knows where the text came from.
    headingPath = headingPath.slice(0, level - 1);
    headingPath.push(line.trim());
    currentPath = [...headingPath];
  }

  flush();
  return sections;
}

/**
 * Split a section body at blank lines while preserving fenced code blocks.
 *
 * Input:  "First paragraph.\n\nSecond paragraph."
 * Output: ["First paragraph.", "Second paragraph."]
 *
 * Input:  "```js\nconst x = 1;\n\nreturn x;\n```"
 * Output: ["```js\nconst x = 1;\n\nreturn x;\n```"]
 */
function splitBlocks(body) {
  const blocks = [];
  let current = [];
  let fence = null;

  for (const line of body.split(/\r?\n/u)) {
    const stripped = line.trim();
    if (stripped.startsWith("```") || stripped.startsWith("~~~")) {
      // Blank lines inside fenced code belong to the code block and must not
      // create a new Markdown block.
      const marker = stripped.slice(0, 3);
      fence = fence === marker ? null : marker;
      current.push(line);
    } else if (!stripped && fence === null) {
      if (current.length) {
        blocks.push(current.join("\n").trim());
        current = [];
      }
    } else {
      current.push(line);
    }
  }

  if (current.length) blocks.push(current.join("\n").trim());
  return blocks;
}

/**
 * Identify Markdown structures that must be kept as one unit.
 *
 * Input:  "- First item\n- Second item"
 * Output: true
 *
 * Input:  "This is an ordinary paragraph."
 * Output: false
 */
function isAtomicMarkdown(block) {
  const lines = block.split(/\r?\n/u);
  const isTable =
    lines.length > 1 &&
    lines.every((line) => !line.trim() || line.trimStart().startsWith("|"));
  const start = block.trimStart();

  // These structures lose meaning when split across chunks. An atomic block
  // may therefore exceed the preferred size limit in unusual documents.
  return (
    isTable ||
    ["```", "~~~", "<!--", ">"].some((marker) => start.startsWith(marker)) ||
    LIST_RE.test(block)
  );
}

/**
 * Divide oversized prose at complete sentence boundaries.
 *
 * Input:  splitProse("One. Two. Three.", 10)
 * Output: ["One. Two.", "Three."]
 *
 * Atomic Markdown and prose already within maxChars are returned unchanged.
 */
function splitProse(block, maxChars) {
  // Only oversized prose is split. Tables, lists, quotes, figures, and code
  // remain whole even when they are large.
  if (block.length <= maxChars || isAtomicMarkdown(block)) return [block];

  const normalized = block.replace(/\s+/gu, " ").trim();
  const sentences = Array.from(normalized.matchAll(SENTENCE_RE), ([text]) =>
    text.trim(),
  );
  if (sentences.length && !SENTENCE_END_RE.test(sentences.at(-1))) {
    // Match the application's rule that every prose chunk ends with a complete
    // sentence, including imperfect text extracted from a PDF.
    sentences[sentences.length - 1] += ".";
  }

  const pieces = [];
  let current = [];
  for (const sentence of sentences) {
    const candidate = [...current, sentence].join(" ");
    if (current.length && candidate.length > maxChars) {
      pieces.push(current.join(" "));
      current = [];
    }
    current.push(sentence);
  }

  if (current.length) pieces.push(current.join(" "));
  return pieces.length ? pieces : [block];
}

/**
 * Combine heading context and content blocks into the stored chunk text.
 *
 * Input:  renderChunk(["# Guide", "## Setup"], ["Install it."])
 * Output: "# Guide\n\n## Setup\n\nInstall it."
 */
function renderChunk(headingPath, blocks) {
  return [...headingPath, ...blocks].filter(Boolean).join("\n\n").trim();
}

/**
 * Split PyMuPDF4LLM Markdown into retrieval-ready chunks.
 *
 * The size is measured in JavaScript characters, not words or model tokens.
 * Heading context counts toward the limit because it is stored in every chunk.
 *
 * Input:
 *   chunkMarkdown("# Guide\nIntro.\n## Setup\nInstall it.")
 * Output:
 *   [
 *     "# Guide\n\nIntro.",
 *     "# Guide\n\n## Setup\n\nInstall it."
 *   ]
 */
export function chunkMarkdown(markdown, maxChars = 3000) {
  const chunks = [];

  for (const { headingPath, body } of splitSections(markdown)) {
    const prefixLength = headingPath.join("\n").length;
    const contentLimit = Math.max(200, maxChars - prefixLength - 2);
    let current = [];

    for (const block of splitBlocks(body)) {
      for (const piece of splitProse(block, contentLimit)) {
        const candidate = renderChunk(headingPath, [...current, piece]);

        // Flush before adding a block that would cross the preferred limit.
        // The new chunk receives the same heading path through renderChunk().
        if (current.length && candidate.length > maxChars) {
          chunks.push(renderChunk(headingPath, current));
          current = [];
        }
        current.push(piece);
      }
    }

    if (current.length) chunks.push(renderChunk(headingPath, current));
  }

  return chunks;
}
