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

let previousFiles = [];
let conversationHistory = [];
let isSpeaking = false;
let currentProcess = null;

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    const process = exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Command failed: ${command}`, error);
        return reject(error);
      }
      resolve(stdout);
    });
    currentProcess = process;
  });
};

const lipSyncMessage = async (messageIndex) => {
  try {
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
  } catch (error) {
    console.error("Error in lip-sync process:", error);
  }
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
  previousFiles = [];
};

const stopSpeaking = () => {
  if (currentProcess) {
    currentProcess.kill();
    currentProcess = null;
  }
  isSpeaking = false;
};

const readJsonTranscript = async (file) => {
  try {
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading JSON file: ${file}`, error);
    return null;
  }
};

const audioFileToBase64 = async (file) => {
  try {
    const data = await fs.readFile(file);
    return data.toString("base64");
  } catch (error) {
    console.error(`Error converting audio to base64: ${file}`, error);
    return null;
  }
};

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  if (isSpeaking) {
    stopSpeaking();
  }

  await deletePreviousFiles();

  if (!userMessage) {
    res.send({
      messages: [
        {
          text: "Hey dear... How was your day?",
          audio: await audioFileToBase64("audios/intro_0.wav"),
          lipsync: await readJsonTranscript("audios/api_0.json"), // Use api_0.json
          facialExpression: "smile",
          animation: "Talking_0",
        },
        {
          text: "I missed you so much... Please don't go for so long!",
          audio: await audioFileToBase64("audios/intro_1.wav"),
          lipsync: await readJsonTranscript("audios/api_0.json"), // Use api_0.json
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
          lipsync: await readJsonTranscript("audios/api_0.json"), // Use api_0.json
          facialExpression: "smile",
          animation: "Talking_0",
        },
        {
          text: "You don't want to ruin Amey Muke with a crazy ChatGPT and ElevenLabs bill, right?",
          audio: await audioFileToBase64("audios/api_1.wav"),
          lipsync: await readJsonTranscript("audios/api_0.json"), // Use api_0.json
          facialExpression: "smile",
          animation: "Talking_0",
        },
      ],
    });
    return;
  }

  conversationHistory.push({ role: "user", content: userMessage });

  const messages = [
    {
      role: "system",
      content:
        "You are a friendly assistant for kids aged 8-10. Just play with kids and respond in a simple, fun, and engaging way. Always reply with plain text, no JSON formatting.",
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

    const responseText = completion.choices[0]?.message?.content || "I'm here to chat!";
    console.log("OpenAI Response:", responseText);

    const animations = ["Talking_0", "Talking_1", "Talking_2"];

    const assistantMessages = [
      {
        text: responseText,
        facialExpression: "smile",
        animation: animations[Math.floor(Math.random() * animations.length)],
      },
    ];

    conversationHistory.push({ role: "assistant", content: responseText });

    isSpeaking = true;

    for (let i = 0; i < assistantMessages.length; i++) {
      const timestamp = Date.now();
      const message = assistantMessages[i];

      if (!message.text) {
        console.error("Text is undefined for message:", message);
        continue;
      }

      const audioFilePath = path.join(__dirname, "audios", `message_${timestamp}.mp3`);

      try {
        const voicebuffer = await voice.textToSpeech.convert(voiceID, {
          text: message.text,
          outputFormat: "mp3_22050_32",
        });
        await fs.writeFile(audioFilePath, voicebuffer);
        console.log(`Audio file saved: ${audioFilePath}`);
      } catch (error) {
        console.error("Error converting text to speech:", error);
        continue;
      }

      // Use the same lipsync file (api_0.json) for all responses
      message.audio = `/audios/message_${timestamp}.mp3`;
      message.lipsync = `/audios/api_0.json`;

      previousFiles.push(audioFilePath);
    }

    isSpeaking = false;

    res.send({ messages: assistantMessages });
  } catch (error) {
    console.error("Error communicating with OpenAI:", error);
    res.status(500).send({ error: "Failed to generate response" });
  }
});

app.listen(port, () => {
  console.log(`Virtual Chatbot listening on port ${port}`);
});
