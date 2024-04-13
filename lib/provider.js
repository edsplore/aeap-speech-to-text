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
        this.isActive = false;
        this.MAX_BUFFER_SIZE = options.maxBufferSize || 102400; // Smaller buffer for testing
        this.MAX_TIME_THRESHOLD = options.maxTimeThreshold || 5000; // 5 seconds
    }

    async _write(chunk, encoding, callback) {
        this.buffer.push(chunk);
        this.bufferSize += chunk.length;

        if (this.bufferSize >= this.MAX_BUFFER_SIZE) {
            console.log('Buffer size threshold reached, sending data.');
            await this.sendAudioToPython();
        } else if (!this.timer) {
            // Set a timeout to send data if the buffer size is not reached within the threshold time
            this.timer = setTimeout(async () => {
                console.log('Time threshold reached, sending data.');
                await this.sendAudioToPython();
            }, this.MAX_TIME_THRESHOLD);
        }
        callback();
    }

    async sendAudioToPython() {
        if (this.buffer.length === 0) {
            console.log('No data in buffer to send, returning early.');
            return; // Avoid sending empty data
        }

        const bufferConcat = Buffer.concat(this.buffer);
        let fileType;
        try {
            const { default: fileTypeFromBuffer } = await import('file-type');
            fileType = await fileTypeFromBuffer(bufferConcat);
        } catch (e) {
            console.error('Failed to load file-type module:', e);
            return;
        }

        if (!fileType || !['audio/mpeg', 'audio/wav', 'audio/flac'].includes(fileType.mime)) {
            console.error('File is not in a supported audio format:', fileType ? fileType.mime : 'Unknown type');
            this.buffer = [];
            this.bufferSize = 0;
            return;
        }

        console.log('Sending audio to Python server at:', this.ngrokUrl);
        const formData = new FormData();
        formData.append('file', bufferConcat, { filename: `audio.${fileType.ext}`, contentType: fileType.mime, knownLength: bufferConcat.length });

        axios.post(this.ngrokUrl, formData, { headers: formData.getHeaders() })
            .then(response => {
                console.log('Successfully sent audio data, received response:', response.data);
                this.emit('result', {
                    text: response.data.outputs.transcript,
                    confidence: response.data.outputs.confidence || null
                });
                this.buffer = [];
                this.bufferSize = 0;
                clearTimeout(this.timer);
                this.timer = null;
            })
            .catch(error => {
                console.error('Error sending audio to Python server:', error.response || error.message);
                this.buffer = [];
                this.bufferSize = 0;
                clearTimeout(this.timer);
                this.timer = null;
            });
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
