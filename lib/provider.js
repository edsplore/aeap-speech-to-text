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
        this.queueSize = 0;
        this.isActive = false;
        this.CHUNK_SIZE = 32000;
    }

    _write(chunk, encoding, callback) {
        if (!this.isActive) {
            console.log('Received data but stream is inactive, discarding data.');
            return callback();
        }

        this.queue.push(chunk);
        this.queueSize += chunk.length;

        // Process data immediately if enough data has accumulated
        if (this.queueSize >= this.CHUNK_SIZE) {
            this.processData(callback);
        } else {
            this.maybeProcessData(); // Check and process data if necessary without callback
            callback();
        }
    }

    maybeProcessData() {
        if (this.queueSize >= this.CHUNK_SIZE || (this.isActive && this.queueSize > 0)) {
            this.processData(() => {});
        }
    }

    processData(callback) {
        let totalSizeProcessed = 0;
        let chunksToProcess = [];

        while (totalSizeProcessed < this.CHUNK_SIZE && this.queue.length > 0) {
            let chunk = this.queue.shift();
            chunksToProcess.push(chunk);
            totalSizeProcessed += chunk.length;
            this.queueSize -= chunk.length;
        }

        if (chunksToProcess.length > 0) {
            const bufferConcat = Buffer.concat(chunksToProcess);
            this.convertAndSendData(bufferConcat, callback);
        } else {
            callback();
        }
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
                const result_for_asterisk = { text: response.data.text, score: Math.round(0.7 * 100) };
                this.emit('result', result_for_asterisk);
                fs.unlink(filePath, err => {
                    if (err) console.error(`Failed to delete ${filePath}: ${err}`);
                });
                this.maybeProcessData();  // Continue processing if more data is available
            })
            .catch(error => {
                console.error('Error sending audio to Python server:', error);
                fs.unlink(filePath, err => {
                    if (err) console.error(`Failed to delete ${filePath}: ${err}`);
                });
                this.isActive = false; // Stop processing on critical error
            });
    }

    _final(callback) {
        this.isActive = false;
        this.processData(callback);
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
        this.isActive = false;
        console.log('Stopping the audio streaming service.');
        this.queue = [];
        this.queueSize = 0;
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
