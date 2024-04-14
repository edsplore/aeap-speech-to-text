const { Writable } = require('stream');
const WebSocket = require('ws');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.wsUrl = options.wsUrl || 'wss://7e0c-2405-201-4007-d071-dd18-640e-849b-1778.ngrok-free.app/ws';
        this.websocket = null;
        this.isActive = false;
        this.sendQueue = [];
        this.connectWebSocket();  // Initiate connection immediately
    }

    connectWebSocket() {
        this.websocket = new WebSocket(this.wsUrl);

        this.websocket.on('open', () => {
            console.log('WebSocket connection established.');
            this.isActive = true;
            this.flushQueue();
        });

        this.websocket.on('message', (data) => {
            const messageStr = data.toString('utf8');
            try {
                const messageObj = JSON.parse(messageStr);
                console.log('Received message:', messageObj);
                this.emit('result', messageObj);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        });

        this.websocket.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.isActive = false;
        });

        this.websocket.on('close', () => {
            console.log('WebSocket connection closed.');
            this.isActive = false;
            setTimeout(() => this.connectWebSocket(), 5000); // Reconnect after a delay
        });
    }

    flushQueue() {
        while (this.sendQueue.length > 0 && this.isActive) {
            const data = this.sendQueue.shift();
            this.sendData(data);
        }
    }

    sendData(chunk, callback) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(chunk, { binary: true }, callback);
        } else {
            this.sendQueue.push(chunk);
            console.log('WebSocket is not open. Queuing data.');
        }
    }

    _write(chunk, encoding, callback) {
        if (!this.isActive) {
            console.log('Stream is inactive, queuing data');
            this.sendQueue.push(chunk);
            return callback();
        }
        this.sendData(chunk, callback);
    }

    _final(callback) {
        if (this.websocket && this.isActive) {
            this.websocket.close(1000, 'Normal Closure', () => {
                console.log('WebSocket closed.');
                callback();
            });
        } else {
            callback();
        }
    }

    start() {
        if (this.isActive) {
            console.log('Stream is already active.');
            return;
        }
        this.connectWebSocket();
    }

    stop() {
        if (!this.isActive) {
            console.log('Stream is already inactive.');
            return;
        }
        this.isActive = false;
        if (this.websocket) {
            this.websocket.close(1000, 'Normal Closure');
        }
    }

    restart() {
        console.log('Restarting the audio streaming service.');
        this.stop();
        this.start();
    }
}

function getProvider(name, options) {
    if (name === "custom") {
        return new CustomProvider(options);
    }
    throw new Error("Unsupported speech provider '" + name + "'");
}

module.exports = {
    getProvider,
};