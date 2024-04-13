const { Writable } = require('stream');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { exec } = require('child_process');

class CustomProvider extends Writable {
    constructor(options) {
        super(options);
        this.ngrokUrl = options.ngrokUrl || 'https://f607-2405-201-4007-d071-c463-f6c5-138e-577a.ngrok-free.app/transcribe';
        this.buffer = [];
        this.bufferSize = 0;
        this.timer = null;
        this.isActive = false;
        this.isFinalizing = false;
        this.MAX_BUFFER_SIZE = options.maxBufferSize || 102400;
        this.MAX_TIME_THRESHOLD = options.maxTimeThreshold || 5000;
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
            this.convertAndSendData(callback);
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
        const uniqueId = Date.now(); // Using timestamp as unique identifier
        const tempPath = `./temp_audio_${uniqueId}.raw`;
        const outputPath = `./output_audio_${uniqueId}.wav`;
        fs.writeFileSync(tempPath, bufferConcat);
    
        exec(`ffmpeg -f mulaw -ar 8000 -ac 1 -i ${tempPath} ${outputPath}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error converting audio: ${error.message}`);
                fs.unlink(tempPath, err => {});
                if (callback) callback(error);
                return;
            }
    
            console.log('Audio conversion complete, sending to server...');
            this.sendAudioToPython(outputPath, () => {
                fs.unlink(tempPath, err => {});
                fs.unlink(outputPath, err => {});
                if (callback) callback();
            });
        });
    
        this.buffer = [];
        this.bufferSize = 0;
    }
    
    

    sendAudioToPython(filePath, callback) {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath), { filename: 'output_audio.wav' });

        axios.post(this.ngrokUrl, formData, { headers: formData.getHeaders() })
            .then(response => {
                console.log('Successfully sent audio data, received response:', response.data);
                this.emit('result', response.data);
                if (this.isFinalizing) {
                    this.stop();
                    if (callback) callback();
                }
            })
            .catch(error => {
                console.error('Error sending audio to Python server:', error);
                if (this.isFinalizing) {
                    this.stop();
                    if (callback) callback(error);
                }
            });

        this.buffer = [];
        this.bufferSize = 0;
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
