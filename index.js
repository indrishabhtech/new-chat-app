// server.js

import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { availableParallelism } from 'os';
import cluster from 'cluster';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';

const app = express();
const server = createServer(app);

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

const dbPromise = open({
  filename: 'chat.db',
  driver: sqlite3.Database
});

const numCPUs = availableParallelism();
if (cluster.isPrimary) {
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({
      PORT: 3000 + i
    });
  }

  setupPrimary();
} else {
  const io = new Server(server, {
    connectionStateRecovery: {},
    adapter: createAdapter()
  });

  io.on('connection', async (socket) => {
    socket.on('disconnect', () => {
      // Broadcast leaving message with the correct username to all other users
      if (socket.userName) {
        io.emit('user left', socket.userName); 
      }
    });

    socket.on('user joined', (userName) => {
      socket.userName = userName; // Set the username on the socket object
    });

    // Handle 'chat message' event
    socket.on('chat message', async (msg, clientOffset, userName, callback) => {
      try {
        const db = await dbPromise;
        const result = await db.run('INSERT INTO messages (content, client_offset) VALUES (?, ?)', msg, clientOffset);
        io.emit('chat message', msg, result.lastID, userName); // Emit userName along with the message
        callback(); // Callback needs to be inside the 'chat message' event handler
      } catch (e) {
        if (e.errno === 19 /* SQLITE_CONSTRAINT */ ) {
          // Handle constraint violation error
        } else {
          // Handle other errors
        }
      }
    });

    // Additional code...
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}
