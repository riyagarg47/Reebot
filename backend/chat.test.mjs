import assert from "node:assert/strict";
import test from "node:test";
import { streamAnswer } from "./src/chat.js";

test("retrieval includes excerpts from every room source", async () => {
  const sources = [
    { sourceId: "source-a", type: "pdf", name: "alpha.pdf" },
    { sourceId: "source-b", type: "url", name: "https://example.com/beta" },
  ];
  const queries = [];
  let completionMessages;

  const collection = {
    async query(options) {
      queries.push(options);
      const sourceId = options.where?.$and?.[1]?.sourceId?.$eq;
      if (sourceId === "source-a") {
        return {
          documents: [["Alpha source summary"]],
          metadatas: [[sources[0]]],
        };
      }
      if (sourceId === "source-b") {
        return {
          documents: [["Beta source summary"]],
          metadatas: [[sources[1]]],
        };
      }
      return {
        documents: [["Alpha source summary"]],
        metadatas: [[sources[0]]],
      };
    },
  };
  const chroma = {
    async getOrCreateCollection() {
      return collection;
    },
  };
  const openai = {
    embeddings: {
      async create() {
        return { data: [{ embedding: [0.1, 0.2] }] };
      },
    },
    chat: {
      completions: {
        async create(options) {
          completionMessages = options.messages;
          return (async function* tokens() {
            yield { choices: [{ delta: { content: "Combined answer" } }] };
          })();
        },
      },
    },
  };

  let answer = "";
  for await (const token of streamAnswer({
    chroma,
    openai,
    embeddingModel: "embedding-model",
    chatModel: "chat-model",
    query: "What are these sources about?",
    roomId: "room-1",
    sources,
  })) {
    answer += token;
  }

  assert.equal(answer, "Combined answer");
  assert.equal(queries.length, 3, "one global query plus one per source");
  assert.deepEqual(queries[0].where.$and[1].sourceId.$in, [
    "source-a",
    "source-b",
  ]);
  const prompt = completionMessages[0].content;
  assert.match(prompt, /alpha\.pdf/);
  assert.match(prompt, /example\.com\/beta/);
  assert.match(prompt, /Alpha source summary/);
  assert.match(prompt, /Beta source summary/);
  assert.match(prompt, /Determine which room source or sources/);
  assert.match(prompt, /every room source/);
});
