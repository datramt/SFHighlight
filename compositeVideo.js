const { exec } = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");

// Promisify exec and fs functions
const execPromise = util.promisify(exec);

// Get input directory from command line arguments
const inputDir = process.argv[2];
const OUTPUT_DURATION = 480; // Changed from 60 to 5 seconds for testing

// Validate input
if (!inputDir) {
    console.error("Usage: node compositeVideo.js <directory_path>");
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

async function createCompositeVideo(videoFiles) {
    const outputDir = path.join(inputDir, 'composite');
    const outputFile = path.join(outputDir, 'composite_output.mp4');
    
    try {
        await fs.promises.mkdir(outputDir, { recursive: true });

        const inputParams = videoFiles
            .map(file => `-i "${file}"`)
            .join(' ');

        // Process first video
        let filterComplex = `[0:v]trim=0:${OUTPUT_DURATION},setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,colorlevels=rimax=0.902:gimax=0.902:bimax=0.902[v0];`;
        
        // Process remaining videos and chain them together
        for (let i = 1; i < videoFiles.length; i++) {
            filterComplex += `[${i}:v]trim=0:${OUTPUT_DURATION},setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,colorlevels=rimax=0.902:gimax=0.902:bimax=0.902[v${i}];`;
            
            if (i === 1) {
                filterComplex += `[v0][v1]blend=all_mode=darken:all_opacity=1[blend1];`;
            } else {
                filterComplex += `[blend${i-1}][v${i}]blend=all_mode=darken:all_opacity=1[blend${i}];`;
            }
        }

        // Process all audio streams
        const audioMix = videoFiles.map((_, i) => {
            return `[${i}:a]atrim=0:${OUTPUT_DURATION},asetpts=PTS-STARTPTS,volume=${1/videoFiles.length}[a${i}];`;
        }).join('');

        const audioMixInputs = videoFiles
            .map((_, i) => `[a${i}]`)
            .join('');

        filterComplex += `${audioMix}${audioMixInputs}amix=inputs=${videoFiles.length}:dropout_transition=0[aout]`;

        const command = `ffmpeg ${inputParams} `
            + `-filter_complex "${filterComplex}" `
            + `-map "[blend${videoFiles.length-1}]" -map "[aout]" `
            + `-c:v libx264 -preset ultrafast -pix_fmt yuv420p `
            + `-c:a aac -strict experimental `
            + `-t ${OUTPUT_DURATION} `
            + `-y "${outputFile}"`;

        await safeExec(command, "Creating composite video");
        logWithTimestamp(`Composite video saved to: ${outputFile}`);

    } catch (error) {
        console.error("Error creating composite video:", error);
        process.exit(1);
    }
}

// Main processing function
async function processVideos() {
    try {
        const files = await fs.promises.readdir(inputDir);
        const videoFiles = files
            .filter(file => path.extname(file).toLowerCase() === '.mp4')
            .map(file => path.join(inputDir, file));

        if (videoFiles.length === 0) {
            console.error("No MP4 files found in the specified directory");
            process.exit(1);
        }

        logWithTimestamp(`Processing ${videoFiles.length} MP4 files`);
        await createCompositeVideo(videoFiles);
        logWithTimestamp("Composite video created successfully!");

    } catch (error) {
        console.error("Error during processing:", error);
        process.exit(1);
    }
}

// Run the main function
processVideos();