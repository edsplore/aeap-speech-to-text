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
        this.messages = [];  // Initialize the messages array
        // Initialize the system prompt once in the constructor
        this.systemPrompt = "You are a helpful and knowledgeable customer service representative at a well-respected insurance company. Provide clear, supportive, and accurate information in response to the customer's inquiry. Your response should not be more than one small sentence. NOTE - If the user input seems incomplete or gibberish or some random word, then just assume what they have to ask and respond accordingly.";
        // Pre-add the system prompt to messages if applicable
        this.messages.push({ role: "system", content: this.systemPrompt });
    }

    _write(chunk, encoding, callback) {
        if (!this.isActive) {
            console.log('Received data but stream is inactive, discarding data.');
            return callback();
        }

        this.queue.push(chunk);
        this.queueSize += chunk.length;
        console.log("Current Queue Size", this.queueSize)

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

    async processData(callback) {
        let totalSizeProcessed = 0;
        let chunksToProcess = [];

        while (totalSizeProcessed < this.CHUNK_SIZE && this.queue.length > 0) {
            let chunk = this.queue.shift();
            chunksToProcess.push(chunk);
            totalSizeProcessed += chunk.length;
            this.queueSize -= chunk.length;
        }

        const bufferConcat = Buffer.concat(chunksToProcess);
        await this.convertAndSendData(bufferConcat, callback);
    }

    async convertAndSendData(buffer, callback) {
        const outputFile = `output_audio_${new Date().getTime()}.wav`;
        const ffmpegProcess = spawn('ffmpeg', ['-f', 'mulaw', '-ar', '8000', '-ac', '1', '-i', 'pipe:0', outputFile]);

        ffmpegProcess.stdin.write(buffer);
        ffmpegProcess.stdin.end();

        ffmpegProcess.on('close', async (code) => {
            if (code !== 0) {
                console.error(`FFmpeg exited with code ${code}`);
                return callback(new Error(`FFmpeg exited with code ${code}`));
            }

            await this.sendAudioToPython(outputFile, callback);
        });
    }

    async sendAudioToPython(filePath, callback) {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath), { filename: path.basename(filePath) });

        axios.post(this.ngrokUrl, formData, { headers: formData.getHeaders() })
            .then(async (response) => {
                console.log('Successfully sent audio data, received response:', response.data);
                
                const result_with_response = await this.sendToChatGPT(response.data.text, callback);

                const result_for_asterisk = { text: result_with_response, score: Math.round(0.7 * 100) };
                
                this.bufferResponse(result_for_asterisk);  // Buffer the response instead of emitting immediately
                // this.emit('result', result_for_asterisk);
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


    async sendToChatGPT(transcript, callback) {
        this.messages.push({ role: "user", content: transcript });
    
        try {
            const gptResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: "gpt-3.5-turbo",
                messages: this.messages,
                temperature: 1
            }, {
                headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
            });
    
            let ai_response = gptResponse.data.choices[0].message.content;
            console.log('ChatGPT response:', ai_response);
    
            this.messages.push({ role: "system", content: ai_response });
            
            try {
                const audioFilePath = await this.sendTextToSpeech(ai_response);
                console.log('Audio File Generated:', audioFilePath);
                callback(null, audioFilePath);  // Success callback
            } catch (err) {
                console.error('TTS Error:', err);
                callback(err);  // Error callback
            }
        } catch (err) {
            console.error('Error in ChatGPT response:', err);
            callback(err);  // Error callback if Chat API fails
        }
    }
    
    async sendTextToSpeech(text) {
        const ttsUrl = 'https://api.openai.com/v1/audio/speech';
        const audioOptions = {
            model: "tts-1",
            input: text,
            voice: "alloy"
        };
    
        try {
            const ttsResponse = await axios.post(ttsUrl, audioOptions, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer'
            });
    
            const audioFilePath = `./audio/${Date.now()}.mp3`;
            fs.writeFileSync(audioFilePath, ttsResponse.data);
            console.log('Audio file saved:', audioFilePath);
            return audioFilePath;  // Return the path directly
        } catch (error) {
            console.error('Error in TTS:', error);
            throw error;  // Throw error to be handled by the caller
        }
    }
    


    // async sendToChatGPT(transcript, callback) {

    //     // const systemPrompt = "You are a helpful and knowledgeable customer service representative at a well-respected insurance company. Provide clear, supportive, and accurate information in response to the customer's inquiry. Your response should not be more than one small sentence. NOTE - If the user input seems incomplete or gibberish or some random word, then just assume what they have to ask and respond accordingly.";
    //     // Append the user's message to the messages array
    //     this.messages.push({ role: "user", content: transcript });
        
    //     axios.post('https://api.openai.com/v1/chat/completions', {
    //         model: "gpt-3.5-turbo",
    //         messages: this.messages,
    //         temperature: 1
    //     }, {
    //         headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
    //     }).then(gptResponse => {
    //         let ai_response = gptResponse.data.choices[0].message.content;
    //         console.log('ChatGPT response:', ai_response);            
    //         // Sending text to TTS and saving the audio file
    //         await this.sendTextToSpeech(ai_response, (err, audioFilePath) => {
    //             if (err) {
    //                 console.error('TTS Error:', err);
    //                 callback(err);
    //             } else {
    //                 console.log('Audio File Generated:', audioFilePath);
    //                 callback();
    //             }
    //         });

    //         // Append the AI's response to the messages array
    //         this.messages.push({ role: "system", content: ai_response });

    //         return `${transcript} ----- AI RESPONSE ----- ${ai_response}`
    //     }).catch(err => {
    //         console.error('Error in ChatGPT response:', err);
    //     });

    //     // return `Fast ---- ${transcript}`;
    // }


    // async sendTextToSpeech(text, callback) {
    //     const ttsUrl = 'https://api.openai.com/v1/audio/speech';  // Correct URL for the TTS API
    //     const audioOptions = {
    //         model: "tts-1",  // Use the specified TTS model
    //         input: text,
    //         voice: "alloy"  // Use the specified voice
    //     };
    
    //     try {
    //         const ttsResponse = await axios.post(ttsUrl, audioOptions, {
    //             headers: {
    //                 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    //                 'Content-Type': 'application/json'
    //             },
    //             responseType: 'arraybuffer'  // Important to handle binary data
    //         });
    
    //         const audioFilePath = `./audio/${Date.now()}.mp3`;  // Save file with timestamp to avoid overwriting
    //         fs.writeFileSync(audioFilePath, ttsResponse.data);
    //         console.log('Audio file saved:', audioFilePath);
    //         callback(null, audioFilePath);  // Success callback
    //     } catch (error) {
    //         console.error('Error in TTS:', error);
    //         callback(error);  // Error callback
    //     }
    // }

    
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