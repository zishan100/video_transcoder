// require("dotenv").config();
const { promisify } = require("util");
const { spawn } = require("child_process");
const fs = require("fs");
const readline = require("readline");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { db } = require("./firebase.service");

const s3Client = new S3Client({
  region: process.env.REGION,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

const readFilesFromFolder = async (dir) => {
  const files = await promisify(fs.readdir)(dir);

  return files;
};

const getContentType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".m3u8") {
    return "application/x-mpegURL";
  } else if (ext === ".ts") {
    return "video/mp2t";
  } else if (ext === ".jpg") {
    return "image/jpeg";
  } else {
    return "application/octet-stream";
  }
};

const uploadFileToS3 = async (bucketName, filePath, s3Key) => {
  const absolutePath = path.posix.join(s3Key);

  const params = {
    Bucket: bucketName,
    Key: `HLS-VIDEO/${s3Key}`,
    Body: fs.createReadStream(absolutePath),
    ContentType: getContentType(filePath), // Set the appropriate content type,
    ACL: "public-read",
  };

  const command = new PutObjectCommand(params);

  return await s3Client.send(command);
};

const getVideoDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata.format.duration;
      resolve(duration);
    });
  });
};

// const monitorFFmpegVideoProgress = async (
//   pipePath,
//   totalDuration,
//   folderId,
//   ffmpeg
// ) => {
//   const rl = readline.createInterface({
//     input: fs.createReadStream(pipePath),
//     crlfDelay: Infinity,
//   });

//   let progressData = {};

//   rl.on("line", async (line) => {
//     const [key, value] = line.split("=");

//     if (key) progressData[key.trim()] = value?.trim();

//     if (key === "progress" && value === "continue") {
//       if (progressData.out_time) {
//         const progressSeconds = parseDuration(progressData.out_time);
//         const percent = Math.floor((progressSeconds / totalDuration) * 100);
//         // await updateProgress(folderId, percent, "processing");
//       }
//       progressData = {};
//     }

//     if (key === "progress" && value === "end") {
//       console.log("FFmpeg processing completed.");

//       rl.close();
//     }
//   });

//   ffmpeg.on("close", () => {
//     console.log("FFmpeg video processed successfully.");
//     fs.unlinkSync(pipePath);
//   });
// };

function spawnFFmpeg(label, args, totalSecs, onPct) {
  const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });

  let progressData = {};
  // parse progress lines on stderr
  const rl = readline.createInterface({ input: proc.stderr });
  rl.on("line", (line) => {
    const [key, value] = line.split("=");

    if (key) progressData[key.trim()] = value?.trim();

    if (key === "progress" && value === "continue") {
      if (!isNaN(progressData.out_time_ms)) {
        const progressSeconds = parseDuration(progressData.out_time);
        const percent = Math.floor((progressSeconds / totalSecs) * 100);

        onPct(label, percent);
      }
      progressData = {};
    }

    if (key === "progress" && value === "end") {
      console.log("FFmpeg processing completed.");

      rl.close();
    }
  });

  return new Promise((res, rej) => {
    proc.on("close", (code) => {
      if (code !== 0) {
        rej(new Error(`${label} died ${code}`));
      } else {
        res(`stdout executed successfully for ${label}`);
      }
    });
  });
}

const parseDuration = (timeStr) => {
  const parts = timeStr.split(":");
  const hours = parseFloat(parts[0]);
  const minutes = parseFloat(parts[1]);
  const seconds = parseFloat(parts[2]);

  return hours * 3600 + minutes * 60 + seconds;
};

const updateProgress = async (folderId, percentage, status) => {
  await db
    .collection("progress")
    .doc(folderId)
    .set(
      { progress: percentage, status: status, updatedAt: new Date() },
      { merge: true }
    );
};

module.exports = {
  readFilesFromFolder,
  uploadFileToS3,
  getVideoDuration,
  parseDuration,
  updateProgress,
  spawnFFmpeg,
};
