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
        this.buffer = [];
        this.bufferSize = 0;
        this.isActive = false;
        this.MAX_BUFFER_SIZE = options.maxBufferSize || 64000; // Smaller buffer for quicker processing
        this.timer = null;
    }

    _write(chunk, encoding, callback) {
        if (!this.isActive) {
            console.log('Received data but stream is inactive, discarding data.');
            callback();
            return;
        }

        this.buffer.push(chunk);
        this.bufferSize += chunk.length;

        // Process immediately if buffer size is reached, without waiting for timer
        if (this.bufferSize >= this.MAX_BUFFER_SIZE) {
            console.log('Buffer size threshold reached, converting and sending data.');
            this.convertAndSendData(callback);
        } else {
            callback();
        }
    }

    convertAndSendData(callback) {
        clearTimeout(this.timer);
        this.timer = null;

        if (this.buffer.length === 0) {
            console.log('No data to process.');
            callback();
            return;
        }

        const bufferConcat = Buffer.concat(this.buffer);
        this.buffer = [];
        this.bufferSize = 0;

        const outputFile = `output_audio_${new Date().getTime()}.wav`;
        const ffmpegProcess = spawn('ffmpeg', ['-f', 'mulaw', '-ar', '8000', '-ac', '1', '-i', 'pipe:0', outputFile]);

        ffmpegProcess.stdin.write(bufferConcat);
        ffmpegProcess.stdin.end();

        ffmpegProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`FFmpeg exited with code ${code}`);
                callback(new Error(`FFmpeg exited with code ${code}`));
            } else {
                console.log('Audio conversion complete, sending to server...');
                this.sendAudioToPython(outputFile, callback);
            }
        });
    }

    sendAudioToPython(filePath, callback) {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath), { filename: path.basename(filePath) });

        axios.post(this.ngrokUrl, formData, { headers: formData.getHeaders() })
            .then(response => {
                console.log('Successfully sent audio data, received response:', response.data);
                const result_for_asterisk = { text: response.data.text, score: Math.round(0.7 * 100) };
                this.emit('result', result_for_asterisk);
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

    start() {
        if (this.isActive) {
            console.log('Stream is already active.');
            return;
        }
        this.isActive = true;
        console.log('Starting the audio streaming service.');
    }

    stop() {
        if (!this.isActive) {
            console.log('Stream is already inactive.');
            return;
        }
        this.isActive = false;
        this.buffer = [];
        this.bufferSize = 0;
        console.log('Stopping the audio streaming service.');
    }

    restart() {
        console.log('Restarting the audio streaming service.');
        this.stop();
        this.start();
    }
    
}

module.exports = {
    getProvider: (name, options) => {
        if (name === "custom") {
            return new CustomProvider(options);
        }
        throw new Error("Unsupported speech provider '" + name + "'");
    }
};