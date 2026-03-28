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
        
        const existingPlayer = game.players.find(p => p.name === name);
        if (existingPlayer) {
            // 切断などで残っていた自分を引き継ぐ（複製させない）
            existingPlayer.id = socket.id;
            if (existingPlayer.isEliminated && game.status === 'waiting') {
                existingPlayer.isEliminated = false;
                existingPlayer.chips = 5000;
            }
        } else {
            // 定員チェック
            if (game.players.length >= 8) {
                socket.emit('roomError', 'このルームは満員（8人）です。');
                return;
            }
            game.addPlayer(socket.id, name);
        }

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

    // 退出ボタン
    socket.on('leaveRoom', () => {
        handlePlayerLeave(socket);
    });

    // 切断時
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        handlePlayerLeave(socket);
    });

    function handlePlayerLeave(socketRef) {
        for (const roomCode in rooms) {
            const game = rooms[roomCode];
            const idx = game.players.findIndex(p => p.id === socketRef.id);
            if (idx !== -1) {
                if (game.status === 'waiting') {
                    // 待機中なら削除
                    game.players.splice(idx, 1);
                } else {
                    // ゲーム中の場合は進行を壊さないため配列に残しfold扱いとする
                    game.players[idx].folded = true;
                    game.players[idx].id = null; // IDを空にしてアクション不能に
                }
                game.broadcastState();
                
                // 実在する接続者が誰もいなくなったらメモリから削除
                if (game.players.filter(p => p.id !== null).length === 0) {
                    delete rooms[roomCode];
                }
                break;
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
