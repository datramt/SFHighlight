const { exec } = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");

// Promisify exec and fs functions
const execPromise = util.promisify(exec);

// Get input directory from command line arguments
const inputDir = process.argv[2];

// Validate input
if (!inputDir) {
    console.error("Usage: node extractAudio.js <directory_path>");
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

async function extractAudio(inputVideo, outputDir) {
    const baseName = path.basename(inputVideo, path.extname(inputVideo));
    const outputFile = path.join(outputDir, `${baseName}.mp3`);
    
    try {
        // Extract audio using high quality settings
        await safeExec(
            `ffmpeg -i "${inputVideo}" -vn -acodec libmp3lame -q:a 0 "${outputFile}"`,
            `Extracting audio from ${inputVideo}`
        );

    } catch (error) {
        console.error("Error processing video:", error);
        process.exit(1);
    }
}

// Main processing function
async function processVideos() {
    const outputDir = path.join(inputDir, 'audios');

    try {
        // Get all MP4 files in the input directory
        const files = await fs.promises.readdir(inputDir);
        const videoFiles = files.filter(file => path.extname(file).toLowerCase() === '.mp4');

        if (videoFiles.length === 0) {
            console.error("No MP4 files found in the specified directory");
            process.exit(1);
        }

        // Delete existing audios directory if it exists
        if (fs.existsSync(outputDir)) {
            logWithTimestamp("Removing existing audios directory");
            await fs.promises.rm(outputDir, { recursive: true, force: true });
        }

        // Create fresh output directory
        logWithTimestamp("Creating new audios directory");
        await fs.promises.mkdir(outputDir, { recursive: true });

        // Process each video
        for (const video of videoFiles) {
            const videoPath = path.join(inputDir, video);
            logWithTimestamp(`Processing video: ${video}`);
            await extractAudio(videoPath, outputDir);
            logWithTimestamp(`Finished processing: ${video}`);
        }

        logWithTimestamp("All videos processed successfully!");
        logWithTimestamp(`Audio files saved in ${outputDir} directory`);

    } catch (error) {
        console.error("Error during processing:", error);
        process.exit(1);
    }
}

// Run the main function
processVideos();