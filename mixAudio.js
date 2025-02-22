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
    console.error("Usage: node mixAudio.js <directory_path>");
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

async function mixAudio(audioFiles) {
    const outputDir = path.join(inputDir, 'mixed');
    const outputFile = path.join(outputDir, 'mixed_output.mp3');
    
    try {
        // Create output directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            await fs.promises.mkdir(outputDir, { recursive: true });
        }

        // Calculate volume adjustment based on number of files
        // Using modified formula with +20dB boost to final output
        const volumeAdjustment = (-6 * Math.log2(audioFiles.length)) + 40;
        
        // Create the filter complex string for mixing
        const filterInputs = audioFiles
            .map((_, i) => `[${i}:a]volume=${volumeAdjustment}dB[a${i}]`)
            .join(';');
        
        const mixInputs = audioFiles
            .map((_, i) => `[a${i}]`)
            .join('');
        
        // Construct the full ffmpeg command
        const inputFiles = audioFiles
            .map(file => `-i "${file}"`)
            .join(' ');
        
        const command = `ffmpeg ${inputFiles} -filter_complex "${filterInputs};${mixInputs}amix=inputs=${audioFiles.length}:dropout_transition=0[aout]" -map "[aout]" -b:a 320k "${outputFile}"`;

        await safeExec(command, "Mixing audio files");
        
        logWithTimestamp(`Mixed audio saved to: ${outputFile}`);
        logWithTimestamp(`Applied volume adjustment: ${volumeAdjustment.toFixed(1)}dB`);

    } catch (error) {
        console.error("Error mixing audio:", error);
        process.exit(1);
    }
}

// Main processing function
async function processAudio() {
    try {
        // Get all MP3 files in the input directory
        const files = await fs.promises.readdir(inputDir);
        const audioFiles = files
            .filter(file => path.extname(file).toLowerCase() === '.mp3')
            .map(file => path.join(inputDir, file));

        if (audioFiles.length === 0) {
            console.error("No MP3 files found in the specified directory");
            process.exit(1);
        }

        logWithTimestamp(`Found ${audioFiles.length} MP3 files to mix`);
        await mixAudio(audioFiles);
        logWithTimestamp("Audio mixing completed successfully!");

    } catch (error) {
        console.error("Error during processing:", error);
        process.exit(1);
    }
}

// Run the main function
processAudio(); 