const { Writable } = require('stream');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.wsUrl = options.wsUrl;
        this.websocket = null;
        this.isActive = false;
        this.chunkSize = 90000;
        this.buffer = Buffer.alloc(0);
        this.connectWebSocket();
        this.setupQueueHandling();
    }

    connectWebSocket() {
        this.websocket = new WebSocket(this.wsUrl);
        this.websocket.on('open', () => {
            this.isActive = true;
            this.sendKeepAlive();
        });
        this.websocket.on('message', (message) => {
            console.log(message.toString());  // Only log received messages (if needed)
        });
        this.websocket.on('error', (error) => {
            this.isActive = false;
        });
        this.websocket.on('close', () => {
            this.isActive = false;
            setTimeout(() => this.connectWebSocket(), 10000);  // Use a longer delay or handle reconnections elsewhere
        });
    }

    sendKeepAlive() {
        if (this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.ping();
            setTimeout(() => this.sendKeepAlive(), 30000);  // Send a ping every 30 seconds
        }
    }

    setupQueueHandling() {
        this.processingQueue = new EventEmitter();
        this.processingQueue.on('process', (chunk) => {
            if (this.isActive) {
                this.convertAndSendData(chunk);
            }
        });
    }

    _write(chunk, encoding, done) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (this.buffer.length >= this.chunkSize) {
            const chunkToSend = this.buffer.slice(0, this.chunkSize);
            this.buffer = this.buffer.slice(this.chunkSize);
            this.processingQueue.emit('process', chunkToSend);
        }
        done();
    }

    convertAndSendData(chunk, callback) {
        const ffmpegProcess = spawn('ffmpeg', [
            '-f', 'mulaw',
            '-ar', '8000',
            '-ac', '1',
            '-i', 'pipe:0',
            '-ar', '16000',
            '-ac', '1',
            '-f', 'wav',
            'pipe:1'
        ]);

        ffmpegProcess.stdin.write(chunk);
        ffmpegProcess.stdin.end();

        ffmpegProcess.stdout.on('data', (convertedData) => {
            if (this.isActive && this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(convertedData, { binary: true });
            }
        });

        ffmpegProcess.on('error', () => {});

        ffmpegProcess.on('close', (code) => {
            if (code !== 0) {
                // Handle FFmpeg exit due to errors
            }
        });
    }

    start() {
        if (!this.isActive) this.connectWebSocket();
    }

    stop() {
        if (this.isActive && this.websocket) {
            this.isActive = false;
            this.websocket.close(1000, 'Normal Closure');
        }
    }

    restart() {
        this.stop();
        setTimeout(() => this.start(), 1000);
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
