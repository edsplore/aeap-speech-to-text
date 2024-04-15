const { Writable, PassThrough } = require('stream');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.wsUrl = options.wsUrl || 'wss://0dc8-2405-201-4007-d071-e1ba-7856-4a73-a9e5.ngrok-free.app/ws';
        this.websocket = null;
        this.isActive = false;
        this.chunkSize = 90000;
        this.processingQueue = new EventEmitter();
        this.connectWebSocket();
        this.setupQueueHandling();
    }

    connectWebSocket() {
        this.websocket = new WebSocket(this.wsUrl);
        this.websocket.on('open', () => {
            console.log('WebSocket connection established.');
            this.isActive = true;
        });
        this.websocket.on('message', (message) => {
            console.log('Received message:', message.toString());
        });
        this.websocket.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.isActive = false;
        });
        this.websocket.on('close', () => {
            console.log('WebSocket connection closed. Attempting to reconnect...');
            this.isActive = false;
            setTimeout(() => this.connectWebSocket(), 5000);
        });
    }

    setupQueueHandling() {
        this.processingQueue.on('process', (chunk) => {
            if (this.isActive) {
                this.convertAndSendData(chunk);
            } else {
                setTimeout(() => this.processingQueue.emit('process', chunk), 500);
            }
        });
    }

    _write(chunk, encoding, callback) {
        let buffer = Buffer.concat([this.buffer, chunk]);
        while (buffer.length >= this.chunkSize) {
            const chunkToSend = buffer.slice(0, this.chunkSize);
            buffer = buffer.slice(this.chunkSize);
            this.processingQueue.emit('process', chunkToSend);
        }
        this.buffer = buffer;
        callback();
    }

    convertAndSendData(chunk) {
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

        const passThrough = new PassThrough();
        ffmpegProcess.stdout.pipe(passThrough);

        passThrough.on('data', (convertedData) => {
            if (this.isActive && this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(convertedData, { binary: true });
            }
        });

        ffmpegProcess.stderr.on('data', (data) => {
            console.error(`FFmpeg stderr: ${data}`);
        });

        ffmpegProcess.on('error', (error) => {
            console.error('FFmpeg error:', error);
        });

        ffmpegProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`FFmpeg exited with code ${code}`);
            } else {
                console.log('Audio conversion and transmission complete.');
            }
        });

        ffmpegProcess.stdin.write(chunk);
        ffmpegProcess.stdin.end();
    }

    _final(callback) {
        if (this.buffer.length > 0) {
            this.processingQueue.emit('process', this.buffer);
            this.buffer = Buffer.alloc(0);
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
}

module.exports = {
    getProvider: function(name, options) {
        if (name === "custom") {
            return new CustomProvider(options);
        }
        throw new Error("Unsupported speech provider '" + name + "'");
    }
};
