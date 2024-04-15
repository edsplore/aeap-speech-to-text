const { Writable } = require('stream');
const WebSocket = require('ws');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.wsUrl = options.wsUrl || 'wss://8823-2405-201-4007-d071-dd18-640e-849b-1778.ngrok-free.app/ws';
        this.websocket = null;
        this.isActive = false;
        this.buffer = Buffer.alloc(0);
        this.targetBufferLength = 32000; // Target buffer length in bytes, approximately 2 seconds of audio at 16kHz, 16-bit PCM
        this.connectWebSocket(); // Initiate connection immediately
    }

    connectWebSocket() {
        if (this.websocket && this.websocket.readyState !== WebSocket.CLOSED) {
            return; // Prevent multiple connections
        }

        this.websocket = new WebSocket(this.wsUrl);
        this.websocket.on('open', () => {
            console.log('WebSocket connection established.');
            this.isActive = true;
            this.flushBuffer(); // Send any buffered data if exists
        });

        this.websocket.on('message', (data) => {
            console.log('Received message:', data.toString());
        });

        this.websocket.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.isActive = false;
        });

        this.websocket.on('close', () => {
            console.log('WebSocket connection closed. Reconnecting...');
            this.isActive = false;
            setTimeout(() => this.connectWebSocket(), 5000);
        });
    }

    sendData(data) {
        if (this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(data, { binary: true });
        } else {
            console.log('WebSocket is not open. Queuing data.');
        }
    }

    flushBuffer() {
        if (this.buffer.length >= this.targetBufferLength && this.isActive && this.websocket.readyState === WebSocket.OPEN) {
            this.sendData(this.buffer);
            this.buffer = Buffer.alloc(0); // Reset buffer after sending
        }
    }

    _write(chunk, encoding, callback) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (this.buffer.length >= this.targetBufferLength) {
            this.flushBuffer();
        }
        callback();
    }

    _final(callback) {
        if (this.buffer.length > 0) {
            this.flushBuffer(); // Send any remaining data in the buffer
        }
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
        if (this.isActive) {
            console.log('Stopping the audio streaming service.');
            this.isActive = false;
            if (this.websocket) {
                this.websocket.close(1000, 'Normal Closure');
            }
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
