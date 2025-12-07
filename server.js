const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: process.env.PORT || 3000 });

let broadcaster = null;
let listener = null;

function safeSend(ws, obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {

    ws.role = "none";

    ws.on("message", (data) => {
        let msg;

        try { msg = JSON.parse(data); }
        catch { return; }

        // ------------------------------
        // REGISTER ROLES
        // ------------------------------
        if (msg.type === "broadcaster") {
            broadcaster = ws;
            ws.role = "broadcaster";
            console.log("Broadcaster connected");
            safeSend(listener, { type: "status", broadcaster: true });
            return;
        }

        if (msg.type === "listener") {
            listener = ws;
            ws.role = "listener";
            console.log("Listener connected");
            safeSend(listener, { type: "status", broadcaster: !!broadcaster });
            return;
        }

        // ------------------------------
        // OFFER -> listener
        // ------------------------------
        if (msg.type === "offer") {
            console.log("Forwarding offer to listener");
            safeSend(listener, { type: "offer", sdp: msg.sdp });
            return;
        }

        // ------------------------------
        // ANSWER -> broadcaster
        // ------------------------------
        if (msg.type === "answer") {
            console.log("Forwarding answer to broadcaster");
            safeSend(broadcaster, { type: "answer", sdp: msg.sdp });
            return;
        }

        // ------------------------------
        // ICE CANDIDATES
        // ------------------------------
        if (msg.type === "candidate") {
            console.log("Forwarding ICE candidate");

            if (ws.role === "broadcaster")
                safeSend(listener, { type: "candidate", candidate: msg.candidate });

            if (ws.role === "listener")
                safeSend(broadcaster, { type: "candidate", candidate: msg.candidate });

            return;
        }
    });

    // ------------------------------
    // CLEANUP ON DISCONNECT
    // ------------------------------
    ws.on("close", () => {
        console.log(`WS closed (${ws.role})`);

        if (ws === broadcaster) {
            broadcaster = null;
            safeSend(listener, { type: "status", broadcaster: false });
        }

        if (ws === listener) {
            listener = null;
        }
    });

    ws.on("error", (err) => {
        console.log("WS ERROR:", err.message);
    });
});

console.log("Server running");