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
        this.responseBuffer = [];  // Buffer to accumulate responses
        this.bufferTimer = null;  // Timer for sending buffered responses
    }

    _write(chunk, encoding, callback) {
        if (!this.isActive) {
            console.log('Received data but stream is inactive, discarding data.');
            return callback();
        }

        this.queue.push(chunk);
        this.queueSize += chunk.length;

        if (this.queueSize >= this.CHUNK_SIZE) {
            this.processData(callback);
        } else {
            callback();
        }
    }

    handleRequest(msg) {
        // Handle different types of requests based on the message received
        switch (msg.type) {
            case 'start':
                this.start();
                break;
            case 'stop':
                this.stop();
                break;
            case 'restart':
                this.restart();
                break;
            default:
                console.log('Unhandled request type:', msg.type);
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

        const bufferConcat = Buffer.concat(chunksToProcess);
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
                let result_with_response = this.sendToChatGPT(response.data.text);
                const result_for_asterisk = { text: result_with_response, score: Math.round(0.7 * 100) };
                this.bufferResponse(result_for_asterisk);  // Buffer the response instead of emitting immediately
                //this.emit('result', result_for_asterisk);
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

    sendToChatGPT(transcript) {

        const systemPrompt = "You are a helpful and knowledgeable customer service representative at a well-respected insurance company. Provide clear, supportive, and accurate information in response to the customer's inquiry.";
        
        axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: transcript }
            ]
        }, {
            headers: { 'Authorization': `Bearer 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` }
        }).then(gptResponse => {
            let ai_response = gptResponse.data.choices[0].message.content;
            console.log('ChatGPT response:', result_for_asterisk);
            return `${transcript} ----- AI RESPONSE ----- ${ai_response}`
        }).catch(err => {
            console.error('Error in ChatGPT response:', err);
        });
    }

    bufferResponse(result) {
        this.responseBuffer.push(result);
        //this.emit('result', result);
        if (!this.bufferTimer) {
            this.bufferTimer = setTimeout(() => this.flushResponseBuffer(result), 1000);  // Flush buffer every second
        }
    }

    flushResponseBuffer(resultX) {
        if (this.responseBuffer.length > 0) {
            console.log ('this.responsebuffer:', resultX);
            this.emit('result', resultX);
            this.responseBuffer = [];
        }
        clearTimeout(this.bufferTimer);
        this.bufferTimer = null;
    }

    _final(callback) {
        this.flushResponseBuffer();  // Ensure all buffered data is sent
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
        if (!this.isActive) {
            console.log('Stream is already inactive.');
            return;
        }
        this.isActive = false;
        this.queue = [];
        this.queueSize = 0;
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