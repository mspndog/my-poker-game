const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { PokerGame } = require('./poker.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// メモリ上でルームを管理
const rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // ルームへの参加
    socket.on('joinRoom', ({ name, room }) => {
        if (!rooms[room]) {
            rooms[room] = new PokerGame(room, io);
        }

        const game = rooms[room];
        
        // 定員チェック
        if (game.players.length >= 8) {
            socket.emit('roomError', 'このルームは満員（8人）です。');
            return;
        }

        game.addPlayer(socket.id, name);
        socket.join(room);
        
        socket.emit('roomJoined', { room });
        console.log(`${name} joined room: ${room}`);
        
        // 人数が最低2人揃ったら、ゲーム待機状態から進行させる処理など
        if (game.players.length >= 2 && game.status === 'waiting') {
             game.startGame();
        } else {
             game.broadcastState();
        }
    });

    // プレイヤーのアクション受信
    socket.on('playerAction', (data) => {
        for (const roomCode in rooms) {
            const game = rooms[roomCode];
            const player = game.players.find(p => p.id === socket.id);
            if (player) {
                game.handleAction(socket.id, data);
                break;
            }
        }
    });

    // 切断時
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (const roomCode in rooms) {
            const game = rooms[roomCode];
            const idx = game.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                game.players.splice(idx, 1);
                game.broadcastState();
                
                // 誰もいなくなったらメモリから削除
                if (game.players.length === 0) {
                    delete rooms[roomCode];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
