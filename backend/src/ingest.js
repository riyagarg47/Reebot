import { chromium } from "playwright";

// Intl.Segmenter handles sentence boundaries more reliably than splitting on
// periods, especially around punctuation, abbreviations, and Unicode text.
const sentenceSegmenter = new Intl.Segmenter(undefined, {
  granularity: "sentence",
});
const SENTENCE_END = /[.!?。！？](?:["'”’)}\]]+)?$/u;

function sentenceLength(sentences) {
  return sentences.reduce(
    (length, sentence) => length + sentence.length,
    Math.max(0, sentences.length - 1),
  );
}

function trailingSentences(sentences, maxLength) {
  const trailing = [];
  let length = 0;

  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index];
    const nextLength = length + sentence.length + (trailing.length ? 1 : 0);
    if (nextLength > maxLength) break;
    trailing.unshift(sentence);
    length = nextLength;
  }
  return trailing;
}

/**
 * Split plain text from URLs into sentence-safe, slightly overlapping chunks.
 * PDF Markdown uses markdownChunker.js instead so its structure is preserved.
 */
export function chunkText(text, size = 1000, overlap = 200) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (size <= 0 || overlap < 0) {
    throw new RangeError("Chunk size must be positive and overlap non-negative.");
  }

  const sentences = Array.from(sentenceSegmenter.segment(clean), ({ segment }) =>
    segment.trim(),
  )
    .filter(Boolean)
    .map((sentence) =>
      SENTENCE_END.test(sentence) ? sentence : `${sentence}.`,
    );

  const chunks = [];
  let current = [];

  for (const sentence of sentences) {
    const candidateLength = sentenceLength([...current, sentence]);
    if (current.length > 0 && candidateLength > size) {
      chunks.push(current.join(" "));

      // Repeating a few complete sentences gives retrieval useful context near
      // a chunk boundary without ever cutting a sentence in half.
      current = trailingSentences(current, overlap);

      // A long next sentence takes priority over overlap. Individual sentences
      // remain intact even when they are longer than the preferred chunk size.
      if (sentenceLength([...current, sentence]) > size) {
        current = [];
      }
    }
    current.push(sentence);
  }

  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}

export async function textFromUrl(url) {
  // A real browser captures rendered page text that a basic HTTP request may
  // miss on JavaScript-driven sites.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const text = await page.evaluate(() => document.body?.innerText || "");
    return text.replace(/\s+/g, " ").trim();
  } finally {
    // Always release the browser process, including navigation failures.
    await browser.close();
  }
}

/** Generate embeddings in the same order as the supplied text array. */
export async function embedTexts(openai, model, texts) {
  const response = await openai.embeddings.create({
    model,
    input: texts,
  });
  return response.data.map((item) => item.embedding);
}

export async function saveChunks(chroma, openai, model, chunks, metadata) {
  if (chunks.length === 0) {
    throw new Error("No text found to embed.");
  }

  const embeddings = await embedTexts(openai, model, chunks);
  const collection = await chroma.getOrCreateCollection({ name: "reebot" });
  await collection.add({
    // Every chunk needs its own stable identifier in Chroma. Source metadata is
    // duplicated so each search result can be filtered and attributed alone.
    ids: chunks.map(() => crypto.randomUUID()),
    embeddings,
    documents: chunks,
    metadatas: chunks.map(() => metadata),
  });
}
