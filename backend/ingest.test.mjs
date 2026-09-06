import assert from "node:assert/strict";
import test from "node:test";
import { chunkText } from "./src/ingest.js";

const COMPLETE_SENTENCE_END = /[.!?。！？](?:["'”’)}\]]+)?$/u;

test("chunks start and end only at sentence boundaries", () => {
  const sentences = [
    "The first sentence introduces the topic.",
    "The second sentence adds useful supporting detail.",
    "Does the third sentence remain complete?",
    "The fourth sentence does!",
  ];
  const chunks = chunkText(sentences.join(" "), 75, 25);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.match(chunk, COMPLETE_SENTENCE_END);
    assert.ok(
      sentences.some((sentence) => chunk.startsWith(sentence)),
      `Chunk starts mid-sentence: ${chunk}`,
    );
  }
});

test("a long sentence remains intact instead of being split", () => {
  const sentence = `${"A deliberately long sentence ".repeat(10).trim()}.`;
  assert.deepEqual(chunkText(sentence, 50, 10), [sentence]);
});

test("a trailing text fragment is made into a complete sentence", () => {
  assert.deepEqual(chunkText("A complete sentence. A trailing fragment"), [
    "A complete sentence. A trailing fragment.",
  ]);
});
