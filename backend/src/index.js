import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { ChromaClient } from "chromadb";
import OpenAI from "openai";
import { chunkText, saveChunks, textFromUrl } from "./ingest.js";
import { chunkMarkdown } from "./markdownChunker.js";
import { streamAnswer } from "./chat.js";
import { connectDb } from "./db.js";
import { parsePdf } from "./pdfParser.js";
import { User, Room, Source, Message } from "./models.js";
import { signToken, publicUser, requireAuth } from "./auth.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
});

const port = process.env.PORT || 3001;
const mongoUrl = process.env.MONGODB_URL || "mongodb://localhost:27017/reebot";
const chromaUrl = process.env.CHROMA_URL || "http://localhost:8000";
const embeddingModel =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

const chatModel = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const chroma = new ChromaClient({ path: chromaUrl });

function isValidRoomId(value) {
  return typeof value === "string" && mongoose.isValidObjectId(value);
}

async function findOwnRoom(roomId, userId, res) {
  const room = await Room.findOne({ _id: roomId, userId }).lean();
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return null;
  }
  return room;
}

function streamText(res, text) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  res.write(text);
  res.end();
}

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const MAX_ROOM_NAME = 40;

const PASSWORD_RULES = [
  { re: /.{8,}/, msg: "be at least 8 characters long" },
  { re: /[A-Z]/, msg: "contain an uppercase letter" },
  { re: /[a-z]/, msg: "contain a lowercase letter" },
  { re: /[0-9]/, msg: "contain a number" },
  { re: /[^A-Za-z0-9]/, msg: "contain a special character (e.g. !@#$%)" },
];

function passwordProblem(password) {
  const failed = PASSWORD_RULES.find((rule) => !rule.re.test(password));
  return failed ? `Password must ${failed.msg}.` : null;
}

app.post("/auth/signup", async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    if (!name) {
      return res.status(400).json({ error: "Please enter your name." });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email." });
    }
    const pwProblem = passwordProblem(password);
    if (pwProblem) {
      return res.status(400).json({ error: pwProblem });
    }

    const existing = await User.findOne({ email }).lean();
    if (existing) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });

    res.json({ token: signToken(user._id), user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists." });
    }
    res.status(500).json({ error: error.message });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    res.json({ token: signToken(user._id), user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/auth/reset-password", async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email." });
    }
    const pwProblem = passwordProblem(password);
    if (pwProblem) {
      return res.status(400).json({ error: pwProblem });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "No account with that email." });
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).lean();
    if (!user) {
      return res.status(401).json({ error: "Account not found." });
    }
    res.json({ user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/health", async (_req, res) => {
  try {
    await chroma.heartbeat();
    res.json({
      ok: true,
      chroma: true,
      mongo: mongoose.connection.readyState === 1,
      chatModel,
      embeddingModel,
    });
  } catch (error) {
    res.status(500).json({ ok: false, chroma: false, error: error.message });
  }
});

app.get("/rooms", requireAuth, async (req, res) => {
  try {
    const rooms = await Room.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .lean();
    const roomIds = rooms.map((r) => r._id);
    const counts = await Source.aggregate([
      { $match: { roomId: { $in: roomIds } } },
      { $group: { _id: "$roomId", count: { $sum: 1 } } },
    ]);
    const byRoom = new Map(counts.map((c) => [String(c._id), c.count]));
    res.json({
      rooms: rooms.map((room) => ({
        id: room._id,
        name: room.name,
        createdAt: room.createdAt,
        sourceCount: byRoom.get(String(room._id)) || 0,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/rooms", requireAuth, async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Please enter a room name." });
    }
    if (name.length > MAX_ROOM_NAME) {
      return res.status(400).json({
        error: `Room name must be ${MAX_ROOM_NAME} characters or fewer.`,
      });
    }
    const room = await Room.create({ name, userId: req.userId });
    res.json({
      room: { id: room._id, name: room.name, sourceCount: 0 },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/rooms/:id", requireAuth, async (req, res) => {
  try {
    if (!isValidRoomId(req.params.id)) {
      return res.status(400).json({ error: "Invalid room id." });
    }

    const room = await findOwnRoom(req.params.id, req.userId, res);
    if (!room) return;

    const [sources, messages] = await Promise.all([
      Source.find({ roomId: room._id }).sort({ createdAt: 1 }).lean(),
      Message.find({ roomId: room._id })
        .sort({ _id: -1 })
        .limit(50)
        .lean()
        .then((list) => list.reverse()),
    ]);

    res.json({
      room: { id: room._id, name: room.name },
      sources: sources.map((s) => ({
        id: s.sourceId,
        type: s.type,
        name: s.name,
      })),
      messages: messages.map((m) => ({
        id: String(m._id),
        role: m.role,
        text: m.content,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/rooms/:id", requireAuth, async (req, res) => {
  try {
    if (!isValidRoomId(req.params.id)) {
      return res.status(400).json({ error: "Invalid room id." });
    }

    const room = await findOwnRoom(req.params.id, req.userId, res);
    if (!room) return;

    try {
      const collection = await chroma.getCollection({ name: "reebot" });
      await collection.delete({
        where: { roomId: { $eq: String(room._id) } },
      });
    } catch (error) {
      if (error.status !== 404) throw error;
    }

    await Promise.all([
      Source.deleteMany({ roomId: room._id }),
      Message.deleteMany({ roomId: room._id }),
      Room.deleteOne({ _id: room._id }),
    ]);

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/ingest", requireAuth, upload.array("pdfs", 20), async (req, res) => {
  try {
    const roomId = (req.body.roomId || "").trim();
    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: "roomId is required." });
    }
    const room = await findOwnRoom(roomId, req.userId, res);
    if (!room) return;

    const files = req.files || [];
    const url = (req.body.url || "").trim();

    if (files.length === 0 && !url) {
      return res.status(400).json({ error: "Add a PDF or a URL." });
    }

    const existingKeys = new Set(
      (await Source.find({ roomId: room._id }).select("name type").lean()).map(
        (s) =>
          s.type === "url"
            ? `url:${s.name.trim().replace(/\/+$/, "").toLowerCase()}`
            : `pdf:${s.name.toLowerCase()}`,
      ),
    );

    const saved = [];
    const duplicates = [];

    for (const file of files) {
      const key = `pdf:${file.originalname.toLowerCase()}`;
      if (existingKeys.has(key)) {
        duplicates.push(file.originalname);
        continue;
      }

      const sourceId = crypto.randomUUID();
      const started = Date.now();
      // Python extracts structured Markdown; JavaScript converts it into the
      // context-rich chunks stored in the vector database.
      const markdown = await parsePdf(file.buffer);
      const chunks = chunkMarkdown(markdown);
      const parsedChars = chunks.reduce(
        (total, chunk) => total + chunk.length,
        0,
      );
      console.log(
        `[ingest] ${file.originalname}: parsed ${parsedChars} chars → ${chunks.length} chunks in ${Date.now() - started}ms`,
      );
      const metadata = {
        type: "pdf",
        name: file.originalname,
        sourceId,
        roomId: String(room._id),
      };
      await saveChunks(chroma, openai, embeddingModel, chunks, metadata);
      await Source.create({
        roomId: room._id,
        sourceId,
        type: "pdf",
        name: file.originalname,
      });
      existingKeys.add(key);
      saved.push({
        sourceId,
        type: "pdf",
        name: file.originalname,
      });
    }

    if (url) {
      const key = `url:${url.replace(/\/+$/, "").toLowerCase()}`;
      if (existingKeys.has(key)) {
        duplicates.push(url);
      } else {
        const sourceId = crypto.randomUUID();
        const text = await textFromUrl(url);
        const chunks = chunkText(text);
        const metadata = {
          type: "url",
          name: url,
          sourceId,
          roomId: String(room._id),
        };
        await saveChunks(chroma, openai, embeddingModel, chunks, metadata);
        await Source.create({
          roomId: room._id,
          sourceId,
          type: "url",
          name: url,
        });
        existingKeys.add(key);
        saved.push({ sourceId, type: "url", name: url });
      }
    }

    res.json({ ok: true, saved, duplicates });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/ingest", requireAuth, async (req, res) => {
  try {
    const sourceId = (req.body.sourceId || "").trim();
    const roomId = (req.body.roomId || "").trim();

    if (!sourceId || !isValidRoomId(roomId)) {
      return res
        .status(400)
        .json({ error: "sourceId and roomId are required." });
    }

    const room = await findOwnRoom(roomId, req.userId, res);
    if (!room) return;

    try {
      const collection = await chroma.getCollection({ name: "reebot" });
      await collection.delete({
        where: {
          $and: [{ sourceId: { $eq: sourceId } }, { roomId: { $eq: roomId } }],
        },
      });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    await Source.deleteOne({ sourceId, roomId });

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/chat", requireAuth, async (req, res) => {
  try {
    const query = (req.body.query || "").trim();
    const roomId = (req.body.roomId || "").trim();

    if (!query) {
      return res.status(400).json({ error: "Enter a question." });
    }
    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: "roomId is required." });
    }
    const room = await findOwnRoom(roomId, req.userId, res);
    if (!room) return;

    const [historyDocs, sources] = await Promise.all([
      Message.find({ roomId: room._id }).sort({ _id: -1 }).limit(6).lean(),
      Source.find({ roomId: room._id })
        .select("sourceId type name -_id")
        .lean(),
    ]);
    const history = historyDocs
      .reverse()
      .map((m) => ({ role: m.role, content: m.content }));

    if (sources.length === 0) {
      streamText(
        res,
        "Please attach a PDF or a website first. I only answer from your sources.",
      );
      return;
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    let full = "";
    for await (const token of streamAnswer({
      chroma,
      openai,
      embeddingModel,
      chatModel,
      query,
      history,
      roomId: String(room._id),
      sources,
    })) {
      full += token;
      res.write(token);
    }
    res.end();

    if (full.trim()) {
      await Message.insertMany([
        { roomId: room._id, role: "user", content: query },
        { roomId: room._id, role: "assistant", content: full },
      ]);
    }
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

connectDb(mongoUrl)
  .then(() => {
    app.listen(port, () => {
      console.log(`Backend running on http://localhost:${port}`);
      console.log(`ChromaDB target: ${chromaUrl}`);
    });
  })
  .catch((error) => {
    console.error("Could not connect to MongoDB:", error.message);
    process.exit(1);
  });
