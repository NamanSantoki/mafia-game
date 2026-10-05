/**
 * MAFIA WEB APP CLIENT SCRIPT
 * Multi-device phone connection, 3D card flips, Audio synthesizer, Real-time phases.
 */

const socket = io();

// State
let gameState = {
  roomCode: null,
  isHost: false,
  myPlayer: null,
  myRoleInfo: null,
  status: 'landing',
  dayNumber: 1,
  players: [],
  settings: {
    mafiaCount: 1,
    doctorCount: 1,
    detectiveCount: 1
  },
  soundEnabled: true,
  cardFlipped: false,
  myNightTarget: null,
  myDayVote: null,
  votesTally: {}
};

// Web Audio API Synthesizer (No external mp3 dependencies needed)
class SoundFX {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTone(freq, type = 'sine', duration = 0.3, gainVal = 0.15) {
    if (!gameState.soundEnabled) return;
    try {
      this.init();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {}
  }

  playRoleReveal() {
    if (!gameState.soundEnabled) return;
    this.playTone(130, 'sawtooth', 0.6, 0.2);
    setTimeout(() => this.playTone(196, 'sawtooth', 0.8, 0.2), 150);
    setTimeout(() => this.playTone(261, 'sine', 1.2, 0.25), 300);
  }

  playNightFall() {
    if (!gameState.soundEnabled) return;
    this.playTone(220, 'sine', 0.8, 0.2);
    setTimeout(() => this.playTone(164, 'sine', 1.0, 0.2), 300);
    setTimeout(() => this.playTone(110, 'sine', 1.4, 0.25), 600);
  }

  playDayWake() {
    if (!gameState.soundEnabled) return;
    this.playTone(261, 'sine', 0.5, 0.2);
    setTimeout(() => this.playTone(329, 'sine', 0.5, 0.2), 180);
    setTimeout(() => this.playTone(392, 'sine', 0.8, 0.25), 360);
  }

  playGavel() {
    if (!gameState.soundEnabled) return;
    this.playTone(120, 'triangle', 0.25, 0.3);
    setTimeout(() => this.playTone(90, 'triangle', 0.4, 0.35), 120);
  }

  playClick() {
    this.playTone(600, 'sine', 0.08, 0.08);
  }
}

const sfx = new SoundFX();

// DOM Elements Cache
const DOM = {
  // Views
  viewLanding: document.getElementById('viewLanding'),
  viewLobby: document.getElementById('viewLobby'),
  viewRoleReveal: document.getElementById('viewRoleReveal'),
  viewNight: document.getElementById('viewNight'),
  viewDay: document.getElementById('viewDay'),
  viewGameOver: document.getElementById('viewGameOver'),

  // Top Controls
  soundToggleBtn: document.getElementById('soundToggleBtn'),
  soundIcon: document.getElementById('soundIcon'),
  btnExitGame: document.getElementById('btnExitGame'),
  toast: document.getElementById('toastNotification'),

  // Landing
  tabJoin: document.getElementById('tabJoin'),
  tabHost: document.getElementById('tabHost'),
  joinFormPanel: document.getElementById('joinFormPanel'),
  hostFormPanel: document.getElementById('hostFormPanel'),
  joinRoomCode: document.getElementById('joinRoomCode'),
  joinPlayerName: document.getElementById('joinPlayerName'),
  hostPlayerName: document.getElementById('hostPlayerName'),
  btnJoinRoom: document.getElementById('btnJoinRoom'),
  btnCreateRoom: document.getElementById('btnCreateRoom'),

  // Settings
  cfgMafiaCount: document.getElementById('cfgMafiaCount'),
  cfgDoctor: document.getElementById('cfgDoctor'),
  cfgDetective: document.getElementById('cfgDetective'),

  // Lobby
  displayRoomCode: document.getElementById('displayRoomCode'),
  btnCopyCode: document.getElementById('btnCopyCode'),
  qrImage: document.getElementById('qrImage'),
  displayJoinUrl: document.getElementById('displayJoinUrl'),
  lobbyPlayerCountNum: document.getElementById('lobbyPlayerCountNum'),
  lobbyPlayersList: document.getElementById('lobbyPlayersList'),
  hostLobbyControls: document.getElementById('hostLobbyControls'),
  playerLobbyNotice: document.getElementById('playerLobbyNotice'),
  btnStartGame: document.getElementById('btnStartGame'),
  lblMafiaCount: document.getElementById('lblMafiaCount'),
  lblDocBadge: document.getElementById('lblDocBadge'),
  lblDetBadge: document.getElementById('lblDetBadge'),

  // Role Reveal
  roleCardElement: document.getElementById('roleCardElement'),
  roleCardBack: document.getElementById('roleCardBack'),
  roleIconContainer: document.getElementById('roleIconContainer'),
  roleTitleText: document.getElementById('roleTitleText'),
  roleTeamText: document.getElementById('roleTeamText'),
  roleDescriptionText: document.getElementById('roleDescriptionText'),
  mafiaTeammatesBox: document.getElementById('mafiaTeammatesBox'),
  mafiaAlliesList: document.getElementById('mafiaAlliesList'),
  hostProceedNightBar: document.getElementById('hostProceedNightBar'),
  btnProceedToNight: document.getElementById('btnProceedToNight'),
  playerWaitingNightNotice: document.getElementById('playerWaitingNightNotice'),

  // Night
  nightActionContainer: document.getElementById('nightActionContainer'),
  hostNightControlPanel: document.getElementById('hostNightControlPanel'),
  btnResolveNight: document.getElementById('btnResolveNight'),
  checkMafia: document.getElementById('checkMafia'),
  checkDoctor: document.getElementById('checkDoctor'),
  checkDetective: document.getElementById('checkDetective'),

  // Day
  dayIncidentBanner: document.getElementById('dayIncidentBanner'),
  incidentTitle: document.getElementById('incidentTitle'),
  incidentText: document.getElementById('incidentText'),
  incidentIcon: document.getElementById('incidentIcon'),
  votingClockDisplay: document.getElementById('votingClockDisplay'),
  timerProgressFill: document.getElementById('timerProgressFill'),
  dayPlayerCardsList: document.getElementById('dayPlayerCardsList'),
  voteCountBadge: document.getElementById('voteCountBadge'),
  skipVoteWrap: document.getElementById('skipVoteWrap'),
  btnVoteSkip: document.getElementById('btnVoteSkip'),


  // Game Over
  winnerText: document.getElementById('winnerText'),
  winnerSubtitle: document.getElementById('winnerSubtitle'),
  winnerIcon: document.getElementById('winnerIcon'),
  finalPlayersList: document.getElementById('finalPlayersList'),
  hostRestartBar: document.getElementById('hostRestartBar'),
  btnRestartGame: document.getElementById('btnRestartGame')
};

// ==========================================
// INITIALIZATION & URL PARSING
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  // Check URL params (e.g. ?room=ABCD from QR scan)
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    DOM.joinRoomCode.value = roomParam.toUpperCase();
    switchLandingTab('join');
    DOM.joinPlayerName.focus();
    showToast(`Joining Room ${roomParam.toUpperCase()}`);
  }

  // Restore saved player name if available
  const savedName = localStorage.getItem('mafia_player_name');
  if (savedName) {
    DOM.joinPlayerName.value = savedName;
    DOM.hostPlayerName.value = savedName;
  }
});

// Sound toggle handler
DOM.soundToggleBtn.addEventListener('click', () => {
  gameState.soundEnabled = !gameState.soundEnabled;
  DOM.soundIcon.className = gameState.soundEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
  showToast(gameState.soundEnabled ? 'Sound On' : 'Sound Muted');
});

// Toast Helper
function showToast(message, duration = 3000) {
  DOM.toast.textContent = message;
  DOM.toast.classList.add('show');
  setTimeout(() => DOM.toast.classList.remove('show'), duration);
}

// Switch Views
function showView(viewElement) {
  document.querySelectorAll('.view-panel').forEach(v => v.classList.remove('active'));
  viewElement.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Toggle Top Exit Button visibility
  if (viewElement === DOM.viewLanding) {
    DOM.btnExitGame.classList.add('hidden');
  } else {
    DOM.btnExitGame.classList.remove('hidden');
  }
}

// Global Leave Room Function
window.leaveGameRoom = function() {
  sfx.playClick();
  if (gameState.roomCode) {
    socket.emit('leave_room');
  }
  gameState.roomCode = null;
  gameState.isHost = false;
  gameState.myPlayer = null;
  gameState.myRoleInfo = null;
  gameState.status = 'landing';
  gameState.cardFlipped = false;
  gameState.myNightTarget = null;
  gameState.myDayVote = null;
  gameState.votesTally = {};

  if (DOM.roleCardElement) {
    DOM.roleCardElement.classList.remove('is-flipped');
  }

  // Clear query parameter
  if (window.history && window.history.replaceState) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  showView(DOM.viewLanding);
  showToast('You left the game room');
};

if (DOM.btnExitGame) {
  DOM.btnExitGame.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave this game room?')) {
      window.leaveGameRoom();
    }
  });
}

// Landing Tab Switch
function switchLandingTab(tab) {
  sfx.playClick();
  if (tab === 'join') {
    DOM.tabJoin.classList.add('active');
    DOM.tabHost.classList.remove('active');
    DOM.joinFormPanel.classList.remove('hidden');
    DOM.hostFormPanel.classList.add('hidden');
  } else {
    DOM.tabHost.classList.add('active');
    DOM.tabJoin.classList.remove('active');
    DOM.hostFormPanel.classList.remove('hidden');
    DOM.joinFormPanel.classList.add('hidden');
  }
}

// Adjust Mafia count in settings
function adjustMafiaCount(delta) {
  sfx.playClick();
  let count = parseInt(DOM.cfgMafiaCount.textContent) + delta;
  if (count < 1) count = 1;
  if (count > 5) count = 5;
  DOM.cfgMafiaCount.textContent = count;
}

// ==========================================
// USER INTERACTIONS & EVENT LISTENERS
// ==========================================

// Create Room (Host)
DOM.btnCreateRoom.addEventListener('click', () => {
  sfx.init();
  sfx.playClick();
  const hostName = DOM.hostPlayerName.value.trim() || 'Host';
  localStorage.setItem('mafia_player_name', hostName);

  const mafiaCount = parseInt(DOM.cfgMafiaCount.textContent) || 1;
  const enableDoctor = DOM.cfgDoctor.checked;
  const enableDetective = DOM.cfgDetective.checked;

  socket.emit('create_room', { hostName, mafiaCount, enableDoctor, enableDetective }, (res) => {
    if (res.success) {
      gameState.roomCode = res.roomCode;
      gameState.isHost = true;
      gameState.myPlayer = res.player;
      gameState.settings = res.settings;
      setupLobbyView(res.roomCode);
    }
  });
});

// Join Room (Player from phone)
DOM.btnJoinRoom.addEventListener('click', () => {
  sfx.init();
  sfx.playClick();
  const roomCode = DOM.joinRoomCode.value.trim().toUpperCase();
  const playerName = DOM.joinPlayerName.value.trim();

  if (!roomCode || roomCode.length < 3) {
    showToast('Please enter a valid Room Code');
    return;
  }
  if (!playerName) {
    showToast('Please enter your name');
    return;
  }

  localStorage.setItem('mafia_player_name', playerName);

  socket.emit('join_room', { roomCode, playerName }, (res) => {
    if (res.success) {
      gameState.roomCode = res.roomCode;
      gameState.isHost = res.player.isHost;
      gameState.myPlayer = res.player;
      gameState.settings = res.settings || gameState.settings;
      setupLobbyView(res.roomCode);
    } else {
      showToast(res.message || 'Could not join room');
    }
  });
});

// Copy Room Code / Link
DOM.btnCopyCode.addEventListener('click', () => {
  sfx.playClick();
  if (navigator.clipboard && gameState.roomCode) {
    navigator.clipboard.writeText(gameState.roomCode);
    showToast(`Copied code: ${gameState.roomCode}`);
  }
});

// Start Game (Host)
DOM.btnStartGame.addEventListener('click', () => {
  sfx.playClick();
  socket.emit('start_game', (res) => {
    if (res && !res.success) {
      showToast(res.message || 'Cannot start game yet.');
    }
  });
});

// Flip Role Card
function flipRoleCard() {
  sfx.init();
  gameState.cardFlipped = !gameState.cardFlipped;
  DOM.roleCardElement.classList.toggle('is-flipped', gameState.cardFlipped);
  if (gameState.cardFlipped) {
    sfx.playRoleReveal();
  }
}

// Proceed to Night 1 (Host)
DOM.btnProceedToNight.addEventListener('click', () => {
  sfx.playClick();
  socket.emit('proceed_to_night');
});

// Resolve Night (Host)
DOM.btnResolveNight.addEventListener('click', () => {
  sfx.playClick();
  socket.emit('resolve_night');
});



// Skip Day Vote
DOM.btnVoteSkip.addEventListener('click', () => {
  sfx.playClick();
  gameState.myDayVote = 'skip';
  socket.emit('submit_vote', { targetId: 'skip' });
  showToast('You voted to Skip execution');
  renderDayPlayersList();
});

// Restart Game
DOM.btnRestartGame.addEventListener('click', () => {
  sfx.playClick();
  socket.emit('restart_game');
});

// ==========================================
// LOBBY & QR CODE SETUP
// ==========================================
async function setupLobbyView(roomCode) {
  DOM.displayRoomCode.textContent = roomCode;

  // Fetch QR code from server
  try {
    const resp = await fetch(`/api/qr?code=${roomCode}`);
    const data = await resp.json();
    if (data.qr) {
      DOM.qrImage.src = data.qr;
      DOM.displayJoinUrl.textContent = data.joinUrl;
    }
  } catch (err) {
    console.warn('QR fetch error:', err);
  }

  // Toggle Host vs Player lobby controls
  if (gameState.isHost) {
    DOM.hostLobbyControls.classList.remove('hidden');
    DOM.playerLobbyNotice.classList.add('hidden');
  } else {
    DOM.hostLobbyControls.classList.add('hidden');
    DOM.playerLobbyNotice.classList.remove('hidden');
  }

  showView(DOM.viewLobby);
}

function updateLobbyUI(data) {
  gameState.players = data.players || [];
  gameState.settings = data.settings || gameState.settings;
  DOM.lobbyPlayerCountNum.textContent = gameState.players.length;

  // Update role labels in lobby
  DOM.lblMafiaCount.textContent = gameState.settings.mafiaCount;
  DOM.lblDocBadge.style.display = gameState.settings.doctorCount ? 'inline-flex' : 'none';
  DOM.lblDetBadge.style.display = gameState.settings.detectiveCount ? 'inline-flex' : 'none';

  // Render players in lobby
  DOM.lobbyPlayersList.innerHTML = '';
  gameState.players.forEach(p => {
    const isYou = gameState.myPlayer && p.id === gameState.myPlayer.id;
    const card = document.createElement('div');
    card.className = `player-card-badge ${isYou ? 'is-you' : ''}`;
    card.innerHTML = `
      <div class="player-avatar-circle"><i class="fa-solid fa-user"></i></div>
      <span class="player-name">${escapeHtml(p.name)} ${isYou ? '<small>(You)</small>' : ''}</span>
      ${p.isHost ? '<i class="fa-solid fa-crown host-star" title="Host"></i>' : ''}
    `;
    DOM.lobbyPlayersList.appendChild(card);
  });
}

// ==========================================
// SOCKET.IO EVENT HANDLERS
// ==========================================

// Room Update (Lobby)
socket.on('room_updated', (data) => {
  if (data.status === 'lobby') {
    updateLobbyUI(data);
    if (!DOM.viewLobby.classList.contains('active') && !DOM.viewLanding.classList.contains('active')) {
      showView(DOM.viewLobby);
    }
  }
});

// Game Restarted (Play Another Round)
socket.on('game_restarted', (data) => {
  stopVillagerMiniGame();
  sfx.playDayWake();
  gameState.status = 'lobby';
  gameState.myRoleInfo = null;
  gameState.cardFlipped = false;
  gameState.myNightTarget = null;
  gameState.myDayVote = null;
  gameState.votesTally = {};

  if (DOM.roleCardElement) {
    DOM.roleCardElement.classList.remove('is-flipped');
  }

  updateLobbyUI(data);
  setupLobbyView(data.code);
  showToast('New round started! Returned to Lobby.');
});

// Player Left Notification
socket.on('player_left', (data) => {
  showToast(`${data.playerName || 'A player'} left the room.`);
});

// Kicked Notification
socket.on('kicked', () => {
  stopVillagerMiniGame();
  window.leaveGameRoom();
  showToast('You were removed from the room.');
});

// Role Assignment (Private to this socket)
socket.on('role_assigned', (roleData) => {
  gameState.myRoleInfo = roleData;
  renderRoleCard(roleData);
});

// Game Started
socket.on('game_started', (data) => {
  stopVillagerMiniGame();
  gameState.status = 'role_reveal';
  gameState.players = data.players;
  gameState.dayNumber = data.dayNumber || 1;

  if (gameState.isHost) {
    DOM.hostProceedNightBar.classList.remove('hidden');
    DOM.playerWaitingNightNotice.classList.add('hidden');
  } else {
    DOM.hostProceedNightBar.classList.add('hidden');
    DOM.playerWaitingNightNotice.classList.remove('hidden');
  }

  showView(DOM.viewRoleReveal);
});

// Timer State Controller
let timerInterval = null;

function startClientTimer(durationSeconds = 180, endTime = null) {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  const targetEnd = endTime || (Date.now() + durationSeconds * 1000);

  function update() {
    const remainingMs = targetEnd - Date.now();
    const remaining = Math.max(0, Math.floor(remainingMs / 1000));
    const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
    const secs = String(remaining % 60).padStart(2, '0');

    if (DOM.votingClockDisplay) {
      DOM.votingClockDisplay.textContent = `${mins}:${secs}`;
      if (remaining <= 30) {
        DOM.votingClockDisplay.classList.add('urgent');
      } else {
        DOM.votingClockDisplay.classList.remove('urgent');
      }
    }

    if (DOM.timerProgressFill) {
      const pct = Math.max(0, Math.min(100, (remaining / durationSeconds) * 100));
      DOM.timerProgressFill.style.width = `${pct}%`;
    }

    if (remaining <= 5 && remaining > 0) {
      sfx.playTone(800, 'sine', 0.05, 0.06);
    }

    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      if (DOM.votingClockDisplay) DOM.votingClockDisplay.textContent = '00:00';
      if (DOM.timerProgressFill) DOM.timerProgressFill.style.width = '0%';
    }
  }

  update();
  timerInterval = setInterval(update, 1000);
}

function stopClientTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Voting Timer Started (3 Minutes)
socket.on('voting_timer_start', (data) => {
  startClientTimer(data.durationSeconds, data.endTime);
});

/// Phase Changed (Night / Day)
socket.on('phase_changed', (data) => {
  gameState.status = data.status;
  gameState.dayNumber = data.dayNumber || gameState.dayNumber;
  if (data.nightStep) gameState.nightStep = data.nightStep;
  if (data.players) gameState.players = data.players;

  document.querySelectorAll('.lblDayNum').forEach(el => el.textContent = gameState.dayNumber);

  if (data.status === 'night') {
    stopClientTimer();
    if (!DOM.viewNight.classList.contains('active')) {
      sfx.playNightFall();
    }
    setupNightView();
    showView(DOM.viewNight);
  } else if (data.status === 'day_discussion' || data.status === 'day_voting') {
    stopVillagerMiniGame();
    sfx.playDayWake();
    setupDayView(data);
    showView(DOM.viewDay);
  }
});

// Night Actions Progress (Host only)
socket.on('night_actions_progress', (progress) => {
  if (!gameState.isHost) return;
  DOM.checkMafia.className = `check-item ${progress.mafiaCountSubmitted >= progress.mafiaTotal ? 'done' : (progress.nightStep === 'mafia' ? 'active' : '')}`;
  DOM.checkDoctor.className = `check-item ${progress.doctorSubmitted ? 'done' : (progress.nightStep === 'doctor' ? 'active' : '')}`;
  DOM.checkDetective.className = `check-item ${progress.detectiveSubmitted ? 'done' : (progress.nightStep === 'detective' ? 'active' : '')}`;
});

// Detective Investigation Result — only reveals Mafia or Not Mafia (no Doctor/Villager identity)
socket.on('detective_result', (result) => {
  const resultCard = document.getElementById('detectiveResultBox');
  if (resultCard) {
    resultCard.classList.remove('hidden');
    resultCard.innerHTML = `
      <div>Investigated: <strong>${escapeHtml(result.targetName)}</strong></div>
      <div class="investigation-verdict ${result.isMafia ? 'verdict-mafia' : 'verdict-innocent'}">
        ${result.isMafia ? '⚠️ YES — MAFIA MEMBER!' : '✅ NO — NOT MAFIA'}
      </div>
    `;
  }
  showToast(result.isMafia ? '🔴 Mafia found!' : '🟢 Not Mafia');
});

// Day Vote Update
socket.on('vote_update', (data) => {
  gameState.votesTally = data.votes || {};
  DOM.voteCountBadge.textContent = `${data.votedCount} / ${data.totalAlive} Voted`;
  renderDayPlayersList();
});

// Day Resolved
socket.on('day_resolved', (data) => {
  stopClientTimer();
  stopVillagerMiniGame();
  sfx.playGavel();
  gameState.players = data.players;
  showToast(data.voteSummary, 5000);
});

// Game Over
socket.on('game_over', (data) => {
  stopClientTimer();
  stopVillagerMiniGame();
  sfx.playRoleReveal();
  DOM.winnerText.textContent = data.winner === 'Town' ? 'TOWN WINS!' : 'MAFIA WINS!';
  DOM.winnerText.style.color = data.winner === 'Town' ? 'var(--color-doctor)' : 'var(--color-mafia)';
  DOM.winnerSubtitle.textContent = data.summary || '';
  DOM.winnerIcon.innerHTML = data.winner === 'Town' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-skull"></i>';

  // Render final roles
  DOM.finalPlayersList.innerHTML = '';
  (data.players || []).forEach(p => {
    const row = document.createElement('div');
    row.className = 'final-player-row';
    row.innerHTML = `
      <span><strong>${escapeHtml(p.name)}</strong> ${p.isAlive ? '' : '💀 (Eliminated)'}</span>
      <span class="badge role-${(p.role || '').toLowerCase()}">${escapeHtml(p.role || 'Unknown')}</span>
    `;
    DOM.finalPlayersList.appendChild(row);
  });

  if (gameState.isHost) {
    DOM.hostRestartBar.classList.remove('hidden');
  } else {
    DOM.hostRestartBar.classList.add('hidden');
  }

  showView(DOM.viewGameOver);
});

// ==========================================
// ROLE REVEAL RENDERING
// ==========================================
function renderRoleCard(roleData) {
  const role = roleData.role;
  const cardBack = DOM.roleCardBack;
  cardBack.className = `card-face card-back role-${role.toLowerCase()}`;

  let iconHtml = '<i class="fa-solid fa-user"></i>';
  let teamText = 'Team: Town (Innocent)';

  if (role === 'Mafia') {
    iconHtml = '<i class="fa-solid fa-gun"></i>';
    teamText = 'Team: Mafia (Outlaw)';
  } else if (role === 'Doctor') {
    iconHtml = '<i class="fa-solid fa-user-doctor"></i>';
    teamText = 'Team: Town (Healer)';
  } else if (role === 'Detective') {
    iconHtml = '<i class="fa-solid fa-magnifying-glass"></i>';
    teamText = 'Team: Town (Investigator)';
  }

  DOM.roleIconContainer.innerHTML = iconHtml;
  DOM.roleTitleText.textContent = role.toUpperCase();
  DOM.roleTeamText.textContent = teamText;
  DOM.roleDescriptionText.textContent = roleData.description;

  // Mafia Teammates
  if (role === 'Mafia') {
    DOM.mafiaTeammatesBox.classList.remove('hidden');
    if (roleData.mafiaTeammates && roleData.mafiaTeammates.length > 0) {
      DOM.mafiaAlliesList.textContent = roleData.mafiaTeammates.join(', ');
    } else {
      DOM.mafiaAlliesList.textContent = 'None (You are the sole Mafia)';
    }
  } else {
    DOM.mafiaTeammatesBox.classList.add('hidden');
  }
}

// ==========================================
// NIGHT PHASE LOGIC & RENDERING
// ==========================================
function setupNightView() {
  stopVillagerMiniGame();
  gameState.myNightTarget = null;
  const role = gameState.myRoleInfo ? gameState.myRoleInfo.role : 'Villager';

  if (gameState.isHost) {
    DOM.hostNightControlPanel.classList.remove('hidden');
  } else {
    DOM.hostNightControlPanel.classList.add('hidden');
  }

  // Alive players
  const alivePlayers = gameState.players.filter(p => p.isAlive);
  const myId = gameState.myPlayer ? gameState.myPlayer.id : null;
  const amAlive = gameState.players.some(p => p.id === myId && p.isAlive);

  // Sequential night turns: 1. Mafia -> 2. Doctor -> 3. Detective
  const currentStep = gameState.nightStep || 'mafia';

  const isMyTurn = amAlive && (
    (currentStep === 'mafia' && role === 'Mafia') ||
    (currentStep === 'doctor' && role === 'Doctor') ||
    (currentStep === 'detective' && role === 'Detective')
  );

  let html = '';

  if (isMyTurn && role === 'Mafia') {
    // Show mafia teammates' votes panel for coordination
    const teammates = (gameState.myRoleInfo && gameState.myRoleInfo.mafiaTeammates) || [];
    const teamPanel = teammates.length > 0 ? `
      <div class="mafia-coordination-panel" id="mafiaCoordPanel">
        <div class="coord-title"><i class="fa-solid fa-handshake"></i> Team Votes</div>
        <div id="mafiaTeamVotes" class="coord-votes">
          ${teammates.map(name => `
            <div class="coord-vote-row">
              <span class="coord-name">${escapeHtml(name)}</span>
              <span class="coord-target">Deciding...</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    html = `
      <div class="action-header-text"><i class="fa-solid fa-gun" style="color:var(--color-mafia)"></i> Mafia Night Turn</div>
      <p class="action-subtext">Choose an innocent player to eliminate tonight:</p>
      ${teamPanel}
      <div class="action-target-list">
        ${alivePlayers
          .filter(p => p.id !== myId)
          .map(p => `
            <button class="target-btn" onclick="submitNightTarget('${p.id}', this)">
              <span>${escapeHtml(p.name)}</span>
              <i class="fa-solid fa-crosshairs"></i>
            </button>
          `).join('')}
      </div>
    `;
  } else if (isMyTurn && role === 'Doctor') {
    html = `
      <div class="action-header-text"><i class="fa-solid fa-user-doctor" style="color:var(--color-doctor)"></i> Doctor Night Turn</div>
      <p class="action-subtext">Choose one player to protect with medical aid (you can protect yourself):</p>
      <div class="action-target-list">
        ${alivePlayers
          .map(p => `
            <button class="target-btn" onclick="submitNightTarget('${p.id}', this)">
              <span>${escapeHtml(p.name)} ${p.id === myId ? '(You)' : ''}</span>
              <i class="fa-solid fa-shield-heart"></i>
            </button>
          `).join('')}
      </div>
    `;
  } else if (isMyTurn && role === 'Detective') {
    html = `
      <div class="action-header-text"><i class="fa-solid fa-magnifying-glass" style="color:var(--color-detective)"></i> Detective Night Turn</div>
      <p class="action-subtext">Choose a suspect to secretly investigate their allegiance:</p>
      <div class="action-target-list">
        ${alivePlayers
          .filter(p => p.id !== myId)
          .map(p => `
            <button class="target-btn" onclick="submitNightTarget('${p.id}', this)">
              <span>${escapeHtml(p.name)}</span>
              <i class="fa-solid fa-search"></i>
            </button>
          `).join('')}
      </div>
      <div id="detectiveResultBox" class="investigation-result-card hidden"></div>
    `;
  } else {
    // Non-active players (Villagers, or roles whose turn hasn't arrived or is finished) play the reflex mini-game
    const patrolTargets = alivePlayers.filter(p => p.id !== myId);
    html = `
      <div class="action-header-text"><i class="fa-solid fa-shield-halved" style="color:var(--color-villager)"></i> Town Patrol Reflex Game</div>
      <p class="action-subtext">Keep watch! Targets highlight randomly every 1–10s. Tap them quickly to stay alert!</p>
      
      <div class="vigil-stats-bar">
        <div class="vigil-stat-item"><i class="fa-solid fa-bolt" style="color:#ffd166"></i> Score: <strong id="villagerScoreVal">0</strong></div>
        <div class="vigil-stat-item"><i class="fa-solid fa-fire" style="color:#ff6b6b"></i> Streak: <strong id="villagerStreakVal">0</strong></div>
        <div class="vigil-stat-item"><span id="villagerStatusBadge" class="vigil-status-badge waiting">Watching...</span></div>
      </div>

      <div class="action-target-list villager-patrol-list" id="villagerPatrolGrid">
        ${patrolTargets.length > 0 ? patrolTargets.map(p => `
          <button class="target-btn patrol-target-btn" data-player-id="${p.id}" onclick="handleVillagerPatrolTap('${p.id}', this)">
            <span class="patrol-name">${escapeHtml(p.name)}</span>
            <span class="patrol-badge hidden"><i class="fa-solid fa-bolt"></i> TAP!</span>
            <i class="fa-solid fa-user-shield patrol-icon"></i>
          </button>
        `).join('') : `
          <p style="color:var(--text-muted);font-size:0.9rem;">No other players active to patrol.</p>
        `}
      </div>
    `;
  }

  DOM.nightActionContainer.innerHTML = html;

  if (!isMyTurn) {
    startVillagerMiniGame();
  }
}

// ==========================================
// NIGHT PATROL MINI-GAME (1 - 10 Seconds Random Interval)
// ==========================================
let villagerMinigame = {
  activeTimer: null,
  highlightTimer: null,
  highlightedId: null,
  score: 0,
  streak: 0,
  isRunning: false
};

function startVillagerMiniGame() {
  stopVillagerMiniGame();
  villagerMinigame.isRunning = true;
  villagerMinigame.score = 0;
  villagerMinigame.streak = 0;
  villagerMinigame.highlightedId = null;
  updateVillagerStatsUI();
  scheduleNextVillagerHighlight();
}

function stopVillagerMiniGame() {
  villagerMinigame.isRunning = false;
  if (villagerMinigame.activeTimer) {
    clearTimeout(villagerMinigame.activeTimer);
    villagerMinigame.activeTimer = null;
  }
  if (villagerMinigame.highlightTimer) {
    clearTimeout(villagerMinigame.highlightTimer);
    villagerMinigame.highlightTimer = null;
  }
  villagerMinigame.highlightedId = null;
  document.querySelectorAll('.patrol-target-btn').forEach(btn => {
    btn.classList.remove('highlighted', 'hit-success', 'hit-wrong');
    const badge = btn.querySelector('.patrol-badge');
    if (badge) badge.classList.add('hidden');
  });
}

function scheduleNextVillagerHighlight() {
  if (!villagerMinigame.isRunning) return;

  // Random interval between 1 and 10 seconds (1000ms - 10000ms)
  const delayMs = Math.floor(Math.random() * 9000) + 1000;

  const statusBadge = document.getElementById('villagerStatusBadge');
  if (statusBadge) {
    statusBadge.textContent = 'Watching...';
    statusBadge.className = 'vigil-status-badge waiting';
  }

  villagerMinigame.activeTimer = setTimeout(() => {
    triggerVillagerHighlight();
  }, delayMs);
}

function triggerVillagerHighlight() {
  if (!villagerMinigame.isRunning) return;

  const buttons = Array.from(document.querySelectorAll('.patrol-target-btn'));
  if (buttons.length === 0) return;

  // Clear existing highlights
  buttons.forEach(btn => {
    btn.classList.remove('highlighted', 'hit-success', 'hit-wrong');
    const badge = btn.querySelector('.patrol-badge');
    if (badge) badge.classList.add('hidden');
  });

  // Pick random button
  const randomIndex = Math.floor(Math.random() * buttons.length);
  const targetBtn = buttons[randomIndex];
  const targetId = targetBtn.getAttribute('data-player-id');

  villagerMinigame.highlightedId = targetId;
  targetBtn.classList.add('highlighted');
  const badge = targetBtn.querySelector('.patrol-badge');
  if (badge) badge.classList.remove('hidden');

  const statusBadge = document.getElementById('villagerStatusBadge');
  if (statusBadge) {
    statusBadge.textContent = '⚡ TAP NOW!';
    statusBadge.className = 'vigil-status-badge active';
  }

  // Active duration before vanishing: 2.5 seconds
  villagerMinigame.highlightTimer = setTimeout(() => {
    if (villagerMinigame.highlightedId === targetId) {
      targetBtn.classList.remove('highlighted');
      if (badge) badge.classList.add('hidden');
      villagerMinigame.highlightedId = null;
      villagerMinigame.streak = 0;
      updateVillagerStatsUI();

      if (statusBadge) {
        statusBadge.textContent = 'Missed!';
        statusBadge.className = 'vigil-status-badge missed';
      }
      scheduleNextVillagerHighlight();
    }
  }, 2500);
}

window.handleVillagerPatrolTap = function(playerId, btnEl) {
  if (!villagerMinigame.isRunning) return;

  const statusBadge = document.getElementById('villagerStatusBadge');

  if (villagerMinigame.highlightedId && villagerMinigame.highlightedId === playerId) {
    // SUCCESSFUL TAP!
    if (villagerMinigame.highlightTimer) {
      clearTimeout(villagerMinigame.highlightTimer);
      villagerMinigame.highlightTimer = null;
    }
    villagerMinigame.highlightedId = null;

    villagerMinigame.streak += 1;
    const pointsGained = 100 + (villagerMinigame.streak * 20);
    villagerMinigame.score += pointsGained;
    updateVillagerStatsUI();

    sfx.playTone(880, 'triangle', 0.1, 0.15);
    if (navigator.vibrate) {
      try { navigator.vibrate(30); } catch(e){}
    }

    btnEl.classList.remove('highlighted');
    btnEl.classList.add('hit-success');
    const badge = btnEl.querySelector('.patrol-badge');
    if (badge) badge.classList.add('hidden');

    if (statusBadge) {
      statusBadge.textContent = `🎯 +${pointsGained} pts!`;
      statusBadge.className = 'vigil-status-badge success';
    }

    setTimeout(() => {
      btnEl.classList.remove('hit-success');
    }, 350);

    // Schedule next target in random 1 to 10 seconds
    const nextDelay = Math.floor(Math.random() * 9000) + 1000;
    villagerMinigame.activeTimer = setTimeout(() => {
      triggerVillagerHighlight();
    }, nextDelay);

  } else {
    // WRONG TARGET TAP
    sfx.playTone(220, 'sawtooth', 0.15, 0.15);
    if (navigator.vibrate) {
      try { navigator.vibrate([40, 30, 40]); } catch(e){}
    }

    btnEl.classList.add('hit-wrong');
    villagerMinigame.streak = 0;
    updateVillagerStatsUI();

    if (statusBadge) {
      statusBadge.textContent = '❌ Missed!';
      statusBadge.className = 'vigil-status-badge missed';
    }

    setTimeout(() => {
      btnEl.classList.remove('hit-wrong');
    }, 350);
  }
};

function updateVillagerStatsUI() {
  const scoreEl = document.getElementById('villagerScoreVal');
  const streakEl = document.getElementById('villagerStreakVal');
  if (scoreEl) scoreEl.textContent = villagerMinigame.score;
  if (streakEl) streakEl.textContent = villagerMinigame.streak;
}

// Mafia coordination — show live teammate vote updates
socket.on('mafia_vote_update', (data) => {
  const panel = document.getElementById('mafiaTeamVotes');
  if (!panel) return;

  // Update the specific teammate's vote display
  const rows = panel.querySelectorAll('.coord-vote-row');
  rows.forEach(row => {
    const nameEl = row.querySelector('.coord-name');
    const targetEl = row.querySelector('.coord-target');
    if (nameEl && nameEl.textContent === data.voterName) {
      targetEl.textContent = `→ ${data.targetName}`;
      targetEl.classList.add('voted');
    }
  });
});

window.submitNightTarget = function(targetId, btnEl) {
  sfx.playClick();
  const role = gameState.myRoleInfo ? gameState.myRoleInfo.role : 'Villager';

  document.querySelectorAll('.night-action-box .target-btn').forEach(b => b.classList.remove('selected'));
  if (btnEl) btnEl.classList.add('selected');

  gameState.myNightTarget = targetId;

  if (role === 'Mafia') {
    socket.emit('mafia_action', { targetId });
    showToast('Mafia target marked');
  } else if (role === 'Doctor') {
    socket.emit('doctor_action', { targetId });
    showToast('Doctor protection assigned');
  } else if (role === 'Detective') {
    socket.emit('detective_action', { targetId });
  }
};

// ==========================================
// DAY PHASE LOGIC & RENDERING
// ==========================================
function setupDayView(data) {
  // Morning report
  if (data.nightSummary) {
    DOM.incidentText.textContent = data.nightSummary;
    if (data.wasSaved) {
      DOM.incidentIcon.innerHTML = '<i class="fa-solid fa-shield-halved" style="color:var(--color-doctor)"></i>';
    } else if (data.victimName) {
      DOM.incidentIcon.innerHTML = '<i class="fa-solid fa-skull" style="color:var(--color-mafia)"></i>';
    } else {
      DOM.incidentIcon.innerHTML = '<i class="fa-solid fa-dove" style="color:var(--color-doctor)"></i>';
    }
  }



  gameState.myDayVote = null;
  gameState.votesTally = {};
  renderDayPlayersList();
}

function renderDayPlayersList() {
  const alivePlayers = gameState.players.filter(p => p.isAlive);
  const myId = gameState.myPlayer ? gameState.myPlayer.id : null;
  const amAlive = gameState.players.some(p => p.id === myId && p.isAlive);

  // Count votes received per target
  const voteCounts = {};
  Object.values(gameState.votesTally).forEach(vote => {
    const tId = vote.targetId;
    voteCounts[tId] = (voteCounts[tId] || 0) + 1;
  });

  DOM.dayPlayerCardsList.innerHTML = '';

  gameState.players.forEach(p => {
    const isTargetSelected = gameState.myDayVote === p.id;
    const votesForThisPlayer = voteCounts[p.id] || 0;

    const card = document.createElement('div');
    card.className = `day-player-card ${p.isAlive ? '' : 'is-dead'}`;
    card.innerHTML = `
      <div class="player-info-left">
        <div class="player-avatar-circle"><i class="fa-solid ${p.isAlive ? 'fa-user' : 'fa-skull'}"></i></div>
        <div>
          <strong>${escapeHtml(p.name)}</strong> ${p.id === myId ? '<small>(You)</small>' : ''}
          ${votesForThisPlayer > 0 ? `<span class="vote-tally-pill">${votesForThisPlayer} vote${votesForThisPlayer > 1 ? 's' : ''}</span>` : ''}
        </div>
      </div>
      <div>
        ${p.isAlive && amAlive && p.id !== myId ? `
          <button class="btn btn-sm ${isTargetSelected ? 'btn-blood' : 'btn-subtle'}" onclick="castDayVote('${p.id}')">
            <i class="fa-solid fa-gavel"></i> ${isTargetSelected ? 'Voted' : 'Vote Suspect'}
          </button>
        ` : ''}
        ${!p.isAlive ? '<span class="badge" style="color:var(--color-mafia)">Deceased</span>' : ''}
      </div>
    `;
    DOM.dayPlayerCardsList.appendChild(card);
  });
}

window.castDayVote = function(targetId) {
  sfx.playClick();
  gameState.myDayVote = targetId;
  socket.emit('submit_vote', { targetId });
  showToast('Vote cast');
  renderDayPlayersList();
};

// Escape HTML helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}
