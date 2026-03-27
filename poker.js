const Hand = require('pokersolver').Hand;

class PokerGame {
    constructor(roomCode, io) {
        this.roomCode = roomCode;
        this.io = io;
        
        this.players = []; 
        this.status = 'waiting'; 
        this.phase = 'pre-flop'; 
        
        this.communityCards = [];
        this.deck = [];
        this.pot = 0;
        this.currentHighestBet = 0;
        
        this.bigBlindAmount = 400;
        this.smallBlindAmount = 200;
        
        this.dealerIndex = 0;
        this.currentPlayerIndex = 0;
        this.activePlayerId = null;
    }

    addPlayer(id, name) {
        this.players.push({
            id, name, chips: 5000, cards: [], currentBet: 0, folded: false,
            isAllIn: false, hasActed: false, isEliminated: false,
            currentHandName: '', winOdds: null
        });
    }

    broadcastState() {
        this.evaluateCurrentHands();
        const state = {
            status: this.status, phase: this.phase, pot: this.pot,
            communityCards: this.communityCards, currentHighestBet: this.currentHighestBet,
            dealerIndex: this.dealerIndex, activePlayerId: this.activePlayerId,
            bigBlind: this.bigBlindAmount,
            players: this.players.map(p => ({
                id: p.id, name: p.name, chips: p.chips, currentBet: p.currentBet,
                folded: p.folded, isAllIn: p.isAllIn, hasActed: p.hasActed,
                isEliminated: p.isEliminated,
                cards: p.cards,
                currentHandName: p.currentHandName,
                winOdds: p.winOdds
            }))
        };
        this.io.to(this.roomCode).emit('gameStateUpdate', state);
    }

    sendMessage(msg) {
        this.io.to(this.roomCode).emit('gameMessage', msg);
    }

    evaluateCurrentHands() {
        const getCardStr = (card) => {
            const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
            return card.rank + suitMap[card.suit];
        };
        const boardStrs = this.communityCards.map(getCardStr);

        this.players.forEach(p => {
            if (p.cards.length === 0 || p.folded) {
                p.currentHandName = '';
                return;
            }
            if (boardStrs.length >= 3) {
                const handStrs = p.cards.map(getCardStr).concat(boardStrs);
                const hand = Hand.solve(handStrs);
                p.currentHandName = hand.name;
            } else {
                p.currentHandName = 'ハイカード'; 
                if (p.cards[0].rank === p.cards[1].rank) p.currentHandName = 'ワンペア';
            }
        });
    }

    startGame() {
        const activeCount = this.players.filter(p => !p.isEliminated).length;
        if (activeCount < 2) {
            this.status = 'waiting';
            this.sendMessage("参加可能なプレイヤーを待っています...");
            this.broadcastState();
            return;
        }

        this.status = 'playing';
        this.phase = 'pre-flop';
        this.pot = 0;
        this.currentHighestBet = this.bigBlindAmount;
        this.communityCards = [];
        this.buildDeck();
        
        this.players.forEach(p => {
            if (!p.isEliminated) {
                p.cards = [this.deck.pop(), this.deck.pop()];
            } else { p.cards = []; }
            p.currentBet = 0; p.folded = false; p.isAllIn = false; p.hasActed = false; p.winOdds = null;
        });

        do { this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
        } while (this.players[this.dealerIndex].isEliminated);

        let sbIndex = this.dealerIndex;
        do { sbIndex = (sbIndex + 1) % this.players.length; } while (this.players[sbIndex].isEliminated);
        let bbIndex = sbIndex;
        do { bbIndex = (bbIndex + 1) % this.players.length; } while (this.players[bbIndex].isEliminated);

        const sbPlayer = this.players[sbIndex];
        const sbBet = Math.min(this.smallBlindAmount, sbPlayer.chips);
        sbPlayer.chips -= sbBet; sbPlayer.currentBet = sbBet;
        if(sbPlayer.chips === 0) sbPlayer.isAllIn = true;

        const bbPlayer = this.players[bbIndex];
        const bbBet = Math.min(this.bigBlindAmount, bbPlayer.chips);
        bbPlayer.chips -= bbBet; bbPlayer.currentBet = bbBet;
        if(bbPlayer.chips === 0) bbPlayer.isAllIn = true;

        this.pot = sbBet + bbBet;
        this.currentHighestBet = this.bigBlindAmount;

        let nextIdx = bbIndex;
        do { nextIdx = (nextIdx + 1) % this.players.length; } while (this.players[nextIdx].isEliminated);
        
        this.currentPlayerIndex = nextIdx;
        this.activePlayerId = this.players[this.currentPlayerIndex].id;
        
        this.sendMessage("ゲーム開始！プリフロップです。");
        this.broadcastState();
    }

    buildDeck() {
        const suits = ['♠', '♥', '♦', '♣'];
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
        this.deck = [];
        for (let s of suits) { for (let r of ranks) { this.deck.push({ suit: s, rank: r }); } }
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    handleAction(playerId, actionData) {
        if (this.status !== 'playing' || this.activePlayerId !== playerId) return;

        const player = this.players.find(p => p.id === playerId);
        const toCall = this.currentHighestBet - player.currentBet;
        let actionLog = ""; let actionAmount = 0;

        switch(actionData.action) {
            case 'fold': player.folded = true; actionLog = "Fold"; break;
            case 'check': if (player.currentBet < this.currentHighestBet && player.chips > 0) return; actionLog = "Check"; break;
            case 'call': 
                actionAmount = Math.min(toCall, player.chips);
                player.chips -= actionAmount; player.currentBet += actionAmount; this.pot += actionAmount;
                if (player.chips === 0) player.isAllIn = true;
                actionLog = "Call"; break;
            case 'allin':
                actionAmount = player.chips;
                const totalAllin = player.currentBet + actionAmount;
                player.chips = 0; player.currentBet = totalAllin; this.pot += actionAmount; player.isAllIn = true;
                if (totalAllin > this.currentHighestBet) {
                    this.currentHighestBet = totalAllin;
                    this.players.forEach(p => { if (p.id !== player.id && !p.folded && !p.isEliminated && !p.isAllIn) p.hasActed = false; });
                }
                actionLog = "★ ALL-IN ★"; break;
            case 'raise':
                let raiseTotal = actionData.amount || (this.currentHighestBet + this.bigBlindAmount);
                if (raiseTotal > player.chips + player.currentBet) raiseTotal = player.chips + player.currentBet;
                actionAmount = raiseTotal - player.currentBet;
                if (actionAmount <= 0) return;
                player.chips -= actionAmount; player.currentBet = raiseTotal; this.pot += actionAmount;
                if (raiseTotal > this.currentHighestBet) {
                    this.currentHighestBet = raiseTotal;
                    this.players.forEach(p => { if (p.id !== player.id && !p.folded && !p.isEliminated && !p.isAllIn) p.hasActed = false; });
                }
                if (player.chips === 0) player.isAllIn = true;
                actionLog = `Raise to ${raiseTotal}`; break;
        }

        player.hasActed = true;
        this.sendMessage(`${player.name} が ${actionLog} しました`);
        this.checkRoundState();
    }

    checkRoundState() {
        const activePlayers = this.players.filter(p => !p.folded && !p.isEliminated);
        if (activePlayers.length === 1) { this.handlePlayerWinRemaining(activePlayers[0]); return; }
        const allActedAndMatched = activePlayers.every(p => p.isAllIn || (p.hasActed && p.currentBet === this.currentHighestBet));

        if (allActedAndMatched) {
            this.startNextPhase();
        } else {
            this.progressTurn();
        }
    }

    progressTurn() {
        let nextIdx = (this.currentPlayerIndex + 1) % this.players.length;
        let p = this.players[nextIdx];
        let loopCount = 0;
        while ((p.folded || p.isAllIn || p.isEliminated) && loopCount < this.players.length) {
            nextIdx = (nextIdx + 1) % this.players.length; p = this.players[nextIdx]; loopCount++;
        }
        if (loopCount >= this.players.length) { this.startNextPhase(); return; }
        this.currentPlayerIndex = nextIdx; this.activePlayerId = p.id;
        this.broadcastState();
    }

    startNextPhase() {
        this.players.forEach(p => {
            p.currentBet = 0;
            if (!p.folded && !p.isAllIn && !p.isEliminated) p.hasActed = false;
            else p.hasActed = true;
        });
        this.currentHighestBet = 0;

        if (this.phase === 'pre-flop') {
            this.phase = 'flop'; this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
            this.sendMessage('フロップが開かれました！');
        } else if (this.phase === 'flop') {
            this.phase = 'turn'; this.communityCards.push(this.deck.pop());
            this.sendMessage('ターンのカードです！');
        } else if (this.phase === 'turn') {
            this.phase = 'river'; this.communityCards.push(this.deck.pop());
            this.sendMessage('リバーのカードです！最後のラウンド！');
        } else {
            this.handleShowdown();
            return;
        }

        const canActPlayers = this.players.filter(pl => !pl.folded && !pl.isAllIn && !pl.isEliminated);
        
        if (canActPlayers.length <= 1) {
            // オールイン対決状態（アクションできる人がいない）
            this.status = 'allin_showdown';
            this.activePlayerId = null;
            this.calculateAllInOdds(); // モンテカルロ勝率計算
            this.broadcastState();
            
            // 誰かの勝率が100%（勝負あり）なら元のスピード(1.5秒)に戻す、それ以外は5秒じらす
            const isWinnerDecided = this.players.some(p => p.winOdds === 100);
            const delayTime = isWinnerDecided ? 1500 : 5000;
            
            setTimeout(() => this.startNextPhase(), delayTime);
            return;
        }

        let nextIdx = (this.dealerIndex + 1) % this.players.length;
        let p = this.players[nextIdx];
        let loopCount = 0;
        while ((p.folded || p.isAllIn || p.isEliminated) && loopCount < this.players.length) {
            nextIdx = (nextIdx + 1) % this.players.length; p = this.players[nextIdx]; loopCount++;
        }
        this.currentPlayerIndex = nextIdx;
        this.activePlayerId = p.id;
        this.broadcastState();
    }

    calculateAllInOdds() {
        const activePlayers = this.players.filter(p => !p.folded && !p.isEliminated);
        const needed = 5 - this.communityCards.length;
        if (needed <= 0 || activePlayers.length < 2) {
            activePlayers.forEach(p => p.winOdds = null); 
            return; 
        }

        let wins = new Array(activePlayers.length).fill(0);
        const iterations = 800; 

        const getCardStr = (card) => {
            const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
            return card.rank + suitMap[card.suit];
        };

        const boardStrs = this.communityCards.map(getCardStr);
        const playersHoleStrs = activePlayers.map(p => p.cards.map(getCardStr));

        for (let i = 0; i < iterations; i++) {
            let tempDeck = [...this.deck];
            for (let j = tempDeck.length - 1; j > 0; j--) {
                const k = Math.floor(Math.random() * (j + 1));
                [tempDeck[j], tempDeck[k]] = [tempDeck[k], tempDeck[j]];
            }
            const drawn = tempDeck.slice(0, needed).map(getCardStr);
            const fullBoard = boardStrs.concat(drawn);

            let bestHands = [];
            for (let pIdx = 0; pIdx < activePlayers.length; pIdx++) {
                const handStrs = playersHoleStrs[pIdx].concat(fullBoard);
                const hand = Hand.solve(handStrs);
                hand.pIdx = pIdx;
                bestHands.push(hand);
            }
            const gWinners = Hand.winners(bestHands);
            const point = 1 / gWinners.length;
            gWinners.forEach(w => { wins[w.pIdx] += point; });
        }

        activePlayers.forEach((p, idx) => {
             p.winOdds = Math.round((wins[idx] / iterations) * 100);
        });
    }

    handlePlayerWinRemaining(winner) {
        this.status = 'showdown'; this.activePlayerId = null;
        winner.chips += this.pot;
        this.sendMessage(`${winner.name} 以外がフォールドしたため不戦勝！ ${this.pot} チップ獲得！`);
        this.pot = 0; this.checkEliminations(); this.broadcastState();
        
        // ★不戦勝時も長めに結果を見せる
        setTimeout(() => this.startGame(), 6000);
    }

    handleShowdown() {
        this.status = 'showdown'; this.activePlayerId = null;
        const activePlayers = this.players.filter(p => !p.folded && !p.isEliminated);
        
        this.players.forEach(p => p.winOdds = null);
        
        if (activePlayers.length === 0) return;
        if (activePlayers.length === 1) { this.handlePlayerWinRemaining(activePlayers[0]); return; }

        const getCardStr = (card) => {
            const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
            return card.rank + suitMap[card.suit];
        };
        const boardStrs = this.communityCards.map(getCardStr);

        activePlayers.forEach(p => {
            const handStrs = p.cards.map(getCardStr).concat(boardStrs);
            const hand = Hand.solve(handStrs);
            hand.player = p; p.solvedHand = hand; p.currentHandName = hand.name;
        });

        const solvedHandsArray = activePlayers.map(p => p.solvedHand);
        const winners = Hand.winners(solvedHandsArray);

        if (winners.length === 1) {
            const winner = winners[0].player; winner.chips += this.pot;
            this.sendMessage(`ショーダウン決着！ ${winner.name} の勝利！ ${this.pot} チップ獲得！`);
        } else {
            const splitAmount = Math.floor(this.pot / winners.length);
            winners.forEach(w => w.player.chips += splitAmount);
            this.sendMessage(`引き分けチョップ！ 勝者同士でチップを分割します。`);
        }
        
        this.pot = 0; this.checkEliminations(); this.broadcastState();
        // ★ショーダウン決着時の静止時間をしっかり取る（お互いが役を見比べる時間）
        setTimeout(() => this.startGame(), 8000);
    }

    checkEliminations() {
        this.players.forEach(p => { if (p.chips <= 0 && !p.isEliminated) { p.isEliminated = true; } });
    }
}
module.exports = { PokerGame };
