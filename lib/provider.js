const { Writable } = require('stream');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.ngrokUrl = options.ngrokUrl || 'http://0.0.0.0:8084/transcribe';
        this.isActive = false;
        this.restartTimer = null;
        this.restartTimeout = options.restartTime || 10; // Automatically restart the stream after this many seconds
    }

    _write(chunk, encoding, callback) {
        if (!this.isActive) {
            console.log('Received data but stream is inactive, discarding data.');
            return callback();
        }

        // Directly send chunk to be processed
        this.convertAndSendData(chunk, callback);
    }

    convertAndSendData(buffer, callback) {
        const outputFile = `output_audio_${new Date().getTime()}.wav`;
        const ffmpegProcess = spawn('ffmpeg', ['-f', 'mulaw', '-ar', '8000', '-ac', '1', '-i', 'pipe:0', outputFile]);

        ffmpegProcess.stdin.write(buffer);
        ffmpegProcess.stdin.end();

        ffmpegProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`FFmpeg exited with code ${code}`);
                return callback(new Error(`FFmpeg exited with code ${code}`));
            }

            this.sendAudioToPython(outputFile, callback);
        });
    }

    sendAudioToPython(filePath, callback) {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath), { filename: path.basename(filePath) });

        axios.post(this.ngrokUrl, formData, { headers: formData.getHeaders() })
            .then(response => {
                console.log('Successfully sent audio data, received response:', response.data);
                const result = { text: response.data.text, score: Math.round(response.data.confidence * 100) };
                this.emit('result', result);
                fs.unlink(filePath, err => {
                    if (err) console.error(`Failed to delete ${filePath}: ${err}`);
                });
                callback();
            })
            .catch(error => {
                console.error('Error sending audio to Python server:', error);
                fs.unlink(filePath, err => {
                    if (err) console.error(`Failed to delete ${filePath}: ${err}`);
                });
                callback(error);
            });
    }

    _final(callback) {
        console.log('Finalizing the stream...');
        this.isActive = false;
        callback();
    }

    start() {
        if (this.isActive) {
            console.log('Stream is already active.');
            return;
        }
        this.isActive = true;
        console.log('Starting the audio streaming service.');
    }

    stop() {
        console.log('Stopping the audio streaming service.');
        this.isActive = false;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
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
