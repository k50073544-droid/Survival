// ══════════════════════════════════════════════════════════════════════════════
// server.js  —  Сервер мультиплеера Survivor Quest
//
// БЫСТРЫЙ ЗАПУСК (бесплатно):
//   1. Зайдите на https://glitch.com → New Project → Import from GitHub
//   2. Загрузите этот файл как server.js и добавьте package.json (ниже)
//   3. Замените SERVER_URL в MultiplayerManager.java на ваш URL
//
// Или локально:
//   npm install ws
//   node server.js
// ══════════════════════════════════════════════════════════════════════════════

const WebSocket = require("ws");
const PORT = process.env.PORT || 3000;

const wss = new WebSocket.Server({ port: PORT });
const rooms = {}; // { code: { host, players: [{ ws, id, nick }] } }

function makeCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function broadcast(room, msg, excludeId) {
  const json = JSON.stringify(msg);
  for (const p of room.players) {
    if (p.id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(json);
    }
  }
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

wss.on("connection", (ws) => {
  let playerId = null;
  let playerNick = "Игрок";
  let playerRoom = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, id, nick, data } = msg;
    if (!type) return;

    // Первое сообщение — приветствие
    if (type === "hello") {
      playerId = id || ("guest_" + Date.now());
      playerNick = nick || "Игрок";
      return;
    }

    if (!playerId) return;

    switch (type) {
      case "create_room": {
        let code = makeCode();
        while (rooms[code]) code = makeCode(); // уникальность
        const room = { host: playerId, players: [{ ws, id: playerId, nick: playerNick }] };
        rooms[code] = room;
        playerRoom = code;
        send(ws, { type: "room_created", data: { code } });
        console.log(`[${code}] created by ${playerNick}`);
        break;
      }

      case "join_room": {
        const code = (data.code || "").toUpperCase().trim();
        const room = rooms[code];
        if (!room) {
          send(ws, { type: "error", data: { message: `Комната ${code} не найдена` } });
          return;
        }
        if (room.players.length >= 4) {
          send(ws, { type: "error", data: { message: "Комната заполнена (макс. 4 игрока)" } });
          return;
        }
        // Список уже существующих игроков для нового
        const existing = room.players.map(p => ({ id: p.id, nickname: p.nick }));
        room.players.push({ ws, id: playerId, nick: playerNick });
        playerRoom = code;

        send(ws, { type: "room_joined", data: { code, players: existing } });

        // Уведомить остальных
        broadcast(room, {
          type: "player_joined",
          data: { id: playerId, nickname: playerNick }
        }, playerId);

        console.log(`[${code}] ${playerNick} joined (${room.players.length}/4)`);
        break;
      }

      case "start_game": {
        const room = rooms[playerRoom];
        if (!room || room.host !== playerId) return;
        broadcast(room, { type: "game_start", data: {} }, null);
        send(ws, { type: "game_start", data: {} });
        console.log(`[${playerRoom}] game started`);
        break;
      }

      case "player_state": {
        const room = rooms[playerRoom];
        if (!room) return;
        broadcast(room, {
          type: "player_state",
          data: { id: playerId, nick: playerNick, ...data }
        }, playerId);
        break;
      }

      case "chat": {
        const room = rooms[playerRoom];
        if (!room) return;
        broadcast(room, {
          type: "chat",
          data: { nick: playerNick, message: data.message || "" }
        }, null);
        break;
      }
    }
  });

  ws.on("close", () => {
    if (!playerRoom || !rooms[playerRoom]) return;
    const room = rooms[playerRoom];
    room.players = room.players.filter(p => p.id !== playerId);
    console.log(`[${playerRoom}] ${playerNick} left (${room.players.length} left)`);

    if (room.players.length === 0) {
      delete rooms[playerRoom];
      console.log(`[${playerRoom}] room deleted`);
    } else {
      if (room.host === playerId) room.host = room.players[0].id;
      broadcast(room, { type: "player_left", data: { id: playerId } }, null);
    }
  });
});

console.log(`Survivor Quest MP server running on ws://localhost:${PORT}`);
