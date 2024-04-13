const { Writable } = require('stream');
const axios = require('axios');
const FormData = require('form-data');
const { exec } = require('child_process');
const fs = require('fs');  // Importing the fs module

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.ngrokUrl = options.ngrokUrl || 'https://f607-2405-201-4007-d071-c463-f6c5-138e-577a.ngrok-free.app/transcribe';
        this.buffer = [];
        this.bufferSize = 0;
        this.timer = null;
        this.isActive = false;
        this.MAX_BUFFER_SIZE = options.maxBufferSize || 102400; // 10 KB buffer size for testing
        this.MAX_TIME_THRESHOLD = options.maxTimeThreshold || 5000; // 5 seconds
    }

    _write(chunk, encoding, callback) {
        this.buffer.push(chunk);
        this.bufferSize += chunk.length;

        if (this.bufferSize >= this.MAX_BUFFER_SIZE) {
            console.log('Buffer size threshold reached, converting and sending data.');
            this.convertAndSendData();
        } else if (!this.timer) {
            this.timer = setTimeout(() => {
                console.log('Time threshold reached, converting and sending data.');
                this.convertAndSendData();
            }, this.MAX_TIME_THRESHOLD);
        }
        callback();
    }

    _final(callback) {
        console.log('Finalizing the stream, stopping the service.');
        if (this.bufferSize > 0) {
            this.convertAndSendData();
        }
        this.stop();
        callback();
    }

    convertAndSendData() {
        const bufferConcat = Buffer.concat(this.buffer);
        // Convert data to WAV using FFmpeg
        const tempPath = 'temp_audio.raw';
        const outputPath = 'output_audio.wav';
        fs.writeFileSync(tempPath, bufferConcat); // Write the buffer to a temporary file

        // Use FFmpeg to convert the audio
        exec(`ffmpeg -f mulaw -ar 8000 -ac 1 -i ${tempPath} ${outputPath}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error converting audio: ${error.message}`);
                return;
            }

            console.log('Audio conversion complete, sending to server...');
            this.sendAudioToPython(outputPath);
        });
    }

    sendAudioToPython(filePath) {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath), { filename: 'output_audio.wav' });

        axios.post(this.ngrokUrl, formData, { headers: formData.getHeaders() })
            .then(response => {
                console.log('Successfully sent audio data, received response:', response.data);
                this.emit('result', response.data);
            })
            .catch(error => {
                console.error('Error sending audio to Python server:', error);
            });

        // Reset buffer and timer
        this.buffer = [];
        this.bufferSize = 0;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
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
