const { Writable } = require('stream');
const WebSocket = require('ws');
const recorder = require('node-record-lpcm16');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.wsUrl = options.wsUrl || 'wss://7e0c-2405-201-4007-d071-dd18-640e-849b-1778.ngrok-free.app/ws';
        this.websocket = null;
        this.isActive = false;
        this.recording = null;
        this.connectWebSocket();
    }

    connectWebSocket() {
        if (this.websocket && this.websocket.readyState !== WebSocket.CLOSED) {
            return; // Avoid multiple connections
        }

        this.websocket = new WebSocket(this.wsUrl);
        this.websocket.on('open', () => {
            console.log('WebSocket connection established.');
            this.isActive = true;
            this.startRecording();
        });
        this.websocket.on('message', (data) => console.log('Received message:', data.toString()));
        this.websocket.on('error', (error) => console.error('WebSocket error:', error));
        this.websocket.on('close', () => {
            console.log('WebSocket connection closed. Reconnecting...');
            this.isActive = false;
            setTimeout(() => this.connectWebSocket(), 5000);
        });
    }

    startRecording() {
        if (this.isActive) {
            this.recording = recorder.record({
                sampleRate: 16000, // Set the sample rate suitable for your scenario
                verbose: false,
                recordProgram: 'rec', // or 'arecord', depending on your system
                silence: '10.0' // Duration of silence before stopping the recording (if needed)
            });
            this.recording.stream().pipe(this);
        } else {
            console.log('Cannot start recording, WebSocket not connected.');
        }
    }

    _write(chunk, encoding, callback) {
        if (this.isActive && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(chunk, { binary: true }, callback);
        } else {
            console.log('Waiting for WebSocket connection to be established to send data.');
            callback();
        }
    }

    _final(callback) {
        if (this.recording) {
            this.recording.stop(); // Ensure to stop recording
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
        if (this.isActive && this.recording) {
            console.log('Stopping the audio streaming service.');
            this.recording.stop(); // Stop the recording
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
