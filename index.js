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

const generateLipSyncData = async (text, outputFile) => {
  try {
    const time = new Date().getTime();
    console.log(`Starting lip-sync generation for text: ${text}`);

    // Use rhubarb-lip-sync to generate lip-sync data from text
    await execCommand(
      `echo "${text}" | rhubarb -f json -o ${outputFile} -r phonetic`
    );
    console.log(`Lip-sync generation done in ${new Date().getTime() - time}ms`);
  } catch (error) {
    console.error("Error in lip-sync generation:", error);
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
          facialExpression: "smile",
          animation: "Talking_0",
        },
        {
          text: "I missed you so much... Please don't go for so long!",
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
          facialExpression: "smile",
          animation: "Talking_0",
        },
        {
          text: "You don't want to ruin Amey Muke with a crazy ChatGPT and ElevenLabs bill, right?",
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
      const jsonFilePath = path.join(__dirname, "audios", `message_${timestamp}.json`);

      try {
        // Generate audio using ElevenLabs
        const voicebuffer = await voice.textToSpeech.convert(voiceID, {
          text: message.text,
          outputFormat: "mp3_22050_32",
        });
        await fs.writeFile(audioFilePath, voicebuffer);

        // Generate lip-sync data from GPT's response
        await generateLipSyncData(message.text, jsonFilePath);

        message.audio = `/audios/message_${timestamp}.mp3`;
        message.lipsync = await readJsonTranscript(jsonFilePath);

        previousFiles.push(audioFilePath, jsonFilePath);
      } catch (error) {
        console.error("Error generating audio or lip-sync data:", error);
        continue;
      }
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
