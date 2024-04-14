const { Writable } = require('stream');
const WebSocket = require('ws');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.wsUrl = options.wsUrl || 'wss://f1ca-2405-201-4007-d071-dd18-640e-849b-1778.ngrok-free.app/ws';
        this.websocket = new WebSocket(this.wsUrl);
        this.isActive = false;

        this.websocket.on('open', () => {
            console.log('WebSocket connection established.');
            this.isActive = true;
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

    _write(chunk, encoding, callback) {
        if (!this.isActive) {
            console.log('Received data but stream is inactive, discarding data.');
            callback();
            return;
        }

        // Send data immediately as it's written to the stream
        this.websocket.send(chunk, (error) => {
            if (error) {
                console.error('Failed to send data via WebSocket:', error);
            }
        });
        callback();
    }

    _final(callback) {
        console.log('Finalizing the stream.');
        this.websocket.close(() => {
            console.log('WebSocket closed.');
            callback();
        });
    }

    start() {
        if (this.isActive) {
            console.log('Stream is already active.');
            return;
        }

        console.log('Starting the audio streaming service.');
        this.isActive = true;
    }

    stop() {
        if (!this.isActive) {
            console.log('Stream is already inactive.');
            return;
        }

        console.log('Stopping the audio streaming service.');
        this.isActive = false;
        this.websocket.close();
    }

    restart() {
        console.log('Restarting the audio streaming service.');
        this.stop();
        this.start();
    }
}

module.exports = CustomProvider;
