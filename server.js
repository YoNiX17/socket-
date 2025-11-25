const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// --- CONFIGURATION ---
const app = express();
app.use(cors()); // Autorise les connexions de partout

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Autorise ton site (localhost ou vercel)
        methods: ["GET", "POST"]
    }
});

// --- DONNÉES EN MÉMOIRE ---
// Stocke l'état de chaque salle active
const rooms = {};
const queue = []; // File d'attente pour le matchmaking

// Base de données OP (Simplifiée pour l'exemple serveur, idéalement chargée depuis un fichier externe)
// Note: Le serveur envoie juste l'index, le client a la DB complète.
const DECK_SIZE = 300; // Taille approx de ta DB

// --- LOGIQUE DE JEU ---

io.on('connection', (socket) => {
    console.log(`Nouveau joueur connecté: ${socket.id}`);

    // 1. Réception des infos joueur
    socket.on('identify', (userData) => {
        socket.user = userData; // { uid, name, avatar }
        socket.user.score = 0;
        console.log(`Identifié: ${socket.user.name}`);
        
        // Ajouter à la file d'attente
        matchmake(socket);
    });

    // 2. Gestion de la déconnexion
    socket.on('disconnect', () => {
        console.log('Joueur déconnecté');
        // Retirer de la file d'attente
        const index = queue.indexOf(socket);
        if (index > -1) queue.splice(index, 1);
        
        // Gérer si en jeu (Abandon)
        if(socket.roomId && rooms[socket.roomId]) {
            io.to(socket.roomId).emit('opponent_left');
            delete rooms[socket.roomId]; // Fermer la salle
        }
    });

    // 3. Réception d'une réponse (Points)
    socket.on('submit_score', (points) => {
        if(!socket.roomId || !rooms[socket.roomId]) return;
        
        socket.user.score += points;
        
        // Diffuser les scores mis à jour à tout le monde dans la salle
        const room = rooms[socket.roomId];
        io.to(socket.roomId).emit('score_update', {
            p1: room.p1.user.score,
            p2: room.p2.user.score
        });
    });
});

function matchmake(socket) {
    if (queue.length > 0) {
        // Adversaire trouvé !
        const opponent = queue.pop();
        const roomId = `room_${opponent.id}_${socket.id}`;
        
        // Rejoindre la salle Socket.io
        socket.join(roomId);
        opponent.join(roomId);
        
        socket.roomId = roomId;
        opponent.roomId = roomId;

        // Création de l'état de la partie
        rooms[roomId] = {
            id: roomId,
            p1: opponent,
            p2: socket,
            round: 0,
            maxRounds: 15,
            phase: 'lobby',
            deck: generateDeck(15)
        };

        console.log(`Match lancé : ${opponent.user.name} VS ${socket.user.name}`);

        // Envoyer info de démarrage aux clients
        io.to(roomId).emit('match_found', {
            p1: opponent.user,
            p2: socket.user,
            roomId: roomId
        });

        // Démarrer la boucle de jeu après 3s
        setTimeout(() => startGameLoop(roomId), 3000);

    } else {
        // Personne en attente, on s'ajoute
        queue.push(socket);
        socket.emit('waiting_opponent');
    }
}

function generateDeck(count) {
    const deck = [];
    for(let i=0; i<count; i++) {
        // Génère des index aléatoires
        deck.push(Math.floor(Math.random() * DECK_SIZE));
    }
    return deck;
}

function startGameLoop(roomId) {
    const room = rooms[roomId];
    if(!room) return;

    // Fonction pour lancer un round
    const nextRound = () => {
        if (room.round >= room.maxRounds) {
            io.to(roomId).emit('game_over', {
                p1Score: room.p1.user.score,
                p2Score: room.p2.user.score
            });
            delete rooms[roomId];
            return;
        }

        room.round++;
        const songIndex = room.deck[room.round - 1];
        const seekTime = Math.floor(Math.random() * 11) + 40;

        // PHASE 1 : GUESSING (20s)
        io.to(roomId).emit('round_start', {
            round: room.round,
            songIndex: songIndex,
            seekTime: seekTime,
            duration: 20
        });

        // Programmer la fin du round (C'est le serveur qui décide !)
        setTimeout(() => {
            if(!rooms[roomId]) return; // Si la salle a été détruite entre temps

            // PHASE 2 : REVEAL (8s)
            io.to(roomId).emit('round_reveal');

            setTimeout(() => {
                if(!rooms[roomId]) return;
                nextRound(); // Round suivant
            }, 8000);

        }, 20000); // 20 secondes de jeu
    };

    // Lancer le premier round
    nextRound();
}

// Lancer le serveur sur le port 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
