import crypto from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const host = "tts.tencentcloudapi.com";
const service = "tts";
const action = "TextToVoice";
const version = "2019-08-23";
const region = "ap-guangzhou";
const algorithm = "TC3-HMAC-SHA256";
const signedHeaders = "content-type;host;x-tc-action";
const outputDirectory = "assets/audio/words";

function loadLocalEnvironment(source) {
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function fileExists(filePath, maxBytes = Number.POSITIVE_INFINITY) {
  try {
    const size = (await stat(filePath)).size;
    return size > 0 && size <= maxBytes;
  } catch {
    return false;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

async function requestSpeech(secretId, secretKey, word, speed, voiceType) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const body = JSON.stringify({
    Text: `<speak><say-as interpret-as="characters">${word}</say-as></speak>`,
    SessionId: `${word.codePointAt(0).toString(16)}-${Date.now().toString(36)}`,
    Volume: 0,
    Speed: speed,
    ProjectId: 0,
    ModelType: 1,
    VoiceType: voiceType,
    PrimaryLanguage: 1,
    SampleRate: 24000,
    Codec: "mp3",
  });
  const canonicalHeaders = [
    "content-type:application/json; charset=utf-8",
    `host:${host}`,
    `x-tc-action:${action.toLowerCase()}`,
    "",
  ].join("\n");
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256(body)].join("\n");
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [algorithm, timestamp, credentialScope, sha256(canonicalRequest)].join("\n");
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign, "hex");
  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${host}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      "X-TC-Action": action,
      "X-TC-Region": region,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": version,
    },
    body,
  });
  const result = await response.json();
  const error = result.Response?.Error;
  if (!response.ok || error || !result.Response?.Audio) {
    throw new Error(error ? `${error.Code}: ${error.Message}` : `HTTP ${response.status}`);
  }
  return Buffer.from(result.Response.Audio, "base64");
}

async function generateWithRetry(credentials, word, speed, voiceType) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await requestSpeech(credentials.secretId, credentials.secretKey, word, speed, voiceType);
    } catch (error) {
      lastError = error;
      if (error.message.includes("PkgExhausted") || error.message.includes("AccountArrears")) throw error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
  }
  throw lastError;
}

try {
  loadLocalEnvironment(await readFile(".env.local", "utf8"));
} catch {
  // Environment variables may be supplied by another secure local mechanism.
}

let credentials = {
  secretId: process.env.TENCENTCLOUD_SECRET_ID,
  secretKey: process.env.TENCENTCLOUD_SECRET_KEY,
};
if (!credentials.secretId || !credentials.secretKey) {
  process.stdout.write("CREDENTIALS_READY\n");
  const rawInput = await new Promise((resolve, reject) => {
    let value = "";
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.on("data", (chunk) => {
      value += chunk;
      if (!value.includes("\n") && !value.includes("\r")) return;
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(value.split(/[\r\n]/, 1)[0]);
    });
    process.stdin.on("error", reject);
  });
  credentials = JSON.parse(rawInput);
}
if (!credentials.secretId || !credentials.secretKey) throw new Error("缺少腾讯云密钥");

const words = [...new Set((await readFile("data/recognition-3000.txt", "utf8")).match(/[\p{Unified_Ideograph}〇]/gu) ?? [])];
if (words.length !== 3000) throw new Error(`字表应有 3000 字，实际得到 ${words.length} 字`);

const speed = Number(process.env.TTS_SPEED ?? 0);
const voiceType = Number(process.env.TTS_VOICE_TYPE ?? 403000);
const concurrency = Math.max(1, Math.min(8, Number(process.env.TTS_CONCURRENCY ?? 1)));
const maxExistingBytes = Number(process.env.TTS_MAX_EXISTING_BYTES ?? Number.POSITIVE_INFINITY);
const mapping = Object.fromEntries(words.map((word) => [word, `${word.codePointAt(0).toString(16)}.mp3`]));

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "index.json"), `${JSON.stringify(mapping, null, 2)}\n`, "utf8");

let cursor = 0;
let completed = 0;
let skipped = 0;
const failures = [];
let fatalError;

async function worker() {
  while (cursor < words.length && !fatalError) {
    const index = cursor;
    cursor += 1;
    const word = words[index];
    const filename = mapping[word];
    const target = path.join(outputDirectory, filename);
    if (await fileExists(target, maxExistingBytes)) {
      skipped += 1;
      completed += 1;
      continue;
    }
    try {
      const audio = await generateWithRetry(credentials, word, speed, voiceType);
      const temporary = `${target}.tmp`;
      await writeFile(temporary, audio);
      await rename(temporary, target);
      completed += 1;
      if (completed % 25 === 0 || completed === words.length) {
        console.log(`进度 ${completed}/${words.length}（已跳过 ${skipped}）`);
      }
    } catch (error) {
      if (error.message.includes("PkgExhausted") || error.message.includes("AccountArrears")) {
        fatalError = error;
        return;
      }
      failures.push({ word, error: error.message });
      console.error(`生成失败：${word}（${error.message}）`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

if (fatalError) throw fatalError;

if (failures.length) {
  await writeFile(path.join(outputDirectory, "failures.json"), `${JSON.stringify(failures, null, 2)}\n`, "utf8");
  console.error(`完成，但有 ${failures.length} 个字失败；重新运行会自动补齐。`);
  process.exitCode = 1;
} else {
  console.log(`全部完成：${words.length} 个 MP3（本次跳过 ${skipped} 个已有文件）`);
}
