// public/main.js
const socket = io();

// UI Elements
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code');
const loginError = document.getElementById('login-error');
const roomDisplay = document.getElementById('room-display');

const playersContainer = document.getElementById('players-container');
const communityCardsArea = document.getElementById('community-cards');
const potAmountDisplay = document.getElementById('pot-amount');
const gameMessage = document.getElementById('game-message');
const dealerCore = document.getElementById('dealer-core');

const heroCardsContainer = document.getElementById('hero-cards-container');
const myHandNameDisplay = document.getElementById('my-hand-name');
myHandNameDisplay.style.display = 'none';

const oddsPanel = document.getElementById('odds-panel');
const oddsContent = document.getElementById('odds-content');

const myStackDisplay = document.getElementById('my-stack');
const myBetDisplay = document.getElementById('my-bet');
const controls = document.getElementById('controls');
const btnFold = document.getElementById('btn-fold');
const btnCheck = document.getElementById('btn-check');
const btnCall = document.getElementById('btn-call');
const btnRaise = document.getElementById('btn-raise');
const btnAllIn = document.getElementById('btn-allin');
const raiseSlider = document.getElementById('raise-slider');
const raiseInput = document.getElementById('raise-input');

// ヘルプモーダル
const helpBtn = document.getElementById('help-btn');
const helpModal = document.getElementById('help-modal');
const closeHelpBtn = document.getElementById('close-help');

helpBtn.onclick = () => helpModal.style.display = "flex";
closeHelpBtn.onclick = () => helpModal.style.display = "none";
window.onclick = (e) => { if (e.target === helpModal) helpModal.style.display = "none"; };

let myId = null;
let currentGameState = null;
let previousPhase = null;
let previousStatus = null;

// アニメーション用のユーティリティ
let animationCounter = 0;

joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const room = roomCodeInput.value.trim();
    if (!name || !room) {
        loginError.textContent = "名前と合言葉を入力してください";
        return;
    }
    socket.emit('joinRoom', { name, room });
});

leaveBtn.addEventListener('click', () => {
    socket.emit('leaveRoom');
    showLoginScreen();
});

// --- アクションイベント ---
btnFold.addEventListener('click', () => socket.emit('playerAction', { action: 'fold' }));
btnCheck.addEventListener('click', () => socket.emit('playerAction', { action: 'check' }));
btnCall.addEventListener('click', () => socket.emit('playerAction', { action: 'call' }));
btnAllIn.addEventListener('click', () => socket.emit('playerAction', { action: 'allin' }));

btnRaise.addEventListener('click', () => {
    const amount = parseInt(raiseInput.value);
    socket.emit('playerAction', { action: 'raise', amount });
});

raiseSlider.addEventListener('input', () => { raiseInput.value = raiseSlider.value; });
raiseInput.addEventListener('input', () => {
    let val = parseInt(raiseInput.value) || 0;
    if (val > parseInt(raiseSlider.max)) val = parseInt(raiseSlider.max);
    raiseSlider.value = val;
});

// --- Socket.IOイベント ---
socket.on('connect', () => { myId = socket.id; });
socket.on('roomError', (msg) => { loginError.textContent = msg; });
socket.on('roomJoined', (data) => {
    roomDisplay.textContent = `Room: ${data.room}`;
    showGameScreen();
});
socket.on('gameStateUpdate', (state) => {
    currentGameState = state;
    renderGame(state);
    previousPhase = state.phase;
    previousStatus = state.status;
});
socket.on('gameMessage', (msg) => {
    gameMessage.textContent = msg;
});

// --- 描画ロジック ---
function showLoginScreen() {
    loginScreen.classList.add('active');
    gameScreen.classList.remove('active');
    playersContainer.innerHTML = '';
}

function showGameScreen() {
    loginScreen.classList.remove('active');
    gameScreen.classList.add('active');
}

function renderGame(state) {
    const me = state.players.find(p => p.id === myId);
    
    // アニメーション判定フラグ
    const isNewDeal = (previousPhase !== 'pre-flop' && state.phase === 'pre-flop' && state.status === 'playing');
    const isNewCommunity = (previousPhase !== state.phase && state.status === 'playing' && state.phase !== 'pre-flop');
    const isShowdownStart = (previousStatus !== 'showdown' && previousStatus !== 'allin_showdown' && 
                             (state.status === 'showdown' || state.status === 'allin_showdown'));
    
    if (isNewDeal || isNewCommunity) animationCounter = 0;

    // 自ステータス
    if (me) {
        myStackDisplay.textContent = me.chips;
        myBetDisplay.textContent = me.currentBet;
        
        if (me.cards && me.cards.length > 0) {
            renderCards(heroCardsContainer, me.cards, false, isNewDeal, false, me.bestHandCards);
            if (me.currentHandName && state.phase !== 'pre-flop' && state.status !== 'waiting') {
                myHandNameDisplay.style.display = 'block';
                myHandNameDisplay.textContent = `現在: ${me.currentHandName}`;
            } else {
                myHandNameDisplay.style.display = 'none';
            }
            if (state.status === 'showdown' && me.currentHandName) {
                myHandNameDisplay.style.display = 'block';
                myHandNameDisplay.textContent = `[役] ${me.currentHandName}`;
            }
        } else {
            heroCardsContainer.innerHTML = ''; 
            myHandNameDisplay.style.display = 'none';
        }

        if (state.activePlayerId === myId && state.status === 'playing' && !me.isEliminated) {
            controls.classList.remove('disabled');
            updateActionButtons(me, state);
        } else {
            controls.classList.add('disabled');
        }
    }

    potAmountDisplay.textContent = state.pot;
    const myBest = me ? me.bestHandCards : [];
    renderCards(communityCardsArea, state.communityCards, false, isNewCommunity, false, myBest);
    renderPlayers(state, isNewDeal, isShowdownStart);
    renderOddsPanel(state);
}

function renderOddsPanel(state) {
    // 右側の特大勝率パネル更新
    if (state.status === 'allin_showdown') {
        oddsPanel.classList.remove('hidden');
        let html = '';
        state.players.forEach(p => {
            if (p.winOdds !== null && p.winOdds !== undefined) {
                let outsHtml = '';
                if (p.outs && p.outs.length > 0) {
                    if (p.outs.length > 15) {
                        outsHtml = '<div class="outs-container"><span class="outs-many">有利 (Ahead)</span></div>';
                    } else {
                        outsHtml = '<div class="outs-container">';
                        p.outs.forEach(o => {
                            const sClass = (o.suit === '♥' || o.suit === '♦') ? 'red' : 'black';
                            outsHtml += `<span class="out-card ${sClass}">${o.suit}${o.rank}</span>`;
                        });
                        outsHtml += '</div>';
                    }
                }
                
                html += `
                    <div class="odds-player-row">
                        <span class="odds-name">${p.name}</span>
                        <span class="odds-percent">${p.winOdds}%</span>
                        ${outsHtml}
                    </div>
                `;
            }
        });
        oddsContent.innerHTML = html;
    } else {
        oddsPanel.classList.add('hidden');
    }
}

function updateActionButtons(me, state) {
    const toCall = state.currentHighestBet - me.currentBet;
    
    if (toCall === 0) {
        btnCheck.style.display = 'inline-block';
        btnCall.style.display = 'none';
    } else {
        btnCheck.style.display = 'none';
        btnCall.style.display = 'inline-block';
        btnCall.textContent = me.chips <= toCall ? 'All-in Call' : `Call (${toCall})`;
    }

    const minRaise = state.currentHighestBet + state.bigBlind;
    if (me.chips > toCall) {
        btnRaise.style.display = 'inline-block';
        raiseSlider.style.display = 'inline-block';
        raiseInput.style.display = 'inline-block';
        
        raiseSlider.min = minRaise;
        raiseSlider.max = me.chips + me.currentBet;
        if (parseInt(raiseSlider.value) < minRaise) {
            raiseSlider.value = minRaise;
            raiseInput.value = minRaise;
        }
    } else {
        btnRaise.style.display = 'none';
        raiseSlider.style.display = 'none';
        raiseInput.style.display = 'none';
    }
}

function renderCards(container, cards, hideAll = false, applyDealAnim = false, applyFlipAnim = false, bestHandCards = []) {
    container.innerHTML = '';
    cards.forEach(card => {
        const cardDiv = document.createElement('div');
        if (hideAll) {
            cardDiv.className = 'card hidden';
        } else {
            const suitClass = (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
            cardDiv.className = `card ${suitClass}`;
            cardDiv.innerHTML = `${card.suit}<br>${card.rank}`;
            
            // 金枠（bestHandCardsに含まれていれば付与）
            if (bestHandCards && bestHandCards.length > 0) {
                const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
                const cStr = card.rank + suitMap[card.suit];
                if (bestHandCards.includes(cStr)) {
                    cardDiv.classList.add('highlight-gold');
                }
            }

            if (applyFlipAnim) {
                // ショーダウン時のじらしフリップ演出
                cardDiv.classList.add('flip-anim');
                cardDiv.style.animationDelay = `${animationCounter * 0.4}s`;
                animationCounter++;
            }
        }
        
        if (applyDealAnim) {
            // 中心から飛んでくるアニメーション
            cardDiv.classList.add('deal-anim');
            // ランダムな位置から飛んでくるようにして「配っている」感を出す
            cardDiv.style.setProperty('--dx', `${(Math.random() - 0.5) * 400}px`);
            cardDiv.style.setProperty('--dy', `${(Math.random() - 0.5) * -400 - 100}px`);
            cardDiv.style.animationDelay = `${animationCounter * 0.15}s`;
            animationCounter++;
        }
        
        container.appendChild(cardDiv);
    });
}

function renderPlayers(state, isNewDeal, isShowdownStart) {
    playersContainer.innerHTML = '';
    let myIndex = state.players.findIndex(p => p.id === myId);
    if (myIndex === -1) myIndex = 0;

    state.players.forEach((p, i) => {
        let displaySeat = (i - myIndex + 8) % 8;
        const seat = document.createElement('div');
        seat.className = `player-seat seat-${displaySeat}`;
        
        if (state.activePlayerId === p.id) seat.classList.add('active-turn');
        if (p.folded) seat.classList.add('folded');
        if (p.isEliminated) seat.classList.add('eliminated'); 

        let html = `
            <div class="player-name">${p.name}</div>
            <div class="player-stack">🪙 ${p.chips}</div>
            <div class="player-bet">Bet: ${p.currentBet}</div>
        `;
        if (state.dealerIndex === i) {
            html += `<div style="position:absolute; top:-10px; right:-10px; background:white; color:black; border-radius:50%; width:20px; height:20px; font-size:12px; display:flex; align-items:center; justify-content:center; border:1px solid #000;">D</div>`;
        }
        
        // 座席上での%表示は廃止し、右の特大パネルへ
        // ショーダウン時の役バッジ表示
        if ((state.status === 'showdown' || state.status === 'allin_showdown') && p.currentHandName && !p.folded) {
             html += `<div class="opponent-hand-badge">${p.currentHandName}</div>`;
        }

        seat.innerHTML = html;

        // カード描画
        const cardsDiv = document.createElement('div');
        cardsDiv.className = 'player-cards';
        
        if (p.id !== myId) {
            if (p.cards && p.cards.length > 0) {
                // 通常は隠すが、ショーダウン時は表にする
                const shouldHide = (state.status !== 'showdown' && state.status !== 'allin_showdown');
                // ショーダウン開始時だけフリップアニメーション
                const applyFlip = isShowdownStart && !shouldHide;
                renderCards(cardsDiv, p.cards, shouldHide, isNewDeal, applyFlip, shouldHide ? [] : p.bestHandCards);
            } else if (state.status !== 'waiting' && !p.folded && !p.isEliminated) {
                renderCards(cardsDiv, [{},{}], true, isNewDeal);
            }
        }
        
        seat.appendChild(cardsDiv);
        playersContainer.appendChild(seat);
    });
}
