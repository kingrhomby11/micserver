let broadcaster = null;
let listener = null;

wss.on("connection", (ws) => {

    ws.on("message", (data) => {
        const msg = JSON.parse(data);

        if (msg.type === "broadcaster") {
            broadcaster = ws;
            console.log("Broadcaster connected");
            if (listener) listener.send(JSON.stringify({ type: "status", broadcaster: true }));
        }

        if (msg.type === "listener") {
            listener = ws;
            console.log("Listener connected");
            if (broadcaster) listener.send(JSON.stringify({ type: "status", broadcaster: true }));
        }

        if (msg.type === "offer" && listener) {
            console.log("Sending offer to listener");
            listener.send(JSON.stringify({ type: "offer", sdp: msg.sdp }));
        }

        if (msg.type === "answer" && broadcaster) {
            console.log("Sending answer to broadcaster");
            broadcaster.send(JSON.stringify({ type: "answer", sdp: msg.sdp }));
        }

        if (msg.type === "candidate") {
            console.log("Forwarding ICE candidate");

            if (ws === broadcaster && listener)
                listener.send(JSON.stringify({ type: "candidate", candidate: msg.candidate }));

            if (ws === listener && broadcaster)
                broadcaster.send(JSON.stringify({ type: "candidate", candidate: msg.candidate }));
        }
    });

    ws.on("close", () => {
        if (ws === broadcaster) {
            console.log("Broadcaster disconnected");
            broadcaster = null;
            if (listener) listener.send(JSON.stringify({ type: "status", broadcaster: false }));
        }
        if (ws === listener) {
            console.log("Listener disconnected");
            listener = null;
        }
    });
});