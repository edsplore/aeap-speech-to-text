const { Writable } = require('stream');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

class CustomProvider extends Writable {
    constructor(options) {
        super();
        this.audioData = [];
        this.apiUrl = 'https://6a16-49-36-184-150.ngrok-free.app/transcribe';
    }

    _write(chunk, encoding, callback) {
        this.audioData.push(chunk);
        callback();
    }

    _final(callback) {
        this.sendAudioData().then(() => callback()).catch(err => callback(err));
    }

    async sendAudioData() {
        const data = Buffer.concat(this.audioData);
        const form = new FormData();
        form.append('file', data, 'audio.mp3');

        try {
            const response = await axios.post(this.apiUrl, form, {
                headers: {
                    ...form.getHeaders(),
                },
            });
            console.log(response.data); // Process response data here
            this.emit('result', { text: response.data.transcript }); // Example response handling
        } catch (error) {
            console.error(error);
        }
    }
}

module.exports = {
    getProvider: function(name, options) {
        // Replace "custom" with the appropriate name for your provider
        return new CustomProvider(options);
    },
}
