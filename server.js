const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const qrcode = require('qrcode');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Helper to get local network IP address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIpAddress();

// In-memory Game Rooms storage
const rooms = new Map();

/**
 * Room Data Model:
 * {
 *   code: 'ABCD',
 *   hostSocketId: '...',
 *   settings: {
 *     mafiaCount: 1,
 *     doctorCount: 1,
 *     detectiveCount: 1,
 *     discussionTimeSeconds: 90
 *   },
 *   status: 'lobby' | 'role_reveal' | 'night' | 'day_discussion' | 'day_voting' | 'game_over',
 *   dayNumber: 0,
 *   players: [
 *     { id: 'socketId', name: 'Alice', isHost: true, role: 'Mafia', isAlive: true, isConnected: true }
 *   ],
 *   nightActions: {
 *     mafiaVotes: { 'socketId': 'targetId' },
 *     doctorTarget: 'targetId' | null,
 *     detectiveTarget: 'targetId' | null,
 *     detectiveResult: { targetName: 'Bob', isMafia: false } | null
 *   },
 *   dayVotes: { 'voterId': 'targetId' }, // 'targetId' or 'skip'
 *   history: [],
 *   winner: null
 * }
 */

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Generate QR Code data URL for joining (supports localhost, tunnels, and cloud deployment)
app.get('/api/qr', async (req, res) => {
  const code = req.query.code || '';
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers.host || `${localIp}:${PORT}`;
  const url = `${protocol}://${host}/?room=${code}`;
  try {
    const qrDataUrl = await qrcode.toDataURL(url, {
      margin: 1,
      width: 260,
      color: {
        dark: '#ffffff',
        light: '#141419'
      }
    });
    res.json({ qr: qrDataUrl, joinUrl: url, host, port: PORT });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Helper to sanitize player info for public broadcast
function getPublicPlayers(players) {
  return players.map(p => ({
    id: p.id,
    name: p.name,
    isHost: p.isHost,
    isAlive: p.isAlive,
    isConnected: p.isConnected
  }));
}

// Helper to check win conditions
function checkWinCondition(room) {
  const alivePlayers = room.players.filter(p => p.isAlive);
  const aliveMafia = alivePlayers.filter(p => p.role === 'Mafia');
  const aliveTown = alivePlayers.filter(p => p.role !== 'Mafia');

  // Town wins if all Mafia members are dead
  if (aliveMafia.length === 0) {
    return 'Town';
  }

  // Mafia wins if all Town members are dead
  if (aliveTown.length === 0) {
    return 'Mafia';
  }

  // Mafia wins if they strictly outnumber town (e.g. 2 Mafia vs 1 Town)
  if (aliveMafia.length > aliveTown.length) {
    return 'Mafia';
  }

  // If 1 Mafia vs 1 Town, game continues so Town has the chance to discuss and vote out the Mafia during Day!
  return null;
}

// Helper to calculate auto-recommended mafia count based on player count
function getRecommendedMafia(playerCount) {
  if (playerCount <= 6) return 1;
  if (playerCount <= 10) return 2;
  return Math.max(1, Math.floor(playerCount / 4));
}

io.on('connection', (socket) => {
  let currentRoomCode = null;

  // 1. Create Room (Host)
  socket.on('create_room', ({ hostName, mafiaCount = 1, enableDoctor = true, enableDetective = true }, callback) => {
    let code = generateRoomCode();
    while (rooms.has(code)) {
      code = generateRoomCode();
    }

    const hostPlayer = {
      id: socket.id,
      name: hostName || 'Host',
      isHost: true,
      role: null,
      isAlive: true,
      isConnected: true
    };

    const room = {
      code,
      hostSocketId: socket.id,
      settings: {
        mafiaCount: parseInt(mafiaCount) || 1,
        doctorCount: enableDoctor ? 1 : 0,
        detectiveCount: enableDetective ? 1 : 0,
        discussionTimeSeconds: 90
      },
      status: 'lobby',
      dayNumber: 0,
      players: [hostPlayer],
      nightActions: {
        mafiaVotes: {},
        doctorTarget: null,
        detectiveTarget: null,
        detectiveResult: null
      },
      dayVotes: {},
      history: [],
      winner: null
    };

    rooms.set(code, room);
    currentRoomCode = code;
    socket.join(code);

    if (typeof callback === 'function') {
      callback({ success: true, roomCode: code, player: hostPlayer, settings: room.settings });
    }

    io.to(code).emit('room_updated', {
      code,
      status: room.status,
      settings: room.settings,
      players: getPublicPlayers(room.players),
      hostSocketId: room.hostSocketId
    });
  });

  // 2. Join Room (Player from phone)
  socket.on('join_room', ({ roomCode, playerName }, callback) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      if (typeof callback === 'function') callback({ success: false, message: 'Room not found. Check code.' });
      return;
    }

    if (room.status !== 'lobby') {
      // Check if reconnecting
      const existing = room.players.find(p => p.name.toLowerCase() === playerName.toLowerCase().trim());
      if (existing) {
        existing.id = socket.id;
        existing.isConnected = true;
        currentRoomCode = code;
        socket.join(code);

        if (typeof callback === 'function') {
          callback({
            success: true,
            roomCode: code,
            player: existing,
            roleInfo: existing.role ? getPrivateRoleData(room, existing) : null,
            status: room.status,
            settings: room.settings
          });
        }

        io.to(code).emit('room_updated', {
          code,
          status: room.status,
          settings: room.settings,
          players: getPublicPlayers(room.players),
          hostSocketId: room.hostSocketId
        });
        return;
      }

      if (typeof callback === 'function') callback({ success: false, message: 'Game already in progress.' });
      return;
    }

    // Name collision check
    let finalName = (playerName || 'Player').trim();
    let counter = 2;
    while (room.players.some(p => p.name.toLowerCase() === finalName.toLowerCase())) {
      finalName = `${playerName.trim()} ${counter++}`;
    }

    const newPlayer = {
      id: socket.id,
      name: finalName,
      isHost: false,
      role: null,
      isAlive: true,
      isConnected: true
    };

    room.players.push(newPlayer);
    currentRoomCode = code;
    socket.join(code);

    // Auto adjust recommended mafia count if host hasn't explicitly locked it
    const recommendedMafia = getRecommendedMafia(room.players.length);
    if (!room.settings.customMafia) {
      room.settings.mafiaCount = recommendedMafia;
    }

    if (typeof callback === 'function') {
      callback({
        success: true,
        roomCode: code,
        player: newPlayer,
        settings: room.settings
      });
    }

    io.to(code).emit('room_updated', {
      code,
      status: room.status,
      settings: room.settings,
      players: getPublicPlayers(room.players),
      hostSocketId: room.hostSocketId
    });
  });

  // 3. Update Settings (Host)
  socket.on('update_settings', ({ mafiaCount, doctorCount, detectiveCount, discussionTimeSeconds }, callback) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostSocketId !== socket.id) return;

    if (mafiaCount !== undefined) {
      room.settings.mafiaCount = Math.max(1, parseInt(mafiaCount) || 1);
      room.settings.customMafia = true;
    }
    if (doctorCount !== undefined) room.settings.doctorCount = doctorCount ? 1 : 0;
    if (detectiveCount !== undefined) room.settings.detectiveCount = detectiveCount ? 1 : 0;
    if (discussionTimeSeconds !== undefined) room.settings.discussionTimeSeconds = parseInt(discussionTimeSeconds) || 90;

    io.to(room.code).emit('room_updated', {
      code: room.code,
      status: room.status,
      settings: room.settings,
      players: getPublicPlayers(room.players),
      hostSocketId: room.hostSocketId
    });

    if (typeof callback === 'function') callback({ success: true });
  });

  // Helper for private role info for a given player
  function getPrivateRoleData(room, player) {
    const mafiaTeammates = room.players
      .filter(p => p.role === 'Mafia' && p.id !== player.id)
      .map(p => p.name);

    return {
      role: player.role,
      name: player.name,
      isAlive: player.isAlive,
      mafiaTeammates: player.role === 'Mafia' ? mafiaTeammates : [],
      description: getRoleDescription(player.role)
    };
  }

  function getRoleDescription(role) {
    switch (role) {
      case 'Mafia':
        return 'You are the Mafia. Coordinate secretly with your fellow mafia members at night to eliminate town members.';
      case 'Doctor':
        return 'You are the Doctor. Each night, choose one player to protect with your medical kit. If attacked, they will survive!';
      case 'Detective':
        return 'You are the Detective. Each night, investigate one suspect to discover their true loyalty (Mafia or Innocent).';
      case 'Villager':
      default:
        return 'You are an Innocent Villager. You have no special night abilities, but your voice and vote are vital to finding and hanging the Mafia!';
    }
  }

  // 4. Start Game (Assign Roles)
  socket.on('start_game', (callback) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostSocketId !== socket.id) return;

    const total = room.players.length;
    let mafiaReq = room.settings.mafiaCount;
    let docReq = room.settings.doctorCount;
    let detReq = room.settings.detectiveCount;

    // Validation
    const specialTotal = mafiaReq + docReq + detReq;
    if (total < 3) {
      if (typeof callback === 'function') callback({ success: false, message: 'Need at least 3 players to start.' });
      return;
    }
    if (specialTotal > total) {
      if (typeof callback === 'function') callback({ success: false, message: `Roles count (${specialTotal}) exceeds player count (${total}).` });
      return;
    }

    // Role Distribution Array
    const roleDeck = [];
    for (let i = 0; i < mafiaReq; i++) roleDeck.push('Mafia');
    for (let i = 0; i < docReq; i++) roleDeck.push('Doctor');
    for (let i = 0; i < detReq; i++) roleDeck.push('Detective');
    while (roleDeck.length < total) {
      roleDeck.push('Villager');
    }

    // Cryptographically secure Fisher-Yates shuffle
    // Uses crypto.randomInt for unbiased randomness so host (player[0]) has no positional bias
    function secureShuffleArray(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    secureShuffleArray(roleDeck);

    // Also shuffle a player index mapping so roles aren't always assigned in join order
    const playerIndices = room.players.map((_, idx) => idx);
    secureShuffleArray(playerIndices);

    // Assign roles using shuffled indices for double randomization
    playerIndices.forEach((playerIdx, roleIdx) => {
      room.players[playerIdx].role = roleDeck[roleIdx];
      room.players[playerIdx].isAlive = true;
    });

    room.status = 'role_reveal';
    room.dayNumber = 1;
    room.history = [`Game started with ${total} players.`];
    room.winner = null;

    // Send secret role to each player socket individually
    room.players.forEach(player => {
      const roleData = getPrivateRoleData(room, player);
      io.to(player.id).emit('role_assigned', roleData);
    });

    // Public room update
    io.to(room.code).emit('game_started', {
      code: room.code,
      status: room.status,
      dayNumber: room.dayNumber,
      players: getPublicPlayers(room.players),
      settings: room.settings
    });

    if (typeof callback === 'function') callback({ success: true });
  });

  // 5. Host proceeds from Role Reveal to Night Phase
  socket.on('proceed_to_night', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    enterNightPhase(room);
  });

  function enterNightPhase(room) {
    // Proactive check if game already ended
    const winner = checkWinCondition(room);
    if (winner) {
      room.status = 'game_over';
      room.winner = winner;
      io.to(room.code).emit('game_over', {
        winner,
        summary: winner === 'Town' ? 'All Mafia members eliminated! Town wins!' : 'Mafia has outnumbered the town! Mafia wins!',
        players: room.players.map(p => ({
          name: p.name,
          role: p.role,
          isAlive: p.isAlive
        })),
        history: room.history
      });
      return;
    }

    room.status = 'night';
    room.nightActions = {
      mafiaVotes: {},
      doctorTarget: null,
      detectiveTarget: null,
      detectiveResult: null
    };
    room.nightStep = null;
    advanceNightStep(room);
  }

  function advanceNightStep(room) {
    // Proactive check if game already ended
    const winner = checkWinCondition(room);
    if (winner) {
      room.status = 'game_over';
      room.winner = winner;
      io.to(room.code).emit('game_over', {
        winner,
        summary: winner === 'Town' ? 'All Mafia members eliminated! Town wins!' : 'Mafia has outnumbered the town! Mafia wins!',
        players: room.players.map(p => ({
          name: p.name,
          role: p.role,
          isAlive: p.isAlive
        })),
        history: room.history
      });
      return;
    }

    const aliveMafia = room.players.filter(p => p.role === 'Mafia' && p.isAlive);
    const aliveDoctor = room.players.filter(p => p.role === 'Doctor' && p.isAlive);
    const aliveDetective = room.players.filter(p => p.role === 'Detective' && p.isAlive);

    let nextStep = null;

    if (!room.nightStep) {
      if (aliveMafia.length > 0) {
        nextStep = 'mafia';
      } else if (aliveDoctor.length > 0) {
        nextStep = 'doctor';
      } else if (aliveDetective.length > 0) {
        nextStep = 'detective';
      } else {
        nextStep = 'resolve';
      }
    } else if (room.nightStep === 'mafia') {
      if (aliveDoctor.length > 0) {
        nextStep = 'doctor';
      } else if (aliveDetective.length > 0) {
        nextStep = 'detective';
      } else {
        nextStep = 'resolve';
      }
    } else if (room.nightStep === 'doctor') {
      if (aliveDetective.length > 0) {
        nextStep = 'detective';
      } else {
        nextStep = 'resolve';
      }
    } else if (room.nightStep === 'detective') {
      nextStep = 'resolve';
    }

    if (nextStep === 'resolve') {
      resolveNightHelper(room);
    } else {
      room.nightStep = nextStep;
      io.to(room.code).emit('phase_changed', {
        status: 'night',
        nightStep: room.nightStep,
        dayNumber: room.dayNumber,
        players: getPublicPlayers(room.players),
        message: `🌙 Night Phase: ${room.nightStep.toUpperCase()} Turn`
      });
      notifyNightProgress(room);
    }
  }

  function notifyNightProgress(room) {
    const aliveMafia = room.players.filter(p => p.role === 'Mafia' && p.isAlive);
    const aliveDoctor = room.players.filter(p => p.role === 'Doctor' && p.isAlive);
    const aliveDetective = room.players.filter(p => p.role === 'Detective' && p.isAlive);

    io.to(room.hostSocketId).emit('night_actions_progress', {
      nightStep: room.nightStep,
      mafiaCountSubmitted: Object.keys(room.nightActions.mafiaVotes).length,
      mafiaTotal: aliveMafia.length,
      doctorSubmitted: room.nightActions.doctorTarget !== null || aliveDoctor.length === 0,
      detectiveSubmitted: room.nightActions.detectiveTarget !== null || aliveDetective.length === 0,
      allReady: false
    });
  }

  // 6. Night Action: Mafia Target
  socket.on('mafia_action', ({ targetId }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.status !== 'night' || room.nightStep !== 'mafia') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== 'Mafia' || !player.isAlive) return;

    room.nightActions.mafiaVotes[socket.id] = targetId;

    // Broadcast mafia vote status to all Mafia members
    const mafiaPlayers = room.players.filter(p => p.role === 'Mafia' && p.isAlive);
    const targetPlayer = room.players.find(p => p.id === targetId);

    mafiaPlayers.forEach(m => {
      io.to(m.id).emit('mafia_vote_update', {
        voterName: player.name,
        targetId,
        targetName: targetPlayer ? targetPlayer.name : 'Unknown'
      });
    });

    notifyNightProgress(room);

    // If all alive mafia submitted votes, auto-advance to doctor after 1 second
    if (Object.keys(room.nightActions.mafiaVotes).length >= mafiaPlayers.length) {
      setTimeout(() => {
        if (room.status === 'night' && room.nightStep === 'mafia') {
          advanceNightStep(room);
        }
      }, 1000);
    }
  });

  // 7. Night Action: Doctor Protect
  socket.on('doctor_action', ({ targetId }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.status !== 'night' || room.nightStep !== 'doctor') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== 'Doctor' || !player.isAlive) return;

    room.nightActions.doctorTarget = targetId;
    const targetPlayer = room.players.find(p => p.id === targetId);

    socket.emit('doctor_confirmed', {
      targetId,
      targetName: targetPlayer ? targetPlayer.name : 'Unknown'
    });

    notifyNightProgress(room);

    // Auto-advance to detective after 1 second
    setTimeout(() => {
      if (room.status === 'night' && room.nightStep === 'doctor') {
        advanceNightStep(room);
      }
    }, 1000);
  });

  // 8. Night Action: Detective Investigate
  // Detective only learns if the target is Mafia or NOT Mafia — no other role info is revealed
  socket.on('detective_action', ({ targetId }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.status !== 'night' || room.nightStep !== 'detective') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== 'Detective' || !player.isAlive) return;

    room.nightActions.detectiveTarget = targetId;
    const targetPlayer = room.players.find(p => p.id === targetId);

    const isMafia = targetPlayer ? (targetPlayer.role === 'Mafia') : false;
    const result = {
      targetId,
      targetName: targetPlayer ? targetPlayer.name : 'Unknown',
      isMafia
    };
    room.nightActions.detectiveResult = result;

    socket.emit('detective_result', result);
    notifyNightProgress(room);

    // Give detective 2.5 seconds to see investigation result, then auto-resolve night to day
    setTimeout(() => {
      if (room.status === 'night' && room.nightStep === 'detective') {
        advanceNightStep(room);
      }
    }, 2500);
  });

  // 9. Host resolves Night / triggers Day (Manual fallback)
  socket.on('resolve_night', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostSocketId !== socket.id || room.status !== 'night') return;
    resolveNightHelper(room);
  });

  function resolveNightHelper(room) {
    if (!room || room.status !== 'night') return;

    // Determine Mafia Kill Target (majority vote)
    const votes = Object.values(room.nightActions.mafiaVotes);
    let targetKilledId = null;
    if (votes.length > 0) {
      const tally = {};
      votes.forEach(v => tally[v] = (tally[v] || 0) + 1);
      let maxCount = 0;
      for (const [id, count] of Object.entries(tally)) {
        if (count > maxCount) {
          maxCount = count;
          targetKilledId = id;
        }
      }
    }

    const doctorProtectedId = room.nightActions.doctorTarget;
    let victim = null;
    let wasSaved = false;

    if (targetKilledId) {
      victim = room.players.find(p => p.id === targetKilledId);
      if (victim && targetKilledId === doctorProtectedId) {
        wasSaved = true;
      } else if (victim) {
        victim.isAlive = false;
      }
    }

    let nightSummary = '';
    if (wasSaved && victim) {
      nightSummary = `🕊️ It was a quiet night. No one died tonight!`;
    } else if (victim) {
      nightSummary = `🩸 ${victim.name} was attacked and eliminated by the Mafia during the night!`;
    } else {
      nightSummary = `🕊️ A peaceful night. No one was killed.`;
    }

    room.history.push(`Night ${room.dayNumber}: ${nightSummary}`);

    // Check Win Condition
    const winner = checkWinCondition(room);
    if (winner) {
      room.status = 'game_over';
      room.winner = winner;
      io.to(room.code).emit('game_over', {
        winner,
        summary: nightSummary,
        players: room.players.map(p => ({
          name: p.name,
          role: p.role,
          isAlive: p.isAlive
        })),
        history: room.history
      });
      return;
    }

    // Move to Day Discussion / Voting (Auto-starts 3 min timer)
    room.status = 'day_voting';
    room.dayVotes = {};

    io.to(room.code).emit('phase_changed', {
      status: room.status,
      dayNumber: room.dayNumber,
      players: getPublicPlayers(room.players),
      nightSummary,
      wasSaved,
      victimName: wasSaved ? null : (victim ? victim.name : null),
      history: room.history,
      message: '☀️ Town wakes up! You have 3 minutes to discuss and vote. Uncast votes will automatically count as Skip.'
    });

    startVotingTimer(room);
  }

  // Helper to start the 3-minute (180 seconds) voting countdown
  function startVotingTimer(room) {
    if (room.votingTimer) {
      clearTimeout(room.votingTimer);
      room.votingTimer = null;
    }

    const durationSeconds = 180; // 3 Minutes
    const endTime = Date.now() + durationSeconds * 1000;
    room.votingEndTime = endTime;

    io.to(room.code).emit('voting_timer_start', {
      durationSeconds,
      endTime
    });

    // Auto-resolve when 3 minutes expire
    room.votingTimer = setTimeout(() => {
      if (room.status === 'day_voting') {
        resolveVoting(room, true);
      }
    }, durationSeconds * 1000);
  }

  // 10. Start Day Voting Phase (Manual trigger fallback)
  socket.on('start_day_voting', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostSocketId !== socket.id) return;

    room.status = 'day_voting';
    startVotingTimer(room);

    io.to(room.code).emit('phase_changed', {
      status: room.status,
      dayNumber: room.dayNumber,
      players: getPublicPlayers(room.players),
      message: '⚖️ Voting timer started (3 minutes). Cast your vote or it will default to Skip.'
    });
  });

  // 11. Submit Day Vote
  socket.on('submit_vote', ({ targetId }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.status !== 'day_voting') return;

    const voter = room.players.find(p => p.id === socket.id);
    if (!voter || !voter.isAlive) return;

    room.dayVotes[socket.id] = targetId; // targetId can be socketId or 'skip'

    // Format vote tally for public broadcast
    const alivePlayers = room.players.filter(p => p.isAlive);
    const voteMap = {};
    Object.entries(room.dayVotes).forEach(([vId, tId]) => {
      const vPlayer = room.players.find(p => p.id === vId);
      const tPlayer = tId === 'skip' ? { name: 'Skip / No Lynch' } : room.players.find(p => p.id === tId);
      if (vPlayer && tPlayer) {
        voteMap[vId] = {
          voterName: vPlayer.name,
          targetId: tId,
          targetName: tPlayer.name
        };
      }
    });

    io.to(room.code).emit('vote_update', {
      votes: voteMap,
      votedCount: Object.keys(room.dayVotes).length,
      totalAlive: alivePlayers.length
    });

    // Count tallies to see if a strict majority has already been reached
    const tally = {};
    Object.values(room.dayVotes).forEach(tId => {
      tally[tId] = (tally[tId] || 0) + 1;
    });
    const maxVotes = Math.max(...Object.values(tally), 0);
    const majorityThreshold = Math.floor(alivePlayers.length / 2) + 1;
    const allVoted = Object.keys(room.dayVotes).length >= alivePlayers.length;
    const hasMajority = maxVotes >= majorityThreshold;

    // Auto-resolve quickly without waiting for full 3 mins!
    if (allVoted || hasMajority) {
      if (!room.resolvingVoteTimer) {
        room.resolvingVoteTimer = setTimeout(() => {
          room.resolvingVoteTimer = null;
          if (room.status === 'day_voting') {
            resolveVoting(room, false);
          }
        }, 1200);
      }
    }
  });

  // Reusable Voting Resolution Helper
  function resolveVoting(room, isTimeExpired = false) {
    if (!room || room.status !== 'day_voting') return;

    if (room.votingTimer) {
      clearTimeout(room.votingTimer);
      room.votingTimer = null;
    }
    if (room.resolvingVoteTimer) {
      clearTimeout(room.resolvingVoteTimer);
      room.resolvingVoteTimer = null;
    }

    const alivePlayers = room.players.filter(p => p.isAlive);

    // If anyone has not voted, mark their vote as 'skip'
    alivePlayers.forEach(p => {
      if (!room.dayVotes[p.id]) {
        room.dayVotes[p.id] = 'skip';
      }
    });

    const tally = {};
    Object.values(room.dayVotes).forEach(tId => {
      tally[tId] = (tally[tId] || 0) + 1;
    });

    let highestTarget = null;
    let highestCount = 0;
    let isTie = false;

    for (const [targetId, count] of Object.entries(tally)) {
      if (count > highestCount) {
        highestCount = count;
        highestTarget = targetId;
        isTie = false;
      } else if (count === highestCount && count > 0) {
        isTie = true;
      }
    }

    let voteSummary = '';
    let executedPlayer = null;

    if (isTie || !highestTarget || highestTarget === 'skip') {
      voteSummary = isTie 
        ? '⚖️ The vote ended in a tie. No one was eliminated today.' 
        : (isTimeExpired ? '⏱️ Voting time expired (3 min). The town skipped execution today.' : '⚖️ The town voted to skip execution today.');
    } else {
      executedPlayer = room.players.find(p => p.id === highestTarget);
      if (executedPlayer) {
        executedPlayer.isAlive = false;
        voteSummary = `⚖️ The town voted to eliminate ${executedPlayer.name}! Their true role was: ${executedPlayer.role}.`;
      }
    }

    room.history.push(`Day ${room.dayNumber} Vote: ${voteSummary}`);

    // Check Win Condition
    const winner = checkWinCondition(room);
    if (winner) {
      room.status = 'game_over';
      room.winner = winner;
      io.to(room.code).emit('game_over', {
        winner,
        summary: voteSummary,
        players: room.players.map(p => ({
          name: p.name,
          role: p.role,
          isAlive: p.isAlive
        })),
        history: room.history
      });
      return;
    }

    // Advance Day counter and prepare for next Night
    room.dayNumber += 1;
    room.status = 'lobby_between_rounds';

    io.to(room.code).emit('day_resolved', {
      voteSummary,
      executedPlayer: executedPlayer ? { name: executedPlayer.name, role: executedPlayer.role } : null,
      players: getPublicPlayers(room.players),
      dayNumber: room.dayNumber,
      history: room.history
    });

    // Auto-transition to next night after 5 seconds so players can read the result
    setTimeout(() => {
      if (room.status !== 'lobby_between_rounds') return; // guard against manual override or restart
      enterNightPhase(room);
    }, 5000);
  }

  // 12. Host Resolves Voting Manually
  socket.on('resolve_voting', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostSocketId !== socket.id || room.status !== 'day_voting') return;
    resolveVoting(room, false);
  });

  // 13. Restart / Reset Game
  socket.on('restart_game', () => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    room.status = 'lobby';
    room.dayNumber = 0;
    room.history = [];
    room.winner = null;
    room.nightActions = { mafiaVotes: {}, doctorTarget: null, detectiveTarget: null, detectiveResult: null };
    room.dayVotes = {};

    room.players.forEach(p => {
      p.role = null;
      p.isAlive = true;
    });

    io.to(room.code).emit('game_restarted', {
      code: room.code,
      status: 'lobby',
      settings: room.settings,
      players: getPublicPlayers(room.players),
      hostSocketId: room.hostSocketId
    });

    io.to(room.code).emit('room_updated', {
      code: room.code,
      status: 'lobby',
      settings: room.settings,
      players: getPublicPlayers(room.players),
      hostSocketId: room.hostSocketId
    });
  });

  // 14. Leave Room / Exit Game
  socket.on('leave_room', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const leavingPlayer = room.players.find(p => p.id === socket.id);
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(currentRoomCode);

    // If host left, pass host to next player or delete room
    if (room.hostSocketId === socket.id && room.players.length > 0) {
      room.hostSocketId = room.players[0].id;
      room.players[0].isHost = true;
    }

    if (room.players.length === 0) {
      rooms.delete(currentRoomCode);
    } else {
      io.to(room.code).emit('room_updated', {
        code: room.code,
        status: room.status,
        settings: room.settings,
        players: getPublicPlayers(room.players),
        hostSocketId: room.hostSocketId
      });
      io.to(room.code).emit('player_left', {
        playerName: leavingPlayer ? leavingPlayer.name : 'A player'
      });
    }

    currentRoomCode = null;
  });

  // 15. Kick Player
  socket.on('kick_player', ({ playerId }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostSocketId !== socket.id) return;

    room.players = room.players.filter(p => p.id !== playerId);
    io.to(playerId).emit('kicked');

    io.to(room.code).emit('room_updated', {
      code: room.code,
      status: room.status,
      settings: room.settings,
      players: getPublicPlayers(room.players),
      hostSocketId: room.hostSocketId
    });
  });

  // Handle Disconnect
  socket.on('disconnect', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.isConnected = false;
      if (room.status === 'lobby') {
        // If in lobby, remove player completely
        room.players = room.players.filter(p => p.id !== socket.id);
      }
    }

    // If host left and lobby is empty, clean up room
    if (room.players.length === 0) {
      rooms.delete(currentRoomCode);
    } else {
      io.to(room.code).emit('room_updated', {
        code: room.code,
        status: room.status,
        settings: room.settings,
        players: getPublicPlayers(room.players),
        hostSocketId: room.hostSocketId
      });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(` 🎭 MAFIA GAME SERVER RUNNING`);
  console.log(` Local:   http://localhost:${PORT}`);
  console.log(` Network: http://${localIp}:${PORT}`);
  console.log(`=========================================`);
});
