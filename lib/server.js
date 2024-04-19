const EventEmitter = require("events");
const { WebSocketServer } = require("ws");
const { getProvider } = require("./provider"); // Adjust path as necessary

const DEFAULT_PORT = 9099;

class WSServer extends EventEmitter {
    constructor(options) {
        super();
        this.port = options && options.port || DEFAULT_PORT;
        this.pingInterval = null; // Store interval ID for cleanup

        this.ws = new WebSocketServer({
            port: this.port,
            clientTracking: true,
        });

        this.ws.on("listening", () => {
            console.info(`Server on port '${this.port}': started listening`);
        });

        this.ws.on("close", () => {
            console.info(`Server on port '${this.port}': stopped listening`);
        });

        this.ws.on("error", (error) => {
            console.error("WebSocket server error:", error);
        });

        this.ws.on("connection", (client) => {
            console.info(`Server on port '${this.port}': client connected`);
            let speech = {
                transport: client,
                sendMessage: function(message) {
                    this.transport.send(JSON.stringify(message), { binary: false });
                }.bind(this)  // Ensure `this` is bound correctly
            };

            let provider = getProvider("custom", {}, speech);

            client.isAlive = true;

            client.on('pong', () => client.isAlive = true);

            client.on('close', (code, reason) => {
                console.log(`Client disconnected - Code: ${code}, Reason: ${reason}`);
                provider.stop();
            });

            client.on('error', (error) => {
                console.error(`WebSocket client error: ${error}`);
            });

            client.on('message', (message) => {
                try {
                    provider.write(message);
                } catch (error) {
                    console.error('Error handling message:', error);
                }
            });

            provider.on('results', (results) => {
                results.forEach(result => {
                    speech.sendMessage({ request: "set", params: { results: [result] }});
                });
            });
        });

        this.startPingingClients();
    }

    startPingingClients() {
        this.pingInterval = setInterval(() => {
            this.ws.clients.forEach((client) => {
                if (!client.isAlive) return client.terminate();

                client.isAlive = false;
                client.ping(() => {});
            });
        }, 30000);
    }

    close() {
        clearInterval(this.pingInterval);  // Clear the interval on close
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
