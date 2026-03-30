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
        
        // ルームロックチェック
        if (game.isLocked) {
            socket.emit('roomError', 'このルームは既にゲーム開始しており、ロックされています。');
            return;
        }

        const existingPlayer = game.players.find(p => p.name === name);
        if (existingPlayer) {
            // 切断などで残っていた自分を引き継ぐ（複製させない）
            existingPlayer.id = socket.id;
            // もしオーナーだった場合、自分のIDを最新に更新
            if (game.ownerId === null || game.players.indexOf(existingPlayer) === 0) {
                 // 既にゲーム内でのオーナーID更新ロジックはあるが念のため
            }
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
        
        // ★修正: 自動スタートを廃止し、常に状態を放送するだけにする
        game.broadcastState();
    });

    // ★追加: ゲーム開始（オーナーのみ）
    socket.on('startGame', () => {
        const game = findGameBySocketId(socket.id);
        if (game && game.ownerId === socket.id && game.status === 'waiting') {
            if (game.players.length >= 2) {
                game.startGame(true); // 初回開始フラグ
            } else {
                socket.emit('gameMessage', '開始するには最低2人のプレイヤーが必要です。');
            }
        }
    });

    // ★追加: プレイヤー追放（オーナーのみ）
    socket.on('kickPlayer', ({ targetId }) => {
        const game = findGameBySocketId(socket.id);
        if (game && game.ownerId === socket.id) {
            const targetSocket = io.sockets.sockets.get(targetId);
            if (targetSocket) {
                targetSocket.emit('kicked', 'オーナーにより追放されました。');
                targetSocket.leave(game.roomCode);
            }
            game.kickPlayer(targetId);
        }
    });

    function findGameBySocketId(id) {
        for (const code in rooms) {
            if (rooms[code].players.some(p => p.id === id)) return rooms[code];
        }
        return null;
    }

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

    // タイムバンク使用
    socket.on('useTimeBank', () => {
        for (const roomCode in rooms) {
            const game = rooms[roomCode];
            const player = game.players.find(p => p.id === socket.id);
            if (player) {
                game.useTimeBank(socket.id);
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
                    // オーナーが退出した場合、次の人に譲渡
                    if (game.ownerId === socketRef.id && game.players.length > 0) {
                        game.ownerId = game.players[0].id;
                    }
                } else {
                    // ゲーム中の場合は進行を壊さないため配列に残しfold扱いとする
                    game.players[idx].folded = true;
                    game.players[idx].id = null; // IDを空にしてアクション不能に
                    // オーナーが退出してもゲーム自体は続くので、ownerId は一旦そのままか
                    // (ただしアクションできないので、実質的には誰かに譲渡すべき)
                    if (game.ownerId === socketRef.id) {
                        const nextOwner = game.players.find(p => p.id !== null);
                        if (nextOwner) game.ownerId = nextOwner.id;
                    }
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
