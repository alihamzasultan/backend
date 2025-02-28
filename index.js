import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import { ElevenLabsClient } from "elevenlabs";
import express from "express";
import { promises as fs } from "fs";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(cors({
  origin: "https://frontend-yslq.vercel.app",
  methods: "GET,POST,PUT,DELETE",
  allowedHeaders: "Content-Type,Authorization"
}));
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "-",
});

const voice = new ElevenLabsClient({
  apiKey: process.env.ELEVEN_LABS_API_KEY || "-",
});

const voiceID = "EXAVITQu4vr4xnSDxMaL";

app.use("/audios", express.static(path.join(__dirname, "audios")));

const port = 3000;
let previousFiles = [];
let conversationHistory = [];
let isSpeaking = false;
let currentProcess = null;

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    const process = exec(command, (error, stdout) => {
      if (error) reject(error);
      resolve(stdout);
    });
    currentProcess = process;
  });
};

const lipSyncMessage = async (messageIndex) => {
  try {
    await execCommand(
      `ffmpeg -y -i audios/message_${messageIndex}.mp3 audios/message_${messageIndex}.wav`
    );
    await execCommand(
      `rhubarb -f json -o audios/message_${messageIndex}.json audios/message_${messageIndex}.wav -r phonetic`
    );
  } catch (error) {
    console.error("Lip sync error:", error);
  }
};

const deletePreviousFiles = async () => {
  for (const file of previousFiles) {
    try {
      await fs.unlink(file);
    } catch (error) {
      console.error(`Error deleting file ${file}:`, error);
    }
  }
  previousFiles = [];
};

const stopSpeaking = () => {
  if (currentProcess) {
    currentProcess.kill();
    currentProcess = null;
  }
  isSpeaking = false;
};

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  if (isSpeaking) stopSpeaking();
  await deletePreviousFiles();

  if (!userMessage) {
    return res.send({
      messages: await getIntroMessages(),
    });
  }

  if (openai.apiKey === "-") {
    return res.send({
      messages: await getApiKeyWarningMessages(),
    });
  }

  conversationHistory.push({ role: "user", content: userMessage });

  const messages = [
    {
      role: "system",
      content: "You are a friendly assistant for kids aged 8-10. Just play with kids and respond in a simple, fun, and engaging way. Always reply with plain text, no JSON formatting.",
    },
    ...conversationHistory.slice(-10),
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      max_tokens: 500,
      temperature: 0.6,
      messages,
    });

    const assistantMessage = {
      text: completion.choices[0].message.content,
      facialExpression: "smile",
      animation: `Talking_${Math.floor(Math.random() * 3)}`,
    };

    conversationHistory.push({ role: "assistant", content: assistantMessage.text });

    isSpeaking = true;
    const timestamp = Date.now();
    const audioFilePath = path.join(__dirname, "audios", `message_${timestamp}.mp3`);
    const jsonFilePath = path.join(__dirname, "audios", `message_${timestamp}.json`);

    try {
      const voicebuffer = await voice.textToSpeech({
        voiceId: voiceID,
        text: assistantMessage.text,
        outputFormat: "mp3_22050_32",
      });

      await fs.writeFile(audioFilePath, voicebuffer);
    } catch (error) {
      console.error("Text-to-speech error:", error);
    }

    await lipSyncMessage(timestamp);

    assistantMessage.audio = `/audios/message_${timestamp}.mp3`;
    assistantMessage.lipsync = await readJsonTranscript(jsonFilePath);

    previousFiles.push(audioFilePath, jsonFilePath);
    isSpeaking = false;

    res.send({ messages: [assistantMessage] });
  } catch (error) {
    console.error("Chatbot error:", error);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

const readJsonTranscript = async (file) => {
  try {
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const audioFileToBase64 = async (file) => {
  try {
    const data = await fs.readFile(file);
    return data.toString("base64");
  } catch {
    return null;
  }
};

const getIntroMessages = async () => [
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
];

const getApiKeyWarningMessages = async () => [
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
];

app.listen(port, () => {
  console.log(`Virtual Chatbot listening on port ${port}`);
});
