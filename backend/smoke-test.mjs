import http from "node:http";
import { MongoMemoryServer } from "mongodb-memory-server";

const fakeChroma = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    const payload = body ? JSON.parse(body) : {};
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url.endsWith("/tenants/default_tenant")) {
      res.end(JSON.stringify({ name: "default_tenant" }));
      return;
    }
    if (
      req.method === "GET" &&
      req.url.endsWith("/databases/default_database")
    ) {
      res.end(
        JSON.stringify({ id: "fake-db-id", name: "default_database" })
      );
      return;
    }
    if (req.method === "POST" && req.url.endsWith("/collections")) {
      res.end(JSON.stringify({ id: "fake-col-id", name: payload.name || "reebot" }));
      return;
    }
    if (req.method === "GET" && req.url.includes("/collections/")) {
      const match = req.url.match(/\/collections\/([^/]+)/);
      const name = decodeURIComponent(match?.[1] || "");
      if (name) {
        res.end(JSON.stringify({ id: "fake-col-id", name }));
        return;
      }
    }
    if (req.url.includes("/query")) {
      res.end(
        JSON.stringify({
          ids: [["x1"]],
          documents: [["excerpt"]],
          metadatas: [[{ type: "pdf", name: "f.pdf", roomId: "r" }]],
          distances: [[0.1]],
        })
      );
      return;
    }
    if (req.url.includes("/delete")) {
      res.end("{}");
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
});
await new Promise((resolve) => fakeChroma.listen(0, "127.0.0.1", resolve));
const chromaPort = fakeChroma.address().port;

process.env.NODE_ENV = "test";
process.env.PORT = "3100";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "smoke-test-key";
process.env.CHROMA_URL = `http://127.0.0.1:${chromaPort}`;
process.env.JWT_SECRET = "smoke-test-secret";

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URL = mongod.getUri("reebot");

await import("./src/index.js");
await new Promise((resolve) => setTimeout(resolve, 1500));

const base = "http://localhost:3100";
let failures = 0;

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, data };
}

function check(label, condition, extra = "") {
  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL: ${label} ${extra}`);
  }
}

const health = await call("GET", "/health");
check("health reports mongo connected", health.status === 500 || (health.data.ok && health.data.mongo === true), JSON.stringify(health));

const noAuth = await call("GET", "/rooms");
check("rooms without token rejected", noAuth.status === 401, JSON.stringify(noAuth));

const badEmail = await call("POST", "/auth/signup", { name: "A", email: "nope", password: "Str0ng!Pass" });
check("signup rejects bad email", badEmail.status === 400, JSON.stringify(badEmail));

const shortPw = await call("POST", "/auth/signup", { name: "A", email: "a@x.com", password: "123" });
check("signup rejects short password", shortPw.status === 400, JSON.stringify(shortPw));

const weakPw = await call("POST", "/auth/signup", { name: "A", email: "a@x.com", password: "alllowercase1" });
check("signup rejects weak password (no upper/special)", weakPw.status === 400 && weakPw.data.error.startsWith("Password must"), JSON.stringify(weakPw));

const signupA = await call("POST", "/auth/signup", { name: "Ada", email: "ada@x.com", password: "Sup3r$ecret" });
check("signup returns token+user", signupA.status === 200 && signupA.data.token && signupA.data.user.name === "Ada", JSON.stringify(signupA));
const tokenA = signupA.data.token;

const dup = await call("POST", "/auth/signup", { name: "Ada2", email: "ada@x.com", password: "An0ther!Pass" });
check("duplicate email blocked", dup.status === 409, JSON.stringify(dup));

const badLogin = await call("POST", "/auth/login", { email: "ada@x.com", password: "wrongpass" });
check("wrong password rejected", badLogin.status === 401, JSON.stringify(badLogin));

const goodLogin = await call("POST", "/auth/login", { email: "ada@x.com", password: "Sup3r$ecret" });
check("login works", goodLogin.status === 200 && goodLogin.data.token, JSON.stringify(goodLogin));

const me = await call("GET", "/auth/me", undefined, tokenA);
check("auth/me returns user", me.status === 200 && me.data.user.email === "ada@x.com", JSON.stringify(me));

const longName = "x".repeat(41);
const longRoom = await call("POST", "/rooms", { name: longName }, tokenA);
check("room name over 40 chars rejected", longRoom.status === 400, JSON.stringify(longRoom));

const createRoom = await call("POST", "/rooms", { name: "Physics" }, tokenA);
check("create room scoped to user", createRoom.status === 200 && createRoom.data.room.name === "Physics", JSON.stringify(createRoom));
const roomIdA = createRoom.data.room.id;

// Verify that stored `content` is exposed as the frontend's `text` field.
const { Message } = await import("./src/models.js");
await Message.create({ roomId: roomIdA, role: "user", content: "Saved question" });
const roomDetails = await call("GET", `/rooms/${roomIdA}`, undefined, tokenA);
check(
  "room history returns saved message text",
  roomDetails.status === 200 && roomDetails.data.messages[0]?.text === "Saved question",
  JSON.stringify(roomDetails),
);

const listA = await call("GET", "/rooms", undefined, tokenA);
check("owner sees own room", listA.data.rooms.length === 1, JSON.stringify(listA));

const signupB = await call("POST", "/auth/signup", { name: "Bob", email: "bob@x.com", password: "B0bby!Pass" });
const tokenB = signupB.data.token;

const listB = await call("GET", "/rooms", undefined, tokenB);
check("other user sees zero rooms", listB.data.rooms.length === 0, JSON.stringify(listB));

const crossRead = await call("GET", `/rooms/${roomIdA}`, undefined, tokenB);
check("cross-user room read blocked", crossRead.status === 404, JSON.stringify(crossRead));

const chatNoAuth = await call("POST", "/chat", { query: "hi", roomId: roomIdA });
check("chat without token rejected", chatNoAuth.status === 401, JSON.stringify(chatNoAuth));

const chatEmpty = await call("POST", "/chat", { query: "hi", roomId: roomIdA }, tokenA);
check("empty-room chat streams hint", typeof chatEmpty.data === "string" && chatEmpty.data.includes("attach"), JSON.stringify(chatEmpty));

const delOther = await call("DELETE", `/rooms/${roomIdA}`, undefined, tokenB);
check("cross-user room delete blocked", delOther.status === 404, JSON.stringify(delOther));

const delOwn = await call("DELETE", `/rooms/${roomIdA}`, undefined, tokenA);
check("owner deletes own room", delOwn.status === 200 && delOwn.data.ok === true, JSON.stringify(delOwn));

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
fakeChroma.close();
await mongod.stop();
process.exit(failures === 0 ? 0 : 1);
