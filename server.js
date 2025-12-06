import { WebSocketServer } from "ws";
import http from "http";

const AUTHORIZED_IP = "115.129.74.51"; // YOU are broadcaster
const PORT = process.env.PORT || 3000;

const server = http.createServer();
const wss = new WebSocketServer({ server });

function broadcastJSON(data) {
    const str = JSON.stringify(data);
    wss.clients.forEach(c => c.readyState === 1 && c.send(str));
}

wss.on("connection", (ws, req) => {
    const clientIP = req.headers["x-forwarded-for"]?.split(",")[0].trim()
        || req.socket.remoteAddress;

    ws.isBroadcaster = clientIP === AUTHORIZED_IP;

    // Notify client of their role
    ws.send(JSON.stringify({
        type: "role",
        role: ws.isBroadcaster ? "broadcaster" : "listener"
    }));

    // Update everyone
    broadcastJSON({
        type: "status",
        broadcasterConnected: [...wss.clients].some(c => c.isBroadcaster),
        listenerCount: [...wss.clients].filter(c => !c.isBroadcaster).length
    });

    ws.on("message", msg => {
        if (!ws.isBroadcaster) return;

        // Relay audio to listeners
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === 1) {
                client.send(msg);
            }
        });
    });

    ws.on("close", () => {
        broadcastJSON({
            type: "status",
            broadcasterConnected: [...wss.clients].some(c => c.isBroadcaster),
            listenerCount: [...wss.clients].filter(c => !c.isBroadcaster).length
        });
    });
});

server.listen(PORT, () => {
    console.log("Audio relay WebSocket running on port", PORT);
});