const { Writable } = require('stream');
const axios = require('axios');
const FormData = require('form-data');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.ngrokUrl = 'https://6aef-2405-201-4007-d071-699c-42fb-8c6e-cfd2.ngrok-free.app/transcribe'; // Replace <your-ngrok-url> with your actual ngrok URL
        this.buffer = [];
        this.bufferSize = 0;
        this.timer = null;
        this.MAX_BUFFER_SIZE = 1 * 1024 * 1024; // for example, 1 MB
        this.MAX_TIME_THRESHOLD = 5000; // time in milliseconds, e.g., 5000 ms or 5 seconds
    }

    _write(chunk, encoding, callback) {
        this.buffer.push(chunk);
        this.bufferSize += chunk.length;

        if (this.bufferSize >= this.MAX_BUFFER_SIZE) {
            this.sendAudioToPython();
        } else if (!this.timer) {
            this.timer = setTimeout(() => this.sendAudioToPython(), this.MAX_TIME_THRESHOLD);
        }

        callback();
    }

    _final(callback) {
        if (this.bufferSize > 0) {
            this.sendAudioToPython();
        }
        callback();
    }

    sendAudioToPython() {
        if (this.buffer.length === 0) return; // Avoid sending empty data

        const formData = new FormData();
        const bufferConcat = Buffer.concat(this.buffer);
        formData.append('file', bufferConcat, { filename: 'audio.wav', contentType: 'audio/wav', knownLength: bufferConcat.length });

        axios.post(this.ngrokUrl, formData, {
            headers: formData.getHeaders()
        })
        .then(response => {
            this.emit('result', {
                text: response.data.text,
                score: response.data.confidence || null  // Adapt this line based on your Python server response
            });
        })
        .catch(error => console.error('Error sending audio to Python server:', error));

        // Reset buffer and timer
        this.buffer = [];
        this.bufferSize = 0;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
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
}
