import { WebSocketServer } from 'ws';
import http from 'http';

// Your IP (only you can broadcast)
const AUTHORIZED_IP = "115.129.74.51";

const PORT = process.env.PORT || 3000;

// IMPORTANT: HTTP response so Railway doesn't freeze
const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebSocket audio relay server is running.");
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

    console.log("Client connected:", clientIP);

    ws.isBroadcaster = (clientIP === AUTHORIZED_IP);

    if (!ws.isBroadcaster) {
        ws.send(JSON.stringify({ type: "info", message: "You are a listener only." }));
        console.log("Listener connected:", clientIP);
    } else {
        ws.send(JSON.stringify({ type: "authorized", message: "You may broadcast audio." }));
        console.log("Broadcaster connected:", clientIP);
    }

    ws.on('message', (msg) => {
        if (!ws.isBroadcaster) return;

        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === 1) {
                client.send(msg);
            }
        });
    });

    ws.on('close', () => {
        console.log("Client disconnected:", clientIP);
    });
});

// MUST bind to 0.0.0.0 on Railway
server.listen(PORT, "0.0.0.0", () => {
    console.log("WebSocket audio relay running on port:", PORT);
});