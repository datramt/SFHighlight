# scorefol.io Ending Sequence Concatenation
Concatenates ending sequence to scorefol.io videos

To Use:
`node concat.js ~/path/to/file.mp4 F` (for FMS ending)
`node concat.js ~/path/to/file.mp4 H` (for scorefol.io Highlight ending)

- Determines which sequence to use based on argument.
- Upscales FPS of score video to 30fps so that ending sequence animation doesn't display poorly.
- Ensures audio of ending sequence is in sync with video in cases where the score video has silent preliminary pages displayed at end.
- Concatenates the score video with the ending sequence.

NEW: Detects if output was 4k or not, and chooses appropriate output accordingly.