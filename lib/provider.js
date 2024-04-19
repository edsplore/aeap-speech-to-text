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
    constructor(serverAddress) {
        super();
        this.client = new transcriptionService.TranscriptionService(serverAddress, grpc.credentials.createInsecure());
        this.stream = null;
        this.isActive = false; // To manage the state of the stream
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
        if (this.stream) {
            this.stream.end();
            this.stream = null;
        }
        console.log('Stopping the audio streaming service.');
    }

    restart() {
        console.log('Restarting the audio streaming service.');
        this.stop();
        this.start();
    }

    _write(chunk, encoding, callback) {
        if (!this.isActive) {
            console.log('Stream is inactive, ignoring data.');
            return callback();
        }

        if (!this.stream) {
            this.stream = this.client.TranscribeStream();
            this.stream.on('data', (response) => {
                console.log(`Received Transcript: ${response.transcript}, Confidence: ${response.confidence}`);
                this.emit('result', response);
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
    switch (name) {
        case "custom":
            return new CustomProvider(options.serverAddress);
        // Add additional cases for different providers if needed
        default:
            throw new Error(`Unsupported speech provider '${name}'`);
    }
}

    module.exports = {
        CustomProvider,
        getProvider
    };




