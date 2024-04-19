const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { Writable } = require('stream');
const PROTO_PATH = './transcription_service.proto'; // Ensure this path points to your .proto file

const packageDefinition = protoLoader.loadSync(
    PROTO_PATH,
    {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
    }
);
const transcriptionService = grpc.loadPackageDefinition(packageDefinition).transcription;

class CustomProvider extends Writable {
    constructor(options) {
        super();
        this.client = new transcriptionService.TranscriptionService(options.serverAddress, grpc.credentials.createInsecure());
        this.stream = null;
        this.isActive = false;
        this.results = []; // Array to store results
        this.maxResults = options.maxResults || 100; // Maximum number of results to cache
    }

    start(config) {
        if (this.isActive) {
            console.log('Stream is already active.');
            return;
        }
        this.isActive = true;
        console.log('Starting the audio streaming service with config:', config);
    }

    stop() {
        if (!this.isActive) {
            console.log('Stream is already inactive.');
            return;
        }
        this.isActive = false;
        if (this.stream) {
            this.stream.end();
            this.stream = null;
        }
        console.log('Stopping the audio streaming service.');
    }

    restart(config) {
        console.log('Restarting the audio streaming service.');
        this.stop();
        this.start(config);
    }

    _write(chunk, encoding, callback) {
        if (!this.isActive) {
            console.log('Stream is inactive, ignoring data.');
            return callback();
        }

        if (!this.stream) {
            this.stream = this.client.TranscribeStream();
            this.stream.on('data', (response) => {
                if (response.confidence !== 0) { // Check to ensure the result is valid
                    const result = {
                        text: response.transcript,
                        score: response.confidence
                    };
                    console.log(`Received Transcript: ${response.transcript}, Confidence: ${response.confidence}`);
                    this.results.push(result);
                    this.emit('result', result);

                    // Maintain result cache size
                    if (this.results.length > this.maxResults) {
                        this.results.shift(); // Remove the oldest result if max size exceeded
                    }
                }
            });
            this.stream.on('end', () => {
                console.log('Stream ended by the server.');
                this.stop(); // Automatically stop the stream when it ends
                callback();
            });
            this.stream.on('error', (err) => {
                console.error('Stream encountered an error:', err.message);
                this.stop(); // Stop the stream on error
                callback(err);
            });
        }

        this.stream.write({audio_data: chunk});
        callback();
    }

    _final(callback) {
        if (this.isActive) {
            this.stop();
        }
        callback();
    }
}

function getProvider(name, options) {
    if (name == "custom") {
        return new CustomProvider(options);
    }
    throw new Error("Unsupported speech provider '" + name + "'");
}

module.exports = {
    getProvider
};
