import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import { ElevenLabsClient } from "elevenlabs";
import express from "express";
import { promises as fs } from "fs";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "-",
});

const voice = new ElevenLabsClient({
  apiKey: process.env.ELEVEN_LABS_API_KEY || "-",
});

const voiceID = "EXAVITQu4vr4xnSDxMaL";

const app = express();
app.use(express.json());
app.use(cors());
app.use("/audios", express.static(path.join(__dirname, "audios")));
const port = 3000;

let previousFiles = []; // To track files generated in the previous response
let conversationHistory = []; // To store conversation history
let isSpeaking = false; // To track if the chatbot is currently speaking
let currentProcess = null; // To track the current speech generation process

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    const process = exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
    currentProcess = process;
  });
};

const lipSyncMessage = async (messageIndex) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${messageIndex}`);
  await execCommand(
    `ffmpeg -y -i audios/message_${messageIndex}.mp3 audios/message_${messageIndex}.wav`
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);
  await execCommand(
    `rhubarb -f json -o audios/message_${messageIndex}.json audios/message_${messageIndex}.wav -r phonetic`
  );
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

const deletePreviousFiles = async () => {
  for (const file of previousFiles) {
    try {
      await fs.unlink(file);
      console.log(`Deleted file: ${file}`);
    } catch (error) {
      console.error(`Error deleting file ${file}:`, error);
    }
  }
  previousFiles = []; // Reset the list of files
};

const stopSpeaking = () => {
  if (currentProcess) {
    currentProcess.kill(); // Kill the current speech generation process
    currentProcess = null;
  }
  isSpeaking = false;
};

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  // If the chatbot is currently speaking, stop it
  if (isSpeaking) {
    stopSpeaking();
  }

  // Delete previous audio and JSON files
  await deletePreviousFiles();

  if (!userMessage) {
    res.send({
      messages: [
        {
          text: "Hey dear... How was your day?",
          audio: await audioFileToBase64("audios/intro_0.wav"),
          lipsync: await readJsonTranscript("audios/intro_0.json"),
          facialExpression: "smile",
          animation: "Talking_0",
        },
        {
          text: "I missed you so much... Please don't go for so long!",
          audio: await audioFileToBase64("audios/intro_1.wav"),
          lipsync: await readJsonTranscript("audios/intro_1.json"),
          facialExpression: "smile",
          animation: "Talking_0",
        },
      ],
    });
    return;
  }

  if (openai.apiKey === "-") {
    res.send({
      messages: [
        {
          text: "Please my dear, don't forget to add your API keys!",
          audio: await audioFileToBase64("audios/api_0.wav"),
          lipsync: await readJsonTranscript("audios/api_0.json"),
          facialExpression: "smile",
          animation: "Talking_0",
        },
        {
          text: "You don't want to ruin Amey Muke with a crazy ChatGPT and ElevenLabs bill, right?",
          audio: await audioFileToBase64("audios/api_1.wav"),
          lipsync: await readJsonTranscript("audios/api_1.json"),
          facialExpression: "smile",
          animation: "Talking_0",
        },
      ],
    });
    return;
  }

  // Add the user's message to the conversation history
  conversationHistory.push({ role: "user", content: userMessage });

  // Prepare the messages for the OpenAI API
  const messages = [
    {
      role: "system",
      content:
        "You are a friendly assistant for kids aged 8-10. Just play with kids and respond in a simple, fun, and engaging way. Always reply with plain text, no JSON formatting.",
    },
    ...conversationHistory.slice(-10), // Include the last 10 messages from the history
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    max_tokens: 500,
    temperature: 0.6,
    messages,
  });

  console.log("OpenAI Response:", completion.choices[0].message.content);

  // Format the GPT response into the required JSON structure
  const animations = ["Talking_0", "Talking_1", "Talking_2"]; // Add more if needed

  const assistantMessages = [
    {
      text: completion.choices[0].message.content,
      facialExpression: "smile",
      animation: animations[Math.floor(Math.random() * animations.length)],
    },
  ];

  // Add the assistant's message to the conversation history
  conversationHistory.push({ role: "assistant", content: assistantMessages[0].text });

  isSpeaking = true; // Set the flag to indicate that the chatbot is speaking

  for (let i = 0; i < assistantMessages.length; i++) {
    const timestamp = Date.now(); // Unique timestamp for each response
    const message = assistantMessages[i];

    // Ensure the text is not undefined
    if (!message.text) {
      console.error("Text is undefined for message:", message);
      continue;
    }

    // Generate unique filenames
    const audioFilePath = path.join(__dirname, "audios", `message_${timestamp}.mp3`);
    const jsonFilePath = path.join(__dirname, "audios", `message_${timestamp}.json`);

    // Generate text-to-speech audio
    const textInput = message.text;
    console.log("Text to be converted to speech:", textInput);

    try {
      const voicebuffer = await voice.textToSpeech.convert(voiceID, {
        text: textInput,
        outputFormat: "mp3_22050_32",
      });
      await fs.writeFile(audioFilePath, voicebuffer);
    } catch (error) {
      console.error("Error converting text to speech:", error);
      continue; // Skip this message and proceed with the next one
    }

    // Generate lipsync data
    await lipSyncMessage(timestamp);

    message.audio = `/audios/message_${timestamp}.mp3`;
    message.lipsync = await readJsonTranscript(jsonFilePath);

    // Track the files for cleanup
    previousFiles.push(audioFilePath);
    previousFiles.push(jsonFilePath);
  }

  isSpeaking = false; // Reset the flag after speaking is done

  res.send({ messages: assistantMessages });
});

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

app.listen(port, () => {
  console.log(`Virtual Chatbot listening on port ${port}`);
});