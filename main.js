const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const { uIOhook, UiohookKey } = require('uiohook-napi');
const { desktopCapturer, screen } = electron;
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');

// Verify Electron app is loaded
if (!app) {
    console.error('Failed to load Electron app module. Make sure Electron is installed correctly.');
    process.exit(1);
}

let mainWindow;
let isTracking = false;
let trackingInterval;

// Activity tracking variables - Fixed structure
const ACTIVITY_INTERVAL_MS = 60 * 1000; // 1 minute
const BLOCK_DURATION_MS = 10 * 60 * 1000; // 10 minutes
let activityIntervalId = null;
let blockIntervalId = null;

// Block timing variables
let currentBlockStartTime = null;
let currentBlockFolder = null;
let screenshotTimeout = null;
let screenshotTaken = false;

// Pause/resume tracking variables
let isPaused = false;
let currentMinute = 0; // Track which minute we're on (0-9 for 10-minute block)
let screenshotMinute = null; // Random minute when screenshot should be taken
let pausedAt = null; // Timestamp when paused
let totalPausedDuration = 0; // Total time spent paused

// Current activity counters (reset every minute)
let currentMinuteKeyboard = 0;
let currentMinuteMouse = 0;

// Current tracking context
let currentProjectID = null;
let currentUserID = null;
let currentTaskID = null;

// Activity data structure for 10-minute blocks
let activityData = {
    projectID: null,
    userID: null,
    taskID: null,
    blockStartTime: null,
    createdAt: null,
    activeJSON: Array(10).fill({ keyboard: 0, mouse: 0, active: 0 }), // 10-minute slots
    activeFlag: 1,
    activeMins: 0,
    activeMemo: ''
};

// Validate activity data structure
function validateActivityData(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid activity data: must be an object');
    }

    if (!Array.isArray(data.activeJSON) || data.activeJSON.length !== 10) {
        throw new Error('Invalid activeJSON: must be array of 10 intervals');
    }

    data.activeJSON.forEach(interval => {
        if (!interval || typeof interval !== 'object') {
            throw new Error('Invalid interval data');
        }
        if (typeof interval.keyboard !== 'number' || typeof interval.mouse !== 'number' || typeof interval.active !== 'number') {
            throw new Error('Invalid interval values: must be numbers');
        }
    });

    return true;
}

// Validate activity data when it's created
validateActivityData(activityData);

// Function to get current block information
function getCurrentBlockInfo() {
    const now = new Date();
    const blockStart = new Date(Math.floor(now.getTime() / BLOCK_DURATION_MS) * BLOCK_DURATION_MS);
    const blockEnd = new Date(blockStart.getTime() + BLOCK_DURATION_MS);
    return {
        blockStart: blockStart.toISOString(),
        blockEnd: blockEnd.toISOString(),
        blockStartTime: blockStart.getTime()
    };
}

// Function to create activity folder path
function getActivityFolderPath() {
    if (!currentProjectID || !currentTaskID) {
        throw new Error('Project ID or Task ID not set');
    }

    const blockInfo = getCurrentBlockInfo();
    const dateStr = blockInfo.blockStart.split('T')[0];  // 2025-06-26
    const timeStr = blockInfo.blockStart.split('T')[1].slice(0, 5).replace(':', ''); // 1056

    return path.join(
        __dirname, 'public', 'activity',
        `activity-${currentProjectID}-${currentTaskID}-${dateStr}-${timeStr}`
    );
}

// Function to create screenshot folder path
function getScreenshotFolderPath() {
    if (!currentProjectID || !currentTaskID) {
        throw new Error('Project ID or Task ID not set');
    }

    const blockInfo = getCurrentBlockInfo();
    if (!blockInfo || !blockInfo.blockStart) {
        throw new Error('Invalid block information');
    }

    const dateStr = blockInfo.blockStart.split('T')[0];  // 2025-06-26
    const timeStr = blockInfo.blockStart.split('T')[1].slice(0, 5).replace(':', ''); // 1056

    return path.join(
        __dirname, 'public', 'screenshots',
        `project_${currentProjectID}`,
        `task_${currentTaskID}`,
        `date_${dateStr}`,
        `block_${timeStr}`
    );
}

// Function to store block for retry
// Empty function since retry functionality is removed
async function storeBlockForRetry() {
    // Do nothing
}

// Fixed saveActHoursLocally function
async function saveActHoursLocally(projectID, taskID, data) {
    try {
        // Create a dedicated folder for act hours data
        const actHoursDir = path.join(__dirname, 'public', 'act_hours', `project_${projectID}`);
        await fs.ensureDir(actHoursDir);

        const filePath = path.join(actHoursDir, `task_${taskID}_acthours.json`);

        const dataToSave = {
            ...data,
            taskID,
            projectID,
            lastUpdated: new Date().toISOString(),
            actHours: data.actHours,
            isExceeded: data.isExceeded
        };

        await fs.writeJson(filePath, dataToSave, { spaces: 2 });
        console.log(`ActHours data saved locally at: ${filePath}`);
        return true;
    } catch (error) {
        console.error('Error in saveActHoursLocally:', error);
        return false;
    }
}

// Function to generate random screenshot minute (call at start of each new block)
function generateRandomScreenshotMinute() {
    screenshotMinute = Math.floor(Math.random() * 11); // Random between 0-10
    console.log('Screenshot will be taken at minute:', screenshotMinute);
}

// Function to start a new 10-minute block
function startNewBlock() {
    try {
        const now = new Date();
        currentBlockStartTime = now;
        currentMinute = 0; // Reset minute counter
        screenshotTaken = false;
        generateRandomScreenshotMinute(); // Generate random minute for screenshot (0-10)

        // Initialize activity data for new block with proper array cloning
        activityData = {
            projectID: currentProjectID,
            userID: currentUserID,
            taskID: currentTaskID,
            blockStartTime: now.toISOString(),
            createdAt: now.toISOString(),
            activeJSON: Array(10).fill(null).map(() => ({ keyboard: 0, mouse: 0, active: 0 })),
            activeFlag: 1,
            activeMins: 0,
            activeMemo: '',
            screenshotMinute: screenshotMinute, // Store for reference
            totalPausedDuration: 0
        };

        // Create block folder with better error handling
        const blockInfo = getCurrentBlockInfo();
        const dateStr = blockInfo.blockStart.split('T')[0];
        const timeStr = blockInfo.blockStart.split('T')[1].slice(0, 5).replace(':', '');

        currentBlockFolder = path.join(
            __dirname, 'public', 'activity',
            `activity-${currentProjectID}-${currentTaskID}-${dateStr}-${timeStr}`
        );

        fs.ensureDir(currentBlockFolder)
            .then(() => {
                console.log('Created block folder:', currentBlockFolder);
            })
            .catch(err => {
                console.error('Error creating block folder:', err);
            });

        // Save initial activity data
        const combinedFile = path.join(currentBlockFolder, 'combined_activity.json');
        fs.writeJson(combinedFile, activityData, { spaces: 2 })
            .then(() => {
                console.log('Initialized new block successfully');
            })
            .catch(err => {
                console.error('Error saving initial activity data:', err);
            });

        // Send block start notification to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('block-start', {
                blockStartTime: currentBlockStartTime,
                projectID: currentProjectID,
                taskID: currentTaskID,
                screenshotMinute: screenshotMinute
            });
        }

        return true;
    } catch (error) {
        console.error('Error starting new block:', error);
        return false;
    }
}

// Function to pause tracking
async function pauseTracking() {
    if (!isTracking || isPaused) {
        console.log('Cannot pause: tracking not active or already paused');
        return { success: false, message: 'Not tracking or already paused' };
    }

    try {
        isPaused = true;
        pausedAt = new Date();

        // Save current state before pausing
        if (currentBlockFolder) {
            const combinedFile = path.join(currentBlockFolder, 'combined_activity.json');
            const tempData = {
                ...activityData,
                modifiedAt: new Date().toISOString()
            };
            fs.writeJson(combinedFile, tempData, { spaces: 2 });
        }

        // Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tracking-status', {
                isTracking: true,
                isPaused: true,
                pausedAt: pausedAt.toISOString()
            });
        }

        console.log('Tracking paused at:', pausedAt.toISOString());
        return { success: true, message: 'Tracking paused successfully' };
    } catch (error) {
        console.error('Error pausing tracking:', error);
        return { success: false, message: 'Failed to pause tracking' };
    }
}

// Function to pause tracking
async function pauseTracking() {
    if (!isTracking || isPaused) {
        console.log('Cannot pause: tracking not active or already paused');
        return { success: false, message: 'Not tracking or already paused' };
    }

    try {
        isPaused = true;
        pausedAt = new Date();

        // Save current state before pausing
        if (currentBlockFolder) {
            const combinedFile = path.join(currentBlockFolder, 'combined_activity.json');
            const tempData = {
                ...activityData,
                modifiedAt: new Date().toISOString()
            };
            fs.writeJson(combinedFile, tempData, { spaces: 2 });
        }

        // Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tracking-status', {
                isTracking: true,
                isPaused: true,
                pausedAt: pausedAt.toISOString()
            });
        }

        console.log('Tracking paused at:', pausedAt.toISOString());
        return { success: true, message: 'Tracking paused successfully' };
    } catch (error) {
        console.error('Error pausing tracking:', error);
        return { success: false, message: 'Failed to pause tracking' };
    }
}


// Create block folder with better error handling
const blockInfo = getCurrentBlockInfo();
const dateStr = blockInfo.blockStart.split('T')[0];
const timeStr = blockInfo.blockStart.split('T')[1].slice(0, 5).replace(':', '');

currentBlockFolder = path.join(
    __dirname, 'public', 'activity',
    `activity-${currentProjectID}-${currentTaskID}-${dateStr}-${timeStr}`
);

// Ensure directory creation with proper error handling
fs.ensureDir(currentBlockFolder)
    .then(() => {
        console.log('Created block folder:', currentBlockFolder);
    })
    .catch(err => {
        console.error('Error creating block folder:', err);
        // Try to create parent directories step by step
        const parentDir = path.dirname(currentBlockFolder);
        fs.ensureDir(parentDir)
            .then(() => fs.ensureDir(currentBlockFolder))
            .catch(parentErr => {
                console.error('Failed to create parent directory:', parentErr);
            });
    });

// Take screenshot immediately at block start with better error handling
takeScreenshot()
    .then(() => {
        console.log('Block start screenshot taken');
    })

// Function to pause tracking
async function pauseTracking() {
    if (!isTracking || isPaused) {
        console.log('Cannot pause: tracking not active or already paused');
        return { success: false, message: 'Not tracking or already paused' };
    }

    try {
        isPaused = true;
        pausedAt = new Date();

        // Clear the minute interval but keep the data
        if (activityIntervalId) {
            clearInterval(activityIntervalId);
            activityIntervalId = null;
        }

        // Clear block interval 
        if (blockIntervalId) {
            clearInterval(blockIntervalId);
            blockIntervalId = null;
        }

        // Clear any pending screenshot timeout
        if (screenshotTimeout) {
            clearTimeout(screenshotTimeout);
            screenshotTimeout = null;
        }

        console.log(`Tracking paused at minute ${currentMinute}, screenshot ${screenshotTaken ? 'already taken' : 'pending at minute ' + screenshotMinute}`);

        // Take screenshot on pause and save it
        try {
            await takeScreenshot();
            screenshotTaken = true;
            console.log('Screenshot taken on pause');
        } catch (error) {
            console.error('Error taking screenshot on pause:', error);
        }

        // Save current state to activity data
        if (currentBlockFolder) {
            try {
                const combinedFile = path.join(currentBlockFolder, 'combined_activity.json');
                const pauseData = {
                    ...activityData,
                    currentMinute: currentMinute,
                    screenshotTaken: true, // Force screenshot taken to true
                    screenshotMinute: screenshotMinute,
                    isPaused: true,
                    pausedAt: pausedAt.toISOString(),
                    modifiedAt: new Date().toISOString()
                };

                await fs.writeJson(combinedFile, pauseData, { spaces: 2 });
                console.log('Saved pause state with screenshot');
            } catch (fileError) {
                console.error('Error saving pause state:', fileError);
            }
        }

        // Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tracking-status', {
                isTracking: true,
                isPaused: true,
                currentMinute: currentMinute,
                screenshotTaken: true,
                screenshotMinute: screenshotMinute
            });
        }

        return { success: true };

    } catch (error) {
        console.error('Error pausing tracking:', error);
        return { success: false, message: error.message };
    }
}

// Function to resume tracking
async function resumeTracking() {
    if (!isTracking || !isPaused) {
        console.log('Cannot resume: not tracking or not paused');
        return { success: false, message: 'Not paused or not tracking' };
    }

    try {
        // Calculate paused duration
        if (pausedAt) {
            const pauseDuration = new Date() - pausedAt;
            totalPausedDuration += pauseDuration;
            console.log(`Resumed after ${Math.round(pauseDuration / 1000)} seconds`);
        }

        // Send pending data to server before resuming
        if (currentBlockFolder) {
            try {
                const combinedFile = path.join(currentBlockFolder, 'combined_activity.json');
                const activityData = await fs.readJson(combinedFile);

                // Prepare data for server
                const blockData = {
                    ...activityData,
                    totalPausedDuration: totalPausedDuration
                };

                // Send to server
                await sendBlockToServer(blockData, currentBlockFolder);
                console.log('Sent paused block data to server');
            } catch (error) {
                console.error('Error sending paused block data:', error);
            }
        }

        isPaused = false;
        pausedAt = null;

        console.log(`Resuming tracking from minute ${currentMinute}, screenshot ${screenshotTaken ? 'already taken' : 'scheduled for minute ' + screenshotMinute}`);

        // Reset state for new block
        currentMinute = 0;
        screenshotTaken = false;
        generateRandomScreenshotMinute();

        // Start new block
        await startNewBlock();

        // Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tracking-status', {
                isTracking: true,
                isPaused: false,
                currentMinute: currentMinute,
                screenshotTaken: screenshotTaken,
                screenshotMinute: screenshotMinute
            });
        }

        return { success: true };

    } catch (error) {
        console.error('Error resuming tracking:', error);
        return { success: false, message: error.message };
    }
}

// IPC Handlers for pause/resume tracking
ipcMain.handle('pause-tracking', async () => {
    return await pauseTracking();
});

ipcMain.handle('resume-tracking', async () => {
    return await resumeTracking();
});

ipcMain.handle('get-tracking-progress', async () => {
    return {
        currentMinute: currentMinute,
        totalMinutes: 10,
        screenshotTaken: screenshotTaken,
        screenshotMinute: screenshotMinute,
        isPaused: isPaused,
        isTracking: isTracking
    };
});



// Function to finish current 2-minute block
async function finishCurrentBlock() {
    if (!currentBlockStartTime) {
        console.log('No current block to finish');
        return;
    }

    try {
        console.log('Finishing current 2-minute block...');

        // Ensure screenshot is taken before sending data
        if (!screenshotTaken) {
            await takeScreenshot();
        }

        // Store current block folder reference before it gets reset
        const blockFolder = currentBlockFolder;
        const blockData = { ...activityData }; // Clone the data

        // Calculate total active intervals (out of 12)
        const activeIntervals = blockData.activeJSON.filter(interval => interval.active === 1).length;
        const activeMins = Math.round((activeIntervals / 12) * 2 * 100) / 100;

        // Update activity data
        blockData.activeFlag = activeIntervals > 0 ? 1 : 0;
        blockData.activeMins = activeMins;
        blockData.activeMemo = `Activity block completed: ${activeIntervals}/12 intervals active (${activeMins} minutes)`;

        // Save combined activity data
        if (blockFolder) {
            const combinedActivityFile = path.join(blockFolder, 'combined_activity.json');
            const combinedData = {
                projectID: currentProjectID,
                userID: currentUserID,
                taskID: currentTaskID,
                blockStartTime: currentBlockStartTime.toISOString(),
                blockEndTime: new Date().toISOString(),
                activeJSON: [...blockData.activeJSON], // Proper array clone
                activeFlag: blockData.activeFlag,
                activeMins: blockData.activeMins,
                deletedFlag: 0,
                activeMemo: blockData.activeMemo,
                createdAt: blockData.createdAt,
                modifiedAt: new Date().toISOString()
            };

            await fs.writeJson(combinedActivityFile, combinedData, { spaces: 2 });
            console.log('Saved combined activity data:', combinedActivityFile);

            // Send block to server with the stored folder reference
            await sendBlockToServer(combinedData, blockFolder);
        } else {
            console.log('No block folder available, cannot save activity data');
        }

    } catch (error) {
        console.error('Error finishing block:', error);
        // Store failed block data for retry
        await storeBlockForRetry(activityData, currentBlockFolder);
    }
}


// Function to start activity tracking
async function startActivityTracking() {
    if (isTracking) {
        console.log('Activity tracking is already running');
        return;
    }

    if (!currentProjectID || !currentTaskID) {
        console.error('Cannot start tracking: Project ID or Task ID not set');
        return;
    }

    try {
        isTracking = true;

        // Start first block
        startNewBlock();

        console.log('Starting activity tracking...');

        // Activity interval - runs every minute
        activityIntervalId = setInterval(async () => {
            try {
                if (!currentBlockStartTime) {
                    console.log('No current block start time, skipping interval');
                    return;
                }

                const now = new Date();
                const minute = now.getMinutes();
                const index = minute % 10; // Last digit of minute determines index

                // Calculate active status for this minute
                const isActive = currentMinuteKeyboard > 0 || currentMinuteMouse > 0;

                // Update activity data for this minute
                activityData.activeJSON[index] = {
                    keyboard: currentMinuteKeyboard,
                    mouse: currentMinuteMouse,
                    active: isActive ? 1 : 0
                };

                // Calculate active minutes for this block
                const activeMinutes = activityData.activeJSON.filter(interval => interval.active === 1).length;
                activityData.activeFlag = activeMinutes;
                activityData.activeMins = activeMinutes;
                activityData.activeMemo = `Activity block completed: ${activeMinutes}/10 minutes active`;

                // Save combined activity data
                if (currentBlockFolder) {
                    try {
                        const combinedFile = path.join(currentBlockFolder, 'combined_activity.json');
                        const tempData = {
                            ...activityData,
                            modifiedAt: new Date().toISOString()
                        };

                        await fs.writeJson(combinedFile, tempData, { spaces: 2 });
                        console.log('Saved activity data for minute:', minute);
                    } catch (fileError) {
                        console.error('Error saving activity file:', fileError);
                    }
                }

                // Reset minute counters
                currentMinuteKeyboard = 0;
                currentMinuteMouse = 0;

                // Send activity update to renderer
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('activity-update', {
                        type: 'minute',
                        minute: minute,
                        activeJSON: activityData.activeJSON
                    });
                }

            } catch (error) {
                console.error('Error in activity tracking interval:', error);
            }
        }, ACTIVITY_INTERVAL_MS);

        // Block interval - runs every 2 minutes to start new blocks
        blockIntervalId = setInterval(async () => {
            try {
                console.log('2-minute block completed, starting new block...');

                // Finish current block
                await finishCurrentBlock();

                // Start new block
                startNewBlock();

            } catch (error) {
                console.error('Error in block interval:', error);
            }
        }, BLOCK_DURATION_MS);

    } catch (error) {
        console.error('Error starting activity tracking:', error);
        isTracking = false;
    }
}

// FIXED: Modified sendBlockToServer to accept blockFolder parameter
async function sendBlockToServer(blockData, blockFolder = null) {
    try {
        // Validate project and task IDs
        if (!currentProjectID || !currentTaskID) {
            console.error('Missing project or task ID');
            throw new Error('Project or task ID not set');
        }

        // Use provided blockFolder or fall back to currentBlockFolder
        const folderToUse = blockFolder || currentBlockFolder;
        if (!folderToUse) {
            console.error('No block folder available');
            throw new Error('Block folder not initialized');
        }

        // Use the screenshot data directly instead of reading from file
        let screenshotData = null;
        try {
            const screenshotFile = path.join(getScreenshotFolderPath(), 'screenshot.json');
            console.log('Screenshot file path:', screenshotFile);

            const screenshotExists = await fs.pathExists(screenshotFile);
            console.log('Screenshot exists:', screenshotExists);

            if (screenshotExists) {
                screenshotData = await fs.readJson(screenshotFile);
                console.log('Screenshot data loaded:', screenshotData ? 'Yes' : 'No');

                // Validate screenshot data
                if (!screenshotData || !screenshotData.imageURL || !screenshotData.thumbNailURL) {
                    console.error('Invalid screenshot data:', screenshotData);
                    throw new Error('Invalid screenshot data format');
                }
            }
        } catch (err) {
            console.error('Error reading screenshot data:', err);
            throw err;
        }

        // Check if we have required screenshot data
        if (!screenshotData || !screenshotData.imageURL || !screenshotData.thumbNailURL) {
            console.log('No screenshot data available, skipping server send for this block');
            // Store this block locally for later retry
            await storeBlockForRetry(blockData, folderToUse);
            return;
        }

        // Validate that imageURL and thumbNailURL are proper base64 data
        const imageUrlValid = screenshotData.imageURL.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
        const thumbnailUrlValid = screenshotData.thumbNailURL.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);

        if (!imageUrlValid || !thumbnailUrlValid) {
            console.log('Invalid image format, skipping server send for this block');
            await storeBlockForRetry(blockData, folderToUse);
            return;
        }

        // Create payload matching database schema
        const payload = {
            projectID: parseInt(blockData.projectID),
            userID: parseInt(blockData.userID),
            taskID: parseInt(blockData.taskID),
            screenshotTimeStamp: screenshotData.timestamp,
            activeJSON: blockData.activeJSON || [],
            calcTimeStamp: new Date(blockData.createdAt).toISOString(),
            activeFlag: parseInt(blockData.activeFlag),
            activeMins: parseFloat(blockData.activeMins),
            deletedFlag: 0,
            activeMemo: blockData.activeMemo,
            imageURL: screenshotData.imageURL,
            thumbNailURL: screenshotData.thumbNailURL,
            createdAt: new Date(blockData.createdAt).toISOString(),
            modifiedAt: new Date().toISOString()
        };

        console.log('Sending 2-minute block to server with screenshot data');

        const response = await fetch('https://vw.aisrv.in/node_backend/postProjectV1', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log('10-minute block sent to server successfully');

            // Only clean up folders if we've completed a full 10-minute block
            if (blockData.activeMins >= 10) {
                try {
                    // Get all paths to remove
                    const screenshotFolder = getScreenshotFolderPath();
                    const activityFolder = folderToUse;

                    // Remove both folders
                    const foldersToRemove = [screenshotFolder, activityFolder].filter(Boolean);

                    for (const folder of foldersToRemove) {
                        if (await fs.pathExists(folder)) {
                            try {
                                await fs.remove(folder);
                                console.log('Removed folder:', folder);
                            } catch (error) {
                                console.error('Error removing folder:', error);
                            }
                        }
                    }

                    // Remove any remaining files in the folders
                    try {
                        const screenshotFile = path.join(screenshotFolder, 'screenshot.json');
                        if (await fs.pathExists(screenshotFile)) {
                            await fs.remove(screenshotFile);
                        }

                        if (activityFolder) {
                            const activityFiles = await fs.readdir(activityFolder).catch(() => []);
                            for (const file of activityFiles) {
                                const filePath = path.join(activityFolder, file);
                                await fs.remove(filePath).catch(error =>
                                    console.error(`Error removing file ${filePath}:`, error)
                                );
                            }
                        }
                    } catch (error) {
                        console.error('Error cleaning up remaining files:', error);
                    }

                    console.log('All local files cleaned up after successful 10-minute block send');

                    // Notify renderer of successful sync
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('block-synced', {
                            timestamp: new Date().toISOString(),
                            blockStartTime: blockData.blockStartTime,
                            activeMins: blockData.activeMins
                        });
                    }

                } catch (cleanupError) {
                    console.error('Error cleaning up local files:', cleanupError);
                    // Store failed cleanup for retry
                    await storeBlockForRetry(blockData, folderToUse);
                }
            }

        } else {
            const errorText = await response.text();
            console.error('Failed to send block to server:', response.status, errorText);
            console.log('Keeping local files due to server send failure');
            // Store failed block for retry
            await storeBlockForRetry(blockData, folderToUse);
        }

    } catch (error) {
        console.error('Error sending block to server:', error);
        // Store failed block for retry
        await storeBlockForRetry(blockData, folderToUse);
    }
}

// Function to take screenshot
async function takeScreenshot() {
    try {
        const screenshotFolderPath = getScreenshotFolderPath();
        await fs.ensureDir(screenshotFolderPath);

        // Get screenshot from desktop capturer
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });

        if (sources.length > 0) {
            const screenshot = sources[0];
            const screenshotBase64 = screenshot.thumbnail.toDataURL();

            // Save screenshot as base64 in JSON
            const screenshotData = {
                timestamp: new Date().toISOString(),
                projectID: currentProjectID,
                taskID: currentTaskID,
                userID: currentUserID,
                imageURL: screenshotBase64,
                thumbNailURL: screenshotBase64, // Using same for now
                blockStartTime: currentBlockStartTime?.toISOString(),
                screenshotTakenAt: new Date().toISOString()
            };

            const screenshotFile = path.join(screenshotFolderPath, 'screenshot.json');
            await fs.writeJson(screenshotFile, screenshotData, { spaces: 2 });

            console.log(`Screenshot saved to: ${screenshotFile}`);

            // Emit success event
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('screenshot-success', {
                    timestamp: new Date().toISOString(),
                    projectID: currentProjectID,
                    taskID: currentTaskID,
                    screenshotPath: screenshotFile
                });
            }

            return screenshotData;
        } else {
            throw new Error('No screen sources available');
        }
    } catch (error) {
        console.error('Error taking screenshot:', error);
        throw error;
    }
}

// Start tracking function
async function startTracking() {
    if (isTracking) {
        console.log('Tracking already started');
        return;
    }

    if (!currentProjectID || !currentTaskID) {
        console.error('Cannot start tracking: Project ID or Task ID not set');
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tracking-status', {
                isTracking: false,
                error: 'Project ID or Task ID not set'
            });
        }
        return;
    }

    try {
        // Clean up any pending data from previous session
        const activityDir = path.join(__dirname, 'public', 'activity');
        const screenshotsDir = path.join(__dirname, 'public', 'screenshots');

        // Remove all pending activity folders
        if (await fs.pathExists(activityDir)) {
            const activityFolders = await fs.readdir(activityDir);
            for (const folder of activityFolders) {
                const folderPath = path.join(activityDir, folder);
                try {
                    await fs.remove(folderPath);
                    console.log('Removed pending activity folder:', folderPath);
                } catch (error) {
                    console.error('Error removing activity folder:', error);
                }
            }
        }

        // Remove all pending screenshot folders
        if (await fs.pathExists(screenshotsDir)) {
            const projectDirs = await fs.readdir(screenshotsDir);
            for (const projectDir of projectDirs) {
                const projectPath = path.join(screenshotsDir, projectDir);
                try {
                    await fs.remove(projectPath);
                    console.log('Removed pending screenshot folder:', projectPath);
                } catch (error) {
                    console.error('Error removing screenshot folder:', error);
                }
            }
        }

        // Initialize activity data
        activityData = {
            projectID: currentProjectID,
            userID: currentUserID,
            taskID: currentTaskID,
            blockStartTime: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            activeJSON: Array(10).fill({ keyboard: 0, mouse: 0, active: 0 }),
            activeFlag: 0,
            activeMins: 0,
            activeMemo: ''
        };

        // Reset activity counters
        currentMinuteKeyboard = 0;
        currentMinuteMouse = 0;
        screenshotTaken = false;

        // Initialize activity tracking
        startActivityTracking();

        // Set up input event listeners
        uIOhook.on('mousedown', (event) => {
            if (isTracking) {
                currentMinuteMouse += 1;
                // Send mouse click count to renderer
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('activity-update', {
                        type: 'mouseclick',
                        count: currentMinuteMouse
                    });
                }
            }
        });

        // Set up keyboard event listener
        uIOhook.on('keydown', (event) => {
            if (isTracking) {
                currentMinuteKeyboard += 1;
                // Send keyboard count to renderer
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('activity-update', {
                        type: 'keyboard',
                        count: currentMinuteKeyboard
                    });
                }
            }
        });

        // Start uIOhook with error handling
        try {
            uIOhook.start();
            console.log('Started uIOhook successfully');
        } catch (uiohookError) {
            console.error('Error starting uIOhook:', uiohookError);
            throw uiohookError;
        }

        // Send tracking status update
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tracking-status', { isTracking: true });
        }

    } catch (error) {
        console.error('Error starting tracking:', error);
        isTracking = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tracking-status', {
                isTracking: false,
                error: error.message
            });
        }
    }
}

// FIXED: Stop tracking function
function stopTracking() {
    if (!isTracking) {
        console.log('Tracking not running');
        return;
    }

    console.log('Stopping tracking...');

    try {
        // Set isTracking to false first
        isTracking = false;

        // Finish current block BEFORE resetting variables
        if (currentBlockStartTime) {
            console.log('Finishing current block on stopTracking');
            finishCurrentBlock()
                .then(() => {
                    console.log('Block finished successfully');
                })
                .catch(error => {
                    console.error('Error finishing block:', error);
                });
        }

        // Clear intervals
        if (activityIntervalId) {
            clearInterval(activityIntervalId);
            activityIntervalId = null;
        }
        if (blockIntervalId) {
            clearInterval(blockIntervalId);
            blockIntervalId = null;
        }

        // Clear screenshot timeout
        if (screenshotTimeout) {
            clearTimeout(screenshotTimeout);
            screenshotTimeout = null;
        }

        // Clean up uIOhook with error handling
        try {
            uIOhook.removeAllListeners();
            uIOhook.stop();
            console.log('Stopped tracking global input events');
        } catch (uiohookError) {
            console.error('Error stopping uIOhook:', uiohookError);
        }

        // Reset block variables AFTER a delay
        // Add these reset lines to your existing stopTracking() function:

        // Reset pause/resume variables (add this in your setTimeout block)
        setTimeout(() => {
            currentBlockStartTime = null;
            currentBlockFolder = null;
            screenshotTaken = false;
            currentMinuteKeyboard = 0;
            currentMinuteMouse = 0;

            // Add these new reset lines:
            isPaused = false;
            currentMinute = 0;
            screenshotMinute = null;
            pausedAt = null;
            totalPausedDuration = 0;

            // Reset activity data
            activityData = {
                projectID: null,
                userID: null,
                taskID: null,
                blockStartTime: null,
                createdAt: null,
                activeJSON: Array(10).fill(null).map(() => ({ keyboard: 0, mouse: 0, active: 0 })),
                activeFlag: 1,
                activeMins: 0,
                activeMemo: ''
            };
        }, 1000);

        // Send tracking status update
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tracking-status', { isTracking: false });
        }

    } catch (error) {
        console.error('Error stopping tracking:', error);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tracking-status', {
                isTracking: false,
                error: error.message
            });
        }
    }
}

// Load ActHours data from dedicated folder
async function loadActHoursLocally() {
    try {
        const actHoursDir = path.join(__dirname, 'public', 'act_hours');
        const dirExists = await fs.pathExists(actHoursDir);
        if (!dirExists) {
            return {};
        }

        const result = {};
        const projectDirs = await fs.readdir(actHoursDir);

        for (const projectDir of projectDirs) {
            if (!projectDir.startsWith('project_')) continue;

            const projectPath = path.join(actHoursDir, projectDir);
            const files = (await fs.readdir(projectPath)).filter(f => f.endsWith('_acthours.json'));

            for (const file of files) {
                try {
                    const fileData = await fs.readJson(path.join(projectPath, file));
                    const taskId = fileData.taskID;
                    if (taskId) {
                        result[taskId] = {
                            actHours: fileData.actHours,
                            isExceeded: fileData.isExceeded
                        };
                    }
                } catch (err) {
                    console.error(`Error reading file ${file}:`, err);
                }
            }
        }

        return result;
    } catch (error) {
        console.error('Error loading actHours data:', error);
        return {};
    }
}

// Register IPC handlers
ipcMain.handle('minimize-window', () => {
    if (mainWindow) {
        mainWindow.minimize();
        return true;
    }
    return false;
});

// Add quit app handler
ipcMain.handle('quit-app', () => {
    if (mainWindow) {
        // Stop tracking before quitting
        stopTracking();
        // Close the window
        mainWindow.close();
        return true;
    }
    return false;
});

// Start the app
if (app) {
    app.whenReady().then(() => {
        // Register IPC handlers
        ipcMain.handle('start-tracking', async () => {
            startTracking();
            return { success: true, isTracking };
        });

        ipcMain.handle('stop-tracking', async () => {
            stopTracking();
            return { success: true, isTracking };
        });

        ipcMain.on('tracking-status', (event, data) => {
            mainWindow.webContents.send('tracking-status', data);
        });

        ipcMain.on('tracking-error', (event, error) => {
            mainWindow.webContents.send('tracking-error', error);
        });

        ipcMain.handle('get-tracking-status', async () => {
            return { isTracking };
        });

        ipcMain.handle('set-tracking-context', (event, context) => {
            currentProjectID = context.projectID;
            currentUserID = context.userID;

            // Priority order: subactionItemID > actionItemID > subtaskID > taskID
            if (context.subactionItemID) {
                currentTaskID = context.subactionItemID;
                console.log('Tracking subaction item with ID:', currentTaskID);
            } else if (context.actionItemID) {
                currentTaskID = context.actionItemID;
                console.log('Tracking action item with ID:', currentTaskID);
            } else if (context.subtaskID) {
                currentTaskID = context.subtaskID;
                console.log('Tracking subtask with ID:', currentTaskID);
            } else {
                currentTaskID = context.taskID;
                console.log('Tracking task with ID:', currentTaskID);
            }

            return { success: true };
        });

        ipcMain.handle('take-screenshot', async () => {
            try {
                return await takeScreenshot();
            } catch (error) {
                console.error('Screenshot IPC failed:', error);
                mainWindow.webContents.send('tracking-error', {
                    type: 'api-failure',
                    message: error.message
                });
                return { success: false };
            }
        });

        ipcMain.handle('save-act-hours', async (event, { taskId, projectId, actHours, isExceeded }) => {
            try {
                const response = await fetch(`https://vw.aisrv.in/node_backend/postProjectV1`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        taskID: taskId,
                        projectID: projectId,
                        actHours,
                        isExceeded
                    })
                });

                if (response.ok) {
                    await saveActHoursLocally(projectId, taskId, {
                        actHours,
                        isExceeded,
                        isSynced: true,
                        lastServerSync: new Date().toISOString()
                    });
                    return { success: true, isLocal: false };
                }

                throw new Error('Failed to save to server');
            } catch (error) {
                console.log('Server save failed, saving locally only');
                const success = await saveActHoursLocally(projectId, taskId, {
                    actHours,
                    isExceeded
                });
                return { success, isLocal: true };
            }
        });

        ipcMain.handle('load-act-hours', async () => {
            return await loadActHoursLocally();
        });

        function createWindow() {
            mainWindow = new BrowserWindow({
                width: 600,
                height: 900,
                resizable: false,              // ⬅️  stops user resizing
                minimizable: false,
                maximizable: false,
                frame: true,
                titleBarStyle: 'hidden',
                backgroundColor: '#ffffff',
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: path.join(__dirname, 'preload.js'),
                },
            });

            const startUrl =
                process.env.ELECTRON_START_URL ||
                `file://${path.join(__dirname, 'build/index.html')}`;
            mainWindow.loadURL(startUrl);

            if (process.env.NODE_ENV === 'development') {
                mainWindow.webContents.openDevTools();
            }
        }


        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });


    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            stopTracking();
            app.quit();
        }
    });

    app.on('will-quit', () => {
        stopTracking();
        uIOhook.stop();
    });
}