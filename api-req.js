const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// URL of the Flask app transcribe endpoint
const url = 'https://6a16-49-36-184-150.ngrok-free.app/transcribe';

// Path to the audio file you want to transcribe
const audioFilePath = 'audio245.mp3'

// Prepare the form data to send with the request
const formData = new FormData();
formData.append('file', fs.createReadStream(audioFilePath));

// Send the POST request with the audio file
axios.post(url, formData, { headers: formData.getHeaders() })
  .then(response => {
    console.log(response.data);
    // Check if the request was successful
    if (response.status_code === 200) {
      // Get the JSON response which contains the transcription
      console.log("Transcription:", response.data);
    } else {
      // If something went wrong, print the error
      console.log("Error: Something went wrong");
    }
  })
  .catch(error => {
    console.error("Error:", error.response ? error.response.data : error.message);
  });
