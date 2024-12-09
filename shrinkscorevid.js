const { exec } = require("child_process");
const util = require("util");
const fs = require("fs");

const execPromise = util.promisify(exec);
const inputVideo = process.argv[2];
const dimension = process.argv[3];
const outputName = '_tiny.mp4';

async function shrinkScoreVideo(inputVideo) {
    try {
        fs.accessSync(inputVideo, fs.constants.R_OK);
    } catch (error) {
        console.error(`Cannot access input file: ${inputVideo}`);
        process.exit(1);
    }

    try {
        const scaleFilter = dimension ? `-vf "mpdecimate,scale=-1:${dimension}" ` : '-vf mpdecimate ';
        await execPromise(`ffmpeg -y -i "${inputVideo}" ${scaleFilter}./${outputName}`);
        console.log("Completed frame deduplication");
    } catch (error) {
        console.error(`Failed during processing: ${error.message}`);
        process.exit(1);
    }
}

shrinkScoreVideo(inputVideo);

