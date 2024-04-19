const EventEmitter = require("events");
const { WebSocketServer } = require("ws");
const { getProvider } = require("./provider"); // Make sure this path is correct

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

            // Create a speech object that includes the necessary methods
            let speech = {
                transport: client,
                sendMessage: function(message) {
                    this.transport.send(JSON.stringify(message), { binary: false });
                }
            };

            // Instantiate the custom provider with the speech object
            let provider = getProvider("custom", {}, speech);

            client.isAlive = true;

            client.on('pong', () => {
                client.isAlive = true;  // Client responded to a ping
            });

            client.on('close', (code, reason) => {
                console.log(`Client disconnected - Code: ${code}, Reason: ${reason}`);
                provider.stop(); // Ensure the provider is stopped when the client disconnects
            });

            client.on('error', (error) => {
                console.error(`WebSocket client error: ${error}`);
            });

            client.on('message', function(message) {
                // Process incoming messages, assuming they're meant for the provider
                provider.write(message);
            });

            // Optionally handle 'results' if the provider emits such events
            provider.on('results', results => {
                results.forEach(result => {
                    speech.sendMessage({ request: "set", params: { results: [result] }});
                });
            });

            this.emit("connection", client);
        });

        // Start pinging clients to check for connections that are still alive
        setInterval(() => {
            this.ws.clients.forEach((client) => {
                if (!client.isAlive) return client.terminate();

                client.isAlive = false;
                client.ping(() => {});
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
