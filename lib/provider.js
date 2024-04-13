const { Writable } = require('stream');
const axios = require('axios');
const FormData = require('form-data');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.ngrokUrl = options.ngrokUrl || 'https://f607-2405-201-4007-d071-c463-f6c5-138e-577a.ngrok-free.app/transcribe';
        this.buffer = [];
        this.bufferSize = 0;
        this.timer = null;
        this.isActive = false; // Flag to check if streaming is active
        this.MAX_BUFFER_SIZE = options.maxBufferSize || 1024 * 1024; // 1 MB
        this.MAX_TIME_THRESHOLD = options.maxTimeThreshold || 5000; // 5 seconds
    }

    _write(chunk, encoding, callback) {
        this.buffer.push(chunk);
        this.bufferSize += chunk.length;

        if (this.bufferSize >= this.MAX_BUFFER_SIZE) {
            this.restart();
        }
        callback();
    }

    _final(callback) {
        this.stop();
        callback();
    }

    sendAudioToPython() {
        if (this.buffer.length === 0) return; // Avoid sending empty data

        const formData = new FormData();
        const bufferConcat = Buffer.concat(this.buffer);
        formData.append('file', bufferConcat, { filename: 'audio.webm', contentType: 'audio/webm', knownLength: bufferConcat.length });

        axios.post(this.ngrokUrl, formData, { headers: formData.getHeaders() })
            .then(response => {
                this.emit('result', {
                    text: response.data.outputs.transcript,
                    confidence: response.data.outputs.confidence || null
                });
                // Reset buffer after successful transmission
                this.buffer = [];
                this.bufferSize = 0;
            })
            .catch(error => {
                console.error('Error sending audio to Python server:', error);
                // Reset buffer after a failed attempt
                this.buffer = [];
                this.bufferSize = 0;
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

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.buffer = [];
        this.bufferSize = 0;
        this.isActive = false;
        console.log('Stopped the audio streaming service.');
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
