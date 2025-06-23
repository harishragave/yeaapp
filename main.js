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
// const ACTIVITY_INTERVAL = 12000; // 12 seconds in millisecondslet lastMousePosition = { x: 0, y: 0 };
const MOUSE_MOVE_THROTTLE_MS = 100; // Adjust this value (100ms default)
let lastMouseEventSent = 0;
let mouseClickCount = 0;
let keyboardPressCount = 0;
let currentMouseCount = 0;
let currentKeyboardCount = 0;

// Activity tracking variables
const ACTIVITY_BLOCK_SIZE = 10; // 10-minute blocks
const ACTIVITY_INTERVAL_MS = 60000; // 1 minute in milliseconds (renamed from activityInterval)
const MINUTE_INTERVAL = 60000; // 1 minute in milliseconds
let activityIntervalId = null; // This will hold the setInterval ID

let activityData = {
    keyboardJSON: [],
    mouseJSON: [],
    activeFlag: [],
    currentMinuteKeyboard: 0,
    currentMinuteMouse: 0
};

// Create activity data directory if it doesn't exist
const activityDataDir = path.join(__dirname, 'public', 'activity_data');
if (!fs.existsSync(activityDataDir)) {
    fs.mkdirSync(activityDataDir, { recursive: true });
}

// Function to save activity data to file
async function saveActivityData() {
    try {
        const currentDate = new Date();
        const dateStr = currentDate.toISOString().split('T')[0];
        const timeStr = currentDate.toISOString().split('T')[1].split('.')[0];
        
        const fileName = `activity_${dateStr}_${timeStr}.json`;
        const filePath = path.join(activityDataDir, fileName);
        
        const dataToSave = {
            timestamp: currentDate.toISOString(),
            keyboardEvents: activityData.keyboardJSON,
            mouseEvents: activityData.mouseJSON,
            activeFlags: activityData.activeFlag,
            totalIntervals: activityData.keyboardJSON.length
        };
        
        await fs.writeFile(filePath, JSON.stringify(dataToSave, null, 2));
        console.log(`Activity data saved to: ${filePath}`);
        
        // Reset activity data after saving
        activityData.keyboardJSON = [];
        activityData.mouseJSON = [];
        activityData.activeFlag = [];
        activityData.currentMinuteKeyboard = 0;
        activityData.currentMinuteMouse = 0;
    } catch (error) {
        console.error('Error saving activity data:', error);
    }
}

// Function to save activity data locally
async function saveActivityDataLocally(data) {
    try {
        const baseFolder = path.join(__dirname, 'public', 'activity');
        const datePath = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const activityFolder = path.join(baseFolder, `project_${data.projectID}`, `task_${data.taskID}`, datePath);
        await fs.ensureDir(activityFolder);

        // Define filename
        const timestamp = Date.now();
        const jsonFilename = `activity_${timestamp}.json`;

        // Prepare metadata
        const metadata = {
            projectID: data.projectID,
            userID: data.userID,
            taskID: data.taskID,
            screenshotTimeStamp: data.screenshotTimeStamp,
            keyboardJSON: data.keyboardJSON,
            mouseJSON: data.mouseJSON,
            activeFlag: data.activeFlag,
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

// Function to save screenshot locally
async function saveScreenshotLocally(data) {
    try {
        const baseFolder = path.join(__dirname, 'public', 'screenshots');
        const datePath = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const screenshotFolder = path.join(baseFolder, `project_${data.projectID}`, `task_${data.taskID}`, datePath);
        await fs.ensureDir(screenshotFolder);

        // Define filename
        const timestamp = Date.now();
        const jsonFilename = `screenshot_${timestamp}.json`;

        // Prepare metadata
        const metadata = {
            projectID: data.projectID,
            userID: data.userID,
            taskID: data.taskID,
            screenshotTimeStamp: data.screenshotTimeStamp,
            deletedFlag: data.deletedFlag || 0,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString()
        };

        await fs.writeJson(path.join(screenshotFolder, jsonFilename), metadata, { spaces: 2 });
        console.log(`✅ Saved screenshot: ${jsonFilename}`);
        return {
            success: true,
            savedLocally: true,
            filePath: path.join(screenshotFolder, jsonFilename)
        };
    } catch (error) {
        console.error('Error saving screenshot locally:', error);
        throw error;
    }
}

// Function to get activity JSON files recursively
async function getActivityJsonFilesRecursively(dir) {
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
                results = [...results, ...await getActivityJsonFilesRecursively(fullPath)];
            } else if (file.name.endsWith('.json') && file.name.startsWith('activity_')) {
                const parentDir = path.basename(path.dirname(fullPath));
                if (/^\d{4}-\d{2}-\d{2}$/.test(parentDir)) { // Matches YYYY-MM-DD format
                    results.push(fullPath);
                }
            }
        }
    } catch (error) {
        console.error(`Error reading activity directory ${dir}:`, error);
    }
    return results;
}

// Function to process activity files
async function processActivityFiles() {
    const activityDir = path.join(__dirname, 'public', 'activity');

    try {
        const files = await getActivityJsonFilesRecursively(activityDir);
        console.log('Activity files to process:', files);

        for (const filePath of files) {
            try {
                const fileContent = await fs.readFile(filePath, 'utf8');
                const jsonData = JSON.parse(fileContent);

                console.log('Processing activity data:', jsonData);

                const response = await fetch('https://vw.aisrv.in/node_backend/postProjectV2', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(jsonData),
                    timeout: 10000
                });

                if (response.status === 200) {
                    // Delete the file after successful upload
                    await fs.unlink(filePath);
                    console.log(`✅ Processed and deleted activity file: ${filePath}`);
                } else {
                    console.error(`❌ Failed to process activity file: ${filePath}`);
                }

            } catch (error) {
                console.error(`❌ Error processing activity file ${filePath}:`, error.message);
            }
        }
    } catch (error) {
        console.error('Error in processActivityFiles:', error);
    }
}

// Modified sendActivityData function
async function sendActivityData() {
    try {
        // Create data to send
        const payload = {
            projectID: currentProjectID,
            userID: currentUserID,
            taskID: currentTaskID,
            screenshotTimeStamp: new Date().toISOString(),
            keyboardJSON: [...activityData.keyboardJSON],
            mouseJSON: [...activityData.mouseJSON],
            activeFlag: [...activityData.activeFlag],
            deletedFlag: 0
        };
        console.log('Sending activity data:', payload);
        // Send to endpoint
        const response = await fetch('https://vw.aisrv.in/node_backend/postProjectV2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Reset after successful send
        if (response.ok) {
            activityData.keyboardJSON = [];
            activityData.mouseJSON = [];
            activityData.activeFlag = [];
            
            return {
                ...localResult,
                serverError: serverError.message
            };
        }

    } catch (error) {
        console.error('Error in sendActivityData:', error);
        const localResult = await saveActivityDataLocally(dataToSend);
        // Reset arrays even on error to prevent accumulation
        activityData.keyboardJSON = [];
        activityData.mouseJSON = [];
        activityData.activeFlag = [];
        
        return {
            ...localResult,
            error: error.message
        };
    }
}

// Function to start activity tracking
function startActivityTracking() {
    // Reset activity data
    activityData = {
        keyboardJSON: [],
        mouseJSON: [],
        activeFlag: [],
        currentMinuteKeyboard: 0,
        currentMinuteMouse: 0
    };

    // Collect activity data every minute
    activityIntervalId = setInterval(async () => {
        // Log activity tracking details
        console.log('=== Activity Tracking Interval ===');
        console.log(`Interval Duration: 60 seconds`);
        console.log(`Current Time: ${new Date().toISOString()}`);
        console.log(`Current Keyboard Activity: ${activityData.currentMinuteKeyboard}`);
        console.log(`Current Mouse Activity: ${activityData.currentMinuteMouse}`);
        console.log(`Total Intervals Collected: ${activityData.keyboardJSON.length}`);
        console.log('');

        // Add current interval's data to arrays
        activityData.keyboardJSON.push(activityData.currentMinuteKeyboard);
        activityData.mouseJSON.push(activityData.currentMinuteMouse);
        
        // Set active flag: 1 if any activity, 0 if no activity
        const isActive = (activityData.currentMinuteKeyboard > 0 || activityData.currentMinuteMouse > 0) ? 1 : 0;
        activityData.activeFlag.push(isActive);

        // Log activity data with more details
        console.log('=== Activity Data Summary ===');
        console.log(`Keyboard Events: ${activityData.currentMinuteKeyboard}`);
        console.log(`Mouse Events: ${activityData.currentMinuteMouse}`);
        console.log(`Active Status: ${isActive ? 'Active' : 'Inactive'}`);
        console.log('');
        console.log('=== Activity History ===');
        console.log(`Total Keyboard Events: ${activityData.keyboardJSON.reduce((a, b) => a + b, 0)}`);
        console.log(`Total Mouse Events: ${activityData.mouseJSON.reduce((a, b) => a + b, 0)}`);
        console.log(`Active Intervals: ${activityData.activeFlag.filter(flag => flag === 1).length}`);
        console.log('');

        // Reset current minute counters
        activityData.currentMinuteKeyboard = 0;
        activityData.currentMinuteMouse = 0;

        // Save data every 10 intervals (every 10 minutes)
        try {
            await saveActivityData();
            console.log('Activity data saved successfully');
        } catch (error) {
            console.error('Error saving activity data:', error);
        }
        try {
            console.log('Sending activity data to API...');
            const payload = {
                projectID: currentProjectID,
                userID: currentUserID,
                taskID: currentTaskID,
                screenshotTimeStamp: new Date().toISOString().replace('T', ' ').replace('Z', ''),
                keyboardJSON: [...activityData.keyboardJSON],
                mouseJSON: [...activityData.mouseJSON],
                activeFlag: [...activityData.activeFlag],
                deletedFlag: 0
            };
            console.log('Sending activity data:', payload);
            // Send to endpoint
            const response = await fetch('https://vw.aisrv.in/node_backend/postProjectV2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            console.log('IM THE BEST');
            console.log(result);
            if (!result) {
                console.error('Error sending to API:', result);
            } else {
                console.log('Activity data sent to API successfully');
            }
        } catch (error) {
            console.error('Error in API call:', error);
        }
        // Send to API every 10 intervals (every 10 minutes)
    }, ACTIVITY_INTERVAL_MS); // Use the constant value here
}

// Function to stop activity tracking
function stopActivityTracking() {
    if (activityIntervalId) {
        clearInterval(activityIntervalId);
        activityIntervalId = null;
    }
}

// Modified initScreenshotWatcher to include activity file watching
async function initScreenshotWatcher() {
    const screenshotsDir = path.join(__dirname, 'public', 'screenshots');
    const activityDir = path.join(__dirname, 'public', 'activity');

    try {
        await fs.mkdir(screenshotsDir, { recursive: true });
        await fs.mkdir(activityDir, { recursive: true });

        // Process existing files first
        console.log('Processing existing screenshot files...');
        await processScreenshotFiles();
        console.log('Processing existing activity files...');
        await processActivityFiles();
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

        // Set up file watcher for activity data
        const activityWatcher = chokidar.watch(activityDir, {
            ignored: /(^|[\/\\])\../,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 1000,
                pollInterval: 100
            }
        });

        activityWatcher.on('add', async (filePath) => {
            if (filePath.endsWith('.json') && path.basename(filePath).startsWith('activity_')) {
                console.log('New activity file added:', filePath);
                await processActivityFiles();
            }
        });

        screenshotWatcher.on('error', error => {
            console.error('Screenshot watcher error:', error);
        });

        activityWatcher.on('error', error => {
            console.error('Activity watcher error:', error);
        });

    } catch (error) {
        console.error('Error setting up file watchers:', error);
    }
}

// Modified startTracking function to include activity tracking
function startTracking() {
    if (isTracking) return;
    isTracking = true;

    uIOhook.start();
    
    // Start activity tracking for postProjectV2
    startActivityTracking();
    
    const firstDelay = Math.floor(Math.random() * SCREENSHOT_INTERVAL);
    console.log(`🕓 First screenshot will be taken in ${Math.floor(firstDelay / 1000)} seconds`);

    setTimeout(() => {
        if (typeof mouseClickCount !== 'undefined' && typeof keyboardPressCount !== 'undefined') {
            takeScreenshot(mouseClickCount, keyboardPressCount);
        }
    }, firstDelay);
    
    // Set up the recurring interval every 10 minutes
    trackingInterval = setInterval(() => {
        const randomDelay = Math.floor(Math.random() * SCREENSHOT_INTERVAL);

        console.log(`🕓 Next screenshot will be taken in ${Math.floor(randomDelay / 1000)} seconds`);

        setTimeout(() => {
            if (typeof mouseClickCount !== 'undefined' && typeof keyboardPressCount !== 'undefined') {
                takeScreenshot(mouseClickCount, keyboardPressCount);
            }
        }, randomDelay);
    }, SCREENSHOT_INTERVAL);

    // Mouse move event
    uIOhook.on('mousemove', (event) => {
        const now = Date.now();

        // Throttle mouse move events
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

    // Modified Mouse click event
    uIOhook.on('click', () => {
        activityData.currentMinuteMouse++;
    });

    // Keyboard presses
    uIOhook.on('keydown', () => {
        activityData.currentMinuteKeyboard++;
    });

    // Exit on Escape key
    uIOhook.on('keydown', (event) => {
        if (event.keycode === UiohookKey.Escape) {
            stopTracking();
        }
    });

    // Update takeScreenshot to use current counts
    async function takeScreenshot() {
        try {
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: screen.getPrimaryDisplay().workAreaSize
            });

            // Generate full-size screenshot with base64 prefix
            const fullSizeBase64 = `data:image/png;base64,${sources[0].thumbnail.resize({
                width: 1200,
                height: 800,
                quality: 'good'
            }).toJPEG(60).toString('base64')}`;

            // Generate thumbnail with base64 prefix
            const thumbnailBase64 = `data:image/png;base64,${sources[0].thumbnail.resize({
                width: 300,
                height: 200,
                quality: 'good'
            }).toJPEG(60).toString('base64')}`;

            // Log the first 50 characters of the base64 strings for debugging
            console.log('Debug: Full image base64 prefix:', fullSizeBase64.substring(0, 50));
            console.log('Debug: Thumbnail base64 prefix:', thumbnailBase64.substring(0, 50));

            const workdiaryData = {
                projectID: currentProjectID,
                userID: currentUserID,
                taskID: currentTaskID,
                screenshotTimeStamp: new Date(),
                calcTimeStamp: new Date(),
                keyboardJSON: JSON.stringify({ clicks: currentKeyboardCount }),
                mouseJSON: JSON.stringify({ clicks: currentMouseCount }),
                imageURL: fullSizeBase64,
                thumbNailURL: thumbnailBase64,
                activeFlag: 1,
                deletedFlag: 0,
                activeMemo: 'google',
                createdAt: new Date(),
                modifiedAT: new Date()
            };

            console.log('Screenshot data size:',
                JSON.stringify(workdiaryData).length / 1024, 'KB');

            // Try to save to server first, it will fall back to local if needed
            const result = await saveToWorkdiary(workdiaryData);
            
            // Reset all counters after screenshot
            const resetInfo = {
                mouseClicks: currentMouseCount,
                keyPresses: currentKeyboardCount
            };
            
            // Reset all counters
            currentMouseCount = 0;
            currentKeyboardCount = 0;
            mouseClickCount = 0;
            keyboardPressCount = 0;
            activityData.currentMinuteKeyboard = 0;
            activityData.currentMinuteMouse = 0;
            
            return { 
                ...result, 
                resetInfo,
                countersReset: true
            };

        } catch (error) {
            console.error('Error in takeScreenshot:', error);
            // Reset all counters even if there's an error
            currentMouseCount = 0;
            currentKeyboardCount = 0;
            mouseClickCount = 0;
            keyboardPressCount = 0;
            activityData.currentMinuteKeyboard = 0;
            activityData.currentMinuteMouse = 0;
            return { 
                success: false, 
                error: error.message,
                savedLocally: false 
            };
        }
    }

    console.log('Started tracking global input events');
    if (mainWindow) {
        mainWindow.webContents.send('tracking-status', { isTracking: true });
    }
}

// Modified stopTracking function to include activity tracking
function stopTracking() {
    if (!isTracking) return;
    isTracking = false;

    // Clear the screenshot interval
    if (trackingInterval) {
        clearInterval(trackingInterval);
        trackingInterval = null;
    }

    // Stop activity tracking
    stopActivityTracking();

    uIOhook.removeAllListeners();
    console.log('Stopped tracking global input events');
    if (mainWindow) {
        mainWindow.webContents.send('tracking-status', { isTracking: false });
    }
}

// Modified createWindow function to remove menu bar
// function createWindow() {
//     mainWindow = new BrowserWindow({
//         width: 600,
//         height: 900,
//         frame: false, // Remove default frame
//         webPreferences: {
//             nodeIntegration: false,
//             contextIsolation: true,
//             preload: path.join(__dirname, 'preload.js')
//         },
//     });

//     // Remove menu bar
//     mainWindow.setMenuBarVisibility(false);

//     // Load the app
//     const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, 'build/index.html')}`;
//     mainWindow.loadURL(startUrl);

//     // Open the DevTools in development
//     if (process.env.NODE_ENV === 'development') {
//         mainWindow.webContents.openDevTools();
//     }
// }

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
    // Don't stop tracking completely, just pause UI updates
    // Timer should continue running in background
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
    stopActivityTracking();
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

// Modify the will-quit handler to clean up activity tracking
app.on('will-quit', () => {
    console.log('App quitting... cleaning up tracking');
    stopTracking();
    stopActivityTracking();
    uIOhook.stop();
});

// Set screenshot interval to 2 minutes (120,000 ms)
const SCREENSHOT_INTERVAL = 10 * 60 * 1000;
// Set activity tracking interval to 12 seconds (2 minutes / 10)
const ACTIVITY_INTERVAL = SCREENSHOT_INTERVAL / 10; // 12 seconds
let currentProjectID = null;
let currentUserID = null;
let currentTaskID = null;
// let currentProjectName = null;
// let currentTaskName = null;

async function saveToWorkdiary(data) {
    try {
        console.log('Saving to workdiary with counts:', {
            keyboard: data.keyboardJSON,
            mouse: data.mouseJSON,
            thumbnailExists: !!data.thumbNailURL
        });

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
                // Send as JSON objects, not strings
                keyboardJSON: data.keyboardJSON,
                mouseJSON: data.mouseJSON,
                activeJSON: data.activeJSON || { app: 'Unknown' },
                activeFlag: 1,
                activeMins: 1,
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
async function processScreenshotFiles() { 
    const screenshotsDir = path.join(__dirname, 'public', 'screenshots');

    try {
        const files = await getJsonFilesRecursively(screenshotsDir);
        console.log('All files:', files);

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
                // let taskData = {};
                try {
                    const taskDataContent = await fs.readFile(taskDataPath, 'utf8');
                    taskData = JSON.parse(taskDataContent);
                } catch (error) {
                    console.warn('Task data file not found or unreadable:', taskDataPath);
                }

                // Fixed data mapping - use activeJSON instead of activeFlag
                const dataToSend = {
                    projectID: jsonData.projectID,
                    userID: jsonData.userID,
                    taskID: jsonData.taskID,
                    screenshotTimeStamp: jsonData.screenshotTimeStamp,
                    calcTimeStamp: jsonData.calcTimeStamp,
                    keyboardJSON: jsonData.keyboardJSON,
                    mouseJSON: jsonData.mouseJSON,
                    activeJSON: jsonData.activeJSON || {},
                    activeFlag: jsonData.activeFlag !== undefined ? jsonData.activeFlag : 1,
                    activeMins: jsonData.activeMins !== undefined ? jsonData.activeMins : 1,
                    deletedFlag: jsonData.deletedFlag !== undefined ? jsonData.deletedFlag : 0,
                    activeMemo: jsonData.activeMemo || 'google',
                    imageURL: jsonData.imageURL || '',
                    thumbNailURL: jsonData.thumbNailURL || '',
                    createdAt: jsonData.createdAt || new Date().toISOString(),
                    modifiedAt: jsonData.modifiedAT || jsonData.modifiedAt || new Date().toISOString()
                };
                console.log('Data being sent to server:', dataToSend);
                try {
                    const response = await fetch(
                        'https://vw.aisrv.in/node_backend/postProjectV1',
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(dataToSend),
                            timeout: 10000
                        }
                    );

                    if (response.status === 200) {
                        // Delete the file after successful upload
                        await fs.unlink(filePath);
                        console.log(`Processed and deleted: ${filePath}`);
                    }

                    console.log(`✅ Successfully processed ${filePath}`);
                } catch (error) {
                    console.error(`❌ Error processing ${filePath}:`, error.message);
                    if (error.response) {
                        console.error('Server error details:', error.response.data);
                    }
                }
            } catch (error) {
                console.error('Error in processScreenshotFiles:', error);
            }
        }
    } catch (error) {
        console.error('Error in processScreenshotFiles:', error);
    }
}
async function initScreenshotWatcher() {
    const screenshotsDir = path.join(__dirname, 'public', 'screenshots');

    try {
        await fs.mkdir(screenshotsDir, { recursive: true });

        // Process existing files first
        console.log('Processing existing files...');
        await processScreenshotFiles();
        console.log('✅ Successfully processed existing files');
        // Set up file watcher
        const chokidar = require('chokidar');
        const watcher = chokidar.watch(screenshotsDir, {
            ignored: /(^|[\/\\])\../,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 1000,
                pollInterval: 100
            }
        });

        watcher.on('add', async (filePath) => {
            if (filePath.endsWith('.json') && path.basename(filePath).startsWith('screenshot_')) {
                console.log('New file added:', filePath);
                await processScreenshotFiles();
            }
        });

        watcher.on('error', error => {
            console.error('Watcher error:', error);
        });

    } catch (error) {
        console.error('Error setting up file watcher:', error);
    }
}
async function getJsonFilesRecursively(dir) {
    let results = [];
    try {
        const files = await fs.readdir(dir, { withFileTypes: true });

        for (const file of files) {
            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
                results = [...results, ...await getJsonFilesRecursively(fullPath)];
            } else if (file.name.endsWith('.json') && file.name.startsWith('screenshot_')) {
                // Include files that are in date-based di
                const parentDir = path.basename(path.dirname(fullPath));
                if (/^\d{4}-\d{2}-\d{2}$/.test(parentDir)) { // Matches YYYY-MM-DD format
                    results.push(fullPath);
                }
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
    }
    console.log('results:', results);
    return results;
}
// function getHourlyFolderName() {
//     const now = new Date();
//     const hour = now.getHours();
//     // Format as "10-11" for 10:00-10:59
//     return `${String(hour).padStart(2, '0')}-${String(hour + 1).padStart(2, '0')}`;
// }

async function saveScreenshotLocally(data) {
    try {
        const baseFolder = path.join(__dirname, 'public', 'screenshots');
        const datePath = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const screenshotFolder = path.join(baseFolder, `project_${data.projectID}`, `task_${data.taskID}`, datePath);
        await fs.ensureDir(screenshotFolder);

        // Define filenames
        const timestamp = Date.now();
        const jsonFilename = `screenshot_${timestamp}.json`;
        

        // Log the actual base64 prefixes for debugging
        console.log("Debug: imageURL prefix:", data.imageURL?.substring(0, 50));
        console.log("Debug: thumbnailURL prefix:", data.thumbNailURL?.substring(0, 50));

        // Validate base64 format
        const screenshotMatch = data.imageURL?.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
        const thumbnailMatch = data.thumbNailURL?.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);

        if (!screenshotMatch || !thumbnailMatch) {
            console.log("🧪 imageURL prefix:", data.imageURL?.substring(0, 50));
            console.log("🧪 thumbnailURL prefix:", data.thumbNailURL?.substring(0, 50));
            console.error("❌ Invalid base64 image format");
            return { success: false, error: "Invalid base64 image format" };
        }

        // Decode and write screenshot image
       
        // Write JSON metadata
        const metadata = {
            projectID: data.projectID,
            userID: data.userID,
            taskID: data.taskID,
            screenshotTimeStamp: new Date().toISOString(),
            calcTimeStamp: new Date().toISOString(),
            keyboardJSON: data.keyboardJSON,
            mouseJSON: data.mouseJSON,
            activeJSON: { app: data.activeJSON || 'Unknown' },
            activeFlag: 1,
            activeMins: 1, // default or calculated
            deletedFlag: 0,
            activeMemo: '',
            imageURL: data.imageURL,  // Store the actual base64 data
            thumbNailURL: data.thumbNailURL,  // Store the actual base64 data
            createdAt: new Date().toISOString(),
            modifiedAT: new Date().toISOString()
        };

        await fs.writeJson(path.join(screenshotFolder, jsonFilename), metadata, { spaces: 2 });
        console.log(`✅ Saved screenshot: ${jsonFilename}`);
        return {
            success: true,
            savedLocally: true,
            filePath: path.join(screenshotFolder, jsonFilename)
        };
    } catch (error) {
        console.error('Error saving screenshot locally:', error);
        throw error;
    }
}


// Fixed takeScreenshot function
async function takeScreenshot() {
    try {
        console.log(`Taking screenshot with counts - Keyboard: ${currentKeyboardCount}, Mouse: ${currentMouseCount}`);
        
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: screen.getPrimaryDisplay().workAreaSize
        });

        // Generate full-size screenshot with base64 prefix
        const fullSizeBase64 = `data:image/png;base64,${sources[0].thumbnail.resize({
            width: 1200,
            height: 800,
            quality: 'good'
        }).toJPEG(60).toString('base64')}`;

        // Generate thumbnail with base64 prefix
        const thumbnailBase64 = `data:image/png;base64,${sources[0].thumbnail.resize({
            width: 300,
            height: 200,
            quality: 'good'
        }).toJPEG(60).toString('base64')}`;

        // Store current counts before reset
        const keyboardCount = currentKeyboardCount;
        const mouseCount = currentMouseCount;

        // Prepare workdiary data with PROPER JSON format for counts
        const workdiaryData = {
            projectID: currentProjectID,
            userID: currentUserID,
            taskID: currentTaskID,
            screenshotTimeStamp: new Date(),
            calcTimeStamp: new Date(),
            // Store counts as JSON strings
            keyboardJSON: JSON.stringify({ clicks: keyboardCount }),
            mouseJSON: JSON.stringify({ clicks: mouseCount }),
            imageURL: fullSizeBase64,
            thumbNailURL: thumbnailBase64,
            activeFlag: 1,
            deletedFlag: 0,
            activeMemo: 'google',
            createdAt: new Date(),
            modifiedAT: new Date()
        };

        console.log('Screenshot data with counts:', {
            keyboard: workdiaryData.keyboardJSON,
            mouse: workdiaryData.mouseJSON,
            dataSize: JSON.stringify(workdiaryData).length / 1024 + ' KB'
        });

        // Try to save to server first
        const result = await saveToWorkdiary(workdiaryData);
        
        // Reset counters ONLY after successful screenshot
        if (result.success) {
            console.log(`Resetting counters - Previous: K:${keyboardCount}, M:${mouseCount}`);
            
            // Reset all screenshot-related counters
            currentMouseCount = 0;
            currentKeyboardCount = 0;
            mouseClickCount = 0;
            keyboardPressCount = 0;
            
            // Emit screenshot taken event with the counts that were used
            mainWindow?.webContents.send('screenshot-taken', {
                success: true,
                mouseClickCount: mouseCount,
                keyboardPressCount: keyboardCount,
                resetInfo: { mouseClicks: mouseCount, keyPresses: keyboardCount }
            });
            
            return { 
                ...result, 
                resetInfo: { mouseClicks: mouseCount, keyPresses: keyboardCount },
                countersReset: true
            };
        } else {
            console.log('Screenshot failed, keeping counters:', { keyboardCount, mouseCount });
            
            // Emit screenshot taken event with error
            mainWindow?.webContents.send('screenshot-taken', {
                success: false,
                error: result.error,
                mouseClickCount: mouseCount,
                keyboardPressCount: keyboardCount
            });
            
            return { 
                ...result,
                countersReset: false
            };
        }

    } catch (error) {
        console.error('Error in takeScreenshot:', error);
        
        // Emit screenshot taken event even on error
        mainWindow?.webContents.send('screenshot-taken', {
            success: false,
            error: error.message,
            mouseClickCount: currentMouseCount,
            keyboardPressCount: currentKeyboardCount
        });
        
        return { 
            success: false, 
            error: error.message,
            savedLocally: false,
            countersReset: false
        };
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

function startTracking() {
    if (isTracking) return;
    isTracking = true;

    // Reset counters when starting tracking
    currentMouseCount = 0;
    currentKeyboardCount = 0;
    mouseClickCount = 0;
    keyboardPressCount = 0;

    uIOhook.start();
    
    // Start activity tracking for postProjectV2
    startActivityTracking();
    
    const firstDelay = Math.floor(Math.random() * SCREENSHOT_INTERVAL);
    console.log(`🕓 First screenshot will be taken in ${Math.floor(firstDelay / 1000)} seconds`);

    setTimeout(() => {
        takeScreenshot();
    }, firstDelay);
    
    // Set up the recurring interval
    trackingInterval = setInterval(() => {
        const randomDelay = Math.floor(Math.random() * SCREENSHOT_INTERVAL);
        console.log(`🕓 Next screenshot will be taken in ${Math.floor(randomDelay / 1000)} seconds`);

        setTimeout(() => {
            takeScreenshot();
        }, randomDelay);
    }, SCREENSHOT_INTERVAL);

    // Mouse move event (no counting needed)
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

    // Mouse click event - increment both counters
    uIOhook.on('click', (event) => {
        currentMouseCount++; // For screenshot data
        activityData.currentMinuteMouse++; // For activity tracking
        mouseClickCount++; // Legacy counter
        
        sendGlobalEvent({
            type: 'mouseclick',
            button: event.button,
            x: event.x,
            y: event.y
        });
    });

    // Keyboard press event - increment both counters
    uIOhook.on('keydown', (event) => {
        currentKeyboardCount++; // For screenshot data
        activityData.currentMinuteKeyboard++; // For activity tracking
        keyboardPressCount++; // Legacy counter
        
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

    console.log('Started tracking global input events');
    if (mainWindow) {
        mainWindow.webContents.send('tracking-status', { isTracking: true });
    }
}

function stopTracking() {
    if (!isTracking) return;
    isTracking = false;

    // Clear the screenshot interval
    if (trackingInterval) {
        clearInterval(trackingInterval);
        trackingInterval = null;
    }

    uIOhook.removeAllListeners();
    console.log('Stopped tracking global input events');
    if (mainWindow) {
        mainWindow.webContents.send('tracking-status', { isTracking: false });
    }

}
// Add this after the existing code, before app.whenReady()
async function saveActHoursLocally(projectID, taskID, data) {
    try {
        // Create the folder path: public/screenshots/project_{projectID}/task_{taskID}/
        const screenshotsDir = path.join(
            'public',
            'screenshots',
            `project_${projectID}`,
            `task_${taskID}`
        );

        try {
            // Ensure the directory exists
            await fs.ensureDir(screenshotsDir);

            // Prepare the file path with timestamp
            const timestamp = new Date().getTime();
            const filePath = path.join(screenshotsDir, `taskData_${taskID}.json`);

            // Prepare data to save
            const dataToSave = {
                ...data,
                taskID,
                projectID,
                lastUpdated: new Date().toISOString(),
                actHours: data.actHours,
                isExceeded: data.isExceeded,
            };

            // Save to file
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

        // Check if directory exists
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

                // Get the most recent file
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
        // Add this with your other IPC handlers in main.js
        ipcMain.handle('get-tracking-status', async () => {
            return { isTracking };
        });
        ipcMain.handle('set-tracking-context', (event, context) => {
            currentProjectID = context.projectID;
            currentUserID = context.userID;
            currentProjectName = context.projectname;
            currentTaskName = context.taskname;
            // Priority order: subactionItemID > actionItemID > subtaskID > taskID
            if (context.subactionItemID) {
                currentTaskID = context.subactionItemID;
                currentTaskName = context.subactionname;
                console.log('Tracking subaction item with ID:', currentTaskID);
            } else if (context.actionItemID) {
                currentTaskID = context.actionItemID;
                currentTaskName = context.actionname;
                console.log('Tracking action item with ID:', currentTaskID);
            } else if (context.subtaskID) {
                currentTaskID = context.subtaskID;
                currentTaskName = context.subtaskname;
                console.log('Tracking subtask with ID:', currentTaskID);
            } else {
                currentTaskID = context.taskID;
                currentTaskName = context.taskname;
                console.log('Tracking task with ID:', currentTaskID);
            }

            return { success: true };
        });
        ipcMain.handle('take-screenshot', async (_, mouse, keyboard) => {
            try {
                return await takeScreenshot(mouse, keyboard);
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
                // First try to save to the server
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
                    // If server save is successful, save locally with isSynced=true
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
                // If server save fails, save locally only
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

            // Load the app
            const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, 'build/index.html')}`;
            mainWindow.loadURL(startUrl);

            // Open the DevTools in development
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

    // Clean up on app quit
    app.on('will-quit', () => {
        stopTracking();
        uIOhook.stop();
    });
}  