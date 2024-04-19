const EventEmitter = require("events");
const { WebSocketServer } = require("ws");

const DEFAULT_PORT = 9099;

class WSServer extends EventEmitter {
    constructor(options) {
        super();
        this.port = options && options.port || DEFAULT_PORT;

        this.ws = new WebSocketServer({
            port: this.port,
            clientTracking: true,
        });

        this.ws.on("listening", () => {
            console.info("Server on port '" + this.port + "': started listening");
        });

        this.ws.on("close", () => {
            console.info("Server on port '" + this.port + "': stopped listening");
        });

        this.ws.on("error", (error) => {
            console.error("WebSocket server error:", error);
        });

        this.ws.on("connection", (client) => {
            console.info("Server on port '" + this.port + "': client connected");

            // Keep-alive mechanism
            client.isAlive = true;

            client.on('pong', () => {
                client.isAlive = true;  // Client responded to a ping
            });

            client.on('close', (code, reason) => {
                console.log(`Client disconnected - Code: ${code}, Reason: ${reason}`);
            });

            client.on('error', (error) => {
                console.error(`WebSocket client error: ${error}`);
            });

            this.emit("connection", client);
        });

        // Start pinging clients to check for connections that are still alive
        setInterval(() => {
            this.ws.clients.forEach((client) => {
                if (!client.isAlive) return client.terminate();

                client.isAlive = false;  // Assume connection is dead, wait for pong to set it true
                client.ping(() => {});  // No-op callback in case of ping failure
            });
        }, 30000);
    }

    close() {
        this.ws.clients.forEach((client) => {
            console.log("Closing client connection");
            client.close();
        });

        this.ws.close((error) => {
            if (error) console.log("Error closing WebSocket server:", error);
            else console.log("WebSocket server closed successfully");
        });
    }
}

function getServer(name, options) {
    if (name === "ws") {
        return new WSServer(options);
    }

    throw new Error("Unsupported server type '" + name + "'");
}

module.exports = {
    getServer,
};