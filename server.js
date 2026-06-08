// ══════════════════════════════════════════════════════════════════
// server.js — Survivor Quest Multiplayer Server
// Деплой на Render: https://render.com (Free tier, Node.js)
// ══════════════════════════════════════════════════════════════════

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// HTTP сервер (нужен для Render health check)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Survivor Quest Server OK\n');
});

const wss = new WebSocket.Server({ server });

// rooms: { roomCode -> { host, players: Map<id, {ws, nick}> } }
const rooms = new Map();

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

function broadcast(room, message, excludeId = null) {
    if (!room) return;
    const text = JSON.stringify(message);
    room.players.forEach((player, id) => {
        if (id !== excludeId && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(text);
        }
    });
}

function findRoomByPlayerId(playerId) {
    for (const [code, room] of rooms) {
        if (room.players.has(playerId)) return { code, room };
    }
    return null;
}

wss.on('connection', (ws) => {
    let playerId = null;
    let playerNick = 'Игрок';

    ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch (e) { return; }

        const type = msg.type;
        const id   = msg.id   || '';
        const nick = msg.nick || 'Игрок';
        const msgData = msg.data || {};

        switch (type) {

            case 'hello': {
                playerId   = id;
                playerNick = nick;
                break;
            }

            case 'create_room': {
                if (!playerId) break;
                let code;
                do { code = generateCode(); } while (rooms.has(code));

                const room = { host: playerId, players: new Map() };
                room.players.set(playerId, { ws, nick: playerNick });
                rooms.set(code, room);

                ws.send(JSON.stringify({
                    type: 'room_created',
                    data: { code }
                }));
                console.log(`Room ${code} created by ${playerNick}`);
                break;
            }

            case 'join_room': {
                if (!playerId) break;
                const code = (msgData.code || '').toUpperCase().trim();
                const room = rooms.get(code);

                if (!room) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        data: { message: 'Комната не найдена: ' + code }
                    }));
                    break;
                }

                if (room.players.size >= 4) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        data: { message: 'Комната заполнена' }
                    }));
                    break;
                }

                // Список уже существующих игроков
                const existingPlayers = [];
                room.players.forEach((p, pid) => {
                    existingPlayers.push({ id: pid, nickname: p.nick });
                });

                room.players.set(playerId, { ws, nick: playerNick });

                // Сообщаем вошедшему
                ws.send(JSON.stringify({
                    type: 'room_joined',
                    data: { code, players: existingPlayers }
                }));

                // Сообщаем остальным
                broadcast(room, {
                    type: 'player_joined',
                    id: playerId,
                    data: { id: playerId, nickname: playerNick }
                }, playerId);

                console.log(`${playerNick} joined room ${code}`);
                break;
            }

            case 'start_game': {
                const found = findRoomByPlayerId(playerId);
                if (!found) break;
                const { room } = found;
                if (room.host !== playerId) break; // только хост

                // Рассылаем всем включая хоста
                const startMsg = JSON.stringify({
                    type: 'game_start',
                    data: {
                        seed:       msgData.seed       || Date.now(),
                        difficulty: msgData.difficulty || 1
                    }
                });
                room.players.forEach((p) => {
                    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(startMsg);
                });
                console.log(`Game started in room ${found.code}, seed=${msgData.seed}`);
                break;
            }

            // ── Сообщения которые пересылаются всем кроме отправителя ────────
            case 'player_state':
            case 'bullet':
            case 'team_settings':
            case 'chat':
            case 'enemy_sync':
            case 'enemy_hit': {
                const found = findRoomByPlayerId(playerId);
                if (!found) break;
                broadcast(found.room, {
                    type,
                    id:   playerId,
                    nick: playerNick,
                    data: msgData
                }, playerId);
                break;
            }
        }
    });

    ws.on('close', () => {
        if (!playerId) return;
        const found = findRoomByPlayerId(playerId);
        if (!found) return;
        const { code, room } = found;

        room.players.delete(playerId);
        console.log(`${playerNick} left room ${code}`);

        if (room.players.size === 0) {
            rooms.delete(code);
            console.log(`Room ${code} deleted (empty)`);
        } else {
            // Если ушёл хост — новый хост первый из оставшихся
            if (room.host === playerId) {
                room.host = room.players.keys().next().value;
                console.log(`New host in room ${code}: ${room.host}`);
            }
            broadcast(room, {
                type: 'player_left',
                data: { id: playerId }
            });
        }
    });

    ws.on('error', (err) => {
        console.error('WS error:', err.message);
    });
});

server.listen(PORT, () => {
    console.log(`Survivor Quest server running on port ${PORT}`);
});
                
