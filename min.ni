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

// Activity tracking variables - Updated structure
const ACTIVITY_BLOCK_SIZE = 2; // 2-minute blocks
const ACTIVITY_INTERVAL_MS = 10000; // 10 seconds in milliseconds
let activityIntervalId = null;

// Block timing variables
let currentBlockStartTime = null;
let currentBlockFolder = null;
let screenshotTaken = false;

// Activity data structure
let activityData = {
    activeJSON: Array(10).fill(null).map(() => ({ keyboard: 0, mouse: 0, active: 0 })),
    currentMinuteKeyboard: 0,
    currentMinuteMouse: 0
};

// Set screenshot interval to 2 minutes
const SCREENSHOT_INTERVAL = 2 * 60 * 1000; // 2 minutes in milliseconds

// Function to schedule random screenshot within 2-minute block
function scheduleRandomScreenshot() {
    if (screenshotTaken) return;
    
    // Generate random time within the 2-minute block (1-119 seconds)
    const randomSeconds = Math.floor(Math.random() * 119) + 1; // 1-119 seconds
    const randomDelay = randomSeconds * 1000;
    
    console.log(`Screenshot scheduled in ${Math.floor(randomSeconds/60)}m ${randomSeconds%60}s`);
    
    setTimeout(async () => {
        if (!screenshotTaken && isTracking) {
            await takeScreenshot();
            screenshotTaken = true;
        }
    }, randomDelay);
}
let currentProjectID = null;
let currentUserID = null;
let currentTaskID = null;

// Function to get the proper 10-minute block timing (0-9, 10-19, 20-29, etc.)
function getCurrentBlockInfo() {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    
    // Calculate the start minute of current 2-minute block (0-1, 2-3, 4-5, etc.)
    const blockStartMinute = Math.floor(minutes / 2) * 2;
    
    const blockStartTime = new Date(now);
    blockStartTime.setMinutes(blockStartMinute, 0, 0);
    
    const blockEndTime = new Date(blockStartTime);
    blockEndTime.setMinutes(blockStartTime.getMinutes() + 2);
    
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
        __dirname, 'public', 'activity',
        `activity-${currentProjectID}-${currentTaskID}-${dateStr}-${timeStr}`
    );
}

// Function to create screenshot folder path
function getScreenshotFolderPath() {
    const blockInfo = getCurrentBlockInfo();
    const dateStr = blockInfo.blockStartTime.toISOString().split('T')[0];
    const timeStr = blockInfo.blockStartTime.toTimeString().slice(0, 5).replace(':', '');
    
    return path.join(
        __dirname, 'public', 'screenshots',
        `project_${currentProjectID}`,
        `task_${currentTaskID}`,
        dateStr,
        `block_${timeStr}`
    );
}

// Function to start activity tracking
function startActivityTracking() {
    const blockInfo = getCurrentBlockInfo();
    currentBlockStartTime = blockInfo.blockStartTime;
    currentBlockFolder = getActivityFolderPath();
    screenshotTaken = false;
    
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

    // Schedule random screenshot within this 10-minute block
    scheduleRandomScreenshot();

    // Collect activity data every 10 seconds
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
            screenshotTaken = false;
            activityData = {
                activeJSON: Array(10).fill(null).map(() => ({ keyboard: 0, mouse: 0, active: 0 })),
                currentMinuteKeyboard: 0,
                currentMinuteMouse: 0
            };
            fs.ensureDirSync(currentBlockFolder);
            console.log(`Started new 10-minute block: ${currentBlockStartTime.toISOString()}`);
            
            // Schedule screenshot for new block
            scheduleRandomScreenshot();
        }

        // Calculate 10-second interval index (0-9)
        const tenSecondIndex = Math.floor((now - currentBlockStartTime) / 10000) % 10;
        
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

// Function to schedule random screenshot within 10-minute block
function scheduleRandomScreenshot() {
    if (screenshotTaken) return;
    
    // Generate random time within the 10-minute block (1-9 minutes to avoid edge cases)
    const randomMinutes = Math.floor(Math.random() * 2) + 1; // 1-8 minutes
    const randomSeconds = Math.floor(Math.random() * 60); // 0-59 seconds
    const randomDelay = (randomMinutes * 60 + randomSeconds) * 1000;
    
    console.log(`Screenshot scheduled in ${randomMinutes}m ${randomSeconds}s`);
    
    setTimeout(async () => {
        if (!screenshotTaken && isTracking) {
            await takeScreenshot();
            screenshotTaken = true;
        }
    }, randomDelay);
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
            taskID: currentTaskID,
            blockStartTime: currentBlockStartTime.toISOString()
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
        const totalActiveMins = activityData.activeJSON.reduce((sum, slot) => sum + (slot ? slot.active : 0), 0);
        
        // Create combined activity file
        const combinedActivityFile = path.join(currentBlockFolder, 'combined_activity.json');
        const combinedData = {
            projectID: currentProjectID,
            userID: currentUserID,
            taskID: currentTaskID,
            blockStartTime: currentBlockStartTime.toISOString(),
            blockEndTime: new Date(currentBlockStartTime.getTime() + 2 * 60 * 1000).toISOString(), // 2 minutes
            activeJSON: [...activityData.activeJSON],
            activeFlag: totalActiveMins,
            activeMins: totalActiveMins,
            deletedFlag: 0,
            activeMemo: `Activity block completed: ${totalActiveMins}/2 minutes active`, // Changed to 2 minutes
            createdAt: new Date().toISOString()
        };
        
        await fs.writeJson(combinedActivityFile, combinedData, { spaces: 2 });
        console.log('Saved combined activity data');
        
        // Try to send to server with screenshot data
        await sendBlockToServer(combinedData);
        
    } catch (error) {
        console.error('Error finishing current block:', error);
    }
}

// Function to send completed block to server
async function sendBlockToServer(blockData) {
    try {
        // Check if there's a screenshot for this block
        const screenshotFolderPath = getScreenshotFolderPath();
        const screenshotFile = path.join(screenshotFolderPath, 'screenshot.json');
        let screenshotData = null;
        
        if (await fs.pathExists(screenshotFile)) {
            screenshotData = await fs.readJson(screenshotFile);
        }
        
        // Filter activeJSON to only include the last 2 minutes of data
        const lastTwoMinutesActiveJSON = blockData.activeJSON.slice(-2);
        
        const payload = {
            projectID: blockData.projectID,
            userID: blockData.userID,
            taskID: blockData.taskID,
            screenshotTimeStamp: blockData.blockStartTime,
            calcTimeStamp: blockData.createdAt,
            activeJSON: lastTwoMinutesActiveJSON,
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
            // Clean up the block folders after successful send
            await fs.remove(currentBlockFolder);
            if (await fs.pathExists(screenshotFolderPath)) {
                await fs.remove(screenshotFolderPath);
            }
            console.log('Cleaned up block folders');
        } else {
            console.error('Failed to send block to server:', response.status);
        }
        
    } catch (error) {
        console.error('Error sending block to server:', error);
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
                blockStartTime: currentBlockStartTime.toISOString(),
                screenshotTakenAt: new Date().toISOString()
            };
            
            const screenshotFile = path.join(screenshotFolderPath, 'screenshot.json');
            await fs.writeJson(screenshotFile, screenshotData, { spaces: 2 });
            
            console.log(`Screenshot saved to: ${screenshotFile}`);
            
            // Emit success event
            mainWindow?.webContents.send('screenshot-success', {
                timestamp: new Date().toISOString(),
                projectID: currentProjectID,
                taskID: currentTaskID,
                screenshotPath: screenshotFile
            });
            
            return screenshotFile;
        }
    } catch (error) {
        console.error('Error taking screenshot:', error);
        throw error;
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
        
        

        uIOhook.on('mousedown', (event) => {
            activityData.currentMinuteMouse += 1;
            // Send mouse click count to renderer
            mainWindow?.webContents.send('activity-update', {
                type: 'mouseclick',
                count: activityData.currentMinuteMouse
            });
            console.log('Mouse down:', event.button);
        });

        uIOhook.on('keydown', (event) => {
            activityData.currentMinuteKeyboard += 1;
            // Send keyboard count to renderer
            mainWindow?.webContents.send('activity-update', {
                type: 'keydown',
                count: activityData.currentMinuteKeyboard
            });
            console.log('Key down:', event.keycode);
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
        screenshotTaken = false;
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
            const filePath = path.join(screenshotsDir, `taskData_${taskID}_${timestamp}.json`);

            // Prepare data to save
            const dataToSave = {
                ...data,
                taskID,
                projectID,
                lastUpdated: new Date().toISOString(),
                actHours: data.actHours,
                isExceeded: data.isExceeded,
                timestamp: timestamp
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