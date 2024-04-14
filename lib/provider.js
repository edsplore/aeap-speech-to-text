const { Writable } = require('stream');
const WebSocket = require('ws');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.wsUrl = options.wsUrl || 'wss://a553-2405-201-4007-d071-dd18-640e-849b-1778.ngrok-free.app/ws';
        this.websocket = new WebSocket(this.wsUrl);
        this.isActive = false;
        this.sendQueue = [];

        this.websocket.on('open', () => {
            console.log('WebSocket connection established.');
            this.isActive = true;
            this.flushQueue();
        });

        this.websocket.on('message', (data) => {
            const messageStr = data.toString('utf8');
            try {
                const messageObj = JSON.parse(messageStr);
                console.log('Received transcription:', messageObj.text);
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
        });
    }

    flushQueue() {
        while (this.sendQueue.length > 0 && this.isActive) {
            const data = this.sendQueue.shift();
            this.sendData(data);
        }
    }

    sendData(chunk, callback) {
        if (this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(chunk, { binary: true }, callback);
        } else {
            this.sendQueue.push(chunk);
            console.log('WebSocket is not open. Queuing data.');
        }
    }

    _write(chunk, encoding, callback) {
        this.sendData(chunk, (error) => {
            if (error) {
                console.error('Failed to send data via WebSocket:', error);
            }
            callback(error);
        });
    }

    _final(callback) {
        console.log('Finalizing the stream.');
        this.websocket.close(1000, 'Normal Closure', () => {
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
    }

    stop() {
        if (!this.isActive) {
            console.log('Stream is already inactive.');
            return;
        }
        console.log('Stopping the audio streaming service.');
        this.isActive = false;
        this.websocket.close(1000, 'Normal Closure');
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