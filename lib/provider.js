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
        this.timer = null;
        this.isActive = false;
        this.isFinalizing = false;
        this.MAX_BUFFER_SIZE = options.maxBufferSize || 1024000; // Adjust as necessary
        this.MAX_TIME_THRESHOLD = options.maxTimeThreshold || 200000; // Adjust as necessary
    }

    _write(chunk, encoding, callback) {
        if (!this.isActive) {
            console.log('Received data but stream is inactive, discarding data.');
            callback();
            return;
        }

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
        this.isFinalizing = true;
        if (this.bufferSize > 0) {
            this.convertAndSendData(() => {
                this.stop();
                callback();
            });
        } else {
            this.stop();
            callback();
        }
    }

    convertAndSendData(callback) {
        clearTimeout(this.timer);
        this.timer = null;

        if (this.buffer.length === 0) {
            console.log('No data to process.');
            if (callback) callback();
            return;
        }

        const bufferConcat = Buffer.concat(this.buffer);
        const timestamp = new Date().getTime();  // Get a unique timestamp
        const outputFile = `output_audio_${timestamp}.wav`;
        const ffmpegProcess = spawn('ffmpeg', ['-f', 'mulaw', '-ar', '8000', '-ac', '1', '-i', 'pipe:0', outputFile]);

        ffmpegProcess.stdin.write(bufferConcat);
        ffmpegProcess.stdin.end();

        ffmpegProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`FFmpeg exited with code ${code}`);
                if (callback) callback(new Error(`FFmpeg exited with code ${code}`));
            } else {
                console.log('Audio conversion complete, sending to server...');
                this.sendAudioToPython(outputFile, callback);
            }
        });

        this.buffer = [];
        this.bufferSize = 0;
    }

    sendAudioToPython(filePath, callback) {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath), { filename: path.basename(filePath) });

        axios.post(this.ngrokUrl, formData, { headers: formData.getHeaders() })
            .then(response => {
                console.log('Successfully sent audio data, received response:', response.data);
                const resultText = response.data.text;  // Extract the 'text' field from response.data

                let result_for_asterisk = {
                    text: response.data.text,
                    score: Math.round(0.7 * 100),
                };

                this.emit('result', result_for_asterisk);  // Emit the result
                // this.emit('result', response.data);
                fs.unlink(filePath, err => {
                    if (err) console.error(`Failed to delete ${filePath}: ${err}`);
                });
                if (this.isFinalizing) {
                    this.stop();
                    if (callback) callback();
                }
            })
            .catch(error => {
                console.error('Error sending audio to Python server:', error);
                fs.unlink(filePath, err => {
                    if (err) console.error(`Failed to delete ${filePath}: ${err}`);
                });
                if (this.isFinalizing) {
                    this.stop();
                    if (callback) callback(error);
                }
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
        this.isActive = false;
        this.buffer = [];
        this.bufferSize = 0;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.isFinalizing = false;
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