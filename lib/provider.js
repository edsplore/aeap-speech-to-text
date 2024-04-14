const { Writable } = require('stream');
const WebSocket = require('ws');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.wsUrl = options.wsUrl || 'wss://f1ca-2405-201-4007-d071-dd18-640e-849b-1778.ngrok-free.app/ws';
        this.websocket = new WebSocket(this.wsUrl);
        this.isActive = false;
        this.sendQueue = []; // Queue for storing data when WS is not ready

        this.websocket.on('open', () => {
            console.log('WebSocket connection established.');
            this.isActive = true;
            this.sendQueue.forEach(data => this.sendData(data)); // Send all queued data
            this.sendQueue = []; // Clear the queue
        });

        this.websocket.on('message', (data) => {
            console.log('Received message:', data);
            this.emit('result', data);
        });

        this.websocket.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.isActive = false;
        });

        this.websocket.on('close', () => {
            console.log('WebSocket connection closed.');
            this.isActive = false;
        });
    }

    sendData(chunk, callback) {
        if (this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(chunk, callback);
        } else {
            this.sendQueue.push(chunk); // Queue the data if the socket isn't open
            console.log('WebSocket is not open. Queuing data.');
        }
    }

    _write(chunk, encoding, callback) {
        this.sendData(chunk, (error) => {
            if (error) {
                console.error('Failed to send data via WebSocket:', error);
                callback(error);
                return;
            }
            callback();
        });
    }

    _final(callback) {
        console.log('Finalizing the stream.');
        if (this.websocket.readyState === WebSocket.OPEN) {
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

        console.log('Starting the audio streaming service.');
    }

    stop() {
        if (!this.isActive) {
            console.log('Stream is already inactive.');
            return;
        }

        console.log('Stopping the audio streaming service.');
        this.isActive = false;
        if (this.websocket.readyState === WebSocket.OPEN) {
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