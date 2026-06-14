const express = require("express");
const http = require("http");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const { saveMessage, getMessages,deleteRoomMessages } = require("./db/messages");

const app = express();
const PORT = process.env.PORT || 4000;

// ---------------- Middleware ----------------
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "*" }));
app.use(express.json());

// ---------------- In-memory state ----------------
const rooms = new Map();        // roomId -> Set(ws)
const clients = new Map();      // ws -> { id, username, roomId }
const typingUsers = new Map();  // roomId -> Set(username)

// ---------------- HTTP Routes ----------------
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/rooms/:roomId/history", async (req, res) => {
  try {
    const history = await getMessages(req.params.roomId);
    res.json(history);
  } catch (err) {
    console.error("History error:", err.message);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// ---------------- Server ----------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------------- Helpers ----------------
function broadcast(roomId, data, excludeWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  const payload = JSON.stringify(data);

  room.forEach((ws) => {
    if (ws !== excludeWs && ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  });
}

function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function getRoomMembers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  return Array.from(room)
    .map((ws) => clients.get(ws))
    .filter(Boolean)
    .map((c) => ({
      id: c.id,
      username: c.username,
    }));
}

// ---------------- WebSocket ----------------
wss.on("connection", (ws) => {
  const clientId = uuidv4();

  clients.set(ws, {
    id: clientId,
    username: null,
    roomId: null,
  });

  send(ws, { type: "CONNECTED", clientId });

  ws.on("message", async (raw) => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: "ERROR", message: "Invalid JSON" });
    }

    const client = clients.get(ws);
    if (!client) return;

    // ---------------- JOIN ----------------
    if (data.type === "JOIN") {
      const { roomId, username } = data;

      if (!roomId || !username) {
        return send(ws, {
          type: "ERROR",
          message: "roomId and username required",
        });
      }

      // leave old room
      if (client.roomId && rooms.has(client.roomId)) {
        rooms.get(client.roomId).delete(ws);
        broadcast(client.roomId, {
          type: "MEMBERS_UPDATE",
          members: getRoomMembers(client.roomId),
        });
      }

      client.roomId = roomId;
      client.username = username.trim().slice(0, 24);

      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      rooms.get(roomId).add(ws);

      const history = await getMessages(roomId);

      send(ws, {
        type: "ROOM_JOINED",
        roomId,
        history,
        members: getRoomMembers(roomId),
      });

      const systemMsg = {
        id: uuidv4(),
        type: "SYSTEM",
        text: `${client.username} joined`,
        timestamp: new Date().toISOString(),
        roomId,
      };

      await saveMessage(systemMsg).catch(() => {});
      broadcast(roomId, systemMsg);

      broadcast(roomId, {
        type: "MEMBERS_UPDATE",
        members: getRoomMembers(roomId),
      });

      return;
    }

    // ---------------- MESSAGE ----------------
    if (data.type === "MESSAGE") {
      if (!client.roomId || !client.username) return;

      const text = data.text?.trim();
      if (!text) return;

      const msg = {
        id: uuidv4(),
        type: "MESSAGE",
        text: text.slice(0, 500),
        sender: {
          id: client.id,
          username: client.username,
        },
        roomId: client.roomId,
        timestamp: new Date().toISOString(),
      };

      await saveMessage(msg).catch((err) =>
        console.error("DB save error:", err.message)
      );

      broadcast(client.roomId, msg);
      return;
    }

    // ---------------- TYPING ----------------
    if (data.type === "TYPING") {
      if (!client.roomId) return;

      broadcast(
        client.roomId,
        {
          type: "TYPING",
          username: client.username,
          isTyping: data.isTyping,
        },
        ws
      );
      return;
    }
  });

  // ---------------- Disconnect ----------------
 ws.on("close", async () => {
  const client = clients.get(ws);
  if (!client) return;

  const roomId = client.roomId;

  if (roomId && rooms.has(roomId)) {
    const room = rooms.get(roomId);

    room.delete(ws);

    // update members list
    broadcast(roomId, {
      type: "MEMBERS_UPDATE",
      members: getRoomMembers(roomId),
    });

    // 🔥 IF ROOM IS EMPTY → DELETE EVERYTHING
    if (room.size === 0) {
      rooms.delete(roomId);

      try {
        await deleteRoomMessages(roomId);
        console.log(`🧹 Deleted all messages in room: ${roomId}`);
      } catch (err) {
        console.error("Failed to delete room messages:", err.message);
      }
    }
  }

  clients.delete(ws);
});
});

// ---------------- Start ----------------
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});