const { Writable } = require('stream');
const axios = require('axios');
const FormData = require('form-data');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.ngrokUrl = 'https://6aef-2405-201-4007-d071-699c-42fb-8c6e-cfd2.ngrok-free.app/transcribe';  // Replace <your-ngrok-url> with your actual ngrok URL
        this.buffer = [];
    }

    _write(chunk, encoding, callback) {
        this.buffer.push(chunk);
        callback();
    }

    _final(callback) {
        this.sendAudioToPython();
        callback();
    }

    sendAudioToPython() {
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
