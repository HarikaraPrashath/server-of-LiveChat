jest.mock("../db/index", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));

const request = require("supertest");
const { app, server, wss } = require("../server");

let WebSocket;

afterAll((done) => {
  wss.close(() => server.close(done));
});

describe("REST API", () => {
  test("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
  });

  test("GET /api/rooms returns array", async () => {
    const res = await request(app).get("/api/rooms");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("GET /api/rooms/:roomId/history returns array", async () => {
    const res = await request(app).get("/api/rooms/test-room/history");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("WebSocket", () => {
  let port;

  beforeAll((done) => {
    WebSocket = require("ws");
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      done();
    });
  }, 10000);

  afterAll((done) => {
    server.close(done);
  });

  function connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  }

  function nextMessage(ws) {
    return new Promise((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
  }

  test("server sends CONNECTED", async () => {
    const ws = await connect();
    const msg = await nextMessage(ws);
    expect(msg.type).toBe("CONNECTED");
    expect(msg.clientId).toBeDefined();
    ws.close();
  }, 10000);

  test("JOIN room returns ROOM_JOINED with history", async () => {
    const ws = await connect();
    await nextMessage(ws);
    ws.send(JSON.stringify({ type: "JOIN", roomId: "test-room", username: "Alice" }));
    const msg = await nextMessage(ws);
    expect(msg.type).toBe("ROOM_JOINED");
    expect(msg.roomId).toBe("test-room");
    expect(Array.isArray(msg.history)).toBe(true);
    expect(Array.isArray(msg.members)).toBe(true);
    ws.close();
  }, 10000);

  test("MESSAGE is broadcast to room members", async () => {
    const ws1 = await connect();
    const ws2 = await connect();
    await nextMessage(ws1);
    await nextMessage(ws2);
    ws1.send(JSON.stringify({ type: "JOIN", roomId: "room-1", username: "Bob" }));
    await nextMessage(ws1);
    ws2.send(JSON.stringify({ type: "JOIN", roomId: "room-1", username: "Carol" }));
    await nextMessage(ws1);
    await nextMessage(ws1);
    const join2 = await nextMessage(ws2);
    expect(join2.type).toBe("ROOM_JOINED");
    ws1.send(JSON.stringify({ type: "MESSAGE", text: "Hello world" }));
    const msg1 = await nextMessage(ws1);
    const msg2 = await nextMessage(ws2);
    expect(msg1.type).toBe("MESSAGE");
    expect(msg2.type).toBe("MESSAGE");
    expect(msg1.text).toBe("Hello world");
    expect(msg2.text).toBe("Hello world");
    ws1.close();
    ws2.close();
  }, 10000);

  test("unknown message type returns ERROR", async () => {
    const ws = await connect();
    await nextMessage(ws);
    ws.send(JSON.stringify({ type: "UNKNOWN" }));
    const msg = await nextMessage(ws);
    expect(msg.type).toBe("ERROR");
    ws.close();
  }, 10000);
});