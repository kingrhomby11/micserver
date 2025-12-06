import { WebSocketServer } from 'ws';
import http from 'http';

// Your IP address (broadcast only allowed from here)
const AUTHORIZED_IP = "115.129.74.51";

const PORT = process.env.PORT || 3000;

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

    console.log("Client connected:", clientIP);

    ws.isBroadcaster = (clientIP === AUTHORIZED_IP);

    if (!ws.isBroadcaster) {
        ws.send(JSON.stringify({ type: "info", message: "You are a listener only." }));
        console.log("A listener connected:", clientIP);
    } else {
        ws.send(JSON.stringify({ type: "authorized", message: "You may broadcast audio." }));
        console.log("Broadcaster connected:", clientIP);
    }

    ws.on('message', (msg) => {
        if (!ws.isBroadcaster) return; // ignore messages from listeners

        // Relay audio to all listeners
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === 1) {
                client.send(msg);
            }
        });
    });

    ws.on('close', () => {
        console.log("Client disconnected:", clientIP);
    });
});

server.listen(PORT, () => {
    console.log("WebSocket audio relay running on port:", PORT);
});