const { Writable } = require('stream');
const axios = require('axios');
const FormData = require('form-data');
const fileType = require('file-type'); // Ensure you have this package installed

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

    _write(chunk, encoding, callback) {
        this.buffer.push(chunk);
        this.bufferSize += chunk.length;

        if (this.bufferSize >= this.MAX_BUFFER_SIZE) {
            console.log('Buffer size threshold reached, sending data.');
            this.sendAudioToPython();
        } else if (!this.timer) {
            // Set a timeout to send data if the buffer size is not reached within the threshold time
            this.timer = setTimeout(() => {
                console.log('Time threshold reached, sending data.');
                this.sendAudioToPython();
            }, this.MAX_TIME_THRESHOLD);
        }
        callback();
    }

    _final(callback) {
        console.log('Finalizing the stream, stopping the service.');
        if (this.bufferSize > 0) {
            this.sendAudioToPython();  // Ensure any remaining data is sent
        }
        this.stop();
        callback();
    }

    sendAudioToPython() {
        if (this.buffer.length === 0) {
            console.log('No data in buffer to send, returning early.');
            return; // Avoid sending empty data
        }

        const bufferConcat = Buffer.concat(this.buffer);
        const type = fileType(bufferConcat); // Detect the file type

        if (!type || !['audio/mpeg', 'audio/wav', 'audio/flac'].includes(type.mime)) {
            console.error('File is not in a supported audio format:', type ? type.mime : 'Unknown type');
            this.buffer = [];
            this.bufferSize = 0;
            return;
        }

        console.log('Sending audio to Python server at:', this.ngrokUrl);
        const formData = new FormData();
        formData.append('file', bufferConcat, { filename: `audio.${type.ext}`, contentType: type.mime, knownLength: bufferConcat.length });

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
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.buffer = [];
        this.bufferSize = 0;
        this.isActive = false;
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
