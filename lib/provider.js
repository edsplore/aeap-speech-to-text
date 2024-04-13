const { Writable } = require('stream');
const axios = require('axios');
const FormData = require('form-data');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.ngrokUrl = 'https://f607-2405-201-4007-d071-c463-f6c5-138e-577a.ngrok-free.app/transcribe'; // Replace with your actual ngrok URL
        this.buffer = [];
        this.bufferSize = 0;
        this.timer = null;
        this.MAX_BUFFER_SIZE = 1024 * 1024; // 1 MB, adjust if needed
        this.MAX_TIME_THRESHOLD = 5000; // 5 seconds, adjust based on latency requirements
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
        formData.append('file', bufferConcat, { filename: 'audio.webm', contentType: 'audio/webm', knownLength: bufferConcat.length });

        axios.post(this.ngrokUrl, formData, {
            headers: formData.getHeaders()
        })
        .then(response => {
            if (response.data.error) {
                console.error('Error from Python server:', response.data.error);
            } else {
                this.emit('result', {
                    text: response.data.outputs.transcript, // assuming the response has a transcript field
                    confidence: response.data.outputs.confidence || null // assuming there's a confidence field
                });
            }
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
