const { Writable } = require('stream');
const WebSocket = require('ws');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.wsUrl = options.wsUrl || 'wss://7e0c-2405-201-4007-d071-dd18-640e-849b-1778.ngrok-free.app/ws';
        this.websocket = null;
        this.isActive = false;
        this.reconnectInterval = 5000; // Initial reconnect interval in milliseconds
        this.maxReconnectInterval = 30000; // Maximum reconnect interval
        this.connectWebSocket(); // Initiate connection immediately
    }

    connectWebSocket() {
        if (this.websocket && this.websocket.readyState !== WebSocket.CLOSED) {
            console.log('Connection attempt ignored because another is active or opening.');
            return; // Prevent multiple connections
        }

        this.websocket = new WebSocket(this.wsUrl);
        this.websocket.on('open', () => {
            console.log('WebSocket connection established.');
            this.isActive = true;
        });

        this.websocket.on('message', (data) => {
            console.log('Received message:', data.toString());
            this.emit('result', JSON.parse(data.toString()));
        });

        this.websocket.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.isActive = false;
        });

        this.websocket.on('close', () => {
            console.log('WebSocket connection closed. Reconnecting in ' + this.reconnectInterval + 'ms...');
            this.isActive = false;
            setTimeout(() => this.connectWebSocket(), this.reconnectInterval);
            this.reconnectInterval = Math.min(this.reconnectInterval * 2, this.maxReconnectInterval);
        });
    }

    sendData(data) {
        if (this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(data, { binary: true });
        } else {
            console.log('WebSocket is not open. Data not sent.');
        }
    }

    _write(chunk, encoding, callback) {
        if (this.isActive && this.websocket.readyState === WebSocket.OPEN) {
            this.sendData(chunk);
        } else {
            console.log('Waiting for active connection to send data.');
        }
        callback();
    }

    _final(callback) {
        if (this.websocket) {
            this.websocket.close(1000, 'Normal Closure', () => {
                console.log('WebSocket closed.');
                callback();
            });
        } else {
            callback();
        }
    }

    start() {
        if (!this.isActive) {
            console.log('Starting the audio streaming service.');
            this.connectWebSocket();
        } else {
            console.log('Stream is already active.');
        }
    }

    stop() {
        if (this.isActive && this.websocket) {
            console.log('Stopping the audio streaming service.');
            this.websocket.close(1000, 'Normal Closure');
            this.isActive = false;
        } else {
            console.log('Stream is already inactive.');
        }
    }

    restart() {
        console.log('Restarting the audio streaming service.');
        this.stop();
        setTimeout(() => this.start(), 1000); // Give a brief pause before restarting
    }
}

module.exports = {
    getProvider: function(name, options) {
        if (name === "custom") {
            return new CustomProvider(options);
        }
        throw new Error("Unsupported speech provider '" + name + "'");
    }
};
