const { Writable, PassThrough } = require('stream');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.wsUrl = options.wsUrl || 'wss://a240-2405-201-4007-d071-e1ba-7856-4a73-a9e5.ngrok-free.app/ws';
        this.websocket = null;
        this.isActive = false;
        this.chunkSize = 90000;
        this.buffer = Buffer.alloc(0); // Initialize buffer
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
        this.processingQueue = new EventEmitter();
        this.processingQueue.on('process', (chunk) => {
            if (this.isActive) {
                this.convertAndSendData(chunk);
            } else {
                setTimeout(() => this.processingQueue.emit('process', chunk), 500);
            }
        });
    }

    _write(chunk, encoding, done) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (this.buffer.length >= this.chunkSize) {
            const chunkToSend = this.buffer.slice(0, this.chunkSize);
            this.buffer = this.buffer.slice(this.chunkSize);
            this.convertAndSendData(chunkToSend, done);  // Pass the callback here
        } else {
            done();  // Only call done here if not processing
        }
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

        let errorOccurred = false;

        ffmpegProcess.stdin.write(chunk);
        ffmpegProcess.stdin.end();

        ffmpegProcess.stdout.on('data', (convertedData) => {
            if (this.isActive && this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(convertedData, { binary: true }, err => {
                    if (err && !errorOccurred) {
                        errorOccurred = true;
                        callback(err);
                    }
                });
            }
        });

        ffmpegProcess.stderr.on('data', (data) => {
            console.error(`FFmpeg stderr: ${data}`);
        });

        ffmpegProcess.on('error', (error) => {
            console.error('FFmpeg error:', error);
            if (!errorOccurred) {
                errorOccurred = true;
                callback(error);
            }
        });

        ffmpegProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`FFmpeg exited with code ${code}`);
                if (!errorOccurred) {
                    errorOccurred = true;
                    callback(new Error(`FFmpeg exited with code ${code}`));
                }
            } else {
                console.log('Audio conversion and transmission complete.');
                if (!errorOccurred) {
                    callback();
                }
            }
        });
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
