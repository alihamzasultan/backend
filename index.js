import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import { ElevenLabsClient } from "elevenlabs";
import express from "express";
import { promises as fs } from "fs";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from '@supabase/supabase-js';

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

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const bucketName = "your-bucket-name"; // Replace with your Supabase bucket name

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

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

const uploadFileToSupabase = async (filePath, fileName) => {
  try {
    const fileData = await fs.readFile(filePath);

    const { data, error } = await supabase
      .storage
      .from(bucketName)
      .upload(fileName, fileData, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw error;
    }

    console.log(`File uploaded successfully: ${fileName}`);
    return data;
  } catch (error) {
    console.error(`Error uploading file to Supabase: ${filePath}`, error);
    return null;
  }
};

const downloadFileFromSupabase = async (fileName, localFilePath) => {
  try {
    const { data, error } = await supabase
      .storage
      .from(bucketName)
      .download(fileName);

    if (error) {
      throw error;
    }

    await fs.writeFile(localFilePath, await data.arrayBuffer());
    console.log(`File downloaded successfully: ${fileName}`);
    return localFilePath;
  } catch (error) {
    console.error(`Error downloading file from Supabase: ${fileName}`, error);
    return null;
  }
};

const lipSyncMessage = async (audioFileName, jsonFileName) => {
  try {
    const time = new Date().getTime();
    console.log(`Starting lip-sync for ${audioFileName}`);

    // Download the audio file from Supabase
    const localAudioPath = path.join(__dirname, "temp", audioFileName);
    await downloadFileFromSupabase(audioFileName, localAudioPath);

    // Convert audio to WAV format
    const localWavPath = path.join(__dirname, "temp", `${audioFileName}.wav`);
    await execCommand(
      `ffmpeg -y -i ${localAudioPath} ${localWavPath}`
    );
    console.log(`Conversion done in ${new Date().getTime() - time}ms`);

    // Generate JSON lip-sync file
    const localJsonPath = path.join(__dirname, "temp", jsonFileName);
    await execCommand(
      `rhubarb -f json -o ${localJsonPath} ${localWavPath} -r phonetic`
    );
    console.log(`Lip sync done in ${new Date().getTime() - time}ms`);

    // Upload JSON file to Supabase
    await uploadFileToSupabase(localJsonPath, jsonFileName);

    // Clean up local files
    await fs.unlink(localAudioPath);
    await fs.unlink(localWavPath);
    await fs.unlink(localJsonPath);

    console.log(`Lip-sync completed for ${audioFileName}`);
  } catch (error) {
    console.error("Error in lip-sync process:", error);
  }
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

  if (isSpeaking) {
    stopSpeaking();
  }

  if (!userMessage) {
    res.send({
      messages: [
        {
          text: "Hey dear... How was your day?",
          audio: "https://your-supabase-url.supabase.co/storage/v1/object/public/your-bucket-name/intro_0.wav",
          lipsync: "https://your-supabase-url.supabase.co/storage/v1/object/public/your-bucket-name/intro_0.json",
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
          audio: "https://your-supabase-url.supabase.co/storage/v1/object/public/your-bucket-name/api_0.wav",
          lipsync: "https://your-supabase-url.supabase.co/storage/v1/object/public/your-bucket-name/api_0.json",
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

      const audioFileName = `message_${timestamp}.mp3`;
      const jsonFileName = `message_${timestamp}.json`;

      // Generate audio using ElevenLabs
      const localAudioPath = path.join(__dirname, "temp", audioFileName);
      try {
        const voicebuffer = await voice.textToSpeech.convert(voiceID, {
          text: message.text,
          outputFormat: "mp3_22050_32",
        });
        await fs.writeFile(localAudioPath, voicebuffer);
      } catch (error) {
        console.error("Error converting text to speech:", error);
        continue;
      }

      // Upload audio to Supabase
      await uploadFileToSupabase(localAudioPath, audioFileName);

      // Generate JSON lip-sync file and upload to Supabase
      await lipSyncMessage(audioFileName, jsonFileName);

      // Add Supabase URLs to the response
      message.audio = `https://${supabaseUrl}.supabase.co/storage/v1/object/public/${bucketName}/${audioFileName}`;
      message.lipsync = `https://${supabaseUrl}.supabase.co/storage/v1/object/public/${bucketName}/${jsonFileName}`;

      // Clean up local audio file
      await fs.unlink(localAudioPath);
    }

    isSpeaking = false;

    // Send the response with audio and lipsync URLs
    res.send({ messages: assistantMessages });
  } catch (error) {
    console.error("Error communicating with OpenAI:", error);
    res.status(500).send({ error: "Failed to generate response" });
  }
});

app.listen(port, () => {
  console.log(`Virtual Chatbot listening on port ${port}`);
});
