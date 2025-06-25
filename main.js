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
const MOUSE_MOVE_THROTTLE_MS = 100;
let lastMouseEventSent = 0;
let lastMousePosition = { x: 0, y: 0 };

// Activity tracking variables - Updated structure
const ACTIVITY_BLOCK_SIZE = 10; // 10-minute blocks
const ACTIVITY_INTERVAL_MS = 60000; // 1 minute in milliseconds
const MINUTE_INTERVAL = 60000; // 1 minute in milliseconds
let activityIntervalId = null;

// Block timing variables
let currentBlockStartTime = null;
let currentBlockFolder = null;

// Activity data structure
let activityData = {
    activeJSON: Array(10).fill(null).map(() => ({ keyboard: 0, mouse: 0, active: 0 })),
    currentMinuteKeyboard: 0,
    currentMinuteMouse: 0
};

// Function to get the proper 10-minute block timing
function getCurrentBlockInfo() {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    
    // Calculate the start minute of current 10-minute block
    let blockStartMinute;
    if (minutes < 10) blockStartMinute = 0;
    else if (minutes < 20) blockStartMinute = 10;
    else if (minutes < 30) blockStartMinute = 20;
    else if (minutes < 40) blockStartMinute = 30;
    else if (minutes < 50) blockStartMinute = 40;
    else blockStartMinute = 50;
    
    const blockStartTime = new Date(now);
    blockStartTime.setMinutes(blockStartMinute, 0, 0);
    
    const blockEndTime = new Date(blockStartTime);
    blockEndTime.setMinutes(blockStartTime.getMinutes() + 10);
    
    return {
        blockStartTime,
        blockEndTime,
        blockStartMinute,
        currentMinuteInBlock: minutes - blockStartMinute
    };
}

// Function to create activity folder path
function getActivityFolderPath() {
    const blockInfo = getCurrentBlockInfo();
    const dateStr = blockInfo.blockStartTime.toISOString().split('T')[0];
    const timeStr = blockInfo.blockStartTime.toTimeString().slice(0, 5).replace(':', '');
    
    return path.join(
        __dirname, 'public', 'screenshots',
        `project_${currentProjectID}`,
        `task_${currentTaskID}`,
        dateStr,
        `activity_${timeStr}`
    );
}

// Function to start activity tracking
function startActivityTracking() {
    const blockInfo = getCurrentBlockInfo();
    currentBlockStartTime = blockInfo.blockStartTime;
    currentBlockFolder = getActivityFolderPath();
    
    // Reset activity data
    activityData = {
        activeJSON: Array(10).fill(null).map(() => ({ keyboard: 0, mouse: 0, active: 0 })),
        currentMinuteKeyboard: 0,
        currentMinuteMouse: 0
    };

    console.log(`Started new 10-minute block: ${currentBlockStartTime.toISOString()}`);
    console.log(`Activity folder: ${currentBlockFolder}`);

    // Ensure activity folder exists
    fs.ensureDirSync(currentBlockFolder);

    // Collect activity data every minute
    activityIntervalId = setInterval(async () => {
        const now = new Date();
        const blockInfo = getCurrentBlockInfo();
        
        // Check if we've moved to a new 10-minute block
        if (blockInfo.blockStartTime.getTime() !== currentBlockStartTime.getTime()) {
            console.log('New 10-minute block detected, finishing current block...');
            await finishCurrentBlock();
            
            // Start new block
            currentBlockStartTime = blockInfo.blockStartTime;
            currentBlockFolder = getActivityFolderPath();
            activityData = {
                activeJSON: Array(10).fill(null).map(() => ({ keyboard: 0, mouse: 0, active: 0 })),
                currentMinuteKeyboard: 0,
                currentMinuteMouse: 0
            };
            fs.ensureDirSync(currentBlockFolder);
            console.log(`Started new 10-minute block: ${currentBlockStartTime.toISOString()}`);
        }

        const minuteIndex = blockInfo.currentMinuteInBlock;
        
        console.log('=== Activity Tracking Interval ===');
        console.log(`Current Time: ${now.toISOString()}`);
        console.log(`Block Start: ${currentBlockStartTime.toISOString()}`);
        console.log(`Minute Index: ${minuteIndex}`);
        console.log(`Current Keyboard Activity: ${activityData.currentMinuteKeyboard}`);
        console.log(`Current Mouse Activity: ${activityData.currentMinuteMouse}`);

        // Build activity object for current minute
        const activity = {
            keyboard: activityData.currentMinuteKeyboard,
            mouse: activityData.currentMinuteMouse,
            active: (activityData.currentMinuteKeyboard > 0 || activityData.currentMinuteMouse > 0) ? 1 : 0
        };

        // Store in the correct slot
        activityData.activeJSON[minuteIndex] = activity;

        // Save current minute's activity to individual file
        await saveMinuteActivity(minuteIndex, activity, now);

        console.log(`Updated activeJSON[${minuteIndex}]:`, activity);
        console.log('Current activeJSON array:', activityData.activeJSON);

        // Reset current minute counters
        activityData.currentMinuteKeyboard = 0;
        activityData.currentMinuteMouse = 0;

    }, ACTIVITY_INTERVAL_MS);
}

// Function to save individual minute activity
async function saveMinuteActivity(minuteIndex, activity, timestamp) {
    try {
        const minuteFile = path.join(currentBlockFolder, `minute_${minuteIndex}.json`);
        const data = {
            minuteIndex,
            timestamp: timestamp.toISOString(),
            activity,
            projectID: currentProjectID,
            userID: currentUserID,
            taskID: currentTaskID
        };
        
        await fs.writeJson(minuteFile, data, { spaces: 2 });
        console.log(`Saved minute ${minuteIndex} activity to: ${minuteFile}`);
    } catch (error) {
        console.error(`Error saving minute ${minuteIndex} activity:`, error);
    }
}

// Function to finish current 10-minute block
async function finishCurrentBlock() {
    try {
        console.log('Finishing current 10-minute block...');
        
        // Calculate total active minutes
        const totalActiveMins = activityData.activeJSON.reduce((sum, slot) => sum + slot.active, 0);
        
        // Create combined activity file
        const combinedActivityFile = path.join(currentBlockFolder, 'combined_activity.json');
        const combinedData = {
            projectID: currentProjectID,
            userID: currentUserID,
            taskID: currentTaskID,
            blockStartTime: currentBlockStartTime.toISOString(),
            blockEndTime: new Date(currentBlockStartTime.getTime() + 10 * 60 * 1000).toISOString(),
            activeJSON: [...activityData.activeJSON],
            activeFlag: totalActiveMins,
            activeMins: totalActiveMins,
            deletedFlag: 0,
            activeMemo: `Activity block completed: ${totalActiveMins}/10 minutes active`,
            createdAt: new Date().toISOString()
        };
        
        await fs.writeJson(combinedActivityFile, combinedData, { spaces: 2 });
        console.log('Saved combined activity data');
        
        // Try to send to server
        await sendBlockToServer(combinedData);
        
    } catch (error) {
        console.error('Error finishing current block:', error);
    }
}

// Function to send completed block to server
async function sendBlockToServer(blockData) {
    try {
        // Check if there's a screenshot for this block
        const screenshotFile = path.join(currentBlockFolder, 'screenshot.json');
        let screenshotData = null;
        
        if (await fs.pathExists(screenshotFile)) {
            screenshotData = await fs.readJson(screenshotFile);
        }
        
        const payload = {
            projectID: blockData.projectID,
            userID: blockData.userID,
            taskID: blockData.taskID,
            screenshotTimeStamp: blockData.blockStartTime,
            calcTimeStamp: blockData.createdAt,
            activeJSON: blockData.activeJSON,
            activeFlag: blockData.activeFlag,
            activeMins: blockData.activeMins,
            deletedFlag: 0,
            activeMemo: blockData.activeMemo,
            imageURL: screenshotData?.imageURL || '',
            thumbNailURL: screenshotData?.thumbNailURL || ''
        };
        
        console.log('Sending block to server:', payload);
        
        const response = await fetch('https://vw.aisrv.in/node_backend/postProjectV1', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log('Block sent to server successfully');
            // Clean up the block folder after successful send
            await fs.remove(currentBlockFolder);
            console.log('Cleaned up block folder');
        } else {
            console.error('Failed to send block to server:', response.status);
        }
        
    } catch (error) {
        console.error('Error sending block to server:', error);
    }
}

// Initialize activeJSON array with 10 empty minutes
function initializeActiveJSON() {
    activityData = {
        activeJSON: Array(10).fill(null).map(() => ({ keyboard: 0, mouse: 0, active: 0 })),
        currentMinuteKeyboard: 0,
        currentMinuteMouse: 0
    };
}

// Create activity data directory if it doesn't exist
const activityDataDir = path.join(__dirname, 'public', 'activity_data');
if (!fs.existsSync(activityDataDir)) {
    fs.mkdirSync(activityDataDir, { recursive: true });
}

// Function to save activity data locally
async function saveActivityDataLocally(data) {
    try {
        const baseFolder = path.join(__dirname, 'public', 'activity_data');
        const datePath = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const activityFolder = path.join(baseFolder, `project_${data.projectID}`, `task_${data.taskID}`, datePath);
        await fs.ensureDir(activityFolder);

        const timestamp = Date.now();
        const jsonFilename = `activity_${timestamp}.json`;

        const metadata = {
            projectID: data.projectID,
            userID: data.userID,
            taskID: data.taskID,
            screenshotTimeStamp: data.screenshotTimeStamp,
            activeJSON: data.activeJSON,
            activeFlag: data.activeFlag,
            activeMins: data.activeMins,
            deletedFlag: data.deletedFlag || 0,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString()
        };

        await fs.writeJson(path.join(activityFolder, jsonFilename), metadata, { spaces: 2 });
        console.log(`✅ Saved activity data: ${jsonFilename}`);
        return {
            success: true,
            savedLocally: true,
            filePath: path.join(activityFolder, jsonFilename)
        };
    } catch (error) {
        console.error('Error saving activity data locally:', error);
        throw error;
    }
}

// Function to get JSON files recursively
async function getJsonFilesRecursively(dir) {
    let results = [];
    try {
        const dirExists = await fs.pathExists(dir);
        if (!dirExists) {
            return results;
        }

        const files = await fs.readdir(dir, { withFileTypes: true });

        for (const file of files) {
            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
                results = [...results, ...await getJsonFilesRecursively(fullPath)];
            } else if (file.name.endsWith('.json') && file.name.startsWith('screenshot_')) {
                const parentDir = path.basename(path.dirname(fullPath));
                if (/^\d{4}-\d{2}-\d{2}$/.test(parentDir)) { // Matches YYYY-MM-DD format
                    results.push(fullPath);
                }
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
    }
    return results;
}

// Function to process screenshot files
async function processScreenshotFiles() {
    const screenshotsDir = path.join(__dirname, 'public', 'screenshots');

    try {
        const files = await getJsonFilesRecursively(screenshotsDir);
        console.log('Screenshot files to process:', files);

        for (const filePath of files) {
            try {
                const fileContent = await fs.readFile(filePath, 'utf8');
                const jsonData = JSON.parse(fileContent);

                // Get the task data file path from the task directory
                const taskDataPath = path.join(
                    screenshotsDir,
                    `project_${jsonData.projectID}`,
                    `task_${jsonData.taskID}`,
                    `taskData_${jsonData.taskID}.json`
                );

                // Read task data
                let taskData = {};
                try {
                    const taskDataContent = await fs.readFile(taskDataPath, 'utf8');
                    taskData = JSON.parse(taskDataContent);
                } catch (error) {
                    console.warn('Task data file not found or unreadable:', taskDataPath);
                }

                // Prepare data for postProjectV1
                const dataToSend = {
                    projectID: jsonData.projectID,
                    userID: jsonData.userID,
                    taskID: jsonData.taskID,
                    screenshotTimeStamp: jsonData.screenshotTimeStamp,
                    calcTimeStamp: jsonData.calcTimeStamp,
                    activeJSON: jsonData.activeJSON || [],
                    activeFlag: jsonData.activeFlag !== undefined ? jsonData.activeFlag : 1,
                    activeMins: jsonData.activeMins !== undefined ? jsonData.activeMins : 1,
                    deletedFlag: jsonData.deletedFlag !== undefined ? jsonData.deletedFlag : 0,
                    activeMemo: jsonData.activeMemo || '',
                    imageURL: jsonData.imageURL || '',
                    thumbNailURL: jsonData.thumbNailURL || '',
                    createdAt: jsonData.createdAt || new Date().toISOString(),
                    modifiedAt: jsonData.modifiedAt || new Date().toISOString()
                };

                console.log('Data being sent to server:', dataToSend);

                const response = await fetch('https://vw.aisrv.in/node_backend/postProjectV1', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(dataToSend),
                    timeout: 10000
                });

                if (response.status === 200) {
                    // Delete the file after successful upload
                    await fs.unlink(filePath);
                    console.log(`✅ Processed and deleted screenshot file: ${filePath}`);
                } else {
                    console.error(`❌ Failed to process screenshot file: ${filePath}`);
                }

            } catch (error) {
                console.error(`❌ Error processing screenshot file ${filePath}:`, error.message);
            }
        }
    } catch (error) {
        console.error('Error in processScreenshotFiles:', error);
    }
}

// Function to initialize screenshot watcher
async function initScreenshotWatcher() {
    const screenshotsDir = path.join(__dirname, 'public', 'screenshots');

    try {
        await fs.mkdir(screenshotsDir, { recursive: true });

        // Process existing files first
        console.log('Processing existing screenshot files...');
        await processScreenshotFiles();
        console.log('✅ Successfully processed existing files');

        // Set up file watcher for screenshots
        const chokidar = require('chokidar');
        const screenshotWatcher = chokidar.watch(screenshotsDir, {
            ignored: /(^|[\/\\])\../,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 1000,
                pollInterval: 100
            }
        });

        screenshotWatcher.on('add', async (filePath) => {
            if (filePath.endsWith('.json') && path.basename(filePath).startsWith('screenshot_')) {
                console.log('New screenshot file added:', filePath);
                await processScreenshotFiles();
            }
        });

        screenshotWatcher.on('error', error => {
            console.error('Screenshot watcher error:', error);
        });

    } catch (error) {
        console.error('Error setting up file watchers:', error);
    }
}

// Set screenshot interval to 10 minutes
const SCREENSHOT_INTERVAL = 10 * 60 * 1000;
let currentProjectID = null;
let currentUserID = null;
let currentTaskID = null;

// Save to workdiary function
async function saveToWorkdiary(data) {
    try {
        console.log('Saving to workdiary with activeJSON:', data.activeJSON);

        const response = await fetch('https://vw.aisrv.in/node_backend/postProjectV1', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                projectID: data.projectID,
                userID: data.userID,
                taskID: data.taskID,
                screenshotTimeStamp: data.screenshotTimeStamp,
                calcTimeStamp: data.calcTimeStamp,
                activeJSON: data.activeJSON,
                activeFlag: data.activeFlag,
                activeMins: data.activeMins,
                deletedFlag: 0,
                activeMemo: data.activeMemo || '',
                imageURL: data.imageURL,
                thumbNailURL: data.thumbNailURL
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Server responded with error, trying local save...', {
                status: response.status,
                statusText: response.statusText,
                body: errorText
            });
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        console.log('✅ Data saved via backend API successfully');
        
        return {
            success: true,
            savedLocally: false,
            data: await response.json()
        };
    } catch (error) {
        console.error('API request failed, trying local save...', error);
        try {
            const localResult = await saveScreenshotLocally(data);
            return {
                ...localResult,
                serverError: error.message
            };
        } catch (localError) {
            console.error('Both server and local save failed:', localError);
            return {
                success: false,
                savedLocally: false,
                error: `Server: ${error.message}, Local: ${localError.message}`
            };
        }
    }
}

// Function to take screenshot
async function takeScreenshot() {
    try {
        const blockInfo = getCurrentBlockInfo();
        
        // Create screenshot folder for current block
        const screenshotPath = path.join(
            __dirname, 'public', 'screenshots',
            `project_${currentProjectID}`,
            `task_${currentTaskID}`,
            blockInfo.blockStartTime.toISOString().split('T')[0],
            `activity_${blockInfo.blockStartTime.toTimeString().slice(0, 5).replace(':', '')}`
        );
        
        await fs.ensureDir(screenshotPath);

        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        const source = sources[0];
        
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: source.id,
                    minWidth: window.screen.width,
                    maxWidth: window.screen.width,
                    minHeight: window.screen.height,
                    maxHeight: window.screen.height
                }
            }
        });

        const canvas = document.createElement('canvas');
        canvas.width = window.screen.width;
        canvas.height = window.screen.height;
        const context = canvas.getContext('2d');
        const video = document.createElement('video');
        video.srcObject = stream;
        video.play();

        // Wait for video to load and render one frame
        await new Promise(resolve => {
            video.onloadedmetadata = () => {
                setTimeout(resolve, 1000);
            };
        });

        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        
        // Save screenshot
        const screenshotFile = path.join(screenshotPath, 'screenshot.png');
        await fs.writeFile(screenshotFile, dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');

        // Create screenshot metadata
        const screenshotMetadata = {
            timestamp: new Date().toISOString(),
            projectID: currentProjectID,
            taskID: currentTaskID,
            userID: currentUserID,
            screenshotPath: screenshotFile,
            width: canvas.width,
            height: canvas.height,
            blockStartTime: blockInfo.blockStartTime.toISOString(),
            blockEndTime: blockInfo.blockEndTime.toISOString()
        };

        // Save metadata
        const metadataFile = path.join(screenshotPath, 'screenshot.json');
        await fs.writeJson(metadataFile, screenshotMetadata, { spaces: 2 });

        // Emit success event
        mainWindow?.webContents.send('screenshot-success', {
            timestamp: new Date().toISOString(),
            projectID: currentProjectID,
            taskID: currentTaskID,
            screenshotPath: screenshotFile,
            metadataPath: metadataFile
        });

        // Clean up
        video.srcObject = null;
        stream.getTracks().forEach(track => track.stop());

        console.log(`Screenshot taken and saved to: ${screenshotFile}`);
        return { success: true, error: null, savedLocally: true };
    } catch (error) {
        console.error('Error taking screenshot:', error);
        mainWindow?.webContents.send('screenshot-error', {
            error: error.message
        });
        return { success: false, error: error.message, savedLocally: false };
    }
}

function sendGlobalEvent(event) {
    if (!event.type) {
        console.error('Attempted to send event without type:', event);
        return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('global-event', event);
    }
}

// Start tracking function
function startTracking() {
    if (isTracking) return;
    isTracking = true;

    try {
        // Initialize activity tracking
        startActivityTracking();
        
        // Initialize screenshot watcher
        initScreenshotWatcher();
        
        // Schedule first screenshot at block end
        const blockInfo = getCurrentBlockInfo();
        const timeToNextBlock = blockInfo.blockEndTime.getTime() - new Date().getTime();
        
        console.log(`Scheduling first screenshot in ${timeToNextBlock}ms`);
        
        setTimeout(() => {
            takeScreenshot();
            trackingInterval = setInterval(() => {
                takeScreenshot();
            }, SCREENSHOT_INTERVAL);
        }, timeToNextBlock);

        // Initialize uIOhook event listeners
        uIOhook.on('mousemove', (event) => {
            const now = Date.now();
            if (now - lastMouseEventSent >= MOUSE_MOVE_THROTTLE_MS) {
                const dx = event.x - lastMousePosition.x;
                const dy = event.y - lastMousePosition.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance > 0) {
                    activityData.currentMinuteMouse += 1;
                    lastMouseEventSent = now;
                    lastMousePosition = { x: event.x, y: event.y };
                    console.log('Mouse moved:', { x: event.x, y: event.y, distance });
                }
            }
        });

        uIOhook.on('mousedown', (event) => {
            activityData.currentMinuteMouse += 1;
            console.log('Mouse down:', event.button);
        });

        uIOhook.on('mouseup', (event) => {
            activityData.currentMinuteMouse += 1;
            console.log('Mouse up:', event.button);
        });

        uIOhook.on('keydown', (event) => {
            activityData.currentMinuteKeyboard += 1;
            console.log('Key down:', event.keycode);
        });

        uIOhook.on('keyup', (event) => {
            activityData.currentMinuteKeyboard += 1;
            console.log('Key up:', event.keycode);
        });

        // Start uIOhook
        uIOhook.start();
        
        // Send tracking status update
        mainWindow?.webContents.send('tracking-status', { isTracking: true });

    } catch (error) {
        console.error('Error starting tracking:', error);
        isTracking = false;
        mainWindow?.webContents.send('tracking-status', { isTracking: false, error: error.message });
    }
}

// Function to handle project submission with screenshot
async function submitProjectData(data) {
    try {
        // Validate required fields
        if (!data.projectID || !data.userID || !data.taskID || !data.imageURL || !data.thumbNailURL) {
            throw new Error('Missing required fields');
        }

        // Get current block info
        const blockInfo = getCurrentBlockInfo();
        
        // Prepare the request data
        const requestData = {
            projectID: data.projectID,
            userID: data.userID,
            taskID: data.taskID,
            screenshotTimeStamp: blockInfo.blockStartTime.toISOString(),
            calcTimeStamp: new Date().toISOString(),
            activeJSON: data.activeJSON || {},
            activeMins: data.activeMins || 0,
            deletedFlag: data.deletedFlag || 0,
            activeMemo: data.activeMemo || '',
            imageURL: data.imageURL,
            thumbNailURL: data.thumbNailURL
        };

        // Send the request
        const response = await fetch('https://vw.aisrv.in/node_backend/postProjectV1', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        return result;

    } catch (error) {
        console.error('Error in submitProjectData:', error);
        throw error;
    }
}

        // Add your code herecurring interval every 10 minutes
        trackingInterval = setInterval(() => {
            const randomDelay = Math.floor(Math.random() * SCREENSHOT_INTERVAL);
            console.log(`🕓 Next screenshot will be taken in ${Math.floor(randomDelay / 1000)} seconds`);

            setTimeout(() => {
                takeScreenshot();
            }, randomDelay);
        }, SCREENSHOT_INTERVAL);

        // Mouse move event (no counting needed for activeJSON)
        uIOhook.on('mousemove', (event) => {
            const now = Date.now();
            if (now - lastMouseEventSent >= MOUSE_MOVE_THROTTLE_MS) {
                lastMouseEventSent = now;
                lastMousePosition = { x: event.x, y: event.y };
                sendGlobalEvent({
                    type: 'mousemove',
                    x: event.x,
                    y: event.y
                });
            }
        });

        // Mouse click event handler
        uIOhook.on('click', (event) => {
            activityData.currentMinuteMouse++;
            sendGlobalEvent({
                type: 'mouseclick',
                button: event.button,
                x: event.x,
                y: event.y
            });
        });

        // Keyboard press event handler
        uIOhook.on('keydown', (event) => {
            activityData.currentMinuteKeyboard++;
            sendGlobalEvent({
                type: 'keydown',
                keycode: event.keycode,
                key: UiohookKey[event.keycode] || `Unknown(${event.keycode})`,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                metaKey: event.metaKey
            });

            // Exit on Escape key
            if (event.keycode === UiohookKey.Escape) {
                stopTracking();
            }
        });

        console.log('Started tracking global input events with activeJSON structure');
        if (mainWindow) {
            mainWindow.webContents.send('tracking-status', { isTracking: true });
        }

// Stop tracking function
function stopTracking() {
    if (!isTracking) return;
    isTracking = false;

    try {
        // Finish current block if tracking is stopped mid-block
        if (currentBlockStartTime) {
            console.log('Finishing current block on stopTracking');
            finishCurrentBlock();
        }

        // Clear intervals
        if (trackingInterval) {
            clearInterval(trackingInterval);
            trackingInterval = null;
        }
        if (activityIntervalId) {
            clearInterval(activityIntervalId);
            activityIntervalId = null;
        }

        // Clean up uIOhook
        uIOhook.removeAllListeners();
        uIOhook.stop();
        console.log('Stopped tracking global input events');

        // Reset block variables
        currentBlockStartTime = null;
        currentBlockFolder = null;
        activityData = {
            activeJSON: Array(10).fill(null).map(() => ({ keyboard: 0, mouse: 0, active: 0 })),
            currentMinuteKeyboard: 0,
            currentMinuteMouse: 0
        };

        // Send tracking status update
        if (mainWindow) {
            mainWindow.webContents.send('tracking-status', { isTracking: false });
        }

    } catch (error) {
        console.error('Error stopping tracking:', error);
        if (mainWindow) {
            mainWindow.webContents.send('tracking-status', { 
                isTracking: false, 
                error: error.message 
            });
        }
    }
}

// Add new IPC handlers for window controls
ipcMain.handle('window-minimize', () => {
    if (mainWindow) {
        mainWindow.minimize();
    }
});

ipcMain.handle('window-close', () => {
    if (mainWindow) {
        stopTracking();
        mainWindow.close();
    }
});

// Add IPC handler for pause functionality
ipcMain.handle('pause-tracking', () => {
    if (mainWindow) {
        mainWindow.webContents.send('tracking-paused', { isPaused: true });
    }
    console.log('Tracking paused but timers continue running');
    return { success: true, isPaused: true };
});

// Add IPC handler for punch out during pause
ipcMain.handle('punch-out', () => {
    console.log('Processing punch out request...');
    stopTracking();
    uIOhook.stop();
    if (mainWindow) {
        mainWindow.webContents.send('tracking-stopped');
    }
    return { success: true, message: 'Punched out successfully' };
});

ipcMain.handle('resume-tracking', () => {
    if (mainWindow) {
        mainWindow.webContents.send('tracking-resumed', { isPaused: false });
    }
    return { success: true, isPaused: false };
});

// Modify the will-quit handler
app.on('will-quit', () => {
    console.log('App quitting... cleaning up tracking');
    stopTracking();
    uIOhook.stop();
});

// Function to save act hours locally
async function saveActHoursLocally(projectID, taskID, data) {
    try {
        const screenshotsDir = path.join(
            'public',
            'screenshots',
            `project_${projectID}`,
            `task_${taskID}`
        );

        try {
            await fs.ensureDir(screenshotsDir);
            const filePath = path.join(screenshotsDir, `taskData_${taskID}.json`);

            const dataToSave = {
                ...data,
                taskID,
                projectID,
                lastUpdated: new Date().toISOString(),
                actHours: data.actHours,
                isExceeded: data.isExceeded,
            };

            await fs.writeJson(filePath, dataToSave, { spaces: 2 });
            console.log(`ActHours data saved locally at: ${filePath}`);
            return true;
        } catch (dirError) {
            console.error('Error creating directory or saving file:', dirError);
            return false;
        }
    } catch (error) {
        console.error('Error in saveActHoursLocally:', error);
        return false;
    }
}

async function loadActHoursLocally() {
    try {
        const screenshotsDir = path.join('public', 'screenshots');
        const dirExists = await fs.pathExists(screenshotsDir);
        if (!dirExists) {
            console.log('Screenshots directory does not exist, returning empty data');
            return {};
        }

        const result = {};
        const projectDirs = await fs.readdir(screenshotsDir);

        for (const projectDir of projectDirs) {
            if (!projectDir.startsWith('project_')) continue;

            const taskDirs = await fs.readdir(path.join(screenshotsDir, projectDir));

            for (const taskDir of taskDirs) {
                if (!taskDir.startsWith('task_')) continue;

                const taskPath = path.join(screenshotsDir, projectDir, taskDir);
                const files = (await fs.readdir(taskPath)).filter(f => f.startsWith('acthours_') && f.endsWith('.json'));

                if (files.length > 0) {
                    const latestFile = files.sort().pop();
                    try {
                        const fileData = await fs.readJson(path.join(taskPath, latestFile));
                        const taskId = fileData.taskID;
                        if (taskId) {
                            result[taskId] = {
                                actHours: fileData.actHours,
                                isExceeded: fileData.isExceeded
                            };
                        }
                    } catch (err) {
                        console.error(`Error reading file ${latestFile}:`, err);
                    }
                }
            }
        }

        return result;
    } catch (error) {
        console.error('Error loading actHours data:', error);
        return {};
    }
}

// Initialize iohook
const iohook = uIOhook;

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
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: path.join(__dirname, 'preload.js')
                },
            });

            const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, 'build/index.html')}`;
            mainWindow.loadURL(startUrl);

            if (process.env.NODE_ENV === 'development') {
                mainWindow.webContents.openDevTools();
            }
        }

        createWindow();
        initScreenshotWatcher();
        
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