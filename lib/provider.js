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
        this.queue = [];
        this.isActive = false;
        this.CHUNK_SIZE = 64000; // Size of each chunk to process
        this.timer = null;
    }

    _write(chunk, encoding, callback) {
        if (!this.isActive) {
            console.log('Received data but stream is inactive, discarding data.');
            callback();
            return;
        }

        // Add chunk to the queue
        this.queue.push(chunk);

        // Process chunks if enough data is queued
        while (this.queue.length * chunk.length >= this.CHUNK_SIZE) {
            this.processData(callback);
        }
        callback();
    }

    processData(callback) {
        if (this.queue.length === 0) {
            console.log('Queue is empty, no data to process.');
            callback();
            return;
        }

        // Concatenate up to the chunk size or whatever is available
        const toProcess = this.queue.splice(0, Math.ceil(this.CHUNK_SIZE / chunk.length));
        const bufferConcat = Buffer.concat(toProcess);

        this.convertAndSendData(bufferConcat, callback);
    }

    convertAndSendData(buffer, callback) {
        const outputFile = `output_audio_${new Date().getTime()}.wav`;
        const ffmpegProcess = spawn('ffmpeg', ['-f', 'mulaw', '-ar', '8000', '-ac', '1', '-i', 'pipe:0', outputFile]);

        ffmpegProcess.stdin.write(buffer);
        ffmpegProcess.stdin.end();

        ffmpegProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`FFmpeg exited with code ${code}`);
                callback(new Error(`FFmpeg exited with code ${code}`));
                return;
            }

            console.log('Audio conversion complete, sending to server...');
            this.sendAudioToPython(outputFile, callback);
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

    _final(callback) {
        if (this.queue.length > 0) {
            console.log('Finalizing stream, processing remaining queue...');
            this.processData(callback);
        } else {
            callback();
        }
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
        this.queue = [];
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
