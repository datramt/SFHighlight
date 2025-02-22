const { exec } = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");

// Promisify exec and fs functions
const execPromise = util.promisify(exec);

// Get input directory from command line arguments
const inputDir = process.argv[2];
const GRAIN_DURATION = 0.0625; // Changed from 0.25 to 0.125 for 1/8th second grains

// Validate input
if (!inputDir) {
    console.error("Usage: node granularVideo.js <directory_path>");
    process.exit(1);
}

// Helper function for logging with timestamps
function logWithTimestamp(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

// Helper function for executing commands
async function safeExec(command, stepDescription) {
    try {
        logWithTimestamp(`Starting: ${stepDescription}`);
        const { stdout, stderr } = await execPromise(command);
        logWithTimestamp(`Completed: ${stepDescription}`);
        return stdout;
    } catch (error) {
        console.error(`Failed during: ${stepDescription}\nCommand: ${command}\nError: ${error.message}`);
        process.exit(1);
    }
}   

// Get video duration using ffprobe
async function getVideoDuration(videoPath) {
    const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const duration = await safeExec(command, `Getting duration for ${path.basename(videoPath)}`);
    return parseFloat(duration);
}

async function createGranularVideo(videoFiles) {
    const outputDir = path.join(inputDir, 'granular');
    const outputFile = path.join(outputDir, 'granular_output.mp4');
    const tempDir = path.join(outputDir, 'temp');
    const NUM_PASSES = 10;
    
    try {
        // Create output and temp directories
        await fs.promises.mkdir(outputDir, { recursive: true });
        await fs.promises.mkdir(tempDir, { recursive: true });

        // Create list of segments with their start times
        const segments = [];
        for (let pass = 1; pass < NUM_PASSES; pass++) {
            const percentagePoint = pass / NUM_PASSES; // 0.0, 0.1, 0.2, ... 0.9
            
            for (let i = 0; i < videoFiles.length; i++) {
                const video = videoFiles[i];
                const duration = await getVideoDuration(video);
                const timePoint = duration * percentagePoint;
                
                // Extract segment from calculated point in video
                const segmentFile = path.join(tempDir, `segment_pass${pass}_${i}.mp4`);
                const extractCommand = `ffmpeg -ss ${timePoint} -i "${video}" `
                    + `-t ${GRAIN_DURATION} `
                    + `-c:v libx264 -preset ultrafast `
                    + `-c:a aac -strict experimental `
                    + `-vsync cfr `
                    + `-af "afade=t=in:st=0:d=0.001,afade=t=out:st=${GRAIN_DURATION-0.001}:d=0.001,apad" `
                    + `-shortest `
                    + `-r 30 -ar 48000 `
                    + `-video_track_timescale 30000 `
                    + `-y "${segmentFile}"`;
                await safeExec(extractCommand, `Extracting segment from ${path.basename(video)} at ${(percentagePoint * 100).toFixed(0)}%`);
                
                segments.push(segmentFile);
            }
        }

        // Create concat file
        const concatFile = path.join(tempDir, 'concat.txt');
        const concatContent = segments.map(s => `file '${s}'`).join('\n');
        await fs.promises.writeFile(concatFile, concatContent);

        // Concatenate all segments with re-encoding to ensure consistency
        const concatCommand = `ffmpeg -f concat -safe 0 -i "${concatFile}" `
            + `-c:v libx264 -preset medium `
            + `-c:a aac -strict experimental `
            + `-vsync cfr -shortest `
            + `-r 30 -ar 48000 `
            + `-video_track_timescale 30000 `
            + `"${outputFile}"`;
        await safeExec(concatCommand, "Concatenating segments");

        // Clean up temp directory
        await fs.promises.rm(tempDir, { recursive: true });

        logWithTimestamp(`Granular video saved to: ${outputFile}`);
        logWithTimestamp(`Total duration: ${(videoFiles.length * GRAIN_DURATION * NUM_PASSES).toFixed(2)} seconds`);

    } catch (error) {
        console.error("Error creating granular video:", error);
        // Clean up temp directory if it exists
        if (fs.existsSync(tempDir)) {
            await fs.promises.rm(tempDir, { recursive: true });
        }
        process.exit(1);
    }
}

// Main processing function
async function processVideos() {
    try {
        // Get all MP4 files in the input directory
        const files = await fs.promises.readdir(inputDir);
        const videoFiles = files
            .filter(file => path.extname(file).toLowerCase() === '.mp4')
            .map(file => path.join(inputDir, file));

        if (videoFiles.length === 0) {
            console.error("No MP4 files found in the specified directory");
            process.exit(1);
        }

        logWithTimestamp(`Found ${videoFiles.length} MP4 files to process`);
        await createGranularVideo(videoFiles);
        logWithTimestamp("Granular video created successfully!");

    } catch (error) {
        console.error("Error during processing:", error);
        process.exit(1);
    }
}

// Run the main function
processVideos(); 