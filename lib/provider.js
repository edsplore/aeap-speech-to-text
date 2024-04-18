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
        this.maxResults = options.maxResults || 100;  // Max results to store before dropping the oldest
        this.results = [];  // Store results

        this.CHUNK_SIZE = options.chunkSize || 32000;  // Size of each chunk to process, could be set in options
        this.buffer = [];  // Buffer to store chunks
        this.bufferSize = 0;  // Current size of the buffer
    }

    _write(chunk, encoding, callback) {
        if (!this.isActive) {
            console.log('Received data but stream is inactive, discarding data.');
            return callback();
        }

        this.buffer.push(chunk);
        this.bufferSize += chunk.length;

        if (this.bufferSize >= this.CHUNK_SIZE) {
            this.processBuffer(callback);
        } else {
            callback();
        }
    }

    processBuffer(callback) {
        const bufferConcat = Buffer.concat(this.buffer);
        this.buffer = [];
        this.bufferSize = 0;

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

                // Handle results storage
                this.results.push(result);
                if (this.results.length > this.maxResults) {
                    this.results.shift();  // Remove the oldest result
                }

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
        if (this.bufferSize > 0) {
            console.log('Finalizing stream, processing remaining buffer...');
            this.processBuffer(callback);
        } else {
            callback();
        }
    }

    start() {
        this.isActive = true;
        console.log('Starting the audio streaming service.');
    }

    stop() {
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

function getProvider(name, options) {
    if (name === "custom") {
        return new CustomProvider(options);
    }
    throw new Error("Unsupported speech provider '" + name + "'");
}

module.exports = {
    getProvider,
};
