// require("dotenv").config();
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

// const { REGION, ACCESS_KEY_ID, SECRET_ACCESS_KEY  } = process.env;
const { exec, spawn, execSync } = require("child_process");
const fs = require("fs");
const readline = require("readline");
const path = require("node:path");
const { v4: uuid } = require("uuid");
const { promisify } = require("util");
const { pipeline } = require("stream");
const {
  readFilesFromFolder,
  uploadFileToS3,
  getVideoDuration,
  updateProgress,
  spawnFFmpeg,
} = require("./Utils/Helpers");

const s3Client = new S3Client({
  region: process.env.REGION,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.BUCKET_NAME;
const KEY = process.env.KEY;
const PROD_BUCKET_NAME = process.env.PROD_BUCKET_NAME;
// const pipePath = "/tmp/ffmpeg_pipe";

async function init() {
  try {

    // const folderId = uuid();
    const docId = KEY.split(".")[0].split("/")[1];

    let params = {
      Bucket: BUCKET_NAME,
      Key: KEY,
    };

    /* Download original video */
    let command = new GetObjectCommand(params);

    /*   
      Here we are updating the progress of video processing with start at 0%
    */
    await updateProgress(docId, 0, "processing");

    const response = await s3Client.send(command);

    const downloadedVideoPath = `downloaded-video-path${path.extname(KEY)}`;

    const videoAbsolutePath = path.resolve(downloadedVideoPath);

    console.log("video-absolute-path :", videoAbsolutePath);

    const fileStream = fs.createWriteStream(videoAbsolutePath);

    const pipe = promisify(pipeline);

    await pipe(response.Body, fileStream);

    console.log("folderId :", docId);

    const outputFolderRootPath = `./${docId}`;

    const currDate = Date.now();

    /*  Set up variant definitions */
    const variants = [
      { name: "360p", w: 640, h: 360, vbr: "800k", abr: "96k" },
      { name: "480p", w: 854, h: 480, vbr: "1400k", abr: "128k" },
    ];

    /* Track % complete for each variant */
    const pctMap = Object.fromEntries(variants.map((v) => [v.name, 0]));

    const updateOverall = async () => {
      const sum = Object.values(pctMap).reduce((a, b) => a + b, 0);
      const overall = Math.floor(Number(sum / variants.length));
      await updateProgress(docId, overall, "processing");
      // console.log(pctMap);
    };

    if (!fs.existsSync(outputFolderRootPath)) {
      fs.mkdirSync(outputFolderRootPath);
    }

    const videoDuration = await getVideoDuration(videoAbsolutePath);

    console.log("video duration (sec) :", videoDuration);

    /* Start the transcoder */

    console.log("monitoring ffmpeg video progress started");

    /* Launch every FFmpeg job with spawn() ************/

    const promises = variants.map((v) => {
      const outTmpl = `${docId}/${currDate}-${v.name}`;
      const args = [
        "-y",
        "-i",
        videoAbsolutePath,
        "-vf",
        `scale=w=${v.w}:h=${v.h}`,
        "-c:v",
        "libx264",
        "-b:v",
        v.vbr,
        "-c:a",
        "aac",
        "-b:a",
        v.abr,
        "-f",
        "hls",
        "-hls_time",
        "10",
        "-hls_playlist_type",
        "vod",
        "-start_number",
        "0",
        "-hls_segment_filename",
        `${outTmpl}-segment%03d.ts`,
        "-progress",
        "pipe:2",
        `${outTmpl}-index.m3u8`,
        "-ss",
        "00:00:03",
        "-vframes",
        "1",
        "-q:v",
        "2",
        `${docId}/thumbnail.jpg`,
      ];

      return spawnFFmpeg(v.name, args, videoDuration, async (label, pct) => {
        pctMap[label] = Number(pct);
        await updateOverall();
      });
    });

    /* Wait for ALL variants to finish */
    await Promise.all(promises);

    const masterPlaylistPath = `${outputFolderRootPath}/index.m3u8`;

    const masterPlaylistContent = `
                    #EXTM3U
                    #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
                    ${currDate}-360p-index.m3u8
                    #EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480
                    ${currDate}-480p-index.m3u8`.trim();

    fs.writeFileSync(masterPlaylistPath, masterPlaylistContent);

    /* Upload the video */

    const files = await readFilesFromFolder(outputFolderRootPath);

    for (const file of files) {
      const fullPath = path.posix.join(docId, file);

      await uploadFileToS3(PROD_BUCKET_NAME, file, fullPath);
    }

    /*   
      Here we are updating the progress of video processing with 100%
    */
    await updateProgress(docId, 100, "completed");

    console.log(" Video streaming process is almost completed...");

    /* Delete file path from local machine */
    if (fs.existsSync(outputFolderRootPath)) {
      fs.rmdirSync(outputFolderRootPath, { recursive: true });
    }

    if (fs.existsSync(videoAbsolutePath)) {
      fs.unlinkSync(videoAbsolutePath);
    }
  } catch (err) {
    console.log("logged error :", err);
    if (fs.existsSync(outputFolderRootPath)) {
      fs.unlinkSync(outputFolderRootPath);
    }

    if (fs.existsSync(videoAbsolutePath)) {
      fs.unlinkSync(videoAbsolutePath);
    }
  }
}

init().finally(() => process.exit(0));
