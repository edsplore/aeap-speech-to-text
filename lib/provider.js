const { Writable } = require('stream');
const WebSocket = require('ws');
const { spawn } = require('child_process');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.wsUrl = options.wsUrl || 'wss://0dc8-2405-201-4007-d071-e1ba-7856-4a73-a9e5.ngrok-free.app/ws';
        this.websocket = null;
        this.isActive = false;
        this.connectWebSocket();
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

    _write(chunk, encoding, callback) {
        if (!this.isActive || this.websocket.readyState !== WebSocket.OPEN) {
            console.log('Waiting for WebSocket connection to be ready...');
            return callback();
        }
        
        this.convertAndSendData(chunk, callback);
    }


    convertAndSendData(chunk, callback) {
        const ffmpegArgs = ['-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'];
        const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    
        ffmpegProcess.stdin.write(chunk);
        ffmpegProcess.stdin.end();
    
        let ffmpegError = '';
    
        ffmpegProcess.stderr.on('data', (data) => {
            ffmpegError += data.toString();
        });
    
        ffmpegProcess.stdout.on('data', (convertedData) => {
            if (this.isActive && this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(convertedData, { binary: true }, callback);
            }
        });
    
        ffmpegProcess.on('error', (error) => {
            console.error('FFmpeg error:', error);
            callback(error);
        });
    
        ffmpegProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`FFmpeg exited with code ${code}`);
                console.error('FFmpeg stderr:', ffmpegError);
                return callback(new Error(`FFmpeg exited with code ${code}`));
            }
            console.log('Audio conversion and transmission complete.');
            callback();
        });
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
