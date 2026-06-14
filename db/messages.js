const db = require("./index");

async function saveMessage(message) {
  await db.query(
    `
    INSERT INTO messages (
      id,
      room_id,
      sender_id,
      username,
      text,
      type,
      created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    `,
    [
      message.id,
      message.roomId,
      message.sender?.id || null,
      message.sender?.username || null,
      message.text,
      message.type,
      message.timestamp,
    ]
  );
}

async function getMessages(roomId) {
  const result = await db.query(
    `
    SELECT
      id,
      room_id,
      sender_id,
      username,
      text,
      type,
      created_at
    FROM messages
    WHERE room_id = $1
    ORDER BY created_at ASC
    LIMIT 50
    `,
    [roomId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    roomId: row.room_id,
    type: row.type,
    text: row.text,
    timestamp: row.created_at,
    sender:
      row.sender_id || row.username
        ? {
            id: row.sender_id,
            username: row.username,
          }
        : null,
  }));
}

async function deleteRoomMessages(roomId) {
  await db.query(
    `DELETE FROM messages WHERE room_id = $1`,
    [roomId]
  );
}

module.exports = {
  saveMessage,
  getMessages,
  deleteRoomMessages
};