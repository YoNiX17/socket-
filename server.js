const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// CONFIGURATION DE BASE
const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Accepte toutes les connexions (à sécuriser plus tard pour la prod)
        methods: ["GET", "POST"]
    }
});

// --- DONNÉES DE JEU ---
// On stocke ici l'état de chaque salle active
// Structure : { [roomId]: { p1: socket, p2: socket, round: 1, scores: {p1:0, p2:0}, currentSong: {}, phase: 'guessing' } }
const rooms = {}; 

// File d'attente pour le matchmaking
let waitingPlayer = null;

// Base de données SIMPLIFIÉE (Idéalement, charge-la depuis un fichier JSON externe ou Firebase Admin)
// Pour l'exemple, on imagine que le serveur a accès à la liste des IDs ou des URLs
// Dans une vraie prod, tu peux soit avoir la DB ici, soit envoyer juste l'ID au client qui a la DB.
// Pour simplifier, on va dire que le serveur envoie un INDEX et que le client regarde dans son op_database.js
const DB_LENGTH = 300; // Taille approximative de ta base OP

// --- LOGIQUE SOCKET ---

io.on('connection', (socket) => {
    console.log(`Nouveau joueur : ${socket.id}`);

    // 1. Identification du joueur
    socket.on('identify', (userData) => {
        socket.user = userData; // { name, avatar, uid }
        console.log(`Identifié : ${socket.user.name}`);
        findMatch(socket);
    });

    // 2. Gestion de la déconnexion
    socket.on('disconnect', () => {
        console.log(`Déconnexion : ${socket.id}`);
        handleDisconnect(socket);
    });

    // 3. Réception d'une réponse (Points)
    socket.on('submit_score', (points) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        
        // Mise à jour du score
        if (socket.id === room.p1.id) room.scores.p1 += points;
        else room.scores.p2 += points;

        // Diffuser les scores immédiatement
        io.to(roomId).emit('score_update', room.scores);
    });
});

// --- FONCTIONS DE JEU ---

function findMatch(socket) {
    if (waitingPlayer) {
        // Match trouvé !
        const opponent = waitingPlayer;
        waitingPlayer = null; // La file est vide

        const roomId = `room_${opponent.id}_${socket.id}`;
        socket.join(roomId);
        opponent.join(roomId);

        socket.roomId = roomId;
        opponent.roomId = roomId;

        // Création de la salle
        rooms[roomId] = {
            id: roomId,
            p1: opponent,
            p2: socket,
            scores: { p1: 0, p2: 0 },
            round: 0,
            maxRounds: 15,
            deck: generateDeck(15),
            timer: null // Pour stocker l'intervalle
        };

        console.log(`Match : ${opponent.user.name} vs ${socket.user.name}`);

        // Dire aux clients que ça commence
        io.to(roomId).emit('match_found', {
            p1: opponent.user,
            p2: socket.user
        });

        // Lancer le premier round après 3s
        setTimeout(() => startRound(roomId), 3000);

    } else {
        // Personne ? On attend.
        waitingPlayer = socket;
        socket.emit('waiting_opponent');
    }
}

function startRound(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    if (room.round >= room.maxRounds) {
        endGame(roomId);
        return;
    }

    // Configuration du Round
    room.round++;
    const songIndex = room.deck[room.round - 1];
    const seekTime = Math.floor(Math.random() * 11) + 40; // Seek entre 40s et 50s

    // Envoi de l'ordre de mission aux clients
    io.to(roomId).emit('round_start', {
        round: room.round,
        songIndex: songIndex,
        seekTime: seekTime,
        duration: 20 // Durée du round
    });

    // --- TIMER SERVEUR ---
    // C'est ici que la magie opère : le serveur compte le temps.
    // Pas besoin de synchro complexe, on laisse juste 20s s'écouler.
    
    let timeLeft = 20;
    room.timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(room.timer);
            revealRound(roomId);
        }
    }, 1000);
}

function revealRound(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    io.to(roomId).emit('round_reveal');

    // Pause de 8 secondes avant la suite
    setTimeout(() => {
        startRound(roomId);
    }, 8000);
}

function endGame(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    io.to(roomId).emit('game_over', room.scores);
    
    // Nettoyage
    room.p1.leave(roomId);
    room.p2.leave(roomId);
    delete rooms[roomId];
}

function handleDisconnect(socket) {
    // Si le joueur était en attente
    if (waitingPlayer === socket) {
        waitingPlayer = null;
    }

    // Si le joueur était en jeu
    if (socket.roomId && rooms[socket.roomId]) {
        io.to(socket.roomId).emit('opponent_left');
        
        // Arrêter le timer si actif
        if(rooms[socket.roomId].timer) clearInterval(rooms[socket.roomId].timer);
        
        delete rooms[socket.roomId];
    }
}

function generateDeck(size) {
    // Génère 'size' index aléatoires uniques (ou pas, selon ta logique)
    const deck = [];
    for(let i=0; i<size; i++) {
        deck.push(Math.floor(Math.random() * DB_LENGTH));
    }
    return deck;
}

// Lancement
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur Red Empire prêt sur le port ${PORT}`);
});
